/* TRIMOSA team app service worker: web push + notification click + offline cache. */

/* §280 Offline (Pascal 8.9., Punkt 6):
 * - API-GETs: NETZ ZUERST. Online kommt immer die Server-Antwort (die
 *   no-store-Regel aus §84 bleibt: fetch(req) übernimmt cache:'no-store' der
 *   Seite), Fehler 4xx/5xx gehen unverändert durch — nie stiller alter Stand.
 *   Nur wenn das Netz ganz fehlt, kommt die letzte gespeicherte Antwort mit
 *   dem Header X-Trimosa-Offline: 1 (sonst 503 mit { offline: true }).
 * - /_next/static + Icons: Cache zuerst (Hash-Namen, unveränderlich).
 * - Navigation /team: Netz zuerst, ohne Netz die zuletzt geladene Seite.
 * - Nutzerwechsel (Message trimosa-user) und Abmelden (trimosa-clear) leeren
 *   API-Cache und /team-Seite; localhost (next dev) cached nie. */
var VERSION = 'v1'
var API_CACHE = 'trimosa-api-' + VERSION
var STATIC_CACHE = 'trimosa-static-' + VERSION
var META_CACHE = 'trimosa-meta-' + VERSION
var API_MAX = 400
var DEV = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1'

/* §265: Ohne skipWaiting/claim blieb ein neuer SW bis zum kompletten
 * PWA-Neustart inaktiv, und frisch gestartete Fenster liefen UNKONTROLLIERT —
 * client.navigate() wirft für unkontrollierte Clients per Spec, weshalb
 * Push-Taps nur fokussierten statt zum Ziel zu springen (Pascals Bug). */
self.addEventListener('install', function () { self.skipWaiting() })
self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    var keep = { }
    keep[API_CACHE] = 1; keep[STATIC_CACHE] = 1; keep[META_CACHE] = 1
    try {
      var names = await caches.keys()
      await Promise.all(names.filter(function (n) { return n.indexOf('trimosa-') === 0 && !keep[n] }).map(function (n) { return caches.delete(n) }))
    } catch (e) { /* egal */ }
    await clients.claim()
  })())
})

/* ── Offline-Cache ── */

function isStaticPath(pathname) {
  return pathname.indexOf('/_next/static/') === 0 || /^\/(icon[^/]*\.png|apple-icon[^/]*|favicon\.ico|manifest[^/]*)$/.test(pathname)
}
function cacheableApi(url) {
  if (url.searchParams.get('probe') === '1') return false
  if (/^\/api\/(auth|push\/subscribe|push\/unsubscribe)/.test(url.pathname)) return false
  return true
}
async function stamp(res) {
  var headers = new Headers(res.headers)
  headers.set('X-Trimosa-Cached-At', String(Date.now()))
  var body = await res.clone().blob()
  return new Response(body, { status: res.status, statusText: res.statusText, headers: headers })
}
async function trimCache(cache, max) {
  try {
    var keys = await cache.keys()
    if (keys.length <= max) return
    await Promise.all(keys.slice(0, keys.length - max).map(function (k) { return cache.delete(k) }))
  } catch (e) { /* egal */ }
}
function offlineResponse(hit) {
  var headers = new Headers(hit.headers)
  headers.set('X-Trimosa-Offline', '1')
  return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers: headers })
}
async function networkFirstApi(req) {
  var cache = await caches.open(API_CACHE)
  try {
    var res = await fetch(req)
    if (res && res.ok) {
      try { await cache.put(req, await stamp(res)); trimCache(cache, API_MAX) } catch (e) { /* Vary:* / Quota */ }
    }
    return res
  } catch (e) {
    var hit = await cache.match(req)
    if (hit) return offlineResponse(hit)
    return new Response(JSON.stringify({ error: 'Offline — dafür liegt noch kein gespeicherter Stand vor.', offline: true }), {
      status: 503, headers: { 'Content-Type': 'application/json', 'X-Trimosa-Offline': '1', 'Cache-Control': 'no-store' },
    })
  }
}
async function cacheFirst(req) {
  var cache = await caches.open(STATIC_CACHE)
  var hit = await cache.match(req)
  if (hit) return hit
  var res = await fetch(req)
  if (res && res.ok) { try { await cache.put(req, res.clone()) } catch (e) { /* egal */ } }
  return res
}
async function navigationFirst(req, url) {
  var cache = await caches.open(STATIC_CACHE)
  try {
    var res = await fetch(req)
    if (res && res.ok && url.pathname === '/team' && !url.search) { try { await cache.put('/team', res.clone()) } catch (e) { /* egal */ } }
    return res
  } catch (e) {
    var hit = await cache.match('/team')
    if (hit) return hit
    throw e
  }
}

self.addEventListener('fetch', function (event) {
  if (DEV) return
  var req = event.request
  if (req.method !== 'GET') return
  var url
  try { url = new URL(req.url) } catch (e) { return }
  if (url.origin !== self.location.origin) return
  if (req.mode === 'navigate') {
    if (url.pathname === '/team' || url.pathname.indexOf('/team/') === 0) event.respondWith(navigationFirst(req, url))
    return
  }
  if (url.pathname.indexOf('/api/') === 0) {
    if (cacheableApi(url)) event.respondWith(networkFirstApi(req))
    return
  }
  if (isStaticPath(url.pathname)) event.respondWith(cacheFirst(req))
})

async function clearUserCaches() {
  try { await caches.delete(API_CACHE) } catch (e) { /* egal */ }
  try { var st = await caches.open(STATIC_CACHE); await st.delete('/team') } catch (e) { /* egal */ }
}

self.addEventListener('message', function (event) {
  var data = event.data || {}
  if (data.type === 'trimosa-user') {
    event.waitUntil((async function () {
      var meta = await caches.open(META_CACHE)
      var prev = await meta.match('/__owner')
      var prevId = prev ? await prev.text() : ''
      var next = String(data.userId || '')
      if (prevId && next && prevId !== next) await clearUserCaches()
      try { await meta.put('/__owner', new Response(next)) } catch (e) { /* egal */ }
    })())
  } else if (data.type === 'trimosa-clear') {
    event.waitUntil((async function () {
      await clearUserCaches()
      try { await caches.delete(META_CACHE) } catch (e) { /* egal */ }
    })())
  }
})

/* ── Push ── */

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
