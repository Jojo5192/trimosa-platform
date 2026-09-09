'use client'

import { useSyncExternalStore } from 'react'

/**
 * 📴 Offline-Helfer der Team-App (Pascal-Prompt 8.9., Punkt 6 — Baustein ⑥).
 *
 * - useOnline(): Netzzustand (navigator.onLine + online/offline-Events).
 * - shouldPoll(key): Polling pausiert offline und läuft nach 10 Minuten ohne
 *   Bedienung nur noch bei jedem dritten Tick (noteInteraction() setzt zurück).
 * - Outbox: ohne Netz gesendete Nachrichten warten in localStorage
 *   (`trimosa-outbox-v1`), stehen halbtransparent im Thread und gehen per
 *   flushOutbox() automatisch raus, sobald Netz da ist (online-Event, Shell).
 * - clearOfflineData(): Abmelden/Nutzerwechsel löscht Snapshots, Warteschlange
 *   und den Service-Worker-Cache (alle `trimosa-*`-Schlüssel und -Caches).
 * - ensureOwner(userId): erkennt einen Nutzerwechsel auf demselben Gerät und
 *   räumt vorher auf; meldet den Nutzer dem Service Worker (Cache je Nutzer).
 *
 * Der API-Cache liegt im Service Worker (public/sw.js): Netz zuerst, ohne Netz
 * die letzte Antwort (Header `X-Trimosa-Offline: 1`). Die no-store-Regel aus
 * §84 bleibt: online kommt IMMER die Server-Antwort, Fehler (4xx/5xx) gehen
 * durch — nie stiller alter Stand.
 */

export const OUTBOX_KEY = 'trimosa-outbox-v1'
/** Warteschlange hat sich geändert (window-Event, ohne detail). */
export const OUTBOX_EVENT = 'trimosa-outbox'
/** Eine wartende Nachricht ist raus (window-CustomEvent, detail { kind, targetId }). */
export const OUTBOX_SENT_EVENT = 'trimosa-outbox-sent'
const OWNER_KEY = 'trimosa-owner'
export const IDLE_MS = 10 * 60_000

export type OutboxItem = {
  id: string
  /** guest = Gäste-Chat (ChatPanel), intern = Gruppen-Chat (InternPanel) */
  kind: 'guest' | 'intern'
  /** Conversation-/Chat-ID, in deren Thread die Nachricht wartet */
  targetId: string
  /** POST-Ziel + JSON-Body — genau das, was der Panel-Versand geschickt hätte */
  url: string
  body: Record<string, unknown>
  /** Anzeige-Text im Thread */
  text: string
  createdAt: number
}

/* ── Netzzustand ── */

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false
}
/** fetch() wirft bei Netzfehlern einen TypeError (kein HTTP-Status). */
export function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError
}
function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb) }
}
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, isOnline, () => true)
}

/* ── Polling-Bremse ── */

let lastInteraction = typeof window === 'undefined' ? 0 : Date.now()
const ticks: Record<string, number> = {}
export function noteInteraction() { lastInteraction = Date.now() }
/** true = jetzt abgleichen. Offline nie; nach 10 Min ohne Bedienung nur jeder dritte Tick. */
export function shouldPoll(key: string): boolean {
  if (!isOnline()) return false
  if (Date.now() - lastInteraction < IDLE_MS) return true
  ticks[key] = (ticks[key] ?? 0) + 1
  return ticks[key] % 3 === 0
}

/* ── Warteschlange ── */

function parseOutbox(raw: string | null): OutboxItem[] {
  try {
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? (arr as OutboxItem[]).filter((i) => i && typeof i.id === 'string' && typeof i.url === 'string') : []
  } catch { return [] }
}
function readOutbox(): OutboxItem[] {
  try { return parseOutbox(localStorage.getItem(OUTBOX_KEY)) } catch { return [] }
}
function writeOutbox(items: OutboxItem[]) {
  try {
    if (items.length) localStorage.setItem(OUTBOX_KEY, JSON.stringify(items))
    else localStorage.removeItem(OUTBOX_KEY)
  } catch { /* quota */ }
  try { window.dispatchEvent(new Event(OUTBOX_EVENT)) } catch { /* SSR */ }
}

