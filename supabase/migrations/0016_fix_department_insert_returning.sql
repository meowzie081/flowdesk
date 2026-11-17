-- Регрессия 0012: создание отдела с RETURNING (приложение использует .select('id'))
-- отклонялось политикой dep_read. can_read_department перезапрашивала departments,
-- а вставляемая строка невидима собственной команде — SELECT-политика для RETURNING
-- не проходила. Проверяем колонки создателя напрямую на строке; семантика 0012
-- (создатель читает, пока не стал участником; блокировка участника закрывает доступ) сохранена.
drop policy if exists dep_read on public.departments;
create policy dep_read on public.departments for select to authenticated
  using (
    is_member(id)
    or (
      created_by = auth.uid()
      and not exists (
        select 1 from department_members m
        where m.department_id = id and m.user_id = auth.uid()
      )
    )
  );

drop function if exists public.can_read_department(uuid);