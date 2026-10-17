-- Этап 1: приглашения по email и устойчивый дайджест «Что я пропустил»

-- Предыдущий визит: дайджест не пропадает при обновлении страницы
alter table profiles add column if not exists prev_seen_at timestamptz;

-- Приглашения: человек ещё не зарегистрирован, при входе он автоматически попадёт в отдел
create table if not exists invites (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) <= 254),
  role member_role not null default 'member',
  invited_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  unique (department_id, email)
);

alter table invites enable row level security;

drop policy if exists invites_read on invites;
create policy invites_read on invites for select to authenticated
  using (is_owner(department_id));

drop policy if exists invites_delete on invites;
create policy invites_delete on invites for delete to authenticated
  using (is_owner(department_id));
-- вставка идёт только через функцию invite_member (прямого insert-доступа нет)

-- Применение приглашений (вызывается только триггерами)
create or replace function public.apply_invites(uid uuid, mail text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if mail is null then return; end if;
  insert into department_members (department_id, user_id, role)
  select department_id, uid, role from invites where email = lower(mail)
  on conflict do nothing;
  delete from invites where email = lower(mail);
end $$;

revoke all on function public.apply_invites(uuid, text) from public, anon, authenticated;

-- Регистрация: профиль + приглашения (только для подтверждённой почты)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;

  if new.email_confirmed_at is not null then
    perform public.apply_invites(new.id, new.email);
  end if;
  return new;
end $$;

-- Подтверждение почты позже (письмо со ссылкой): применяем приглашения тогда
create or replace function public.handle_user_confirmed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.apply_invites(new.id, new.email);
  return new;
end $$;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.handle_user_confirmed();

-- Приглашение: существующего пользователя добавляем сразу, иначе сохраняем приглашение
create or replace function public.invite_member(dep uuid, member_email text, new_role member_role)
returns text language plpgsql security definer set search_path = public as $$
declare
  e text := lower(trim(member_email));
  uid uuid;
begin
  if not is_owner(dep) then
    raise exception 'forbidden';
  end if;
  if e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid_email';
  end if;

  select id into uid from auth.users where lower(email) = e limit 1;
  if uid is not null then
    insert into department_members (department_id, user_id, role)
    values (dep, uid, new_role)
    on conflict (department_id, user_id) do update set role = excluded.role;
    return 'added';
  end if;

  insert into invites (department_id, email, role, invited_by)
  values (dep, e, new_role, auth.uid())
  on conflict (department_id, email) do update set role = excluded.role;
  return 'pending';
end $$;

revoke all on function public.invite_member(uuid, text, member_role) from public, anon;
grant execute on function public.invite_member(uuid, text, member_role) to authenticated;
