import { NextResponse } from 'next/server';
import { botReply, miniAppUrl, telegramApi, validWebhookSecret, verifyWebhookSecret } from '@/lib/telegram/bot';
export const runtime = 'nodejs';
export async function POST(request: Request) {
    const token = process.env.TELEGRAM_BOT_TOKEN, secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!token || !validWebhookSecret(secret) || !process.env.FLOWDESK_PUBLIC_URL)
        return NextResponse.json({ error: 'Telegram bot is not configured' }, { status: 503 });
    if (!verifyWebhookSecret(request.headers.get('x-telegram-bot-api-secret-token'), secret))
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // Bound the actual stream, not only a potentially forged Content-Length header.
    const reader = request.body?.getReader();
    if (!reader)
        return NextResponse.json({ error: 'Empty update' }, { status: 400 });
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            bytes += value.length;
            if (bytes > 65536) {
                await reader.cancel();
                return NextResponse.json({ error: 'Update too large' }, { status: 413 });
            }
            chunks.push(value);
        }
    }
    catch {
        return NextResponse.json({ error: 'Invalid update' }, { status: 400 });
    }
    let update: unknown;
    try {
        update = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    try {
        const reply = botReply(update, miniAppUrl(process.env.FLOWDESK_PUBLIC_URL));
        if (reply)
            await telegramApi(token, 'sendMessage', reply);
        return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    }
    catch {
        return NextResponse.json({ error: 'Telegram bot request failed' }, { status: 502 });
    }
}
