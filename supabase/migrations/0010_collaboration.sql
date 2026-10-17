begin;

alter table public.columns add column color text not null default '#f1ae75' check (color ~ '^#[0-9A-Fa-f]{6}$');
alter table public.columns add column wip_limit integer check (wip_limit between 1 and 999);
alter table public.tasks add column blocked_reason text not null default '' check (char_length(blocked_reason) <= 1000);
alter table public.messages add column parent_id uuid references public.messages(id) on delete set null;
alter table public.messages add column mentions uuid[] not null default '{}';
alter table public.messages add column is_pinned boolean not null default false;
create index messages_parent_idx on public.messages (parent_id, created_at, id);

create table public.chat_reads (
 department_id uuid not null references public.departments(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 last_read_at timestamptz not null default 'epoch',
 last_read_id uuid not null default '00000000-0000-0000-0000-000000000000',
 primary key (department_id, user_id)
);
alter table public.chat_reads enable row level security;
create policy chat_reads_read on public.chat_reads for select to authenticated using (user_id = auth.uid() and public.is_member(department_id));
-- Writes go through mark_chat_read, so cursors cannot be moved backwards or into another department.

create table public.task_checklist (
 id uuid primary key default gen_random_uuid(),
 task_id uuid not null references public.tasks(id) on delete cascade,
 title text not null check (char_length(btrim(title)) between 1 and 200),
 is_done boolean not null default false,
 position integer not null default 0
);
create index task_checklist_task_idx on public.task_checklist (task_id, position, id);
alter table public.task_checklist enable row level security;
create policy checklist_read on public.task_checklist for select to authenticated using (public.is_member(public.task_dep(task_id)));
create policy checklist_write on public.task_checklist for all to authenticated using (public.can_write(public.task_dep(task_id))) with check (public.can_write(public.task_dep(task_id)));

alter table public.task_events drop constraint task_events_kind_check;
alter table public.task_events add constraint task_events_kind_check check (kind in ('created','moved','assigned','commented','done','edited','checklist'));
drop policy if exists ev_insert on public.task_events;
-- The event journal is written by triggers, not forgeable by a client.
create or replace function public.log_task_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare dep uuid; done boolean; changes jsonb := '{}'::jsonb; field text;
begin
 dep := board_dep(new.board_id);
 if tg_op = 'INSERT' then
  insert into task_events (department_id, task_id, actor_id, kind, payload) values (dep,new.id,auth.uid(),'created',jsonb_build_object('title',new.title));
  return new;
 end if;
 if new.column_id is distinct from old.column_id then
  select is_done into done from columns where id = new.column_id;
  insert into task_events (department_id,task_id,actor_id,kind,payload) values (dep,new.id,auth.uid(),case when done then 'done' else 'moved' end,
   jsonb_build_object('title',new.title,'from',old.column_id,'to',new.column_id,'from_name',(select name from columns where id=old.column_id),'to_name',(select name from columns where id=new.column_id)));
 end if;
 if new.assignee_id is distinct from old.assignee_id then
  insert into task_events (department_id,task_id,actor_id,kind,payload) values (dep,new.id,auth.uid(),'assigned',jsonb_build_object('title',new.title,'from',old.assignee_id,'to',new.assignee_id));
 end if;
 foreach field in array array['title','description','priority','due_date','blocked_reason'] loop
  if to_jsonb(new)->field is distinct from to_jsonb(old)->field then changes := changes || jsonb_build_object(field,jsonb_build_object('from',to_jsonb(old)->field,'to',to_jsonb(new)->field)); end if;
 end loop;
 if changes <> '{}'::jsonb then
  insert into task_events (department_id,task_id,actor_id,kind,payload) values (dep,new.id,auth.uid(),'edited',jsonb_build_object('title',new.title,'changes',changes));
 end if;
 return new;
end $$;

create function public.log_checklist_event() returns trigger language plpgsql security definer set search_path=public as $$
declare t uuid; dep uuid; item jsonb;
begin
 if tg_op='UPDATE' and new.task_id is distinct from old.task_id then raise exception 'Нельзя перенести пункт в другую задачу'; end if;
 if tg_op='DELETE' then t:=old.task_id; item:=to_jsonb(old); else t:=new.task_id; item:=to_jsonb(new); end if;
 dep:=task_dep(t);
 if dep is not null and (tg_op <> 'UPDATE' or to_jsonb(old) is distinct from to_jsonb(new)) then
  insert into task_events(department_id,task_id,actor_id,kind,payload) values(dep,t,auth.uid(),'checklist',jsonb_build_object('title',(select title from tasks where id=t),'item',item->>'title','action',tg_op,'is_done',item->'is_done'));
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger checklist_journal after insert or update or delete on public.task_checklist for each row execute function public.log_checklist_event();

-- Validate cross-table links, including the board/column pair and chat source.
create function public.validate_task_links() returns trigger language plpgsql set search_path=public as $$
begin
 if not exists(select 1 from columns where id=new.column_id and board_id=new.board_id) then raise exception 'Колонка не принадлежит доске'; end if;
 if new.source_message_id is not null and not exists(select 1 from messages where id=new.source_message_id and department_id=board_dep(new.board_id) and deleted_at is null) then raise exception 'Исходное сообщение недоступно'; end if;
 if new.assignee_id is not null and not exists(select 1 from department_members where department_id=board_dep(new.board_id) and user_id=new.assignee_id) then raise exception 'Исполнитель не состоит в отделе'; end if;
 return new;
end $$;
create trigger task_links before insert or update on public.tasks for each row execute function public.validate_task_links();

create function public.validate_chat_message() returns trigger language plpgsql set search_path=public as $$
declare root uuid; f jsonb;
begin
 if new.parent_id is not null then
  select coalesce(parent_id,id) into root from messages where id=new.parent_id and department_id=new.department_id;
  if root is null then raise exception 'Обсуждение недоступно'; end if;
  new.parent_id:=root;
 end if;
 if cardinality(new.mentions)>50 or exists(select 1 from unnest(new.mentions) u where not exists(select 1 from department_members m where m.department_id=new.department_id and m.user_id=u)) then raise exception 'Упоминать можно только участников отдела'; end if;
 for f in select value from jsonb_array_elements(new.files) loop
  if jsonb_typeof(f)<>'object' or coalesce(f->>'name','')='' or coalesce(f->>'size','')!~'^[0-9]+$' then raise exception 'Некорректное вложение'; end if;
  if (f->>'size')::bigint>10485760 then raise exception 'Файл больше 10 МБ'; end if;
  if f->>'path' is null or split_part(f->>'path','/',1) <> new.department_id::text or split_part(f->>'path','/',2) <> new.author_id::text then raise exception 'Недопустимый путь вложения'; end if;
 end loop;
 -- Pinning is only available through the checked RPC.
 if tg_op='INSERT' then new.is_pinned:=false; end if;
 return new;
end $$;
create trigger validate_chat before insert on public.messages for each row execute function public.validate_chat_message();

alter table public.notifications add column message_id uuid references public.messages(id) on delete cascade;
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('assigned','comment','mention','reply'));
create function public.notify_chat_message() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into notifications(user_id,department_id,message_id,kind,title,body)
 select distinct u,new.department_id,new.id,'mention','Вас упомянули в чате',left(new.body,140)
 from unnest(new.mentions) u where u<>new.author_id;
 if new.parent_id is not null then
  insert into notifications(user_id,department_id,message_id,kind,title,body)
  select m.author_id,new.department_id,new.id,'reply','Ответ в обсуждении',left(new.body,140) from messages m
  where m.id=new.parent_id and m.author_id<>new.author_id and not(m.author_id=any(new.mentions))
   and exists(select 1 from department_members d where d.department_id=new.department_id and d.user_id=m.author_id);
 end if;
 return new;
