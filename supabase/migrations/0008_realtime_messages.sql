-- Чат обновляется в реальном времени: добавляем messages в публикацию Realtime
-- (раньше это нужно было включать вручную в Database → Replication). Скрипт можно запускать повторно.
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
