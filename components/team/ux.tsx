'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { pickSpruch } from '@/lib/start-curtain'

/**
 * 📱 §209 iOS-Feeling-Paket (Pascal): geteilte UX-Bausteine der Team-App —
 * Haptik, Pull-to-Refresh und Skeleton-Ladezustände.
 */

/** 📳 Haptik: Android über navigator.vibrate; iOS 17.4+ über den
 *  <input type="checkbox" switch>-Trick — ein programmatischer Klick auf das
 *  Label löst das System-Tick aus (funktioniert nur innerhalb einer
 *  User-Geste, also aus onClick/onTouch-Handlern heraus — genau da rufen
 *  wir auf). Ohne Support passiert einfach nichts. */
let hapticEl: HTMLLabelElement | null = null
/** §282.12 Muster: tap = leicht · success = doppelter Puls · error = langer Puls */
export type HapticKind = 'tap' | 'success' | 'error'
const VIBRATE: Record<HapticKind, number | number[]> = { tap: 10, success: [12, 60, 12], error: 45 }
export function haptic(kind: HapticKind = 'tap') {
  try {
    const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean }
    if (typeof nav.vibrate === 'function' && nav.vibrate(VIBRATE[kind])) return
    if (!hapticEl || !document.body.contains(hapticEl)) {
      hapticEl = document.createElement('label')
      hapticEl.style.cssText = 'position:fixed;top:-100px;left:-100px;width:1px;height:1px;overflow:hidden;'
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.setAttribute('switch', '')
      hapticEl.appendChild(input)
      document.body.appendChild(hapticEl)
    }
    hapticEl.click()
    // iOS kennt nur das eine System-Tick: Erfolg = zwei Ticks, Fehler = drei
    if (kind !== 'tap') {
      const el = hapticEl
      setTimeout(() => el.click(), 70)
      if (kind === 'error') setTimeout(() => el.click(), 140)
    }
  } catch { /* Haptik ist nice-to-have */ }
}

/** ⬇️ Pull-to-Refresh für Touch-Scroller: Hook an den Scroller-Ref hängen,
 *  {pull, busy} an <PullHint> geben (über der Liste rendern). Zieht nur,
 *  wenn der Scroller ganz oben steht; Auslösung ab ~56px mit Haptik. */
export function usePullToRefresh(ref: RefObject<HTMLElement | null>, onRefresh: () => Promise<unknown>) {
  const [pull, setPull] = useState(0)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let startY = 0
    let active = false
    let dist = 0
    const start = (e: TouchEvent) => {
      if (busyRef.current || el.scrollTop > 0) { active = false; return }
      startY = e.touches[0].clientY
      active = true
      dist = 0
    }
    const move = (e: TouchEvent) => {
      if (!active || busyRef.current) return
      dist = e.touches[0].clientY - startY
      if (dist > 0 && el.scrollTop <= 0) setPull(Math.min(84, dist * 0.45))
      else { setPull(0); if (el.scrollTop > 0) active = false }
    }
    const end = async () => {
      if (!active) return
      active = false
      if (dist * 0.45 >= 56) {
        busyRef.current = true
        setBusy(true)
        setPull(48)
        haptic()
        try { await onRefresh() } catch { /* Panels zeigen eigene Fehler */ }
        busyRef.current = false
        setBusy(false)
      }
      setPull(0)
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: true })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
    }
  }, [ref, onRefresh])
  return { pull, busy }
}

/** Indikator-Zeile zum Pull-to-Refresh-Hook — §282.5: der Ring aus der Marke
 *  zieht sich beim Herunterziehen zu (Bogen wächst mit) und dreht sich beim Laden. */
export function PullHint({ pull, busy }: { pull: number; busy: boolean }) {
  if (pull <= 0 && !busy) return null
  const R = 9, C = 2 * Math.PI * R
  const progress = busy ? 0.28 : Math.min(1, pull / 56)
  return (
    <div style={{
      height: busy ? 48 : pull, display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', transition: busy ? 'none' : 'height .18s', flexShrink: 0,
    }}>
      <svg width="26" height="26" viewBox="0 0 26 26" className={busy ? 'tm-ring-spin' : undefined} style={{ opacity: busy ? 1 : 0.4 + 0.6 * progress }} aria-hidden="true">
        <circle cx="13" cy="13" r={R} fill="none" stroke="var(--tm-accent-soft, rgba(174,141,45,0.2))" strokeWidth="2" />
        <circle cx="13" cy="13" r={R} fill="none" stroke="var(--tm-accent, #AE8D2D)" strokeWidth="2" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - progress)} transform="rotate(-90 13 13)" />
        <circle cx="13" cy="13" r="2.2" fill="var(--tm-accent, #AE8D2D)" />
      </svg>
    </div>
  )
}