end $$;
create trigger messages_notify after insert on public.messages for each row execute function public.notify_chat_message();

create function public.mark_chat_read(dep uuid, message uuid) returns void language plpgsql security definer set search_path=public as $$
declare stamp timestamptz;
begin
 if not is_member(dep) then raise exception 'Нет доступа'; end if;
 select created_at into stamp from messages where id=message and department_id=dep;
 if stamp is null then raise exception 'Сообщение не найдено'; end if;
 insert into chat_reads(department_id,user_id,last_read_at,last_read_id) values(dep,auth.uid(),stamp,message)
 on conflict(department_id,user_id) do update set last_read_at=excluded.last_read_at,last_read_id=excluded.last_read_id
 where (chat_reads.last_read_at,chat_reads.last_read_id)<(excluded.last_read_at,excluded.last_read_id);
end $$;
revoke all on function public.mark_chat_read(uuid,uuid) from public;
grant execute on function public.mark_chat_read(uuid,uuid) to authenticated;

create function public.chat_unread(dep uuid) returns jsonb language plpgsql security invoker set search_path=public as $$
declare stamp timestamptz; cursor_id uuid; total bigint; first_id uuid;
begin
 if not is_member(dep) then raise exception 'Нет доступа'; end if;
 select last_read_at,last_read_id into stamp,cursor_id from chat_reads where department_id=dep and user_id=auth.uid();
 stamp:=coalesce(stamp,'epoch'); cursor_id:=coalesce(cursor_id,'00000000-0000-0000-0000-000000000000'::uuid);
 select count(*) into total from messages where department_id=dep and deleted_at is null and author_id<>auth.uid() and (created_at,id)>(stamp,cursor_id);
 select id into first_id from messages where department_id=dep and deleted_at is null and author_id<>auth.uid() and (created_at,id)>(stamp,cursor_id) order by created_at,id limit 1;
 return jsonb_build_object('count',total,'first_id',first_id,'last_read_at',stamp,'last_read_id',cursor_id);
