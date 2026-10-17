begin;

-- Department-scoped suspension takes effect for existing JWTs through every RLS helper.
alter table public.department_members add column blocked_at timestamptz;
create or replace function public.is_member(dep uuid) returns boolean language sql security definer stable set search_path=public as $$select exists(select 1 from department_members where department_id=dep and user_id=auth.uid() and blocked_at is null)$$;
create or replace function public.can_write(dep uuid) returns boolean language sql security definer stable set search_path=public as $$select exists(select 1 from department_members where department_id=dep and user_id=auth.uid() and blocked_at is null and role in('owner','member'))$$;
create or replace function public.is_owner(dep uuid) returns boolean language sql security definer stable set search_path=public as $$select exists(select 1 from department_members where department_id=dep and user_id=auth.uid() and blocked_at is null and role='owner')$$;

create function public.can_read_department(dep uuid) returns boolean language sql security definer stable set search_path=public as $$select is_member(dep) or exists(select 1 from departments d where d.id=dep and d.created_by=auth.uid() and not exists(select 1 from department_members m where m.department_id=dep and m.user_id=auth.uid()))$$;
drop policy dep_read on public.departments;
create policy dep_read on public.departments for select to authenticated using(can_read_department(id));
drop policy notif_read on public.notifications;
create policy notif_read on public.notifications for select to authenticated using(user_id=auth.uid() and is_member(department_id));
drop policy notif_update on public.notifications;
create policy notif_update on public.notifications for update to authenticated using(user_id=auth.uid() and is_member(department_id)) with check(user_id=auth.uid() and is_member(department_id));
drop policy notif_delete on public.notifications;
create policy notif_delete on public.notifications for delete to authenticated using(user_id=auth.uid() and is_member(department_id));
drop policy comments_delete on public.comments;
create policy comments_delete on public.comments for delete to authenticated using(can_write(task_dep(task_id)) and(author_id=auth.uid() or is_owner(task_dep(task_id))));

create table public.admin_audit (
 id uuid primary key default gen_random_uuid(), department_id uuid not null references public.departments(id) on delete cascade,
 actor_id uuid references public.profiles(id) on delete set null, target_id uuid references public.profiles(id) on delete set null,
 actor_name text not null default '',target_name text not null default '',action text not null, details jsonb not null default '{}', created_at timestamptz not null default now()
);
create function public.audit_names() returns trigger language plpgsql security definer set search_path=public as $$begin
 new.actor_name:=case when new.actor_id is null then 'Система' else coalesce((select nullif(full_name,'') from profiles where id=new.actor_id),'Участник') end;
 new.target_name:=coalesce((select nullif(full_name,'') from profiles where id=new.target_id),'Участник');return new;
end $$;
create trigger audit_names_snapshot before insert on public.admin_audit for each row execute function public.audit_names();
create index admin_audit_department_idx on public.admin_audit(department_id,created_at desc);
alter table public.admin_audit enable row level security;
create policy admin_audit_read on public.admin_audit for select to authenticated using(public.is_owner(department_id));
grant select on public.admin_audit to authenticated;
grant all on public.admin_audit to service_role;

