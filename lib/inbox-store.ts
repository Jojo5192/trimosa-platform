'use client'

import { useSyncExternalStore } from 'react'

/**
 * 📬 Gemeinsamer Stand der Gäste-Threads der Team-App (Pascal 12.9.2026).
 *
 * EINE Quelle statt drei Kopien: Das dauerhaft gemountete ChatPanel (variant
 * „app") veröffentlicht seine Thread-Liste hier; die Shell (Inbox-Badge +
 * Segment „Gäste · n") und der Heute-Reiter („Warten auf Antwort" + Heute-
 * Zähler → App-Icon-Badge) lesen daraus. Damit liefern Badge, Segment, Chip
 * „Offen · n" und Heute per Konstruktion dieselbe Offen-Zahl — und ✓/📞 oder
 * eine Antwort wirken sofort auf alle Zähler.
 *
 * Nur Arbeitsspeicher (kein eigener Snapshot): beim Kaltstart füllt das
 * ChatPanel den Stand aus seinem Gerätespeicher `trimosa-inbox-v1`.
 * Dienstleister haben kein ChatPanel → der Stand bleibt leer (Zähler 0).
 */

export type InboxThreadLite = {
  id: string; guestName: string; listingTitle: string | null; bookingId: string | null
  platform: string; lastMessageAt: string | null; lastSender: 'guest' | 'host' | null
  lastPreview: string | null; noReplyNeeded: boolean; phoneResolved: boolean; unread: number
}

/** Offen = letzte Nachricht vom Gast, weder ✓ („keine Antwort nötig") noch 📞
 *  („telefonisch geklärt") markiert — die EINE Definition für Chip, Badge, Heute, Offen-Stapel */
export function isOffenThread(t: { lastSender?: 'guest' | 'host' | null; noReplyNeeded?: boolean | null; phoneResolved?: boolean | null }): boolean {
  return t.lastSender === 'guest' && !t.noReplyNeeded && !t.phoneResolved
}

/** window-Event: bittet das ChatPanel um einen frischen Listen-Abgleich
 *  (detail.hard = nach einer Änderung: ungebremst, kurz gebündelt) */
export const INBOX_RELOAD_EVENT = 'trimosa-inbox-reload'
/** Listen-Abgleich anstoßen. hard = es wurde gerade etwas geändert (Antwort/✓/📞
 *  außerhalb des ChatPanels) — sonst weich (höchstens alle 5 s). */
export function requestInboxReload(hard = false) {
  try { window.dispatchEvent(new CustomEvent(INBOX_RELOAD_EVENT, { detail: { hard } })) } catch { /* SSR */ }
}

const EMPTY: InboxThreadLite[] = []
let threads: InboxThreadLite[] = EMPTY
let ready = false
let openCount = 0
const subs = new Set<() => void>()
const subscribe = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb) } }

/** Nur das ChatPanel der Team-App ruft das auf (bei jeder Änderung seiner Liste). */
export function publishInboxThreads(next: InboxThreadLite[]) {
  threads = next
  ready = true
  openCount = next.filter(isOffenThread).length
  subs.forEach((f) => f())
}

/** Alle Gäste-Threads des letzten Stands (reaktiv; leer, solange nichts vorliegt). */
export function useInboxThreads(): InboxThreadLite[] {
  return useSyncExternalStore(subscribe, () => threads, () => EMPTY)
}
/** true, sobald ein Stand vorliegt (Gerätespeicher oder Server) — vorher ist „0" nur „noch unbekannt". */
export function useInboxReady(): boolean {
  return useSyncExternalStore(subscribe, () => ready, () => false)
}
/** Anzahl OFFENER Gäste-Threads (Primitive → Verwender rendern nur bei geänderter Zahl neu). */
export function useInboxOpenCount(): number {
  return useSyncExternalStore(subscribe, () => openCount, () => 0)
}
