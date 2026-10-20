import { authenticated, json, smallJSON } from '@/lib/notifications/request';
import { subscriptionSchema, allowedPushEndpoint } from '@/lib/notifications/shared';
import { pushConfigured } from '@/lib/notifications/transport';
import { createAdminClient } from '@/lib/supabase/admin';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const auth = await authenticated(request); if (auth.error) return auth.error;
  const input = subscriptionSchema.safeParse(await smallJSON(request));
  if (!input.success) return json({error: 'Некорректная push-подписка'}, 400);
  if (Buffer.from(input.data.keys.p256dh, 'base64url')[0] !== 4) return json({error: 'Некорректный ключ устройства'}, 400);
  const admin = createAdminClient(); if (!admin || !pushConfigured()) return json({error: 'Администратор ещё не настроил Web Push'}, 503);
  const {error} = await admin.rpc('register_push_device', {account: auth.user.id, endpoint_url: input.data.endpoint, key_p: input.data.keys.p256dh, key_a: input.data.keys.auth});
  if (error) return json({error: 'Не удалось добавить устройство: максимум 5. При смене аккаунта отключите подписку в предыдущем аккаунте или сбросьте разрешение сайта.'}, 409);
  return json({ok: true});
}
export async function DELETE(request: Request) {
  const auth = await authenticated(request); if (auth.error) return auth.error;
  const input = await smallJSON(request);
  if (typeof input?.endpoint !== 'string' || !allowedPushEndpoint(input.endpoint)) return json({error: 'Некорректная подписка'}, 400);
  const admin = createAdminClient(); if (!admin) return json({error: 'Сервис недоступен'}, 503);
  const {error} = await admin.from('push_subscriptions').delete().eq('user_id', auth.user.id).eq('endpoint', input.endpoint);
  return error ? json({error: 'Не удалось отключить устройство'}, 503) : json({ok: true});
}
