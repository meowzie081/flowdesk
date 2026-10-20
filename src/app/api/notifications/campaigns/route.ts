import { authenticated, json, smallJSON } from '@/lib/notifications/request';
import { campaignSchema } from '@/lib/notifications/shared';
export async function POST(request: Request) {
  const auth = await authenticated(request); if (auth.error) return auth.error;
  const input = campaignSchema.safeParse(await smallJSON(request));
  if (!input.success) return json({error: 'Тема: 1–120 символов; текст: 1–4000 символов'}, 400);
  const {departmentId, id, subject, body} = input.data;
  const {data, error} = await auth.db.rpc('publish_department_announcement', {dep: departmentId, campaign: id, heading: subject, content: body});
  return error ? json({error: 'Рассылка не создана. Нужны права владельца; между рассылками — минимум минута.'}, 400) : json({ok: true, ...data});
}
