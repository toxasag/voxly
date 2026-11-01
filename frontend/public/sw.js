// ---------------------------------------------------------------------------
// GETVOXLY Service Worker
// W3C Web Push API & Background Notification Handler (Android, iOS 16.4+, Desktop)
// ---------------------------------------------------------------------------

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Слушатель фоновых Web Push уведомлений
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch (err) {
    payload = {
      title: 'GETVOXLY',
      body: event.data.text() || 'Новое уведомление',
      url: '/dashboard',
    };
  }

  const title = payload.title || 'GETVOXLY';
  const targetUrl = payload.url || payload.data?.url || '/dashboard';

  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/favicon-32.png',
    data: {
      ...payload.data,
      url: targetUrl,
    },
    tag: payload.data?.type ? `${payload.data.type}-${payload.data.id || Date.now()}` : 'getvoxly-notification',
    renotify: true,
    vibrate: [100, 50, 100],
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Слушатель клика по уведомлению: фокусирует существующую вкладку или открывает нужный экран
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Ищем уже открытую вкладку нашего домена
      for (const client of clientList) {
        if ('focus' in client && client.url.includes(self.location.origin)) {
          client.focus();
          if ('navigate' in client) {
            return client.navigate(targetUrl);
          }
          return;
        }
      }
      // Если открытых вкладок нет, открываем новое окно
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
