'use client';

import { useEffect } from 'react';

/** Регистрирует service worker (нужен для установки приложения на телефон/компьютер). */
export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* PWA — улучшение, а не необходимость */
    });
  }, []);
  return null;
}
