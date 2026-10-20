import { NextResponse } from 'next/server';
import { sameOrigin } from '@/lib/http';
import { createClient } from '@/lib/supabase/server';

export const noStore = {'Cache-Control': 'no-store'};
export function json(data: unknown, status = 200) { return NextResponse.json(data, {status, headers: noStore}); }
export async function authenticated(request: Request, mutate = true) {
  if (mutate && !sameOrigin(request)) return {error: json({error: 'Недопустимый источник запроса'}, 403)} as const;
  const db = createClient();
  const {data: {user}} = await db.auth.getUser();
  if (!user) return {error: json({error: 'Войдите в аккаунт'}, 401)} as const;
  return {db, user} as const;
}
export async function smallJSON(request: Request, limit = 32768) {
  if (!request.body) return null;
  const reader = request.body.getReader(); let size = 0; const parts: Uint8Array[] = [];
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); return null; }
      parts.push(value);
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch { return null; } finally { reader.releaseLock(); }
}
