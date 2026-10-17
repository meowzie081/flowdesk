-- Этап 2: комментарии к карточкам, метки, уведомления.
-- Выполнять после 0001–0005. Скрипт можно запускать повторно.

-- ---------------------------------------------------------------- comments
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  author_id uuid not null references profiles(id),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists comments_task_idx on comments (task_id, created_at);

alter table comments enable row level security;

drop policy if exists comments_read on comments;
create policy comments_read on comments for select to authenticated
  using (is_member(task_dep(task_id)));

drop policy if exists comments_insert on comments;
create policy comments_insert on comments for insert to authenticated
  with check (can_write(task_dep(task_id)) and author_id = auth.uid());

drop policy if exists comments_delete on comments;
create policy comments_delete on comments for delete to authenticated
  using (author_id = auth.uid() or is_owner(task_dep(task_id)));

-- ------------------------------------------------------------------ labels
create table if not exists labels (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  created_at timestamptz not null default now()
);
create unique index if not exists labels_dep_name_uq on labels (department_id, lower(name));

create table if not exists task_labels (
  task_id uuid not null references tasks(id) on delete cascade,
  label_id uuid not null references labels(id) on delete cascade,
  primary key (task_id, label_id)
);

alter table labels enable row level security;
alter table task_labels enable row level security;

drop policy if exists labels_read on labels;
create policy labels_read on labels for select to authenticated
  using (is_member(department_id));

drop policy if exists labels_write on labels;
create policy labels_write on labels for all to authenticated
  using (can_write(department_id)) with check (can_write(department_id));

drop policy if exists task_labels_read on task_labels;
create policy task_labels_read on task_labels for select to authenticated
  using (is_member(task_dep(task_id)));

-- метку можно повесить только из того же отдела, что и задача
drop policy if exists task_labels_insert on task_labels;
create policy task_labels_insert on task_labels for insert to authenticated
  with check (
    can_write(task_dep(task_id))
    and exists (
      select 1 from labels l
      where l.id = label_id and l.department_id = task_dep(task_id)
    )
  );

drop policy if exists task_labels_delete on task_labels;
create policy task_labels_delete on task_labels for delete to authenticated
  using (can_write(task_dep(task_id)));

-- ----------------------------------------------------------- notifications
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  department_id uuid not null references departments(id) on delete cascade,
  task_id uuid references tasks(id) on delete cascade,
  kind text not null check (kind in ('assigned', 'comment')),
  title text not null,
  body text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications (user_id, created_at desc);

alter table notifications enable row level security;

-- Пользователь видит и отмечает только свои уведомления; создают их триггеры ниже
drop policy if exists notif_read on notifications;
create policy notif_read on notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists notif_update on notifications;
create policy notif_update on notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notif_delete on notifications;
create policy notif_delete on notifications for delete to authenticated
  using (user_id = auth.uid());

-- Уведомление исполнителю при назначении
create or replace function public.notify_task_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  dep uuid;
begin
  if new.assignee_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then return new; end if;
  if new.assignee_id = auth.uid() then return new; end if;  -- себе не уведомляем

  select department_id into dep from boards where id = new.board_id;
  insert into notifications (user_id, department_id, task_id, kind, title)
  values (new.assignee_id, dep, new.id, 'assigned', new.title);
  return new;
end $$;

drop trigger if exists tasks_notify_assignment on tasks;
create trigger tasks_notify_assignment
  after insert or update of assignee_id on tasks
  for each row execute function public.notify_task_assignment();

-- Комментарий: событие для дайджеста + уведомление исполнителю и автору задачи
create or replace function public.on_comment_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t record;
  dep uuid;
begin
  select id, title, board_id, assignee_id, created_by into t from tasks where id = new.task_id;
  if not found then return new; end if;
  select department_id into dep from boards where id = t.board_id;

  insert into task_events (department_id, task_id, actor_id, kind, payload)
  values (dep, new.task_id, new.author_id, 'commented', jsonb_build_object('title', t.title));

  insert into notifications (user_id, department_id, task_id, kind, title, body)
  select distinct v.u, dep, new.task_id, 'comment', t.title, left(new.body, 140)
  from (values (t.assignee_id), (t.created_by)) as v(u)
  where v.u is not null and v.u <> new.author_id;

  return new;
end $$;

drop trigger if exists comments_after_insert on comments;
create trigger comments_after_insert
  after insert on comments
  for each row execute function public.on_comment_created();

-- Уведомления приходят в браузер сразу (Realtime)
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
