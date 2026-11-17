import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let database: 'up' | 'down' | 'unconfigured' = 'unconfigured';
  if (url && key) {
    const probe = createClient(url, key, { auth: { persistSession: false } });
    try {
      // RLS вернёт пустой результат для anon — важен сам факт ответа базы, не строки.
      const { error } = await probe
        .from('departments')
        .select('id')
        .limit(1)
        .abortSignal(AbortSignal.timeout(5000));
      database = error ? 'down' : 'up';
    } catch {
      database = 'down';
    }
  }
  const ok = database !== 'down';
  return Response.json(
    { ok, database },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}