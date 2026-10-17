-- Исправление: триггер регистрации должен явно указывать схему public,
-- иначе при вызове из сервиса auth таблица profiles не находится
-- и регистрация падает с "Database error saving new user".

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Явная схема и для функций проверки прав (безопасная практика для security definer)
alter function public.is_member(uuid) set search_path = public;
alter function public.can_write(uuid) set search_path = public;
alter function public.is_owner(uuid) set search_path = public;
alter function public.board_dep(uuid) set search_path = public;