/** 🧭 §243ag Apple-Redesign: SF-Symbol-artige Tab-Icons (monochrome
 *  Silhouetten, per currentColor getintet) statt Emojis — DER sichtbarste
 *  Unterschied zwischen Web-Look und echter iOS-Tab-Bar. */
const TAB_PATHS: Record<string, string> = {
  // Sprechblase (gefüllt)
  chat: 'M12 3c-5 0-9 3.4-9 7.7 0 2.3 1.2 4.4 3.1 5.8L5.2 21l4.5-1.9c.7.1 1.5.2 2.3.2 5 0 9-3.4 9-7.6S17 3 12 3z',
  // Ablage-Tray
  offen: 'M19.5 4h-15L2.5 12.4V20h19v-7.6L19.5 4zM6 6h12l1.5 6H15a3 3 0 01-6 0H4.5L6 6z',
  // Aktentasche
  intern: 'M9 3.5h6A2.5 2.5 0 0117.5 6v.5H20A2 2 0 0122 8.5v10a2 2 0 01-2 2H4a2 2 0 01-2-2v-10a2 2 0 012-2h2.5V6A2.5 2.5 0 019 3.5zm.5 3h5V6a.5.5 0 00-.5-.5h-4a.5.5 0 00-.5.5v.5z',
  // Haken im Kreis
  aufgaben: 'M12 2a10 10 0 100 20 10 10 0 000-20zm-1.3 14.3l-4.2-4.2 1.5-1.5 2.7 2.7 5.8-5.8 1.5 1.5-7.3 7.3z',
  // Kalender
  kalender: 'M8 2h2v2h4V2h2v2h4a1 1 0 011 1v16a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1h4V2zm13 8H5v10h16V10z',
  // Ellipsis im Kreis (Mehr)
  einstellungen: 'M12 2a10 10 0 100 20 10 10 0 000-20zM7.2 13.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm4.8 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm4.8 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3z',
}
export function TabIcon({ name, size = 25 }: { name: string; size?: number }) {
  const d = TAB_PATHS[name]
  if (!d) return null
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ display: 'block' }}>
      <path d={d} fillRule="evenodd" />
    </svg>
  )
}

/** 🎚 iOS-Segmented-Control (Buchhaltungs-/System-Look) — geteilt, damit
 *  alle Panels dieselbe Filter-Sprache sprechen. options: [wert, label]. */
export function Segmented({ options, value, onChange, accent }: {
  options: [string, string][]
  value: string
  onChange: (v: string) => void
  /** aktive Segment-Textfarbe (z. B. lila für 🤖 Vorschläge) */
  accent?: Record<string, string>
}) {
  return (
    <div style={{ display: 'flex', background: 'var(--tm-surface2, rgba(118,118,128,0.14))', borderRadius: 10, padding: 2, gap: 2 }}>
      {options.map(([v, label]) => {
        const active = value === v
        return (
          <button key={v} type="button" onClick={() => { haptic(); onChange(v) }} style={{
            flex: 1, minWidth: 0, padding: '6px 4px', borderRadius: 8, border: 'none',
            fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
            transition: 'background .15s, color .15s, box-shadow .15s',
            background: active ? 'var(--tm-card, #fff)' : 'transparent',
            color: active ? (accent?.[v] ?? 'var(--tm-text, #111)') : 'var(--tm-muted, rgba(60,60,67,0.72))',
            boxShadow: active ? '0 1px 4px rgba(0,0,0,0.14)' : 'none',
            WebkitTapHighlightColor: 'transparent',
          }}>{label}</button>
        )
      })}
    </div>
  )
}