end $$;
revoke all on function public.chat_unread(uuid) from public;
grant execute on function public.chat_unread(uuid) to authenticated;

create function public.pin_chat_message(message uuid, pinned boolean) returns void language plpgsql security definer set search_path=public as $$
begin
 update messages set is_pinned=pinned where id=message and deleted_at is null and can_write(department_id);
 if not found then raise exception 'Нет доступа к сообщению'; end if;
end $$;
revoke all on function public.pin_chat_message(uuid,boolean) from public;
grant execute on function public.pin_chat_message(uuid,boolean) to authenticated;

-- One task per source message on a board. The RPC is idempotent and uses an advisory lock.
create function public.task_from_message(message uuid, target_board uuid) returns uuid language plpgsql security invoker set search_path=public as $$
declare src messages; col uuid; result uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(message::text||target_board::text,0));
 select * into src from messages where id=message and deleted_at is null;
 if not found or not can_write(src.department_id) or board_dep(target_board) is distinct from src.department_id then raise exception 'Нет доступа'; end if;
 select id into result from tasks where board_id=target_board and source_message_id=message order by created_at limit 1;
 if result is not null then return result; end if;
 select id into col from columns where board_id=target_board and not is_done order by position,id limit 1;
 if col is null then raise exception 'Создайте рабочую колонку на доске'; end if;
 insert into tasks(board_id,column_id,title,description,source_message_id,created_by,position)
 values(target_board,col,left(regexp_replace(src.body,'@\[([^\]]+)\]\([0-9a-f-]{36}\)','@\1','g'),200),regexp_replace(src.body,'@\[([^\]]+)\]\([0-9a-f-]{36}\)','@\1','g'),message,auth.uid(),coalesce((select max(position)+1 from tasks where column_id=col),0)) returning id into result;
 return result;
end $$;
revoke all on function public.task_from_message(uuid,uuid) from public;
grant execute on function public.task_from_message(uuid,uuid) to authenticated;

-- Column deletion never silently deletes its tasks. Reordering is atomic.
drop policy columns_write on public.columns;
create policy columns_insert on public.columns for insert to authenticated with check(can_write(board_dep(board_id)));
create policy columns_update on public.columns for update to authenticated using(can_write(board_dep(board_id))) with check(can_write(board_dep(board_id)));
create function public.delete_empty_column(col uuid) returns void language plpgsql security definer set search_path=public as $$
declare b uuid;
begin
 select board_id into b from columns where id=col for update;
 if b is null or not can_write(board_dep(b)) then raise exception 'Нет доступа'; end if;
 perform pg_advisory_xact_lock(hashtextextended(b::text,1));
 if exists(select 1 from tasks where column_id=col) then raise exception 'Сначала перенесите задачи из колонки'; end if;
 if (select count(*) from columns where board_id=b)<=1 then raise exception 'Нельзя удалить последнюю колонку'; end if;
 delete from columns where id=col;
end $$;
revoke all on function public.delete_empty_column(uuid) from public;
grant execute on function public.delete_empty_column(uuid) to authenticated;
create function public.reorder_columns(b uuid, ordered uuid[]) returns void language plpgsql security definer set search_path=public as $$
begin
 if not can_write(board_dep(b)) then raise exception 'Нет доступа'; end if;
 perform pg_advisory_xact_lock(hashtextextended(b::text,1));
 if cardinality(ordered)<>(select count(*) from columns where board_id=b) or cardinality(ordered)<>(select count(distinct x) from unnest(ordered) x) or exists(select 1 from unnest(ordered) x where not exists(select 1 from columns where id=x and board_id=b)) then raise exception 'Список колонок изменился. Обновите доску'; end if;
 update columns c set position=o.n-1 from unnest(ordered) with ordinality o(id,n) where c.id=o.id and c.board_id=b;
end $$;
revoke all on function public.reorder_columns(uuid,uuid[]) from public;
grant execute on function public.reorder_columns(uuid,uuid[]) to authenticated;


