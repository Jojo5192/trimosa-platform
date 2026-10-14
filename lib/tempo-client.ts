/**
 * ⏱ Gefühlte Geschwindigkeit — Messung im Browser (Pascal, Chefsache 7.10.2026, Bereich 11).
 *
 * tempoStarten() wird beim Laden des TeamShell-Moduls aufgerufen (also VOR den ersten Lade-Aufrufen der
 * Panels, deren Effekte vor dem Shell-Effekt laufen) und legt einen dünnen Mantel um
 * window.fetch: Für gleiche-Origin-Aufrufe an /api/* merkt er sich Methode, Routen-Muster (lib/tempo.ts
 * musterAusPfad), Dauer bis zur Antwort (Kopfzeilen da — Streams und große Bodies bleiben unberührt) und
 * Statusklasse. Keine Inhalte, keine Query-Werte, keine Texte. Die Antwort selbst wird NIE angefasst:
 * der Mantel gibt genau das Promise der echten fetch-Funktion zurück und hängt sich nur daneben.
 *
 * Nicht gemessen: Aufrufe bei verstecktem Tab (da wartet niemand), abgebrochene Aufrufe (AbortError —
 * gewollt abgebrochen), Fehler während die Seite verlassen wird, HEAD/OPTIONS und /api/tempo selbst.
 *
 * Senden gebündelt alle 60 s und beim Verstecken/Verlassen der Seite per navigator.sendBeacon
 * (Rückfall: originales fetch mit keepalive). Dazu einmalig die Kennzahl „App-Start" (tempoAppBereit()
 * aus dem Mount-Effekt der TeamShell): Seitenstart (performance.timeOrigin) bis die Shell hydriert ist und
 * der erste Frame steht — ab da reagieren die Knöpfe.
 *
 * Wirft nie; mehrfacher Aufruf (z. B. Fast Refresh) ist wirkungslos.
 */
import {
  APP_START_METHODE, APP_START_MUSTER, MAX_DAUER, MAX_EINTRAEGE, METHODEN, TEMPO_ROUTE,
  musterAusPfad, statusKlasse, type Messung, type Methode, type StatusKlasse,
} from '@/lib/tempo'

const SENDE_TAKT_MS = 60_000
/** Puffer-Obergrenze — ohne Netz/bei Dauer-Polling gehen eher alte Messungen verloren als Speicher */
const PUFFER_MAX = MAX_EINTRAEGE * 3
const GLOBAL = '__trimosaTempo'

interface Zustand {
  puffer: Messung[]
  original: typeof fetch
  /** gesetzt beim Verlassen der Seite (pagehide) — abgebrochene Ladevorgänge zählen dann nicht als Netzfehler */
  verlaesst: boolean
  appStartGemessen: boolean
}
interface Start { m: Methode; r: string; t0: number }

type MitTempo = Window & { [GLOBAL]?: Zustand }

const sichtbar = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'

function urlVon(input: unknown): string | null {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  if (input && typeof input === 'object' && typeof (input as { url?: unknown }).url === 'string') return (input as { url: string }).url
  return null
}

/** Startpunkt einer Messung — null = diesen Aufruf nicht messen */
function erfassen(input: unknown, init: RequestInit | undefined): Start | null {
  if (!sichtbar()) return null
  const roh = urlVon(input)
  if (!roh) return null
  const u = new URL(roh, window.location.href)
  if (u.origin !== window.location.origin) return null
  if (u.pathname === TEMPO_ROUTE || u.pathname.startsWith(TEMPO_ROUTE + '/')) return null
  // Hintergrund-Abgleiche (?peek=1: Polls der offenen App) zählen nicht — dort wartet niemand, sie würden die Liste nur füllen
  if (u.searchParams.get('peek') === '1') return null
  const r = musterAusPfad(u.pathname)
  if (!r) return null
  const methodeRoh = init?.method
    ?? (input && typeof input === 'object' && typeof (input as { method?: unknown }).method === 'string' ? (input as { method: string }).method : 'GET')
  const m = methodeRoh.toUpperCase()
  if (m === APP_START_METHODE || !(METHODEN as readonly string[]).includes(m)) return null
  return { m: m as Methode, r, t0: performance.now() }
}

