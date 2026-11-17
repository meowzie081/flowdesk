-- Тарифы и enforcement лимитов на уровне БД. Оплата подключается позже:
-- план меняет только service_role (вебхук провайдера/админ), клиент — нет.
create table public.plans (
  id text primary key,
  name text not null,
  max_members integer not null,
  max_boards integer not null,
  max_orgs integer not null default 1,
  price_per_seat_month integer
);
insert into public.plans(id, name, max_members, max_boards, max_orgs, price_per_seat_month) values
  ('free', 'Free', 5, 2, 1, null),
  ('team', 'Team', 500, 100, 10, 299);

create table public.subscriptions (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  plan_id text not null default 'free' references public.plans(id),
  status text not null default 'active' check(status in ('active','past_due','canceled')),
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
create policy sub_read on public.subscriptions for select to authenticated
  using (is_org_member(organization_id));
grant select on public.plans, public.subscriptions to authenticated;
-- Дефолтные привилегии Supabase выдают authenticated все права на новые таблицы;
-- менять тарифы может только service_role (оплата/админ), поэтому отзываем запись.
revoke insert,update,delete on public.plans, public.subscriptions from authenticated, anon;
grant select,insert,update,delete on public.plans, public.subscriptions to service_role;

-- Подписки для организаций, созданных бэкфиллом 0020.
insert into public.subscriptions(organization_id)
  select id from public.organizations o
  where not exists (select 1 from public.subscriptions s where s.organization_id = o.id);

create or replace function public.org_plan_limits(org uuid)
returns table(max_members integer, max_boards integer, plan_name text)
language sql security definer stable set search_path=public as $$
  select p.max_members, p.max_boards, p.name
  from public.subscriptions s join public.plans p on p.id = s.plan_id
  where s.organization_id = org
$$;
grant execute on function public.org_plan_limits(uuid) to authenticated;

-- Лимит организаций на владельца: free — одна, team — до 10.
create or replace function public.org_insert_limits() returns trigger
language plpgsql security definer set search_path=public as $$
declare cur_plan text; allowed integer; owned integer;
begin
  if auth.uid() is null then return new; end if;
  select s.plan_id into cur_plan
    from organizations o join subscriptions s on s.organization_id = o.id
    where o.created_by = new.created_by order by o.created_at limit 1;
  select max_orgs into allowed from plans where id = coalesce(cur_plan, 'free');
  select count(*) into owned from organizations where created_by = new.created_by;
  if owned >= allowed then
    raise exception 'Тариф Free включает одну организацию. Создавайте отделы внутри существующей или перейдите на Team.';
  end if;
  return new;
end $$;
create trigger organizations_limits before insert on public.organizations
  for each row execute function public.org_insert_limits();

-- Новая организация получает подписку free и владельца участником.
create or replace function public.org_bootstrap() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into public.subscriptions(organization_id) values (new.id) on conflict do nothing;
  insert into public.org_members(organization_id, user_id, role) values (new.id, new.created_by, 'owner') on conflict do nothing;
  return new;
end $$;
create trigger organizations_bootstrap after insert on public.organizations
  for each row execute function public.org_bootstrap();

-- Лимит мест: считается по org_members, включая добавление через отдел.
create or replace function public.org_seat_limits() returns trigger
language plpgsql security definer set search_path=public as $$
declare lim integer; pname text; n integer;
begin
  if auth.uid() is null then return new; end if;
  select max_members, plan_name into lim, pname from public.org_plan_limits(new.organization_id);
  if lim is null then lim := 5; pname := 'Free'; end if;
  select count(*) into n from org_members where organization_id = new.organization_id;
  if n >= lim then
    raise exception 'Тариф % включает % участников. Перейдите на Team, чтобы добавить больше.', pname, lim;
  end if;
  return new;
end $$;
create trigger org_members_limits before insert on public.org_members
  for each row execute function public.org_seat_limits();

-- Отдел без организации получает личную организацию создателя; отделы внутри
-- чужой организации может создавать только её владелец/админ.
create or replace function public.department_org_link() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.organization_id is null then
    insert into organizations(name, created_by) values (new.name, auth.uid()) returning id into new.organization_id;
  elsif not public.is_org_owner(new.organization_id) then
    raise exception 'Создавать отделы внутри организации может только её владелец.';
  end if;
  return new;
end $$;
create trigger departments_org_link before insert on public.departments
  for each row execute function public.department_org_link();

-- Участник отдела автоматически становится участником организации (место).
create or replace function public.department_member_seat() returns trigger
language plpgsql security definer set search_path=public as $$
declare o uuid;
begin
  if auth.uid() is null then return new; end if;
  select organization_id into o from departments where id = new.department_id;
  if o is null then return new; end if;
  insert into org_members(organization_id, user_id, role) values (o, new.user_id, 'member') on conflict do nothing;
  return new;
end $$;
create trigger department_members_seat before insert on public.department_members
  for each row execute function public.department_member_seat();

-- Лимит досок на организацию.
create or replace function public.board_limits() returns trigger
language plpgsql security definer set search_path=public as $$
declare o uuid; lim integer; pname text; n integer;
begin
  if auth.uid() is null then return new; end if;
  select organization_id into o from departments where id = new.department_id;
  if o is null then return new; end if;
  select max_boards, plan_name into lim, pname from public.org_plan_limits(o);
  if lim is null then lim := 2; pname := 'Free'; end if;
  select count(*) into n from boards b join departments d on d.id = b.department_id where d.organization_id = o;
  if n >= lim then
    raise exception 'Тариф % включает % доски на организацию. Перейдите на Team, чтобы создать больше.', pname, lim;
  end if;
  return new;
end $$;
create trigger boards_limits before insert on public.boards
  for each row execute function public.board_limits();

-- Self-serve: организация + отдел + доска + колонки одной транзакцией.
create or replace function public.create_organization_with_workspace(p_org_name text, p_department_name text default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare o uuid; d uuid; b uuid;
begin
  if auth.uid() is null then raise exception 'Войдите в аккаунт'; end if;
  insert into organizations(name, created_by) values (p_org_name, auth.uid()) returning id into o;
  insert into departments(name, created_by, organization_id)
    values (coalesce(nullif(trim(p_department_name), ''), p_org_name), auth.uid(), o) returning id into d;
  insert into department_members(department_id, user_id, role) values (d, auth.uid(), 'owner');
  insert into boards(department_id, name) values (d, 'Основная доска') returning id into b;
  insert into columns(board_id, name, position, is_done) values
    (b, 'Backlog', 0, false), (b, 'В работе', 1, false), (b, 'Ревью', 2, false), (b, 'Готово', 3, true);
  return jsonb_build_object('organization_id', o, 'department_id', d, 'board_id', b);
end $$;
grant execute on function public.create_organization_with_workspace(text, text) to authenticated;