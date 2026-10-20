// Минимальный service worker: статика кэшируется, данные и авторизация — всегда из сети.
const CACHE = 'flowdesk-static-v1';
const OFFLINE = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, '/icons/icon-192.png'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase и ИИ не трогаем

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
  }
});

// Every received push displays a generic notification; work content stays in the app.
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch {}
  event.waitUntil(self.registration.showNotification('FlowDesk', {
    body: 'Новое уведомление. Откройте приложение.',
    icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    tag: typeof payload.tag === 'string' ? payload.tag.slice(0, 100) : 'flowdesk',
    data: {url: '/'},
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) return client.focus();
    }
    return self.clients.openWindow('/');
  })());
});