// Stabiler Snapshot für useSyncExternalStore: dieselbe Array-Instanz, solange
// sich der gespeicherte Text nicht ändert
let snapRaw: string | null = null
let snapItems: OutboxItem[] = []
const EMPTY: OutboxItem[] = []
export function outboxSnapshot(): OutboxItem[] {
  let raw: string | null = null
  try { raw = localStorage.getItem(OUTBOX_KEY) } catch { raw = null }
  if (raw !== snapRaw) { snapRaw = raw; snapItems = parseOutbox(raw) }
  return snapItems
}
function subscribeOutbox(cb: () => void) {
  window.addEventListener(OUTBOX_EVENT, cb)
  window.addEventListener('storage', cb)
  return () => { window.removeEventListener(OUTBOX_EVENT, cb); window.removeEventListener('storage', cb) }
}
/** Alle wartenden Nachrichten (reaktiv). */
export function useOutbox(): OutboxItem[] {
  return useSyncExternalStore(subscribeOutbox, outboxSnapshot, () => EMPTY)
}
export function useOutboxCount(): number {
  return useOutbox().length
}

export function enqueueOutbox(item: Omit<OutboxItem, 'id' | 'createdAt'>): OutboxItem {
  const full: OutboxItem = {
    ...item,
    id: 'ob-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    createdAt: Date.now(),
  }
  writeOutbox([...readOutbox(), full])
  if (isOnline()) void flushOutbox()
  return full
}
export function removeOutbox(id: string) {
  writeOutbox(readOutbox().filter((i) => i.id !== id))
}

let flushing = false
/** Warteschlange der Reihe nach senden. Netzfehler/5xx/401 → Rest bleibt;
 *  andere 4xx → Nachricht verwerfen + Hinweis (Toast der Shell). */
export async function flushOutbox(): Promise<void> {
  if (flushing || !isOnline()) return
  const items = readOutbox()
  if (!items.length) return
  flushing = true
  try {
    for (const it of items) {
      try {
        const r = await fetch(it.url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
          body: JSON.stringify(it.body),
        })
        if (r.ok) {
          removeOutbox(it.id)
          window.dispatchEvent(new CustomEvent(OUTBOX_SENT_EVENT, { detail: { kind: it.kind, targetId: it.targetId } }))
        } else if (r.status === 401 || r.status === 403 || r.status >= 500) {
          break // Sitzung weg oder Server hustet: später erneut
        } else {
          removeOutbox(it.id)
          const d = await r.json().catch(() => null) as { error?: string } | null
          window.dispatchEvent(new CustomEvent('trimosa-toast', { detail: { text: `⚠️ Wartende Nachricht nicht gesendet: ${d?.error ?? `HTTP ${r.status}`}` } }))
        }
      } catch {
        break // Netz wieder weg → Rest bleibt in der Schlange
      }
    }
  } finally {
    flushing = false
  }
}

/* ── Aufräumen ── */

/** Abmelden/Nutzerwechsel: Snapshots, Warteschlange, Einstellungen (`trimosa-*`)
 *  und Service-Worker-Caches löschen. */
export async function clearOfflineData(): Promise<void> {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('trimosa-')).forEach((k) => localStorage.removeItem(k))
  } catch { /* egal */ }
  try { window.dispatchEvent(new Event(OUTBOX_EVENT)) } catch { /* SSR */ }
  try { navigator.serviceWorker?.controller?.postMessage({ type: 'trimosa-clear' }) } catch { /* egal */ }
  try {
    if (typeof caches !== 'undefined') {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n.startsWith('trimosa-')).map((n) => caches.delete(n)))
    }
  } catch { /* egal */ }
}

/** Beim Start der Team-App: anderer Nutzer als zuletzt → vorher aufräumen;
 *  Nutzer dem Service Worker melden (der leert seinen API-Cache bei Wechsel). */
export function ensureOwner(userId: string) {
  try {
    const prev = localStorage.getItem(OWNER_KEY)
    if (prev && prev !== userId) void clearOfflineData()
    localStorage.setItem(OWNER_KEY, userId)
  } catch { /* egal */ }
  try {
    navigator.serviceWorker?.ready
      .then((reg) => reg.active?.postMessage({ type: 'trimosa-user', userId }))
      .catch(() => {})
  } catch { /* egal */ }
}
