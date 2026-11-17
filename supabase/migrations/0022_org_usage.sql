-- Использование тарифа организацией для страницы «Организация».
-- Счётчики идут через security definer, т.к. доски/участники отдельных отделов
-- могут быть не видны вызывающему по RLS; доступ гейтится is_org_member.
create or replace function public.org_usage(org uuid)
returns table(
  member_count integer,
  board_count integer,
  max_members integer,
  max_boards integer,
  plan_id text,
  plan_name text,
  price_per_seat_month integer
)
language plpgsql security definer stable set search_path=public as $$
begin
  if not public.is_org_member(org) then
    raise exception 'Нет доступа к этой организации';
  end if;
  return query
  select
    (select count(*)::int from public.org_members where organization_id = org),
    (select count(*)::int from public.boards b join public.departments d on d.id = b.department_id where d.organization_id = org),
    p.max_members, p.max_boards, p.id, p.name, p.price_per_seat_month
  from public.subscriptions s join public.plans p on p.id = s.plan_id
  where s.organization_id = org;
end $$;
grant execute on function public.org_usage(uuid) to authenticated;