-- Email, Web Push, department announcements and account-level onboarding.
create table public.notification_preferences (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 email_events boolean not null default false,
 email_announcements boolean not null default false,
 push_enabled boolean not null default false
);
alter table public.notification_preferences enable row level security;
create policy preferences_own on public.notification_preferences for all to authenticated
 using(user_id=auth.uid()) with check(user_id=auth.uid());
grant select,insert,update,delete on public.notification_preferences to authenticated;

create table public.onboarding_progress (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 status text not null default 'new' check(status in('new','completed','skipped')),
 updated_at timestamptz not null default now()
);
alter table public.onboarding_progress enable row level security;
create policy onboarding_own on public.onboarding_progress for all to authenticated
 using(user_id=auth.uid()) with check(user_id=auth.uid());
grant select,insert,update on public.onboarding_progress to authenticated;

create table public.email_campaigns (
 id uuid primary key,
 department_id uuid not null references public.departments(id) on delete cascade,
 created_by uuid not null references public.profiles(id),
 subject text not null check(char_length(subject) between 1 and 120),
 body text not null check(char_length(body) between 1 and 4000),
 recipient_count integer not null default 0,
 created_at timestamptz not null default now()
);
alter table public.email_campaigns enable row level security;
revoke all on public.email_campaigns from anon,authenticated;
grant select on public.email_campaigns to authenticated;
create policy campaign_read on public.email_campaigns for select to authenticated
 using(public.is_member(department_id));

-- Device endpoints are capabilities: never expose them through the browser DB API.
create table public.push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 endpoint text not null unique check(char_length(endpoint)<=2048),
 p256dh text not null,
 auth text not null,
 created_at timestamptz not null default now()
);
create index push_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon,authenticated;

alter table public.notifications add column campaign_id uuid references public.email_campaigns(id) on delete cascade;
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
 check(kind in('assigned','comment','mention','reply','help_request','help_response','announcement'));
-- Recipients may mark a notification read, but cannot rewrite routing/content.
revoke update on public.notifications from authenticated;
grant update(read_at) on public.notifications to authenticated;

create table public.notification_outbox (
 id uuid primary key default gen_random_uuid(),
 notification_id uuid not null references public.notifications(id) on delete cascade,
 channel text not null check(channel in('email','push')),
 status text not null default 'pending' check(status in('pending','processing','sent','skipped','failed')),
 attempts integer not null default 0,
 available_at timestamptz not null default now(),
 lock_token uuid,
 locked_at timestamptz,
 finished_at timestamptz,
 last_error text,
 unique(notification_id,channel)
);
create index outbox_due_idx on public.notification_outbox(status,available_at);
alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from anon,authenticated;
grant all on public.notification_preferences,public.onboarding_progress,public.email_campaigns,public.push_subscriptions,public.notification_outbox to service_role;
grant select on public.notifications,public.department_members to service_role;

create function public.queue_notification_delivery() returns trigger language plpgsql security definer set search_path=public as $$
declare p public.notification_preferences;
begin
 select * into p from notification_preferences where user_id=new.user_id;
 if not found then return new; end if;
 if (new.kind='announcement' and p.email_announcements) or (new.kind<>'announcement' and p.email_events) then
  insert into notification_outbox(notification_id,channel) values(new.id,'email') on conflict do nothing;
 end if;
 if p.push_enabled then
  insert into notification_outbox(notification_id,channel) values(new.id,'push') on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function public.queue_notification_delivery() from public,anon,authenticated;
create trigger notifications_queue_delivery after insert on public.notifications
 for each row execute function public.queue_notification_delivery();

