-- Слой организаций над отделами: единица биллинга и self-serve воркспейсов.
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check(char_length(name) between 2 and 80),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.organizations enable row level security;

create table public.org_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check(role in ('owner','admin','member')),
  joined_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
alter table public.org_members enable row level security;
create index org_members_user_idx on public.org_members(user_id);

alter table public.departments add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
create index departments_org_idx on public.departments(organization_id);

create or replace function public.is_org_member(org uuid) returns boolean
language sql security definer stable set search_path=public as $$
  select exists(select 1 from org_members where organization_id=org and user_id=auth.uid())
$$;
create or replace function public.is_org_owner(org uuid) returns boolean
language sql security definer stable set search_path=public as $$
  select exists(select 1 from org_members where organization_id=org and user_id=auth.uid() and role in ('owner','admin'))
$$;
grant execute on function public.is_org_member(uuid), public.is_org_owner(uuid) to authenticated;

-- Создатель читает свою строку, пока не стал участником: INSERT ... RETURNING (урок 0016).
create policy org_read on public.organizations for select to authenticated
  using (
    is_org_member(id)
    or (created_by = auth.uid() and not exists (
      select 1 from org_members m where m.organization_id = id and m.user_id = auth.uid()
    ))
  );
create policy org_insert on public.organizations for insert to authenticated
  with check (created_by = auth.uid());
create policy org_update on public.organizations for update to authenticated
  using (is_org_owner(id)) with check (is_org_owner(id));

create policy org_members_read on public.org_members for select to authenticated
  using (is_org_member(organization_id) or user_id = auth.uid());
create policy org_members_insert on public.org_members for insert to authenticated
  with check (is_org_owner(organization_id));
create policy org_members_update on public.org_members for update to authenticated
  using (is_org_owner(organization_id)) with check (is_org_owner(organization_id));
create policy org_members_delete on public.org_members for delete to authenticated
  using (is_org_owner(organization_id) or (user_id = auth.uid() and role <> 'owner'));

grant select,insert,update,delete on public.organizations, public.org_members to authenticated;

-- Существующие отделы становятся организациями 1:1, чтобы не ломать текущие команды.
do $$
declare d record; o uuid;
begin
  for d in select id, name, created_by from public.departments where organization_id is null loop
    insert into public.organizations(name, created_by) values (d.name, d.created_by) returning id into o;
    insert into public.org_members(organization_id, user_id, role)
      select o, dm.user_id, case when dm.role = 'owner' then 'owner' else 'member' end
      from public.department_members dm where dm.department_id = d.id
      on conflict do nothing;
    update public.departments set organization_id = o where id = d.id;
  end loop;
end $$;