-- An atomic move prevents partially saved positions when a client loses its connection.
create function public.move_board_task(task uuid, target_column uuid, before_task uuid default null) returns void language plpgsql security invoker set search_path=public as $$
declare b uuid; target_b uuid; ids uuid[]; slot integer;
begin
 select board_id into b from tasks where id=task;
 select board_id into target_b from columns where id=target_column;
 if b is null or b is distinct from target_b or not can_write(board_dep(b)) then raise exception 'Нет доступа к перемещению'; end if;
 perform pg_advisory_xact_lock(hashtextextended(b::text,2));
 select coalesce(array_agg(id order by position,id),'{}'::uuid[]) into ids from tasks where column_id=target_column and id<>task;
 if before_task=task then return; end if;
 slot:=coalesce(array_position(ids,before_task),cardinality(ids)+1);
 ids:=coalesce(ids[1:slot-1],'{}'::uuid[])||array[task]||coalesce(ids[slot:cardinality(ids)],'{}'::uuid[]);
 update tasks t set column_id=target_column,position=o.n-1 from unnest(ids) with ordinality o(id,n) where t.id=o.id;
end $$;
revoke all on function public.move_board_task(uuid,uuid,uuid) from public;
grant execute on function public.move_board_task(uuid,uuid,uuid) to authenticated;

create view public.chat_messages with (security_invoker=true) as
 select m.*, (select count(*) from public.messages r where r.parent_id=m.id and r.deleted_at is null) as reply_count from public.messages m;

create view public.department_files with (security_invoker=true) as
 select a.id::text as id, b.department_id, a.task_id, null::uuid as message_id,
 'attachments'::text as bucket, a.storage_path, a.file_name, a.size_bytes, a.uploaded_by as author_id,a.created_at,t.title as source_title
 from public.attachments a join public.tasks t on t.id=a.task_id join public.boards b on b.id=t.board_id
 union all
 select m.id::text||':'||(f->>'path'),m.department_id,null::uuid,m.id,'chat-files',f->>'path',f->>'name',(f->>'size')::bigint,m.author_id,m.created_at,left(m.body,100)
 from public.messages m cross join lateral jsonb_array_elements(m.files) f where m.deleted_at is null;

-- Daily summary computed in the database without client row limits. No external AI required.
create function public.daily_team_summary(dep uuid, start_at timestamptz, end_at timestamptz) returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb;
begin
 if not is_member(dep) or end_at<=start_at or end_at-start_at>interval '2 days' then raise exception 'Недопустимый период или отдел'; end if;
 with active as (
  select t.* from tasks t join boards b on b.id=t.board_id join columns c on c.id=t.column_id where b.department_id=dep and not c.is_done
 ), completed as (
  select distinct on(e.task_id) e.task_id as id,e.payload->>'title' as title from task_events e where e.department_id=dep and e.kind='done' and e.created_at>=start_at and e.created_at<end_at order by e.task_id,e.created_at desc
 ), overdue as (select id,title,due_date from active where due_date<(now() at time zone 'Europe/Moscow')::date),
 blocked as (select id,title,blocked_reason,moved_at from active where blocked_reason<>'' or moved_at<now()-interval '3 days'),
 discussions as (select m.id,m.body,m.author_id,m.created_at,m.is_pinned from messages m where m.department_id=dep and m.deleted_at is null and m.created_at>=start_at and m.created_at<end_at and (m.is_pinned or cardinality(m.mentions)>0 or m.parent_id is not null))
 select jsonb_build_object(
  'done_count',(select count(*) from completed),'done',coalesce((select jsonb_agg(x) from(select * from completed limit 50)x),'[]'),
  'overdue_count',(select count(*) from overdue),'overdue',coalesce((select jsonb_agg(x) from(select * from overdue order by due_date,id limit 50)x),'[]'),
  'blocked_count',(select count(*) from blocked),'blocked',coalesce((select jsonb_agg(x) from(select * from blocked order by moved_at,id limit 50)x),'[]'),
  'discussion_count',(select count(*) from discussions),'discussions',coalesce((select jsonb_agg(x) from(select * from discussions order by created_at desc,id limit 20)x),'[]'),
  'message_count',(select count(*) from messages where department_id=dep and deleted_at is null and created_at>=start_at and created_at<end_at)
 ) into result;
 return result;
end $$;
revoke all on function public.daily_team_summary(uuid,timestamptz,timestamptz) from public;
grant execute on function public.daily_team_summary(uuid,timestamptz,timestamptz) to authenticated;

grant select on public.chat_messages,public.department_files to authenticated;
grant select on public.chat_reads to authenticated;
grant select,insert,update,delete on public.task_checklist to authenticated;
-- Fix the legacy attachment insert policy to enforce task access as well.
drop policy att_write on public.attachments;
create policy att_insert on public.attachments for insert to authenticated with check(uploaded_by=auth.uid() and can_write(task_dep(task_id)));
create policy att_update on public.attachments for update to authenticated using(can_write(task_dep(task_id))) with check(can_write(task_dep(task_id)));
create policy att_delete on public.attachments for delete to authenticated using(can_write(task_dep(task_id)));

commit;