-- One client-generated UUID survives retries/double-clicks. Owners only; serialized rate limit.
create function public.publish_department_announcement(dep uuid,campaign uuid,heading text,content text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare existing email_campaigns; total integer;
begin
 if not public.is_owner(dep) then raise exception 'Только владелец отдела может создавать рассылки'; end if;
 perform 1 from departments where id=dep for update;
 select * into existing from email_campaigns where id=campaign;
 if found then
  if existing.department_id<>dep or existing.created_by<>auth.uid() or existing.subject<>btrim(heading) or existing.body<>btrim(content) then raise exception 'Идентификатор рассылки уже использован'; end if;
  return jsonb_build_object('id',existing.id,'recipients',existing.recipient_count);
 end if;
 if heading is null or content is null or char_length(btrim(heading)) not between 1 and 120 or char_length(btrim(content)) not between 1 and 4000 or heading ~ E'[\r\n]' then raise exception 'Проверьте тему и текст'; end if;
 if exists(select 1 from email_campaigns where department_id=dep and created_at>now()-interval '1 minute') then raise exception 'Подождите минуту перед следующей рассылкой'; end if;
 select count(*) into total from department_members where department_id=dep and blocked_at is null;
 if total>500 then raise exception 'В одной рассылке допускается до 500 участников'; end if;
 insert into email_campaigns(id,department_id,created_by,subject,body,recipient_count)
 values(campaign,dep,auth.uid(),btrim(heading),btrim(content),total);
 insert into notifications(user_id,department_id,kind,title,body,campaign_id)
 select user_id,dep,'announcement',btrim(heading),btrim(content),campaign
 from department_members where department_id=dep and blocked_at is null;
 return jsonb_build_object('id',campaign,'recipients',total);
end $$;
revoke all on function public.publish_department_announcement(uuid,uuid,text,text) from public,anon;
grant execute on function public.publish_department_announcement(uuid,uuid,text,text) to authenticated;

-- Short leases + SKIP LOCKED allow concurrent cron invocations without claiming the same job.
create function public.claim_notification_deliveries(batch_size integer default 10)
returns setof public.notification_outbox language plpgsql security definer set search_path=public as $$
begin
 return query
 with due as (
  select id from notification_outbox
  where ((status='pending' and available_at<=now()) or (status='processing' and locked_at<now()-interval '5 minutes'))
    and attempts<5
  order by available_at for update skip locked limit greatest(1,least(batch_size,10))
 )
 update notification_outbox o set status='processing',attempts=o.attempts+1,lock_token=gen_random_uuid(),locked_at=now()
 from due where o.id=due.id returning o.*;
 -- A worker may die during its last attempt; do not leave such rows processing forever.
 update notification_outbox set status='failed',finished_at=now(),last_error='lease_expired'
 where status='processing' and attempts>=5 and locked_at<now()-interval '5 minutes';
end $$;
revoke all on function public.claim_notification_deliveries(integer) from public,anon,authenticated;
grant execute on function public.claim_notification_deliveries(integer) to service_role;

create function public.register_push_device(account uuid,endpoint_url text,key_p text,key_a text)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform 1 from profiles where id=account for update;
 if exists(select 1 from push_subscriptions where endpoint=endpoint_url and user_id<>account) then raise exception 'Устройство связано с другим аккаунтом'; end if;
 if not exists(select 1 from push_subscriptions where endpoint=endpoint_url) and (select count(*) from push_subscriptions where user_id=account)>=5 then raise exception 'Не более пяти устройств'; end if;
 insert into push_subscriptions(user_id,endpoint,p256dh,auth) values(account,endpoint_url,key_p,key_a)
 on conflict(endpoint) do update set p256dh=excluded.p256dh,auth=excluded.auth;
end $$;
revoke all on function public.register_push_device(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.register_push_device(uuid,text,text,text) to service_role;

create function public.campaign_delivery_stats(dep uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 if not public.is_owner(dep) then raise exception 'Нет доступа'; end if;
 return coalesce((select jsonb_agg(row_to_json(s)) from (
  select c.id,o.channel,o.status,count(*)::integer as count
  from email_campaigns c join notifications n on n.campaign_id=c.id
  join notification_outbox o on o.notification_id=n.id
  where c.department_id=dep and c.created_at>now()-interval '30 days'
  group by c.id,o.channel,o.status
 ) s),'[]'::jsonb);
end $$;
revoke all on function public.campaign_delivery_stats(uuid) from public,anon;
grant execute on function public.campaign_delivery_stats(uuid) to authenticated;
