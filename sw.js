// sw.js
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: 'ديوني', body: 'لديك إشعار جديد' };
  try {
    data = event.data.json();
  } catch(e) {
    if(event.data) data.body = event.data.text();
  }

  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    dir: 'rtl',
    lang: 'ar',
    vibrate: [200, 100, 200],
    tag: 'debt-notif-' + Date.now(),
    renotify: true,
    requireInteraction: false,
    data: { url: data.url || '/' }
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'ديوني', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(self.location.origin)) {
          c.focus();
          if (c.navigate) c.navigate(url);
          return;
        }
      }
      return clients.openWindow(url);
    })
  );
});