create function public.membership_guard_log() returns trigger language plpgsql security definer set search_path=public as $$
declare dep uuid; target uuid; event text;
begin
 dep:=case when tg_op='DELETE' then old.department_id else new.department_id end;
 target:=case when tg_op='DELETE' then old.user_id else new.user_id end;
 perform 1 from departments where id=dep for update;
 if not found then if tg_op='DELETE' then return old; else return new; end if; end if;
 if tg_op='UPDATE' and (new.user_id<>old.user_id or new.department_id<>old.department_id) then raise exception 'Нельзя переносить членство'; end if;
 if tg_op<>'INSERT' and old.role='owner' and old.blocked_at is null then
  if tg_op='DELETE' or new.role<>'owner' or new.blocked_at is not null then
   if not exists(select 1 from department_members where department_id=dep and user_id<>target and role='owner' and blocked_at is null) then raise exception 'В отделе должен остаться активный владелец'; end if;
  end if;
 end if;
 event:=case when tg_op='INSERT' then case when exists(select 1 from managed_accounts where user_id=target and created_by=auth.uid()) then 'user_created' else 'member_added' end when tg_op='DELETE' then 'member_removed' when new.blocked_at is distinct from old.blocked_at then case when new.blocked_at is null then 'user_unblocked' else 'user_blocked' end else 'role_changed' end;
 if tg_op<>'UPDATE' or new.role is distinct from old.role or new.blocked_at is distinct from old.blocked_at then
  insert into admin_audit(department_id,actor_id,target_id,action,details) values(dep,auth.uid(),target,event,
   case when tg_op='DELETE' then jsonb_build_object('role',old.role) when tg_op='INSERT' then jsonb_build_object('role',new.role) else jsonb_build_object('old_role',old.role,'role',new.role) end);
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger membership_guard before insert or update or delete on public.department_members for each row execute function public.membership_guard_log();
create function public.set_member_blocked(dep uuid,target uuid,blocked boolean) returns void language plpgsql security definer set search_path=public as $$
begin
 perform 1 from departments where id=dep for update;
 if not is_owner(dep) or target=auth.uid() then raise exception 'Нельзя изменить доступ'; end if;
 update department_members set blocked_at=case when blocked then now() else null end where department_id=dep and user_id=target;
 if not found then raise exception 'Участник не найден'; end if;
end $$;
revoke all on function public.set_member_blocked(uuid,uuid,boolean) from public;
grant execute on function public.set_member_blocked(uuid,uuid,boolean) to authenticated;
-- Membership policies restrict all role and suspension updates to active department owners.

