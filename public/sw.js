/* TRIMOSA team chat service worker: web push + notification click. */

/* §265: Ohne skipWaiting/claim blieb ein neuer SW bis zum kompletten
 * PWA-Neustart inaktiv, und frisch gestartete Fenster liefen UNKONTROLLIERT —
 * client.navigate() wirft für unkontrollierte Clients per Spec, weshalb
 * Push-Taps nur fokussierten statt zum Ziel zu springen (Pascals Bug). */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()))

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
      // tag: Mitteilungen desselben Threads stapeln sich und lassen sich beim
      // Lesen in der App gezielt schließen (§122); renotify hält den Ton an
      tag: data.tag || data.url || 'trimosa',
      renotify: true,
      data: { url: data.url || '/team' },
    })
  )
})

/* §265: postMessage mit ACK — die Team-App bestätigt über den mitgeschickten
 * MessagePort. Bleibt das ACK aus (ALTES Seiten-Bundle ohne Listener,
 * gecrashte Seite), fällt der Aufrufer auf navigate()/openWindow zurück,
 * statt dass der Tap still verpufft. */
function openViaMessage(client, url, timeoutMs) {
  return new Promise((resolve) => {
    let done = false
    const finish = (ok) => { if (!done) { done = true; resolve(ok) } }
    try {
      const ch = new MessageChannel()
      ch.port1.onmessage = () => finish(true)
      setTimeout(() => finish(false), timeoutMs)
      client.postMessage({ type: 'trimosa-push-open', url }, [ch.port2])
    } catch (e) { finish(false) }
  })
}

function pathOf(client) {
  try { return new URL(client.url).pathname } catch (e) { return '' }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/team'
  event.waitUntil((async () => {
    const list = await clients.matchAll({ type: 'window', includeUncontrolled: true })
    let targetPath = '/team'
    try { targetPath = new URL(url, self.location.origin).pathname } catch (e) { /* relative */ }
    const teamTarget = targetPath.indexOf('/team') === 0
    // Bevorzugt ein Fenster, das schon am Ziel-Pfad steht; nur die Team-App
    // hat den Message-Listener — andere Pfade brauchen navigate().
    const inApp = list.find((c) => pathOf(c).indexOf(targetPath) === 0)
    const any = list.find((c) => 'focus' in c)

    if (inApp) {
      try { await inApp.focus() } catch (e) { /* egal */ }
      // Team-Ziel: die laufende App springt per Message OHNE Reload zum Ziel.
      // Kein ACK (altes Bundle/kein Listener) → navigate()-Reload als Netz.
      if (teamTarget && await openViaMessage(inApp, url, 600)) return
      try {
        const nav = await inApp.navigate(url)
        if (nav) return
      } catch (e) { /* uncontrolled/iOS → Fallbacks */ }
    }
    if (any && any !== inApp) {
      try { await any.focus() } catch (e) { /* egal */ }
      // navigate() awaiten und Fehlschläge auffangen: bei unkontrollierten
      // Clients wirft es, vorher lief danach still nur focus() — der Nutzer
      // landete irgendwo in der App und musste von Hand suchen.
      try {
        const nav = await any.navigate(url)
        if (nav) return
      } catch (e) { /* uncontrolled/iOS → Fallbacks */ }
      // Message hilft nur, wenn dort die Team-App lauscht (ACK beweist es)
      if (teamTarget && pathOf(any).indexOf('/team') === 0 && await openViaMessage(any, url, 600)) return
    }
    try { await clients.openWindow(url) } catch (e) { /* letzter Ausweg erschöpft */ }
  })())
})
