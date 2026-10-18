begin;
create table public.task_help_requests (
 id uuid primary key default gen_random_uuid(), task_id uuid not null references public.tasks(id) on delete cascade,
 requester_id uuid not null references public.profiles(id), helper_id uuid not null references public.profiles(id),
 reason text not null check(reason in ('file','access','decision','other')),
 detail text not null check(char_length(btrim(detail)) between 1 and 1000),
 status text not null default 'open' check(status in ('open','answered','resolved','cancelled')),
 response text not null default '' check(char_length(response)<=2000),
 created_at timestamptz not null default now(),answered_at timestamptz,closed_at timestamptz,
 check(requester_id<>helper_id)
);
create unique index task_help_active on public.task_help_requests(task_id) where status in ('open','answered');
create index help_incoming on public.task_help_requests(helper_id,status,created_at desc);
alter table public.task_help_requests enable row level security;
create policy help_read on public.task_help_requests for select to authenticated using(is_member(task_dep(task_id)));
grant select on public.task_help_requests to authenticated;
revoke insert,update,delete on public.task_help_requests from authenticated,anon;

create table public.day_plans (
 user_id uuid not null references public.profiles(id) on delete cascade,
 task_id uuid not null references public.tasks(id) on delete cascade,
 day date not null,primary key(user_id,task_id,day)
);
alter table public.day_plans enable row level security;
create policy plans_read on public.day_plans for select to authenticated using(user_id=auth.uid() and is_member(task_dep(task_id)));
create policy plans_insert on public.day_plans for insert to authenticated with check(user_id=auth.uid() and can_write(task_dep(task_id)) and exists(select 1 from tasks t join columns c on c.id=t.column_id where t.id=task_id and t.assignee_id=auth.uid() and t.archived_at is null and not c.is_done));
create policy plans_delete on public.day_plans for delete to authenticated using(user_id=auth.uid() and is_member(task_dep(task_id)));
grant select,insert,delete on public.day_plans to authenticated;
grant all on public.day_plans,public.task_help_requests to service_role;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in('assigned','comment','mention','reply','help_request','help_response'));
create function public.request_task_help(task uuid,helper uuid,reason_code text,details text) returns uuid
language plpgsql security definer set search_path=public as $$
declare dep uuid;result uuid;t tasks;
begin
 select * into t from tasks where id=task for update;
 dep:=board_dep(t.board_id);
 if dep is null or not can_write(dep) then raise exception 'Нет доступа к задаче';end if;
 if t.archived_at is not null or exists(select 1 from columns where id=t.column_id and is_done) then raise exception 'Выберите активную незавершённую задачу';end if;
 if helper=auth.uid() or not exists(select 1 from department_members where department_id=dep and user_id=helper and blocked_at is null and role in('owner','member')) then raise exception 'Выберите другого активного участника с правом записи';end if;
 if exists(select 1 from task_help_requests where task_id=task and status in('open','answered')) then raise exception 'У этой задачи уже есть активный запрос помощи';end if;
 insert into task_help_requests(task_id,requester_id,helper_id,reason,detail) values(task,auth.uid(),helper,reason_code,btrim(details)) returning id into result;
 insert into notifications(user_id,department_id,task_id,kind,title,body) values(helper,dep,task,'help_request','Нужна ваша помощь: '||t.title,left(details,140));
 return result;
end $$;
create function public.respond_task_help(request uuid,answer text) returns void
language plpgsql security definer set search_path=public as $$
declare r task_help_requests;dep uuid;
begin
 select * into r from task_help_requests where id=request for update;dep:=task_dep(r.task_id);
 if r.id is null or not can_write(dep) or r.helper_id<>auth.uid() then raise exception 'Ответить может только назначенный участник';end if;
 if r.status<>'open' then raise exception 'Запрос уже обработан';end if;
 if char_length(btrim(answer)) not between 1 and 2000 then raise exception 'Ответ: 1–2000 символов';end if;
 update task_help_requests set status='answered',response=btrim(answer),answered_at=now() where id=request;
 insert into notifications(user_id,department_id,task_id,kind,title,body) values(r.requester_id,dep,r.task_id,'help_response','Получен ответ на запрос помощи',left(answer,140));
end $$;
create function public.close_task_help(request uuid,cancel boolean default false) returns void
language plpgsql security definer set search_path=public as $$
declare r task_help_requests;dep uuid;
begin
 select * into r from task_help_requests where id=request for update;dep:=task_dep(r.task_id);
 if r.id is null or not can_write(dep) or (r.requester_id<>auth.uid() and not is_owner(dep)) then raise exception 'Закрыть запрос может автор или владелец';end if;
 if r.status not in('open','answered') then raise exception 'Запрос уже закрыт';end if;
 if not cancel and r.status<>'answered' then raise exception 'Сначала дождитесь ответа или отмените запрос';end if;
 update task_help_requests set status=case when cancel then 'cancelled' else 'resolved' end,closed_at=now() where id=request;
end $$;
revoke all on function public.request_task_help(uuid,uuid,text,text),public.respond_task_help(uuid,text),public.close_task_help(uuid,boolean) from public;
grant execute on function public.request_task_help(uuid,uuid,text,text),public.respond_task_help(uuid,text),public.close_task_help(uuid,boolean) to authenticated;

create function public.my_day(dep uuid,day date) returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb;
begin
 if not is_member(dep) then raise exception 'Нет доступа к отделу';end if;
 if day is null then raise exception 'Укажите дату';end if;
 select jsonb_build_object(
 'tasks',coalesce((select jsonb_agg(x order by x.due_date nulls last,x.id) from (
  select t.id,t.title,t.priority,t.due_date,t.blocked_reason,exists(select 1 from day_plans p where p.task_id=t.id and p.user_id=auth.uid() and p.day=my_day.day) as planned
  from tasks t join boards b on b.id=t.board_id join columns c on c.id=t.column_id
  where b.department_id=dep and t.assignee_id=auth.uid() and t.archived_at is null and not c.is_done
 )x),'[]'::jsonb),
 'requests',coalesce((select jsonb_agg(x order by x.created_at desc) from (
  select r.*,t.title as task_title,coalesce(nullif(a.full_name,''),'Участник') as requester_name,coalesce(nullif(h.full_name,''),'Участник') as helper_name
  from task_help_requests r join tasks t on t.id=r.task_id join boards b on b.id=t.board_id
  join profiles a on a.id=r.requester_id join profiles h on h.id=r.helper_id
  where b.department_id=dep and t.archived_at is null and r.status in('open','answered')
  and (r.requester_id=auth.uid() or r.helper_id=auth.uid() or t.assignee_id=auth.uid() or is_owner(dep))
 )x),'[]'::jsonb),
 'inbox',coalesce((select jsonb_agg(x order by x.created_at desc) from (
  select id,task_id,message_id,kind,title,body,created_at from notifications where department_id=dep and user_id=auth.uid() and read_at is null and kind in('mention','reply') order by created_at desc limit 30
 )x),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.my_day(uuid,date) from public;
grant execute on function public.my_day(uuid,date) to authenticated;
commit;
