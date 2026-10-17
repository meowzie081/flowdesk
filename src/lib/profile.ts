import { z } from 'zod';

/** Иконки для профиля (эмодзи). В базе хранится сам символ. */
export const ICONS = [
  '🦊', '🐱', '🐶', '🐼', '🦉', '🐙', '🦄', '🐢',
  '🚀', '⭐', '🔥', '⚡', '🌿', '🌙', '🎯', '🎨',
  '💡', '🧠', '🛠️', '📌', '🎧', '☕', '🍀', '🧩',
] as const;

/** Готовые цвета ника: читаются и на светлой, и на тёмной теме. */
export const COLORS = [
  '#2563eb', '#0891b2', '#059669', '#4d7c0f',
  '#d97706', '#ea580c', '#dc2626', '#db2777',
  '#9333ea', '#7c3aed', '#6b7280', '#a16207',
] as const;

const LIGHT_BG = '#fafafa';
const DARK_BG = '#0a0a0a';
const MIN_CONTRAST = 3;

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** Контраст двух цветов по WCAG: от 1 до 21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Цвет подходит, если ник читается и на светлом, и на тёмном фоне (иначе пользователь выберет «невидимый» ник). */
export function isReadableColor(hex: string): boolean {
  return (
    isHexColor(hex) && contrastRatio(hex, LIGHT_BG) >= MIN_CONTRAST && contrastRatio(hex, DARK_BG) >= MIN_CONTRAST
  );
}

export const profileSchema = z.object({
  full_name: z.string().trim().min(1, 'Введите имя').max(40, 'Имя не длиннее 40 символов'),
  avatar_icon: z.string().max(8).nullable(),
  name_color: z
    .string()
    .nullable()
    .refine((c) => c === null || isReadableColor(c), 'Этот цвет плохо читается на светлой или тёмной теме'),
});

export interface ProfileLook {
  name: string;
  icon?: string | null;
  color?: string | null;
}

/** Достаёт данные профиля из вложенного запроса Supabase (может прийти объектом или массивом). */
export function lookFromRow(row: unknown, fallbackName: string): ProfileLook {
  const p = (Array.isArray(row) ? row[0] : row) as
    | { full_name?: string; avatar_icon?: string | null; name_color?: string | null }
    | null
    | undefined;
  return {
    name: p?.full_name?.trim() || fallbackName,
    icon: p?.avatar_icon ?? null,
    color: p?.name_color && isHexColor(p.name_color) ? p.name_color : null,
  };
}
