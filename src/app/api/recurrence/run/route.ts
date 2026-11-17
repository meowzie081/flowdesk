import { timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { json } from '@/lib/notifications/request';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  const key = process.env.NOTIFICATION_CRON_SECRET;
  if (!key || !/^[A-Za-z0-9_-]{32,256}$/.test(key)) return json({error: 'Планировщик ещё не настроен'}, 503);
  const got = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${key}`;
  if (Buffer.byteLength(got) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(got), Buffer.from(expected))) return json({error: 'Unauthorized'}, 401);
  const admin = createAdminClient(); if (!admin) return json({error: 'Сервис недоступен'}, 503);
  try {
    const { data, error } = await admin.rpc('run_due_recurring');
    if (error) return json({error: 'Не удалось обработать повторы задач.'}, 503);
    return json(data);
  } catch {
    return json({error: 'Не удалось обработать повторы задач.'}, 503);
  }
}