function ablegen(z: Zustand, m: Methode, r: string, dauer: number, s: StatusKlasse) {
  const d = Math.min(MAX_DAUER, Math.max(0, Math.round(dauer)))
  z.puffer.push({ m, r, d, s })
  if (z.puffer.length > PUFFER_MAX) z.puffer.splice(0, z.puffer.length - PUFFER_MAX)
}

function istAbbruch(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: unknown }).name === 'AbortError'
}

function senden(z: Zustand) {
  try {
    // höchstens drei Pakete je Durchgang (= PUFFER_MAX)
    for (let i = 0; i < 3 && z.puffer.length; i++) {
      const teil = z.puffer.splice(0, MAX_EINTRAEGE)
      const json = JSON.stringify({ e: teil })
      let ok = false
      try {
        // String-Body = text/plain → kein Preflight, in allen Browsern erlaubt; die Route liest JSON aus dem Text
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') ok = navigator.sendBeacon(TEMPO_ROUTE, json)
      } catch { ok = false }
      if (!ok) {
        try {
          void z.original.call(window, TEMPO_ROUTE, {
            method: 'POST', body: json, keepalive: true, credentials: 'same-origin',
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          }).catch(() => {})
        } catch { /* egal — Messwerte sind entbehrlich */ }
      }
    }
  } catch { /* nie werfen */ }
}

/** „App-Start": nur bei echtem Seitenaufruf von /team (nicht nach Wechsel innerhalb der Seite) */
function appStartMessen(z: Zustand) {
  try {
    if (z.appStartGemessen) return
    z.appStartGemessen = true
    const nav = performance.getEntriesByType?.('navigation')?.[0] as PerformanceNavigationTiming | undefined
    if (!nav) return
    const typ: string = nav.type
    if (typ === 'prerender') return
    if (!new URL(nav.name, window.location.href).pathname.startsWith('/team')) return
    requestAnimationFrame(() => {
      setTimeout(() => {
        try {
          const d = performance.now()
          if (d <= MAX_DAUER && sichtbar()) ablegen(z, APP_START_METHODE, APP_START_MUSTER, d, '2xx')
        } catch { /* egal */ }
      }, 0)
    })
  } catch { /* egal */ }
}

export function tempoStarten(): void {
  try {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return
    const w = window as MitTempo
    if (w[GLOBAL]) return
    const original = window.fetch
    const z: Zustand = { puffer: [], original, verlaesst: false, appStartGemessen: false }
    w[GLOBAL] = z

    const gemessen = function (...args: Parameters<typeof fetch>): Promise<Response> {
      let start: Start | null = null
      try { start = erfassen(args[0], args[1]) } catch { start = null }
      const p = original.apply(window, args)
      if (start && p && typeof p.then === 'function') {
        const { m, r, t0 } = start
        p.then(
          (res) => {
            try { ablegen(z, m, r, performance.now() - t0, res.type === 'opaqueredirect' ? '3xx' : statusKlasse(res.status)) } catch { /* egal */ }
          },
          (err) => {
            try {
              if (istAbbruch(err) || z.verlaesst || !sichtbar()) return
              ablegen(z, m, r, performance.now() - t0, 'netz')
            } catch { /* egal */ }
          },
        )
      }
      return p
    }
    window.fetch = gemessen as typeof fetch

    setInterval(() => senden(z), SENDE_TAKT_MS)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') senden(z) })
    // pagehide statt beforeunload — beforeunload-Lauscher kosten in manchen Browsern den Zurück-Cache
    window.addEventListener('pagehide', () => { z.verlaesst = true; senden(z) })
    window.addEventListener('pageshow', () => { z.verlaesst = false })
  } catch { /* Messung darf die App nie stören */ }
}

/** Einmal aus dem Mount-Effekt der TeamShell: misst „App-Start" (weitere Aufrufe sind wirkungslos) */
export function tempoAppBereit(): void {
  try {
    tempoStarten()
    const z = typeof window !== 'undefined' ? (window as MitTempo)[GLOBAL] : undefined
    if (z) appStartMessen(z)
  } catch { /* egal */ }
}
