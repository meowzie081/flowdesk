/** Client flags affect presentation only. They never authorize access to data. */
export const TELEGRAM_CLIENT_KEY = 'flowdesk:telegram-client';
export type NativeClient = 'telegram' | 'desktop' | null;
export function nativeClient(): NativeClient {
    if (typeof window === 'undefined')
        return null;
    if (/\bFlowDeskDesktop\//.test(navigator.userAgent))
        return 'desktop';
    try {
        if (sessionStorage.getItem(TELEGRAM_CLIENT_KEY) === '1')
            return 'telegram';
    }
    catch { }
    return null;
}
export function telegramBackTarget(path: string): string | null {
    if (path === '/telegram' || path === '/')
        return null;
    if (path === '/login')
        return '/telegram';
    const match = path.match(/^\/d\/([^/]+)(?:\/(.*))?$/);
    if (match)
        return match[2] && match[2] !== 'my-day' ? `/d/${match[1]}/my-day` : '/';
    return '/';
}
export function safeInset(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(200, value)) : 0; }
