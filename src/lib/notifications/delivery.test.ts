import {afterEach, describe, expect, it, vi} from 'vitest';
import {allowedPushEndpoint, campaignSchema, emailContent, deliveryOrigin, subscriptionSchema} from './shared';
import {DeliveryError, sendMail, sendPush} from './transport';
import webpush from 'web-push';
vi.mock('web-push', () => ({default: {sendNotification: vi.fn()}}));
afterEach(() => {vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks();});
const id = '00000000-0000-4000-8000-000000000001';
const notice = {department_id: id, campaign_id: id};
describe('delivery boundaries', () => {
  it('rejects arbitrary/private endpoints, credentials, forged suffixes and URL schemes', () => {
    for (const endpoint of ['http://fcm.googleapis.com/a', 'https://127.0.0.1/x', 'https://localhost/x', 'https://fcm.googleapis.com.evil.test/x', 'https://evil.test/fcm.googleapis.com', 'https://name:password@fcm.googleapis.com/x', 'https://fcm.googleapis.com:444/x', 'file:///etc/passwd', 'https://fcm.googleapis.com/x#part']) expect(allowedPushEndpoint(endpoint)).toBe(false);
    for (const endpoint of ['https://fcm.googleapis.com/wp/secret', 'https://updates.push.services.mozilla.com/wpush/v2/a', 'https://web.push.apple.com/Q/a', 'https://wns2-am3p.notify.windows.com/w/?token=x']) expect(allowedPushEndpoint(endpoint)).toBe(true);
  });
  it('validates keys and bounded campaign text', () => {
    expect(subscriptionSchema.safeParse({endpoint: 'https://fcm.googleapis.com/x', keys: {p256dh: 'x'.repeat(87), auth: 'a'.repeat(22)}}).success).toBe(true);
    expect(subscriptionSchema.safeParse({endpoint: 'https://fcm.googleapis.com/x', keys: {p256dh: 'short', auth: 'short'}}).success).toBe(false);
    for (const subject of ['Hello\nBcc: other@test.example', 'x'.repeat(121), ' ']) expect(campaignSchema.safeParse({id, departmentId: id, subject, body: 'Text'}).success).toBe(false);
  });
  it('requires a configured HTTPS origin, never a caller-provided host', () => {
    for(const value of [undefined, 'http://localhost', 'https://a.test/path', 'https://u:p@a.test', 'https://a.test?token=x']) expect(() => deliveryOrigin(value)).toThrow();
    expect(deliveryOrigin('https://flowdesk.example')).toBe('https://flowdesk.example');
  });
  it('escapes campaign HTML and generates profile opt-out link', () => {
    const email = emailContent('https://flowdesk.example', notice, {subject: '<img onerror=evil()>', body: '<script>alert(1)</script> & "test"'});
    expect(email.html).not.toContain('<script>'); expect(email.html).not.toContain('<img');
    expect(email.html).toContain('&lt;script&gt;'); expect(email.text).toContain('/profile#notifications');
    expect(email.html).toContain(`/d/${id}/announcements#${id}`);
  });
  it('keeps task content out of event emails', () => {
    const email = emailContent('https://flowdesk.example', {department_id: id, task_id: id});
    expect(email.subject).toBe('FlowDesk — новое уведомление'); expect(email.text).toContain('/board?task=');
  });
  it('sends individual recipients with a stable idempotency key', async () => {
    vi.stubEnv('RESEND_API_KEY', 'private-key'); vi.stubEnv('EMAIL_FROM', 'FlowDesk <team@example.com>');
    const fetcher = vi.fn().mockResolvedValue(new Response('{}')); vi.stubGlobal('fetch', fetcher);
    await sendMail('member@example.com', id, emailContent('https://flowdesk.example', notice));
    const options = fetcher.mock.calls[0][1];
    expect(options.headers['Idempotency-Key']).toBe(`flowdesk/${id}`);
    expect(JSON.parse(options.body).to).toEqual(['member@example.com']);
  });
  it('classifies provider failures without exposing provider bodies or tokens', async () => {
    vi.stubEnv('RESEND_API_KEY', 'private-key'); vi.stubEnv('EMAIL_FROM', 'team@example.com');
    for(const [status, retry] of [[429, true], [503, true], [401, false], [422, false]] as const) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret provider body', {status})));
      const error = await sendMail('member@example.com', id, emailContent('https://flowdesk.example', notice)).catch(e => e);
      expect(error).toBeInstanceOf(DeliveryError); expect(error.retry).toBe(retry); expect(error.message).not.toContain('secret');
    }
  });
  it('encrypts only a generic push payload and bounds its lifetime', async () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', 'public'); vi.stubEnv('VAPID_PRIVATE_KEY', 'private'); vi.stubEnv('VAPID_SUBJECT', 'mailto:admin@example.com');
    await sendPush({endpoint: 'https://fcm.googleapis.com/x', p256dh: 'key', auth: 'auth'}, id);
    const call = vi.mocked(webpush.sendNotification).mock.calls[0];
    expect(JSON.parse(call[1] as string)).toEqual({title: 'FlowDesk', body: 'Новое уведомление. Откройте приложение.', url: '/', tag: `flowdesk-${id}`});
    expect(call[2]?.TTL).toBe(3600); expect(call[2]?.timeout).toBe(4000);
  });
});
