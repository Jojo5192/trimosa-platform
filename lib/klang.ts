'use client'

import { useSyncExternalStore } from 'react'

/**
 * 🔔 Klangbild + Haptik-Muster der Team-App (Pascal, Chefsache 7.10.2026, Gestaltung 1 + 2).
 *
 * Töne werden per WebAudio SYNTHETISIERT (keine Audiodateien) und teilen sich eine Klangfarbe
 * (Sinus + leiser Oktav-Oberton) und eine Hüllkurve (8 ms Anschlag, weiches Ausklingen) — alle
 * stehen in derselben Tonart (A-Dur-Umfeld), damit sie wie EIN zusammengehöriges Klangbild wirken:
 *   gesendet = weicher kurzer Aufwärts-Gleitton · erledigt = kleiner Zweiklang · fehler = tiefer Doppelton.
 * Je ≤ 250 ms, leise (Spitzenpegel ~0,05–0,08).
 *
 * Gerät & Rücksicht:
 *  - EIN AudioContext, erst nach der ersten Nutzer-Geste angelegt (navigator.userActivation).
 *  - navigator.audioSession.type = 'ambient' (Safari 16.4+): folgt dem Stumm-Schalter und unterbricht
 *    keine laufende Musik.
 *  - Schalter „Töne" (Standard AN) je Gerät in localStorage, bei JEDEM Abspielen frisch gelesen.
 *  - prefers-reduced-motion betrifft Bewegung, nicht Ton — bewusst NICHT gekoppelt.
 *
 * Die Haptik-Muster stehen hier neben den Tönen, damit beide abgestimmt bleiben (Pulse setzen dort ein,
 * wo die Töne einsetzen); ausgelöst werden sie in components/team/ux.tsx (haptic / rueckmeldung).
 * Reine Logik (Plan, Muster, Schalter-Lesen) ist exportiert und ohne Browser prüfbar.
 */

export type TonArt = 'gesendet' | 'erledigt' | 'fehler'
/** tap = normale Aktion (nur Haptik, kein Ton) */
export type RueckmeldungArt = TonArt | 'tap'

/** Ein Ton: Einsatz und Dauer in Sekunden, Frequenz in Hz (freqEnde = Gleitton), gain = Spitzenpegel des Grundtons */
export type Note = { start: number; dauer: number; freq: number; freqEnde?: number; gain: number }

// Tonvorrat (gleichschwebend, A4 = 440 Hz)
const E4 = 329.63
const G4 = 392
const E5 = 659.25
const A5 = 880

export const TON_PLAN: Record<TonArt, readonly Note[]> = {
  // weicher kurzer Aufwärts-Ton: E5 gleitet eine Quarte hinauf zur A5
  gesendet: [{ start: 0, dauer: 0.16, freq: E5, freqEnde: A5, gain: 0.05 }],
  // kleiner Zweiklang: dieselbe Quarte E5 → A5, als zwei getrennte Töne
  erledigt: [
    { start: 0, dauer: 0.13, freq: E5, gain: 0.055 },
    { start: 0.09, dauer: 0.16, freq: A5, gain: 0.055 },
  ],
  // tiefer, weicher Doppelton: G4 → E4 (kleine Terz abwärts), eine Oktave unter dem Rest
  fehler: [
    { start: 0, dauer: 0.11, freq: G4, gain: 0.065 },
    { start: 0.13, dauer: 0.12, freq: E4, gain: 0.065 },
  ],
}

/** Klangfarbe: [Frequenz-Vielfaches, Anteil] — Grundton + leiser Oktav-Oberton (warm, nicht piepsig) */
export const KLANGFARBE: readonly (readonly [number, number])[] = [[1, 1], [2, 0.16]]
/** Hüllkurve: linearer Anschlag, dann exponentielles Ausklingen bis zum Notenende */
export const ANSCHLAG = 0.008

/** Gesamtlänge eines Tons in Sekunden */
export function tonDauer(art: TonArt): number {
  return Math.max(...TON_PLAN[art].map((n) => n.start + n.dauer))
}
/** Höchster Spitzenpegel (Grundton + Oberton) eines Tons */
export function tonSpitze(art: TonArt): number {
  const summe = KLANGFARBE.reduce((s, [, anteil]) => s + anteil, 0)
  return Math.max(...TON_PLAN[art].map((n) => n.gain * summe))
}

