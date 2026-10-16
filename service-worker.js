self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = String(payload.title || 'CRAZII');
  const options = {
    body: String(payload.body || 'Bạn có cập nhật tín hiệu giao dịch.'),
    icon: '/app-icon.png',
    badge: '/app-icon.png',
    tag: String(payload.tag || 'crazii-notification'),
    renotify: true,
    data: { url: String(payload.url || '/') },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(destination);
        return;
      }
    }
    await clients.openWindow(destination);
  })());
});