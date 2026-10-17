-- Кастомизация профиля: иконка (эмодзи) и цвет ника. Скрипт можно запускать повторно.
alter table profiles add column if not exists avatar_icon text;
alter table profiles add column if not exists name_color text;

alter table profiles drop constraint if exists profiles_avatar_icon_len;
alter table profiles add constraint profiles_avatar_icon_len
  check (avatar_icon is null or char_length(avatar_icon) between 1 and 8);

alter table profiles drop constraint if exists profiles_name_color_hex;
alter table profiles add constraint profiles_name_color_hex
  check (name_color is null or name_color ~ '^#[0-9a-fA-F]{6}$');

-- Права на изменение профиля уже есть: политика profiles_update разрешает править только свою строку.