/* ─────────────── Haptik-Muster (abgestimmt auf die Töne) ─────────────── */

/** vibrate = Muster für navigator.vibrate (an, aus, an … in ms) · ios = Versatz der System-Ticks in ms
 *  (iOS kennt nur EIN Tick — die Anzahl und der Abstand machen den Unterschied). */
export type HaptikMuster = { vibrate: number | readonly number[]; ios: readonly number[] }

export const HAPTIK: Record<RueckmeldungArt, HaptikMuster> = {
  // leicht – normale Aktion (Knopf, Umschalter)
  tap: { vibrate: 10, ios: [0] },
  // ein etwas festerer Puls – wie der eine Gleitton
  gesendet: { vibrate: 16, ios: [0] },
  // deutlicher – zwei Pulse genau auf den zwei Tönen (0 / 90 ms)
  erledigt: { vibrate: [14, 76, 22], ios: [0, 90] },
  // anders – zwei lange, schwere Pulse auf dem Doppelton (0 / 130 ms); iOS: drei dichte Ticks
  fehler: { vibrate: [40, 90, 40], ios: [0, 65, 130] },
}

/** Alte haptic()-Arten auf das Klangbild abbilden: success → erledigt, error → fehler */
export function haptikArt(kind: RueckmeldungArt | 'success' | 'error'): RueckmeldungArt {
  return kind === 'success' ? 'erledigt' : kind === 'error' ? 'fehler' : kind
}

/** Einsatzzeitpunkte (ms) der Pulse eines vibrate-Musters — fürs Abgleichen mit den Tönen */
export function pulsEinsaetze(muster: number | readonly number[]): number[] {
  const liste = typeof muster === 'number' ? [muster] : muster
  const out: number[] = []
  let t = 0
  liste.forEach((ms, i) => { if (i % 2 === 0) out.push(t); t += ms })
  return out
}

/* ─────────────── Schalter „Töne" (je Gerät) ─────────────── */

export const TOENE_KEY = 'trimosa-toene'
const TOENE_EVENT = 'trimosa-toene'

function speicher(): Pick<Storage, 'getItem'> | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}
/** Standard AN — aus nur, wenn ausdrücklich '0' gespeichert ist; kein/gesperrter Speicher = an */
export function toeneAn(s: Pick<Storage, 'getItem'> | null = speicher()): boolean {
  try { return s?.getItem(TOENE_KEY) !== '0' } catch { return true }
}
export function setToeneAn(an: boolean) {
  try { localStorage.setItem(TOENE_KEY, an ? '1' : '0') } catch { /* Speicher gesperrt – gilt dann nur bis zum Neuladen nicht */ }
  try { window.dispatchEvent(new Event(TOENE_EVENT)) } catch { /* SSR */ }
}
function abonnieren(cb: () => void) {
  window.addEventListener(TOENE_EVENT, cb)
  window.addEventListener('storage', cb)
  return () => { window.removeEventListener(TOENE_EVENT, cb); window.removeEventListener('storage', cb) }
}
/** Schalterstand (reaktiv) — Server/Hydration: an */
export function useToeneAn(): boolean {
  return useSyncExternalStore(abonnieren, () => toeneAn(), () => true)
}

/* ─────────────── WebAudio ─────────────── */

type Nav = Navigator & {
  userActivation?: { hasBeenActive: boolean }
  audioSession?: { type: string }
}
type Fenster = Window & { webkitAudioContext?: typeof AudioContext }

let ctx: AudioContext | null = null
let ruheTimer: ReturnType<typeof setTimeout> | null = null
let entsperrtAb = false
/** nach so vielen ms ohne Geste/Ton schläft der Kontext (Akku); die nächste Geste weckt ihn */
const RUHE_MS = 12000

function warGeste(): boolean {
  const ua = (navigator as Nav).userActivation
  return ua ? ua.hasBeenActive : true
}

