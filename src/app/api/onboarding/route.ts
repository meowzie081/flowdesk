import { authenticated, json, smallJSON } from '@/lib/notifications/request';
export async function GET(request: Request) {
  const auth = await authenticated(request, false); if (auth.error) return auth.error;
  const {data, error} = await auth.db.from('onboarding_progress').select('status').eq('user_id', auth.user.id).maybeSingle();
  return error ? json({error: 'Не удалось загрузить обучение'}, 503) : json({status: data?.status ?? 'new'});
}
export async function POST(request: Request) {
  const auth = await authenticated(request); if (auth.error) return auth.error;
  const input = await smallJSON(request);
  if (!['completed', 'skipped', 'new'].includes(input?.status)) return json({error: 'Некорректный статус'}, 400);
  const {error} = await auth.db.from('onboarding_progress').upsert({user_id: auth.user.id, status: input.status, updated_at: new Date().toISOString()});
  return error ? json({error: 'Не удалось сохранить обучение'}, 503) : json({ok: true});
}
