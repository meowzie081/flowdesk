-- Принудительная смена временного пароля для аккаунтов, созданных/сброшенных владельцем.
alter table public.profiles add column if not exists must_change_password boolean not null default false;
grant select,insert,update,delete on public.profiles to service_role;

create or replace function public.protect_password_flag()
returns trigger language plpgsql as $$
begin
  -- Клиентские роли не могут снять или поставить отметку сами: это делает сервер
  -- (service_role) после выдачи временного пароля и после успешной смены пароля.
  if new.must_change_password is distinct from old.must_change_password
     and current_user in ('authenticated','anon') then
    new.must_change_password := old.must_change_password;
  end if;
  return new;
end $$;

drop trigger if exists profiles_password_flag on public.profiles;
create trigger profiles_password_flag before update on public.profiles
  for each row execute function public.protect_password_flag();