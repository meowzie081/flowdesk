'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { LANG_COOKIE } from '@/lib/i18n/server';

export async function setLanguage(lang: string) {
  if (lang !== 'ru' && lang !== 'en') return;
  cookies().set(LANG_COOKIE, lang, { path: '/', maxAge: 31536000, sameSite: 'lax' });
  revalidatePath('/', 'layout');
}