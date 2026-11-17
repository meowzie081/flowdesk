import 'server-only';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/** Fixed-window limiter backed by Supabase (global across serverless instances).
 * Fails open when the admin client or RPC is unavailable: this is defense-in-depth,
 * and a limiter outage must not lock legitimate users out of password changes. */
export async function checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const admin = createAdminClient();
  if (!admin) return true;
  const { data, error } = await admin.rpc('check_rate_limit', { p_key: key, p_limit: limit, p_window_seconds: windowSeconds });
  if (error) return true;
  return data !== false;
}

export function tooManyRequests(retryAfterSeconds = 60) {
  return NextResponse.json(
    { error: 'Слишком много запросов. Подождите немного и повторите.' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds), 'Cache-Control': 'no-store' } },
  );
}