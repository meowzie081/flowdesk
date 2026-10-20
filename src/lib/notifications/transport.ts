import webpush from 'web-push';
import { deliveryOrigin, emailContent, allowedPushEndpoint } from './shared';

export class DeliveryError extends Error {
  constructor(public code: string, public retry: boolean) { super(code); }
}
export function mailConfigured() { return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM); }
export function pushConfigured() { return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT); }
export async function sendMail(to: string, id: string, content: ReturnType<typeof emailContent>) {
  if (!mailConfigured()) throw new DeliveryError('email_not_configured', true);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `flowdesk/${id}` },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], ...content }), signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new DeliveryError(`email_http_${response.status}`, response.status === 429 || response.status >= 500);
}
export async function sendPush(subscription: {endpoint: string; p256dh: string; auth: string}, noticeId: string) {
  if (!allowedPushEndpoint(subscription.endpoint)) throw new DeliveryError('invalid_push_endpoint', false);
  if (!pushConfigured()) throw new DeliveryError('push_not_configured', true);
  await webpush.sendNotification({ endpoint: subscription.endpoint, keys: {p256dh: subscription.p256dh, auth: subscription.auth} },
    // No task/chat content or department identity on the lock screen or a shared device.
    JSON.stringify({ title: 'FlowDesk', body: 'Новое уведомление. Откройте приложение.', url: '/', tag: `flowdesk-${noticeId}` }), {
      vapidDetails: {subject: process.env.VAPID_SUBJECT!, publicKey: process.env.VAPID_PUBLIC_KEY!, privateKey: process.env.VAPID_PRIVATE_KEY!},
      TTL: 3600, urgency: 'normal', timeout: 4000,
    });
}
export function configuredOrigin() { return deliveryOrigin(process.env.FLOWDESK_PUBLIC_URL); }
