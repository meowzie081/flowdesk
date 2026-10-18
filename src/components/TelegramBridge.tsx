'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Script from 'next/script';
import { TELEGRAM_CLIENT_KEY, telegramBackTarget, safeInset } from '@/lib/native-client';
type Insets = {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
};
export type TelegramApp = {
    platform?: string;
    colorScheme?: 'light' | 'dark';
    viewportStableHeight?: number;
    safeAreaInset?: Insets;
    contentSafeAreaInset?: Insets;
    ready: () => void;
    expand: () => void;
    onEvent: (name: string, fn: () => void) => void;
    offEvent: (name: string, fn: () => void) => void;
    BackButton?: {
        show: () => void;
        hide: () => void;
        onClick: (fn: () => void) => void;
        offClick: (fn: () => void) => void;
    };
};
declare global {
    interface Window {
        Telegram?: {
            WebApp?: TelegramApp;
        };
    }
}
export default function TelegramBridge() {
    const path = usePathname(), router = useRouter();
    const [enabled, setEnabled] = useState(false);
    const [loaded, setLoaded] = useState(false);
    useEffect(() => { let active = path === '/telegram'; try {
        if (active)
            sessionStorage.setItem(TELEGRAM_CLIENT_KEY, '1');
        else
            active = sessionStorage.getItem(TELEGRAM_CLIENT_KEY) === '1';
    }
    catch { } setEnabled(active); if (active)
        document.documentElement.dataset.client = 'telegram'; }, [path]);
    useEffect(() => {
        const app = window.Telegram?.WebApp;
        if (!enabled || !loaded || !app || app.platform === 'unknown')
            return;
        function refresh() {
            const sdk = window.Telegram?.WebApp;
            if (!sdk)
                return;
            const root = document.documentElement;
            for (const side of ['top', 'right', 'bottom', 'left'] as const)
                root.style.setProperty(`--flowdesk-tg-${side}`, `${safeInset(sdk.safeAreaInset?.[side]) + safeInset(sdk.contentSafeAreaInset?.[side])}px`);
            if (sdk.viewportStableHeight && Number.isFinite(sdk.viewportStableHeight))
                root.style.setProperty('--flowdesk-tg-height', `${Math.max(200, sdk.viewportStableHeight)}px`);
            let userTheme: string | null = null;
            try {
                userTheme = localStorage.getItem('theme');
            }
            catch { }
            if (userTheme !== 'dark' && userTheme !== 'light') {
                root.classList.toggle('dark', sdk.colorScheme === 'dark');
                window.dispatchEvent(new Event('flowdesk:theme-changed'));
            }
        }
        app.ready();
        app.expand();
        refresh();
        const events = ['themeChanged', 'viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged'];
        events.forEach(e => app.onEvent(e, refresh));
        const target = telegramBackTarget(path);
        const back = () => { if (document.querySelector('[role="dialog"]')) {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            return;
        } if (target)
            router.push(target); };
        if (target) {
            app.BackButton?.show();
            app.BackButton?.onClick(back);
        }
        else
            app.BackButton?.hide();
        return () => { events.forEach(e => app.offEvent(e, refresh)); app.BackButton?.offClick(back); };
    }, [enabled, loaded, path, router]);
    return enabled ? <Script id="telegram-web-app" src="https://telegram.org/js/telegram-web-app.js?64" strategy="afterInteractive" onLoad={() => setLoaded(true)} onReady={() => setLoaded(true)}/> : null;
}
