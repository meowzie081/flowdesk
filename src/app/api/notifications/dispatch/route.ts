import { timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { json } from '@/lib/notifications/request';
import { dispatchNotifications } from '@/lib/notifications/dispatch';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  const key = process.env.NOTIFICATION_CRON_SECRET;
  if (!key || !/^[A-Za-z0-9_-]{32,256}$/.test(key)) return json({error: 'Доставка ещё не настроена'}, 503);
  const got = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${key}`;
  if (Buffer.byteLength(got) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(got), Buffer.from(expected))) return json({error: 'Unauthorized'}, 401);
  const admin = createAdminClient(); if (!admin) return json({error: 'Сервис недоступен'}, 503);
  try { return json(await dispatchNotifications(admin)); }
  catch { return json({error: 'Не удалось обработать очередь. Проверьте миграцию и настройки доставки.'}, 503); }
}
