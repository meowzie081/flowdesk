-- Автоматическая запись событий для дайджеста «Что я пропустил»

create or replace function log_task_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  dep uuid;
  col_done boolean;
begin
  dep := board_dep(new.board_id);

  if tg_op = 'INSERT' then
    insert into task_events (department_id, task_id, actor_id, kind, payload)
    values (dep, new.id, auth.uid(), 'created', jsonb_build_object('title', new.title));
    return new;
  end if;

  -- перемещение между колонками
  if new.column_id is distinct from old.column_id then
    select is_done into col_done from columns where id = new.column_id;
    insert into task_events (department_id, task_id, actor_id, kind, payload)
    values (
      dep, new.id, auth.uid(),
      case when col_done then 'done' else 'moved' end,
      jsonb_build_object('title', new.title)
    );
  end if;

  -- смена исполнителя
  if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null then
    insert into task_events (department_id, task_id, actor_id, kind, payload)
    values (dep, new.id, auth.uid(), 'assigned', jsonb_build_object('title', new.title));
  end if;

  return new;
end $$;

drop trigger if exists tasks_log_insert on tasks;
create trigger tasks_log_insert
  after insert on tasks
  for each row execute function log_task_event();

drop trigger if exists tasks_log_update on tasks;
create trigger tasks_log_update
  after update on tasks
  for each row execute function log_task_event();
