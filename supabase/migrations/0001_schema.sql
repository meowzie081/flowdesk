-- FlowDesk: схема БД (10 таблиц) + RLS
-- Роли: owner / member / viewer

create extension if not exists "pgcrypto";

create type member_role as enum ('owner', 'member', 'viewer');
create type task_priority as enum ('low', 'medium', 'high');

-- 1. profiles
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  avatar_url text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 2. departments
create table departments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

-- 3. department_members
create table department_members (
  department_id uuid not null references departments(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (department_id, user_id)
);

-- 4. boards
create table boards (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);

-- 5. columns
create table columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  position int not null default 0,
  is_done boolean not null default false
);

-- 6. tasks
create table tasks (
  id uuid primary key default gen_random_uuid(),
  column_id uuid not null references columns(id) on delete cascade,
  board_id uuid not null references boards(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  priority task_priority not null default 'medium',
  assignee_id uuid references profiles(id) on delete set null,
  due_date date,
  position int not null default 0,
  source_message_id uuid,
  moved_at timestamptz not null default now(),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

-- 7. messages (чат отдела)
create table messages (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id) on delete cascade,
  author_id uuid not null references profiles(id),
  body text not null check (char_length(body) between 1 and 4000),
  is_ai boolean not null default false,
  created_at timestamptz not null default now()
);

alter table tasks
  add constraint tasks_source_message_fk
  foreign key (source_message_id) references messages(id) on delete set null;

-- 8. attachments (файловое хранилище)
create table attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  size_bytes bigint not null check (size_bytes <= 10485760),
  uploaded_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

-- 9. task_events (журнал для дайджеста и радара блокеров)
create table task_events (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id) on delete cascade,
  task_id uuid references tasks(id) on delete cascade,
  actor_id uuid references profiles(id),
  kind text not null check (kind in ('created','moved','assigned','commented','done')),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- 10. ai_logs (приватность ИИ: что реально ушло наружу)
create table ai_logs (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id) on delete cascade,
  user_id uuid not null references profiles(id),
  command text not null,
  masked_count int not null default 0,
  sent_chars int not null default 0,
  provider text not null,
  created_at timestamptz not null default now()
);

create index on tasks (board_id, column_id, position);
create index on tasks (moved_at);
create index on messages (department_id, created_at desc);
create index on task_events (department_id, created_at desc);

-- Хелперы RLS -----------------------------------------------------------

create or replace function is_member(dep uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from department_members
    where department_id = dep and user_id = auth.uid()
  );
$$;

create or replace function can_write(dep uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from department_members
    where department_id = dep and user_id = auth.uid()
      and role in ('owner','member')
  );
$$;

create or replace function is_owner(dep uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from department_members
    where department_id = dep and user_id = auth.uid() and role = 'owner'
  );
$$;

create or replace function board_dep(b uuid)
returns uuid language sql security definer stable as $$
  select department_id from boards where id = b;
$$;

-- Включаем RLS -----------------------------------------------------------

alter table profiles enable row level security;
alter table departments enable row level security;
alter table department_members enable row level security;
alter table boards enable row level security;
alter table columns enable row level security;
alter table tasks enable row level security;
alter table messages enable row level security;
alter table attachments enable row level security;
alter table task_events enable row level security;
alter table ai_logs enable row level security;

-- profiles: видны всем авторизованным, правит только владелец профиля
create policy profiles_read on profiles for select to authenticated using (true);
create policy profiles_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_insert on profiles for insert to authenticated
  with check (id = auth.uid());

-- departments
create policy dep_read on departments for select to authenticated
  using (is_member(id) or created_by = auth.uid());
create policy dep_insert on departments for insert to authenticated
  with check (created_by = auth.uid());
create policy dep_update on departments for update to authenticated
  using (is_owner(id));
create policy dep_delete on departments for delete to authenticated
  using (is_owner(id));

-- department_members
create policy mem_read on department_members for select to authenticated
  using (is_member(department_id));
create policy mem_insert on department_members for insert to authenticated
  with check (
    is_owner(department_id)
    or (user_id = auth.uid() and role = 'owner' and exists (
          select 1 from departments d
          where d.id = department_id and d.created_by = auth.uid()))
  );
create policy mem_update on department_members for update to authenticated
  using (is_owner(department_id));
create policy mem_delete on department_members for delete to authenticated
  using (is_owner(department_id) or user_id = auth.uid());

-- boards
create policy boards_read on boards for select to authenticated
  using (is_member(department_id));
create policy boards_write on boards for all to authenticated
  using (can_write(department_id)) with check (can_write(department_id));

-- columns
create policy columns_read on columns for select to authenticated
  using (is_member(board_dep(board_id)));
create policy columns_write on columns for all to authenticated
  using (can_write(board_dep(board_id)))
  with check (can_write(board_dep(board_id)));

-- tasks
create policy tasks_read on tasks for select to authenticated
  using (is_member(board_dep(board_id)));
create policy tasks_write on tasks for all to authenticated
  using (can_write(board_dep(board_id)))
  with check (can_write(board_dep(board_id)));

-- messages: viewer читает, member/owner пишет; редактирует только автор
create policy msg_read on messages for select to authenticated
  using (is_member(department_id));
create policy msg_insert on messages for insert to authenticated
  with check (can_write(department_id) and author_id = auth.uid());
create policy msg_delete on messages for delete to authenticated
  using (author_id = auth.uid() or is_owner(department_id));

-- attachments
create policy att_read on attachments for select to authenticated
  using (exists (select 1 from tasks t where t.id = task_id
                 and is_member(board_dep(t.board_id))));
create policy att_write on attachments for all to authenticated
  using (exists (select 1 from tasks t where t.id = task_id
                 and can_write(board_dep(t.board_id))))
  with check (uploaded_by = auth.uid());

-- task_events: читать могут участники, писать — через сервер/триггер
create policy ev_read on task_events for select to authenticated
  using (is_member(department_id));
create policy ev_insert on task_events for insert to authenticated
  with check (can_write(department_id) and actor_id = auth.uid());

-- ai_logs: видят только владельцы отдела и сам пользователь
create policy ailog_read on ai_logs for select to authenticated
  using (user_id = auth.uid() or is_owner(department_id));
create policy ailog_insert on ai_logs for insert to authenticated
  with check (user_id = auth.uid() and can_write(department_id));

-- Триггеры ----------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function touch_task_moved()
returns trigger language plpgsql as $$
begin
  if new.column_id is distinct from old.column_id then
    new.moved_at = now();
  end if;
  return new;
end $$;

create trigger tasks_touch_moved
  before update on tasks
  for each row execute function touch_task_moved();

-- Радар блокеров: задачи, застрявшие в не-финальной колонке
create or replace view stuck_tasks as
select t.id, t.board_id, t.title, t.assignee_id, t.moved_at,
       extract(day from now() - t.moved_at)::int as days_stuck
from tasks t
join columns c on c.id = t.column_id
where c.is_done = false
  and t.moved_at < now() - interval '3 days';
alter view stuck_tasks set (security_invoker = true);

-- Хранилище файлов (bucket создаётся в Supabase Storage: "attachments")