/** Den einen AudioContext holen — angelegt erst nach der ersten Nutzer-Geste. */
function kontext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (ctx && ctx.state === 'closed') ctx = null
  if (!ctx) {
    if (!warGeste()) return null
    const AC = window.AudioContext ?? (window as Fenster).webkitAudioContext
    if (!AC) return null
    // Safari: „ambient" folgt dem Stumm-Schalter und mischt sich unter Musik, statt sie anzuhalten
    try { const s = (navigator as Nav).audioSession; if (s && s.type !== 'ambient') s.type = 'ambient' } catch { /* ältere Browser */ }
    try { ctx = new AC({ latencyHint: 'interactive' }) } catch { return null }
  }
  return ctx
}

function ruheSpaeter() {
  if (ruheTimer) clearTimeout(ruheTimer)
  ruheTimer = setTimeout(() => {
    ruheTimer = null
    if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {})
  }, RUHE_MS)
}

/** Innerhalb einer Geste: Kontext anlegen bzw. wecken. Safari/iOS lassen resume() nur dort zu —
 *  der Ton selbst kommt oft erst nach der Server-Antwort, also außerhalb der Geste. */
function entsperren() {
  if (!toeneAn()) return
  const c = kontext()
  if (!c) return
  if (c.state !== 'running') c.resume().catch(() => {})
  ruheSpaeter()
}

/** Gesten-Lauscher einmalig anhängen (nur Team-App bzw. sobald ein Ton gewünscht wird —
 *  Gäste-Seiten, die ux.tsx mitladen, legen so keinen AudioContext an). */
function lauscherAnhaengen() {
  if (entsperrtAb || typeof window === 'undefined') return
  entsperrtAb = true
  for (const typ of ['pointerup', 'touchend', 'click', 'keydown'] as const) {
    window.addEventListener(typ, entsperren, { capture: true, passive: true })
  }
}
if (typeof window !== 'undefined' && location.pathname.startsWith('/team')) lauscherAnhaengen()

function stimme(c: AudioContext, t0: number, n: Note) {
  const a = t0 + n.start
  const e = a + n.dauer
  const huelle = c.createGain()
  huelle.gain.setValueAtTime(0.0001, a)
  huelle.gain.linearRampToValueAtTime(n.gain, a + ANSCHLAG)
  huelle.gain.exponentialRampToValueAtTime(0.0001, e)
  huelle.connect(c.destination)
  KLANGFARBE.forEach(([mult, anteil], i) => {
    const osc = c.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(n.freq * mult, a)
    if (n.freqEnde) osc.frequency.exponentialRampToValueAtTime(n.freqEnde * mult, a + n.dauer * 0.6)
    const pegel = c.createGain()
    pegel.gain.value = anteil
    osc.connect(pegel)
    pegel.connect(huelle)
    osc.start(a)
    osc.stop(e + 0.01)
    osc.onended = () => {
      try { osc.disconnect(); pegel.disconnect(); if (i === 0) huelle.disconnect() } catch { /* schon getrennt */ }
    }
  })
}

/** Spielt einen Ton des Klangbilds — still, wenn „Töne" aus ist, vor der ersten Geste oder ohne WebAudio.
 *  Ein Ton, der nicht SOFORT spielen kann (Kontext schläft und lässt sich nicht wecken), entfällt —
 *  er soll nie verspätet bei der nächsten Berührung nachklingen. */
export function spieleTon(art: TonArt): void {
  if (typeof window === 'undefined' || !toeneAn()) return
  lauscherAnhaengen()
  const c = kontext()
  if (!c) return
  const spielen = () => {
    try {
      const t0 = c.currentTime + 0.01
      for (const n of TON_PLAN[art]) stimme(c, t0, n)
    } catch { /* Ton ist nice-to-have */ }
    ruheSpaeter()
  }
  if (c.state === 'running') { spielen(); return }
  const angefragt = Date.now()
  c.resume()
    .then(() => { if (c.state === 'running' && Date.now() - angefragt < 300) spielen() })
    .catch(() => { /* ohne Geste nicht erlaubt – dann eben still */ })
}
