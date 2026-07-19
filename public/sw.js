/* TRIMOSA team chat service worker: web push + notification click. */
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { title: 'TRIMOSA', body: event.data ? event.data.text() : '' } }
  // App-Icon-Badge als Signal setzen (echte Zahl setzt die App beim Öffnen)
  try { if (navigator.setAppBadge) navigator.setAppBadge() } catch (e) { /* nicht verfügbar */ }
  event.waitUntil(
    self.registration.showNotification(data.title || 'TRIMOSA', {
      body: data.body || '',
      icon: '/icon.png',
      badge: '/icon.png',
      data: { url: data.url || '/team' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/team'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) { client.navigate(url); return client.focus() }
      }
      return clients.openWindow(url)
    })
  )
})
