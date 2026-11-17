-- Доска обновляется в реальном времени: добавляем tasks, columns и boards
-- в публикацию Realtime по образцу 0008_realtime_messages.sql.
-- Скрипт можно запускать повторно. RLS проверяется для каждого подписчика.
do $$
begin
  alter publication supabase_realtime add table public.tasks;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.columns;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.boards;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;