/** 💀 Skeleton-Zeilen für Erst-Ladezustände (Shimmer via .team-skel). */
export function SkeletonRows({ kind, count = 6 }: { kind: 'chat' | 'card'; count?: number }) {
  return (
    <div style={{ padding: kind === 'card' ? '2px 0' : 0 }}>
      {Array.from({ length: count }).map((_, i) => (
        kind === 'chat' ? (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px' }}>
            <div className="team-skel" style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="team-skel" style={{ height: 13, borderRadius: 6, width: `${55 - (i % 3) * 10}%`, marginBottom: 7 }} />
              <div className="team-skel" style={{ height: 11, borderRadius: 6, width: `${82 - (i % 4) * 9}%` }} />
            </div>
          </div>
        ) : (
          <div key={i} className="team-skel" style={{ height: 74, borderRadius: 14, marginBottom: 10 }} />
        )
      ))}
    </div>
  )
}

/* ═══════════════ §276 Design-System-Bausteine (JUPAS-Referenz) ═══════════════ */

/** 🖊 Strich-Icons (Stroke, 24er-Viewbox) für die schwebende Tab-Leiste und
 *  die Seitenleiste — aktiv dicker (2.3) als inaktiv (1.9). */
const STROKE_PATHS: Record<string, string> = {
  // Haus (Heute)
  heute: 'M3 11.5 12 4l9 7.5M5.5 10v10h13V10M10 20v-6h4v6',
  // Sprechblase (Chat/Inbox)
  chat: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V16H6.5A2.5 2.5 0 0 1 4 13.5v-7z',
  inbox: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V16H6.5A2.5 2.5 0 0 1 4 13.5v-7z',
  // Aktentasche (Intern)
  intern: 'M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M4 9.5A2.5 2.5 0 0 1 6.5 7h11A2.5 2.5 0 0 1 20 9.5V17a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17V9.5zM4 12.5h16',
  // Ablage (Offen)
  offen: 'M4 13.5V17a2.5 2.5 0 0 0 2.5 2.5h11A2.5 2.5 0 0 0 20 17v-3.5M4 13.5 6.2 6.2A1.5 1.5 0 0 1 7.6 5h8.8a1.5 1.5 0 0 1 1.4 1.2L20 13.5M4 13.5h4.5l1 2h5l1-2H20',
  // Haken im Quadrat (Aufgaben)
  aufgaben: 'M5 6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 17.5v-11zM8.5 12.2l2.4 2.4 4.7-5',
  // Kalender
  kalender: 'M5 7.5A1.5 1.5 0 0 1 6.5 6h11A1.5 1.5 0 0 1 19 7.5v10a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 17.5v-10zM5 10.5h14M9 4v4M15 4v4',
  // Raster (Mehr)
  einstellungen: 'M5 5h5.5v5.5H5V5zM13.5 5H19v5.5h-5.5V5zM5 13.5h5.5V19H5v-5.5zM13.5 13.5H19V19h-5.5v-5.5z',
}
export function TabStrokeIcon({ name, size = 27, active = false }: { name: string; size?: number; active?: boolean }) {
  const d = STROKE_PATHS[name]
  if (!d) return null
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.3 : 1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block' }}>
      <path d={d} />
    </svg>
  )
}

/** Lupe / Aktualisieren / Zurück — Kopfleisten-Icons. */
export function IconSearch({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" /><line x1="20" y1="20" x2="15.8" y2="15.8" />
    </svg>
  )
}
export function IconRefresh({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4.5v4.5H15" />
    </svg>
  )
}

/** 🍞 Toast: dunkle Pille unten mittig über der Tab-Leiste, 2 s.
 *  Aufruf von überall — die TeamShell rendert den Host. */
export function tmToast(text: string) {
  try { window.dispatchEvent(new CustomEvent('trimosa-toast', { detail: { text } })) } catch { /* SSR */ }
}

/** Paragraph 310 (Dominik 10.9. 08:09): Laeuft die App als installierte PWA, oeffnen Links (Gaestemappe, Rechnung …)
 *  ohne Browser-Leiste — kein Zurueck. Deshalb im Standalone-Modus ein In-App-Sheet mit Schliessen-Knopf;
 *  im normalen Browser wie gehabt ein neues Fenster. */
export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || (window.matchMedia?.('(display-mode: standalone)').matches ?? false)
}
export function openLink(url: string, title?: string) {
  if (typeof window === 'undefined') return
  if (isStandalonePwa()) {
    window.dispatchEvent(new CustomEvent('trimosa-open-link', { detail: { url, title: title ?? '' } }))
  } else {
    window.open(url, '_blank', 'noopener')
  }
}

