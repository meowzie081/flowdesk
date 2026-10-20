import { z } from 'zod';

export const preferenceSchema = z.object({
  email_events: z.boolean(), email_announcements: z.boolean(), push_enabled: z.boolean(),
}).strict();
export const defaultPreferences = { email_events: false, email_announcements: false, push_enabled: false };
export const campaignSchema = z.object({
  departmentId: z.string().uuid(), id: z.string().uuid(),
  subject: z.string().trim().min(1).max(120).refine(v => !/[\r\n]/.test(v)),
  body: z.string().trim().min(1).max(4000),
}).strict();

// Push endpoints are supplied by clients but contacted by the server: reject arbitrary URLs.
export function allowedPushEndpoint(value: string): boolean {
  try {
    const u = new URL(value);
    return value.length <= 2048 && u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash &&
      (u.hostname === 'fcm.googleapis.com' || u.hostname === 'updates.push.services.mozilla.com' ||
       u.hostname === 'web.push.apple.com' || /^[a-z0-9-]+\.notify\.windows\.com$/.test(u.hostname));
  } catch { return false; }
}
export const subscriptionSchema = z.object({
  endpoint: z.string().refine(allowedPushEndpoint),
  keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/) }).strict(),
  expirationTime: z.number().nullable().optional(),
}).strict();
export function notificationHref(n: {department_id: string; task_id?: string | null; message_id?: string | null; campaign_id?: string | null}) {
  const base = `/d/${n.department_id}`;
  return n.campaign_id ? `${base}/announcements#${n.campaign_id}` : n.message_id ? `${base}/chat?message=${n.message_id}` : n.task_id ? `${base}/board?task=${n.task_id}` : `${base}/my-day`;
}
export function deliveryOrigin(value: string | undefined): string {
  if (!value) throw new Error('Delivery configuration is missing');
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash || u.port) throw new Error('Delivery origin must be HTTPS');
  return u.origin;
}
export function escapeHTML(value: string) {
  return value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
}
export function emailContent(origin: string, notice: Parameters<typeof notificationHref>[0], campaign?: {subject: string; body: string} | null) {
  const url = new URL(notificationHref(notice), origin).href;
  const preferences = `${origin}/profile#notifications`;
  const subject = campaign ? `FlowDesk: ${campaign.subject}` : 'FlowDesk — новое уведомление';
  const body = campaign?.body ?? 'У вас новое рабочее уведомление. Откройте FlowDesk, чтобы посмотреть подробности.';
  return {
    subject,
    text: `${body}\n\nОткрыть FlowDesk: ${url}\n\nВы получили это письмо, потому что включили email в FlowDesk. Отключить письма: ${preferences}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px;color:#202020"><p style="color:#c2410c;font-weight:bold">FlowDesk</p><h1 style="font-size:24px">${escapeHTML(campaign?.subject ?? 'Новое уведомление')}</h1><p style="white-space:pre-wrap;line-height:1.6">${escapeHTML(body)}</p><p><a href="${escapeHTML(url)}">Открыть FlowDesk →</a></p><hr><p style="font-size:12px">Вы включили email в FlowDesk. <a href="${escapeHTML(preferences)}">Настроить или отключить письма</a></p></div>`,
  };
}
