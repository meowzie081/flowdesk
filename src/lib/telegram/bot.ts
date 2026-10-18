import { timingSafeEqual } from 'node:crypto';
export function validWebhookSecret(value: string | undefined): value is string { return !!value && /^[A-Za-z0-9_-]{32,256}$/.test(value); }
export function verifyWebhookSecret(actual: string | null, expected: string | undefined) {
    if (!actual || !validWebhookSecret(expected))
        return false;
    const a = Buffer.from(actual), b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}
export function miniAppUrl(value: string | undefined) {
    if (!value)
        throw new Error('FLOWDESK_PUBLIC_URL is required');
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.port && url.port !== '443')
        throw new Error('FLOWDESK_PUBLIC_URL must be an HTTPS origin');
    return new URL('/telegram', url).href;
}
/** Commands contain no user identity, account data or work content. Only private chats. */
export function botReply(update: unknown, appUrl: string) {
    const u = update as {
        message?: {
            chat?: {
                id?: number;
                type?: string;
            };
            text?: string;
        };
    } | null;
    const m = u?.message;
    if (m?.chat?.type !== 'private' || !Number.isSafeInteger(m.chat.id) || typeof m.text !== 'string')
        return null;
    const command = m.text.trim().split(/\s/, 1)[0].split('@', 1)[0].toLowerCase();
    if (!['/start', '/app', '/help'].includes(command))
        return null;
    return { chat_id: m.chat.id, text: command === '/help' ? 'Откройте FlowDesk кнопкой ниже. Вход — по вашему логину и паролю FlowDesk. Задачи, чат и файлы общие для сайта и приложения.' : 'FlowDesk — ваш день и работа команды. Откройте приложение и войдите в свой аккаунт.', reply_markup: { inline_keyboard: [[{ text: 'Открыть FlowDesk', web_app: { url: appUrl } }]] } };
}
export async function telegramApi(token: string, method: 'sendMessage' | 'setWebhook' | 'getWebhookInfo' | 'setMyCommands' | 'setChatMenuButton', body: unknown, fetcher: typeof fetch = fetch) {
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(token))
        throw new Error('Telegram bot token is not configured');
    let response: Response;
    try {
        response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    }
    catch {
        throw new Error('Telegram API is unavailable');
    }
    const data = await response.json().catch(() => null) as {
        ok?: boolean;
        result?: unknown;
    } | null;
    if (!response.ok || !data?.ok)
        throw new Error('Telegram API rejected the request');
    return data.result;
}