/** 🎨 Portalfarben (Pascal-Spec) für Avatare, Badges, Belegungsbalken. */
// Paragraph 305 (Pascal 9.9. 18:11): Pillen = Kalenderfarben. Airbnb Rot, Booking Navy, FeWo-direkt Vrbo-Blau (hell,
// damit es sich vom Booking-Navy abhebt), HomeToGo „Twilight Purple" (Markenfarbe), Website/Direkt Gold.
export const PORTAL_COLORS: Record<string, string> = {
  'Booking.com': '#1A4FA0',
  'Airbnb': '#E0565B',
  'FeWo-direkt': '#0EA5E9',
  'HomeToGo': '#7C3AED',
  'Website': '#AE8D2D',
  'Direkt': '#AE8D2D',
  'TRIMOSA': '#AE8D2D',
}
/** Kanal-Normalisierung — §140/§262-Substring-Falle: fewo VOR direkt VOR booking */
export function portalOf(raw?: string | null): string {
  const v = (raw ?? '').toLowerCase()
  if (/fewo|homeaway|vrbo|abritel/.test(v)) return 'FeWo-direkt'
  if (/website|trimosa/.test(v)) return 'Website'
  if (/direct|direkt/.test(v)) return 'Direkt'
  if (/airbnb/.test(v)) return 'Airbnb'
  if (/booking/.test(v)) return 'Booking.com'
  if (/hometogo/.test(v)) return 'HomeToGo'
  return raw?.trim() || 'Direkt'
}
export function portalColor(raw?: string | null): string {
  return PORTAL_COLORS[portalOf(raw)] ?? '#646b76'
}
/** „Thomas Seggelmann" → „TS" */
export function initials(name?: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '·'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/* ── §282.10 Leere Zustände mit Charakter: Linien-Illustration in Markenfarbe
   + ein Satz aus dem Sprüche-Fundus des Start-Vorhangs ── */
const EMPTY_ART: Record<'house' | 'check' | 'chat' | 'calendar', string[]> = {
  house: ['M12 36 L44 12 L76 36', 'M22 30 V58 H66 V30', 'M39 58 V44 H49 V58', 'M14 14 a5 5 0 1 0 0.01 0'],
  check: ['M44 12 a20 20 0 1 0 0.01 0', 'M34 33 l7 7 l13 -14'],
  chat: ['M14 18 h36 a6 6 0 0 1 6 6 v12 a6 6 0 0 1 -6 6 h-22 l-8 7 v-7 h-6 a6 6 0 0 1 -6 -6 v-12 a6 6 0 0 1 6 -6 z', 'M60 30 h10 a5 5 0 0 1 5 5 v10 a5 5 0 0 1 -5 5 h-4 v6 l-7 -6 h-12 a5 5 0 0 1 -5 -5 v-3'],
  calendar: ['M18 16 h52 a4 4 0 0 1 4 4 v34 a4 4 0 0 1 -4 4 h-52 a4 4 0 0 1 -4 -4 v-34 a4 4 0 0 1 4 -4 z', 'M14 28 h60', 'M30 10 v10', 'M58 10 v10', 'M28 40 h6', 'M41 40 h6', 'M54 40 h6', 'M28 48 h6', 'M41 48 h6'],
}
export function EmptyState({ title, hint, icon = 'house' }: { title: string; hint?: string; icon?: keyof typeof EMPTY_ART }) {
  const [spruch] = useState(() => pickSpruch(new Date(), null).text)
  return (
    <div className="tm-empty tm-enter" style={{ textAlign: 'center', padding: '40px 24px 32px' }}>
      <svg width="88" height="64" viewBox="0 0 88 64" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block', margin: '0 auto' }}>
        {EMPTY_ART[icon].map((d, i) => <path key={i} d={d} />)}
      </svg>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--tm-text, #171a1f)', marginTop: 14 }}>{title}</div>
      {hint && <div style={{ fontSize: 13, color: 'var(--tm-muted, #646b76)', marginTop: 6, lineHeight: 1.5 }}>{hint}</div>}
      <div style={{ fontSize: 12.5, color: 'var(--tm-muted2, #959ca7)', marginTop: 10, fontStyle: 'italic' }}>{spruch}</div>
    </div>
  )
}
