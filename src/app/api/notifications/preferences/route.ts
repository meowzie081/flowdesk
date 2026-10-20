import { authenticated, json, smallJSON } from '@/lib/notifications/request';
import { defaultPreferences, preferenceSchema } from '@/lib/notifications/shared';
import { isManagedEmail } from '@/lib/accounts';
import { mailConfigured, pushConfigured } from '@/lib/notifications/transport';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  const auth = await authenticated(request, false); if (auth.error) return auth.error;
  const {data, error} = await auth.db.from('notification_preferences').select('email_events,email_announcements,push_enabled').eq('user_id', auth.user.id).maybeSingle();
  if (error) return json({error: 'Не удалось загрузить настройки. Проверьте миграцию 0014.'}, 503);
  return json({preferences: data ?? defaultPreferences, emailEligible: !!auth.user.email && !!auth.user.email_confirmed_at && !isManagedEmail(auth.user.email),
    emailConfigured: mailConfigured(), pushConfigured: pushConfigured(), publicKey: pushConfigured() ? process.env.VAPID_PUBLIC_KEY : null});
}
export async function POST(request: Request) {
  const auth = await authenticated(request); if (auth.error) return auth.error;
  const parsed = preferenceSchema.safeParse(await smallJSON(request));
  if (!parsed.success) return json({error: 'Некорректные настройки'}, 400);
  if ((parsed.data.email_events || parsed.data.email_announcements) && (!auth.user.email || !auth.user.email_confirmed_at || isManagedEmail(auth.user.email)))
    return json({error: 'Для email нужен аккаунт с подтверждённой настоящей почтой'}, 400);
  const {error} = await auth.db.from('notification_preferences').upsert({user_id: auth.user.id, ...parsed.data});
  return error ? json({error: 'Не удалось сохранить настройки'}, 503) : json({ok: true});
}
