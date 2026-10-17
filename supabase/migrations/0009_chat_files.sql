-- Soft deletion propagates through filtered Realtime UPDATE events and polling.
alter table public.messages add column deleted_at timestamptz;
alter table public.messages add column files jsonb not null default '[]'::jsonb;
alter table public.messages add constraint messages_files_array check (jsonb_typeof(files) = 'array' and jsonb_array_length(files) <= 5);

-- Use soft deletion exclusively so every client receives a tombstone.
drop policy if exists msg_delete on public.messages;

-- Only deletion is exposed; other message fields remain immutable.
create function public.delete_chat_message(message_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update messages set deleted_at = now(), body = 'Сообщение удалено', files = '[]'::jsonb
  where id = message_id and deleted_at is null and can_write(department_id)
    and (author_id = auth.uid() or is_owner(department_id));
  if not found then raise exception 'Нет права удалить сообщение'; end if;
  update tasks set source_message_id = null where source_message_id = message_id;
end;
$$;
revoke all on function public.delete_chat_message(uuid) from public;
grant execute on function public.delete_chat_message(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-files', 'chat-files', false, 10485760) on conflict (id) do nothing;
-- Object path: department / uploader / uuid-file. Private, no executable preview.
create policy chat_files_read on storage.objects for select to authenticated
using (bucket_id = 'chat-files' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy chat_files_insert on storage.objects for insert to authenticated
with check (bucket_id = 'chat-files' and public.can_write(((storage.foldername(name))[1])::uuid)
  and (storage.foldername(name))[2] = auth.uid()::text);
create policy chat_files_delete on storage.objects for delete to authenticated
using (bucket_id = 'chat-files' and public.can_write(((storage.foldername(name))[1])::uuid)
  and ((storage.foldername(name))[2] = auth.uid()::text or public.is_owner(((storage.foldername(name))[1])::uuid)));
