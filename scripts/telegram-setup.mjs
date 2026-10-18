import { existsSync } from 'node:fs';
if (existsSync('.env')) {
    if (!process.loadEnvFile)
        throw new Error('Используйте Node.js 22 или новее');
    process.loadEnvFile('.env');
}
async function main() {
    const token = process.env.TELEGRAM_BOT_TOKEN, secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!token || !/^\d+:[A-Za-z0-9_-]+$/.test(token) || !secret || !/^[A-Za-z0-9_-]{32,256}$/.test(secret))
        throw new Error('Invalid configuration');
    const base = new URL(process.env.FLOWDESK_PUBLIC_URL || '');
    if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash || base.port && base.port !== '443')
        throw new Error('Invalid public origin');
    const url = new URL('/telegram', base).href;
    if (process.argv.includes('--dry-run')) {
        console.log(`Конфигурация проверена. Mini App: ${url}. Telegram API не вызывался.`);
        return;
    }
    async function call(method, body) { let response; try {
        response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    }
    catch {
        throw new Error('Telegram unavailable');
    } const data = await response.json().catch(() => null); if (!response.ok || !data?.ok)
        throw new Error('Telegram rejected request'); return data.result; }
    const probe = await fetch(new URL('/api/telegram/webhook', base), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret }, body: JSON.stringify({ update_id: 0 }), signal: AbortSignal.timeout(10000) });
    const probeBody = await probe.json().catch(() => null);
    if (!probe.ok || !probeBody?.ok)
        throw new Error('Webhook is not ready');
    await call('setMyCommands', { commands: [{ command: 'start', description: 'Открыть FlowDesk' }, { command: 'app', description: 'Запустить приложение' }, { command: 'help', description: 'Как пользоваться' }] });
    await call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'FlowDesk', web_app: { url } } });
    await call('setWebhook', { url: new URL('/api/telegram/webhook', base).href, secret_token: secret, allowed_updates: ['message'] });
    const info = await call('getWebhookInfo', {});
    console.log(`Бот настроен. Mini App: ${url}. Ожидающих обновлений: ${info.pending_update_count ?? 0}. Отправьте /start вашему боту.`);
}
main().catch(() => { console.error('Настройка бота не завершена. Проверьте TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET (32–256 букв, цифр, _ или -), FLOWDESK_PUBLIC_URL (HTTPS-адрес без пути), доступ к Telegram API и опубликованный webhook.'); process.exitCode = 1; });
