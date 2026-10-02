// استقبال الإشعارات وعرضها
self.addEventListener('push', function(event) {
  if (event.data) {
    let data;
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'إشعار جديد', body: event.data.text() };
    }

    const options = {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [100, 50, 100], // اهتزاز الهاتف
      data: {
        url: data.url || '/'
      }
    };

    event.waitUntil(
      self.registration.showNotification(data.title || 'إشعار جديد', options)
    );
  }
});

// عند الضغط على الإشعار، افتح التطبيق
self.addEventListener('notificationclick', function(event) {
  event.notification.close(); // إغلاق الإشعار
  
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(windowClients => {
      // إذا كان التطبيق مفتوحاً، قم بالتركيز عليه
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url === event.notification.data.url && 'focus' in client) {
          return client.focus();
        }
      }
      // إذا لم يكن مفتوحاً، افتحه
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data.url);
      }
    })
  );
});
