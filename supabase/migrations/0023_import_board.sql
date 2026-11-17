-- Атомарный импорт доски из Trello/CSV. security invoker: RLS и триггер лимитов
-- досок применяются как при обычном создании; всё в одной транзакции.
create or replace function public.import_board_payload(p_dep uuid, p_payload jsonb)
returns uuid language plpgsql security invoker set search_path=public as $$
declare
  b uuid; cid uuid; col record; t record; pos integer;
  cols jsonb; tasks jsonb;
begin
  if auth.uid() is null then raise exception 'Войдите в аккаунт'; end if;
  if not public.can_write(p_dep) then raise exception 'Нет прав на импорт в этот отдел'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Некорректные данные импорта';
  end if;
  cols := coalesce(p_payload->'columns', '[]'::jsonb);
  tasks := coalesce(p_payload->'tasks', '[]'::jsonb);
  if jsonb_array_length(cols) = 0 then raise exception 'В файле нет колонок'; end if;
  if jsonb_array_length(cols) > 50 then raise exception 'Слишком много колонок (максимум 50)'; end if;
  if jsonb_array_length(tasks) > 2000 then raise exception 'Слишком много задач (максимум 2000)'; end if;

  insert into boards(department_id, name)
    values (p_dep, left(coalesce(nullif(trim(p_payload->>'board_name'), ''), 'Импорт'), 60))
    returning id into b;

  pos := 0;
  for col in select value as elem from jsonb_array_elements(cols) loop
    insert into columns(board_id, name, position, is_done)
      values (b, left(col.elem->>'name', 60), pos, coalesce((col.elem->>'is_done')::boolean, false));
    pos := pos + 1;
  end loop;

  pos := 0;
  for t in select value as elem from jsonb_array_elements(tasks) loop
    select id into cid from columns where board_id = b and name = t.elem->>'column' order by position limit 1;
    if cid is null then select id into cid from columns where board_id = b order by position limit 1; end if;
    insert into tasks(column_id, board_id, title, description, priority, due_date, position, created_by)
      values (
        cid, b,
        left(t.elem->>'title', 200),
        left(coalesce(t.elem->>'description', ''), 8000),
        (case when t.elem->>'priority' in ('low','medium','high') then t.elem->>'priority' else 'medium' end)::task_priority,
        case when t.elem->>'due_date' ~ '^\d{4}-\d{2}-\d{2}$' then (t.elem->>'due_date')::date else null end,
        pos, auth.uid()
      );
    pos := pos + 1;
  end loop;
  return b;
end $$;
grant execute on function public.import_board_payload(uuid, jsonb) to authenticated;