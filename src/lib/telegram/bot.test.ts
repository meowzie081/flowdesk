import { describe, it, expect, vi, afterEach } from 'vitest';
import { botReply, miniAppUrl, verifyWebhookSecret, telegramApi } from './bot';
import { POST } from '@/app/api/telegram/webhook/route';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const secret = 'test_secret_with_more_than_32_characters';
const update = { update_id: 1, message: { text: '/start', chat: { id: 123, type: 'private' } } };
function setup() { vi.stubEnv('TELEGRAM_BOT_TOKEN', '123:token'); vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', secret); vi.stubEnv('FLOWDESK_PUBLIC_URL', 'https://flowdesk.example'); }
function request(body: string, key: string | null = secret) { return new Request('https://flowdesk.example/api/telegram/webhook', { method: 'POST', headers: { ...(key ? { 'x-telegram-bot-api-secret-token': key } : {}), 'content-type': 'application/json' }, body }); }
describe('Telegram command and webhook boundary', () => {
    it('compares the configured secret and rejects missing or malformed credentials', () => { expect(verifyWebhookSecret(secret, secret)).toBe(true); for (const value of [null, 'wrong', 'x'.repeat(secret.length)])
        expect(verifyWebhookSecret(value, secret)).toBe(false); expect(verifyWebhookSecret('short', 'short')).toBe(false); });
    it('requires an explicit HTTPS origin for the Mini App', () => { expect(miniAppUrl('https://flowdesk.example')).toBe('https://flowdesk.example/telegram'); for (const value of [undefined, 'http://flowdesk.example', 'https://user:pass@flowdesk.example', 'https://flowdesk.example/private', 'https://flowdesk.example?token=secret', 'https://flowdesk.example:3000'])
        expect(() => miniAppUrl(value)).toThrow(); });
    it('responds only to private-chat app commands without echoing user content', () => { for (const command of ['/start', '/start payload', '/app@flowdesk_bot', '/help'])
        expect(botReply({ ...update, message: { ...update.message, text: command } }, 'https://flowdesk.example/telegram')?.reply_markup.inline_keyboard[0][0].web_app.url).toBe('https://flowdesk.example/telegram'); for (const raw of [null, {}, 42, { message: { ...update.message, text: 'secret work content' } }, { message: { ...update.message, chat: { id: 123, type: 'group' } } }])
        expect(botReply(raw, 'https://flowdesk.example/telegram')).toBeNull(); });
    it('fails closed when bot configuration is absent', async () => { vi.stubEnv('TELEGRAM_BOT_TOKEN', ''); expect((await POST(request('{}'))).status).toBe(503); });
    it('rejects forged requests before sending a Telegram message', async () => { setup(); const send = vi.fn(); vi.stubGlobal('fetch', send); expect((await POST(request(JSON.stringify(update), 'forged'))).status).toBe(401); expect(send).not.toHaveBeenCalled(); });
    it('bounds actual body bytes and rejects invalid JSON', async () => { setup(); expect((await POST(request('x'.repeat(65537)))).status).toBe(413); expect((await POST(request('invalid'))).status).toBe(400); });
    it('ignores groups and sends app button for valid private command', async () => { setup(); const send = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: {} }))); vi.stubGlobal('fetch', send); expect((await POST(request(JSON.stringify({ ...update, message: { ...update.message, chat: { id: -1, type: 'group' } } })))).status).toBe(200); expect(send).not.toHaveBeenCalled(); expect((await POST(request(JSON.stringify(update)))).status).toBe(200); expect(send).toHaveBeenCalledTimes(1); expect(JSON.parse(send.mock.calls[0][1].body).reply_markup.inline_keyboard[0][0].web_app.url).toBe('https://flowdesk.example/telegram'); });
    it('does not leak token or provider error to clients and retries upstream failures', async () => { setup(); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret token in provider error'))); const response = await POST(request(JSON.stringify(update))); expect(response.status).toBe(502); expect(await response.text()).not.toContain('secret token'); });
    it('does not expose Telegram API response descriptions containing secrets', async () => { await expect(telegramApi('123:private_token', 'sendMessage', {}, vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, description: 'private_token' }), { status: 401 })))).rejects.toThrow('Telegram API rejected the request'); });
});
