import 'server-only';
import { cookies } from 'next/headers';
import type { Lang } from './dictionary';

export const LANG_COOKIE = 'fd_lang';

export function getLang(): Lang {
  return cookies().get(LANG_COOKIE)?.value === 'en' ? 'en' : 'ru';
}