create function public.begin_password_reset(dep uuid,target uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare event uuid;
begin
 if not is_owner(dep) or target=auth.uid() or not exists(select 1 from department_members where department_id=dep and user_id=target) or not exists(select 1 from managed_accounts where user_id=target and created_by=auth.uid()) then raise exception 'Сбрасывать пароль можно только созданным вами аккаунтам этого отдела'; end if;
 insert into admin_audit(department_id,actor_id,target_id,action,details) values(dep,auth.uid(),target,'password_reset',jsonb_build_object('status','requested')) returning id into event;
 return event;
end $$;
revoke all on function public.begin_password_reset(uuid,uuid) from public;
grant execute on function public.begin_password_reset(uuid,uuid) to authenticated;
create function public.finish_password_reset(event uuid,success boolean) returns void language sql security definer set search_path=public as $$update admin_audit set details=jsonb_build_object('status',case when success then 'succeeded' else 'failed' end) where id=event and action='password_reset' and details->>'status'='requested'$$;
revoke all on function public.finish_password_reset(uuid,boolean) from public,authenticated,anon;
grant execute on function public.finish_password_reset(uuid,boolean) to service_role;

alter table public.tasks add column archived_at timestamptz;
alter table public.tasks add column archived_by uuid references public.profiles(id) on delete set null;
create index tasks_active_idx on public.tasks(board_id,column_id) where archived_at is null;
alter table public.task_events drop constraint task_events_kind_check;
alter table public.task_events add constraint task_events_kind_check check(kind in('created','moved','assigned','commented','done','edited','checklist','archived','restored','dependency'));
create function public.archive_task(task uuid,archived boolean) returns void language plpgsql security invoker set search_path=public as $$
begin
 update tasks set archived_at=case when archived then now() else null end,archived_by=case when archived then auth.uid() else null end where id=task;
 if not found then raise exception 'Нет доступа к задаче'; end if;
end $$;
revoke all on function public.archive_task(uuid,boolean) from public;
grant execute on function public.archive_task(uuid,boolean) to authenticated;
create function public.log_task_archive() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.archived_at is distinct from old.archived_at then insert into task_events(department_id,task_id,actor_id,kind,payload) values(board_dep(new.board_id),new.id,auth.uid(),case when new.archived_at is null then 'restored' else 'archived' end,jsonb_build_object('title',new.title)); end if;
 return new;
end $$;
create trigger tasks_archive_history after update on public.tasks for each row execute function public.log_task_archive();
create or replace view public.stuck_tasks with (security_invoker=true) as select t.id,t.board_id,t.title,t.assignee_id,t.moved_at,extract(day from now()-t.moved_at)::int as days_stuck from tasks t join columns c on c.id=t.column_id where not c.is_done and t.archived_at is null and t.moved_at<now()-interval '3 days';
-- Keep the existing summary API, but exclude archived tasks from current workload.
do $$declare src text;begin select pg_get_functiondef('public.daily_team_summary(uuid,timestamptz,timestamptz)'::regprocedure) into src;src:=replace(src,'where b.department_id=dep and not c.is_done','where b.department_id=dep and not c.is_done and t.archived_at is null');execute src;end $$;

create table public.task_dependencies (
 task_id uuid not null references public.tasks(id) on delete cascade, depends_on uuid not null references public.tasks(id) on delete cascade,
 primary key(task_id,depends_on),check(task_id<>depends_on)
);
alter table public.task_dependencies enable row level security;
create policy dependencies_read on public.task_dependencies for select to authenticated using(is_member(task_dep(task_id)));
create policy dependencies_insert on public.task_dependencies for insert to authenticated with check(can_write(task_dep(task_id)) and task_dep(task_id)=task_dep(depends_on));
create policy dependencies_delete on public.task_dependencies for delete to authenticated using(can_write(task_dep(task_id)));
grant select,insert,delete on public.task_dependencies to authenticated;
create function public.guard_dependency() returns trigger language plpgsql security definer set search_path=public as $$
declare b uuid; other_b uuid;
begin
 select board_id into b from tasks where id=new.task_id;
 select board_id into other_b from tasks where id=new.depends_on;
 if b is null or b is distinct from other_b then raise exception 'Выберите задачу с этой доски'; end if;
 perform pg_advisory_xact_lock(hashtextextended(b::text,3));
 if exists(with recursive chain(id) as(select new.depends_on union select d.depends_on from task_dependencies d join chain c on d.task_id=c.id)select 1 from chain where id=new.task_id) then raise exception 'Зависимость создаёт цикл'; end if;
 if exists(select 1 from tasks t join columns c on c.id=t.column_id where t.id=new.task_id and c.is_done) and exists(select 1 from tasks t join columns c on c.id=t.column_id where t.id=new.depends_on and not c.is_done) then raise exception 'Завершённая задача не может зависеть от незавершённой'; end if;
 return new;
end $$;
create trigger dependency_guard before insert on public.task_dependencies for each row execute function public.guard_dependency();
create function public.enforce_dependencies() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.column_id is distinct from old.column_id and exists(select 1 from columns where id=new.column_id and is_done) then
  perform pg_advisory_xact_lock(hashtextextended(new.board_id::text,3));
  if exists(select 1 from task_dependencies d join tasks t on t.id=d.depends_on join columns c on c.id=t.column_id where d.task_id=new.id and not c.is_done) then raise exception 'Сначала завершите задачи, от которых зависит эта карточка'; end if;
 end if;
 return new;
end $$;
create trigger tasks_dependencies before update of column_id on public.tasks for each row execute function public.enforce_dependencies();
create function public.log_dependency() returns trigger language plpgsql security definer set search_path=public as $$declare t uuid;d uuid;begin
 t:=case when tg_op='DELETE' then old.task_id else new.task_id end;d:=case when tg_op='DELETE' then old.depends_on else new.depends_on end;
 if task_dep(t) is not null then insert into task_events(department_id,task_id,actor_id,kind,payload) values(task_dep(t),t,auth.uid(),'dependency',jsonb_build_object('title',(select title from tasks where id=t),'item',(select title from tasks where id=d),'action',tg_op)); end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
create trigger dependencies_history after insert or delete on public.task_dependencies for each row execute function public.log_dependency();
create or replace function public.validate_task_links() returns trigger language plpgsql set search_path=public as $$
begin
 if not exists(select 1 from columns where id=new.column_id and board_id=new.board_id) then raise exception 'Колонка не принадлежит доске'; end if;
 if new.source_message_id is not null and (tg_op='INSERT' or new.source_message_id is distinct from old.source_message_id) and not exists(select 1 from messages where id=new.source_message_id and department_id=board_dep(new.board_id) and deleted_at is null) then raise exception 'Исходное сообщение недоступно'; end if;
 if new.assignee_id is not null and (tg_op='INSERT' or new.assignee_id is distinct from old.assignee_id) and not exists(select 1 from department_members where department_id=board_dep(new.board_id) and user_id=new.assignee_id and blocked_at is null) then raise exception 'Исполнитель не имеет доступа к отделу'; end if;
 return new;
end $$;

create table public.task_templates (
 id uuid primary key default gen_random_uuid(),board_id uuid not null references public.boards(id) on delete cascade,
 name text not null check(char_length(btrim(name)) between 1 and 80),title text not null check(char_length(btrim(title)) between 1 and 200),
 description text not null default '' check(char_length(description)<=5000),priority public.task_priority not null default 'medium',
 checklist jsonb not null default '[]' check(jsonb_typeof(checklist)='array' and jsonb_array_length(checklist)<=100),
 due_days integer not null default 0 check(due_days between 0 and 3650),created_by uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
alter table public.task_templates enable row level security;
create policy templates_read on public.task_templates for select to authenticated using(is_member(board_dep(board_id)));
create policy templates_write on public.task_templates for all to authenticated using(can_write(board_dep(board_id))) with check(can_write(board_dep(board_id)));
create function public.validate_template() returns trigger language plpgsql as $$begin
 if exists(select 1 from jsonb_array_elements(new.checklist) x where jsonb_typeof(x)<>'string' or char_length(btrim(x#>>'{}')) not between 1 and 200) then raise exception 'Пункт чек-листа: 1–200 символов'; end if;return new;
end $$;
create trigger templates_validate before insert or update on public.task_templates for each row execute function public.validate_template();
create function public.save_task_template(task uuid,template_name text) returns uuid language plpgsql security invoker set search_path=public as $$declare t tasks;result uuid;begin
 select * into t from tasks where id=task;if not found or not can_write(board_dep(t.board_id)) then raise exception 'Нет доступа';end if;
 insert into task_templates(board_id,name,title,description,priority,checklist,created_by) values(t.board_id,template_name,t.title,t.description,t.priority,coalesce((select jsonb_agg(title order by position,id)from task_checklist where task_id=task),'[]'),auth.uid()) returning id into result;return result;
end $$;
revoke all on function public.save_task_template(uuid,text) from public;
grant execute on function public.save_task_template(uuid,text) to authenticated;
create function public.task_from_template(template uuid,target_column uuid) returns uuid language plpgsql security invoker set search_path=public as $$declare tpl task_templates;result uuid;begin
 select * into tpl from task_templates where id=template;if not found or not can_write(board_dep(tpl.board_id)) or not exists(select 1 from columns where id=target_column and board_id=tpl.board_id) then raise exception 'Нет доступа к шаблону или колонке';end if;
 insert into tasks(board_id,column_id,title,description,priority,due_date,created_by,position) values(tpl.board_id,target_column,tpl.title,tpl.description,tpl.priority,(now() at time zone 'Europe/Moscow')::date+tpl.due_days,auth.uid(),coalesce((select max(position)+1 from tasks where column_id=target_column),0)) returning id into result;
 insert into task_checklist(task_id,title,position) select result,v#>>'{}',n-1 from jsonb_array_elements(tpl.checklist) with ordinality j(v,n);return result;
end $$;
revoke all on function public.task_from_template(uuid,uuid) from public;
grant execute on function public.task_from_template(uuid,uuid) to authenticated;

create table public.recurring_tasks (
 id uuid primary key default gen_random_uuid(),template_id uuid not null references public.task_templates(id) on delete cascade,
 board_id uuid not null references public.boards(id) on delete cascade,column_id uuid not null references public.columns(id) on delete cascade,
 assignee_id uuid references public.profiles(id) on delete set null,created_by uuid not null references public.profiles(id),
 cadence text not null check(cadence in('day','week','month')),interval_n integer not null default 1 check(interval_n between 1 and 365),
 next_run date not null,anchor_day integer not null check(anchor_day between 1 and 31),active boolean not null default true,last_error text,created_at timestamptz not null default now()
);
alter table public.recurring_tasks enable row level security;
create policy recurring_read on public.recurring_tasks for select to authenticated using(is_member(board_dep(board_id)));
create policy recurring_insert on public.recurring_tasks for insert to authenticated with check(can_write(board_dep(board_id)) and created_by=auth.uid());
create policy recurring_update on public.recurring_tasks for update to authenticated using(can_write(board_dep(board_id))) with check(can_write(board_dep(board_id)));
create policy recurring_delete on public.recurring_tasks for delete to authenticated using(can_write(board_dep(board_id)));
create table public.recurring_occurrences (
 rule_id uuid references public.recurring_tasks(id) on delete cascade,run_date date,task_id uuid references public.tasks(id) on delete set null,primary key(rule_id,run_date)
);
alter table public.recurring_occurrences enable row level security;
create policy occurrences_read on public.recurring_occurrences for select to authenticated using(exists(select 1 from recurring_tasks r where r.id=rule_id and is_member(board_dep(r.board_id))));
create or replace function public.delete_empty_column(col uuid) returns void language plpgsql security definer set search_path=public as $$declare b uuid;begin
 select board_id into b from columns where id=col for update;
 if b is null or not can_write(board_dep(b)) then raise exception 'Нет доступа';end if;
 perform pg_advisory_xact_lock(hashtextextended(b::text,1));
 if exists(select 1 from tasks where column_id=col) then raise exception 'Сначала перенесите задачи из колонки, включая архив';end if;
 if exists(select 1 from recurring_tasks where column_id=col) then raise exception 'Сначала удалите или перенесите расписания из колонки';end if;
 if(select count(*)from columns where board_id=b)<=1 then raise exception 'Нельзя удалить последнюю колонку';end if;
 delete from columns where id=col;
end $$;
create function public.validate_recurring() returns trigger language plpgsql set search_path=public as $$begin
 if not exists(select 1 from task_templates where id=new.template_id and board_id=new.board_id) or not exists(select 1 from columns where id=new.column_id and board_id=new.board_id) then raise exception 'Шаблон и рабочая колонка должны принадлежать доске';end if;
 if tg_op='UPDATE' and(new.board_id<>old.board_id or new.created_by<>old.created_by) then raise exception 'Нельзя менять доску или автора правила';end if;
 if tg_op='INSERT' or new.next_run is distinct from old.next_run then new.anchor_day:=extract(day from new.next_run);end if;
 return new;
end $$;
create trigger recurring_validate before insert or update on public.recurring_tasks for each row execute function public.validate_recurring();
create function public.next_recurrence(d date,cadence text,n integer,anchor integer) returns date language plpgsql immutable as $$declare first date;begin
 if cadence='day' then return d+n;elsif cadence='week' then return d+7*n;elsif cadence='month' then first:=(date_trunc('month',d)+make_interval(months=>n))::date;return first+least(anchor,extract(day from first+interval '1 month'-interval '1 day')::integer)-1;end if;raise exception 'Неизвестный период';end $$;
create function public.run_due_recurring() returns jsonb language plpgsql security definer set search_path=public as $$
declare r recurring_tasks;tpl task_templates;task uuid;occ date;next_day date;n integer;created integer:=0;failed integer:=0;anchor integer;rule_created integer;
begin
 for r in select * from recurring_tasks where active and next_run<=(now() at time zone 'Europe/Moscow')::date order by next_run,id limit 50 for update skip locked loop
  begin
   if not exists(select 1 from department_members where department_id=board_dep(r.board_id) and user_id=r.created_by and role in('owner','member') and blocked_at is null) then update recurring_tasks set active=false,last_error='Автор правила не имеет права создавать задачи' where id=r.id;failed:=failed+1;continue;end if;
   if exists(select 1 from columns where id=r.column_id and is_done) then raise exception 'Нужна рабочая колонка';end if;
   select * into tpl from task_templates where id=r.template_id;
   occ:=r.next_run;anchor:=r.anchor_day;n:=0;rule_created:=0;
   while occ<=(now() at time zone 'Europe/Moscow')::date and n<50 loop
    insert into recurring_occurrences(rule_id,run_date) values(r.id,occ) on conflict do nothing;
    if found then
     insert into tasks(board_id,column_id,title,description,priority,due_date,assignee_id,created_by,position) values(r.board_id,r.column_id,tpl.title,tpl.description,tpl.priority,occ+tpl.due_days,r.assignee_id,r.created_by,coalesce((select max(position)+1 from tasks where column_id=r.column_id),0)) returning id into task;
     insert into task_checklist(task_id,title,position) select task,v#>>'{}',ord-1 from jsonb_array_elements(tpl.checklist) with ordinality j(v,ord);
     update recurring_occurrences set task_id=task where rule_id=r.id and run_date=occ;rule_created:=rule_created+1;
    end if;
    next_day:=next_recurrence(occ,r.cadence,r.interval_n,anchor);occ:=next_day;n:=n+1;
   end loop;
   update recurring_tasks set next_run=occ,anchor_day=anchor,last_error=null where id=r.id;
   -- next_run validation resets the anchor for manual edits; preserve the original anchor for monthly schedules.
   update recurring_tasks set anchor_day=anchor where id=r.id;created:=created+rule_created;
  exception when others then
   update recurring_tasks set active=false,last_error='Не удалось создать задачу: проверьте колонку и исполнителя' where id=r.id;failed:=failed+1;
  end;
 end loop;
 return jsonb_build_object('created',created,'failed',failed);
end $$;
revoke all on function public.run_due_recurring() from public,authenticated,anon;
grant execute on function public.run_due_recurring() to service_role;
grant select,insert,update,delete on public.task_templates,public.recurring_tasks to authenticated;
grant select on public.recurring_occurrences to authenticated;
grant all on public.task_templates,public.recurring_tasks,public.recurring_occurrences to service_role;

create function public.search_department(dep uuid,term text,kind text default 'all',page integer default 0,include_archive boolean default false) returns jsonb language plpgsql security invoker set search_path=public as $$declare result jsonb;pattern text;begin
 if not is_member(dep) then raise exception 'Нет доступа';end if;
 if char_length(btrim(term))<2 or char_length(term)>200 or page<0 then raise exception 'Запрос: 2–200 символов';end if;
 pattern:='%'||replace(replace(replace(btrim(term),'\','\\'),'%','\%'),'_','\_')||'%';
 with hits as(
  select 'task'::text as kind,t.id::text as id,t.title as title,left(t.description,240) as excerpt,t.created_at,('/d/'||dep||'/board?task='||t.id)::text as href
   from tasks t join boards b on b.id=t.board_id where b.department_id=dep and(kind in('all','task')) and(include_archive or t.archived_at is null) and(t.title ilike pattern or t.description ilike pattern)
  union all
  select 'message',m.id::text,left(m.body,100),left(m.body,240),m.created_at,('/d/'||dep||'/chat?message='||m.id) from messages m where m.department_id=dep and m.deleted_at is null and kind in('all','message') and m.body ilike pattern
  union all
  select 'file',f.id,f.file_name,f.source_title,f.created_at,case when f.task_id is not null then '/d/'||dep||'/board?task='||f.task_id else '/d/'||dep||'/chat?message='||f.message_id end from department_files f where f.department_id=dep and kind in('all','file') and f.file_name ilike pattern
 )select jsonb_build_object('count',(select count(*) from hits),'items',coalesce((select jsonb_agg(x)from(select * from hits order by hits.created_at desc,hits.kind,hits.id limit 30 offset page*30)x),'[]')) into result;return result;
end $$;
revoke all on function public.search_department(uuid,text,text,integer,boolean) from public;
grant execute on function public.search_department(uuid,text,text,integer,boolean) to authenticated;
create view public.task_readiness with(security_invoker=true) as select t.id,(select count(*) from task_dependencies d join tasks p on p.id=d.depends_on join columns c on c.id=p.column_id where d.task_id=t.id and not c.is_done) as blocked_count from tasks t;
grant select on public.task_readiness to authenticated;
commit;
