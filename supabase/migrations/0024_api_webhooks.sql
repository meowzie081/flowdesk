-- Публичный API v1: персональные токены и вебхуки на события отдела.

create table public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  token_hash text not null unique,
  token_prefix text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index api_tokens_user_idx on public.api_tokens(user_id);
alter table public.api_tokens enable row level security;
create policy tokens_read on public.api_tokens for select to authenticated using (user_id = auth.uid());
create policy tokens_insert on public.api_tokens for insert to authenticated with check (user_id = auth.uid());
create policy tokens_delete on public.api_tokens for delete to authenticated using (user_id = auth.uid());
revoke update on public.api_tokens from authenticated, anon;
grant all on public.api_tokens to service_role;

create function public.api_tokens_limit() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then return new; end if;
  if (select count(*) from api_tokens where user_id = new.user_id) >= 5 then
    raise exception 'Не более пяти API-токенов. Удалите неиспользуемый.';
  end if;
  return new;
end $$;
revoke all on function public.api_tokens_limit() from public, anon, authenticated;
create trigger api_tokens_limit before insert on public.api_tokens
  for each row execute function public.api_tokens_limit();

create table public.api_webhooks (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  url text not null check (char_length(url) between 8 and 2000 and url ~ '^https://'),
  secret text not null,
  events text[] not null default array['task.created','task.moved','task.done','task.assigned','task.commented'],
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint api_webhooks_events check (
    cardinality(events) > 0
    and events <@ array['task.created','task.moved','task.done','task.assigned','task.commented']
  )
);
create index api_webhooks_department_idx on public.api_webhooks(department_id);
alter table public.api_webhooks enable row level security;
create policy webhooks_read on public.api_webhooks for select to authenticated using (public.is_owner(department_id));
create policy webhooks_insert on public.api_webhooks for insert to authenticated
  with check (public.is_owner(department_id) and created_by = auth.uid());
create policy webhooks_update on public.api_webhooks for update to authenticated
  using (public.is_owner(department_id)) with check (public.is_owner(department_id));
create policy webhooks_delete on public.api_webhooks for delete to authenticated using (public.is_owner(department_id));
grant all on public.api_webhooks to service_role;

create function public.api_webhooks_limit() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then return new; end if;
  if (select count(*) from api_webhooks where department_id = new.department_id) >= 5 then
    raise exception 'Не более пяти вебхуков на отдел.';
  end if;
  return new;
end $$;
revoke all on function public.api_webhooks_limit() from public, anon, authenticated;
create trigger api_webhooks_limit before insert on public.api_webhooks
  for each row execute function public.api_webhooks_limit();

-- Очередь доставки: копия notification_outbox (0014), наружу не видна.
create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references public.api_webhooks(id) on delete cascade,
  event_id uuid not null references public.task_events(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','processing','sent','skipped','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lock_token uuid,
  locked_at timestamptz,
  finished_at timestamptz,
  last_error text,
  unique (webhook_id, event_id)
);
create index webhook_due_idx on public.webhook_deliveries(status, available_at);
alter table public.webhook_deliveries enable row level security;
revoke all on public.webhook_deliveries from anon, authenticated;
grant all on public.webhook_deliveries to service_role;
grant select on public.task_events to service_role;

create function public.queue_webhook_delivery() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into webhook_deliveries (webhook_id, event_id)
  select w.id, new.id from api_webhooks w
  where w.department_id = new.department_id and w.active and ('task.' || new.kind) = any(w.events)
  on conflict do nothing;
  return new;
end $$;
revoke all on function public.queue_webhook_delivery() from public, anon, authenticated;
create trigger task_events_queue_webhooks after insert on public.task_events
  for each row execute function public.queue_webhook_delivery();

-- Короткие аренды + SKIP LOCKED: параллельные cron-запуски не берут одну задачу дважды.
create function public.claim_webhook_deliveries(batch_size integer default 10)
returns setof public.webhook_deliveries language plpgsql security definer set search_path=public as $$
begin
  return query
  with due as (
    select id from webhook_deliveries
    where ((status='pending' and available_at<=now()) or (status='processing' and locked_at<now()-interval '5 minutes'))
      and attempts<5
    order by available_at for update skip locked limit greatest(1,least(batch_size,10))
  )
  update webhook_deliveries o set status='processing', attempts=o.attempts+1, lock_token=gen_random_uuid(), locked_at=now()
  from due where o.id=due.id returning o.*;
  update webhook_deliveries set status='failed', finished_at=now(), last_error='lease_expired'
  where status='processing' and attempts>=5 and locked_at<now()-interval '5 minutes';
end $$;
revoke all on function public.claim_webhook_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_webhook_deliveries(integer) to service_role;