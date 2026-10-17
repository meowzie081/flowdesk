begin;
-- Login registry contains no password or Auth credentials. Only the server service role writes it.
create table public.managed_accounts (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 login text not null unique check (login ~ '^[a-z0-9][a-z0-9._-]{2,31}$' and login not like '%..%' and login not like '%.'),
 created_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now()
);
alter table public.managed_accounts enable row level security;
create policy managed_accounts_read on public.managed_accounts for select to authenticated using (
 user_id=auth.uid() or exists(select 1 from public.department_members m where m.user_id=managed_accounts.user_id and public.is_member(m.department_id))
);
grant select on public.managed_accounts to authenticated;
grant all on public.managed_accounts to service_role;
commit;
