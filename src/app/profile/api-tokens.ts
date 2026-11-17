'use server';

import { createHash, randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type TokenResult = { ok: true; token: string } | { ok: false; error: string };

export async function createApiToken(formData: FormData): Promise<TokenResult> {
  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 1 || name.length > 60) return { ok: false, error: 'Название токена — от 1 до 60 символов.' };
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Войдите в аккаунт.' };
  const token = 'fd_' + randomBytes(32).toString('base64url');
  const { error } = await supabase.from('api_tokens').insert({
    user_id: user.id,
    name,
    token_hash: createHash('sha256').update(token).digest('hex'),
    token_prefix: token.slice(0, 11),
  });
  if (error) {
    const missing = /api_tokens|does not exist|schema cache/i.test(error.message);
    return { ok: false, error: missing ? 'API ещё не включён в этой базе. Примените миграцию 0024 в Supabase SQL Editor.' : error.message };
  }
  revalidatePath('/profile');
  return { ok: true, token };
}

export async function revokeApiToken(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const id = String(formData.get('id') ?? '');
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Войдите в аккаунт.' };
  const { error } = await supabase.from('api_tokens').delete().eq('id', id).eq('user_id', user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/profile');
  return { ok: true };
}