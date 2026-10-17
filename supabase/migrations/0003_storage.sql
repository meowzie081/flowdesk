-- Файловое хранилище: приватный bucket "attachments".
-- Путь объекта: <task_id>/<uuid>-<имя файла>, права проверяются по отделу задачи.

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 10485760)
on conflict (id) do nothing;

create or replace function task_dep(t uuid)
returns uuid language sql security definer stable set search_path = public as $$
  select board_dep(board_id) from tasks where id = t;
$$;

drop policy if exists att_obj_read on storage.objects;
create policy att_obj_read on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and is_member(task_dep(((storage.foldername(name))[1])::uuid))
  );

drop policy if exists att_obj_insert on storage.objects;
create policy att_obj_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and can_write(task_dep(((storage.foldername(name))[1])::uuid))
  );

drop policy if exists att_obj_delete on storage.objects;
create policy att_obj_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and can_write(task_dep(((storage.foldername(name))[1])::uuid))
  );
