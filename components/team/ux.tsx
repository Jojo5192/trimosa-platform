'use client'

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { pickSpruch } from '@/lib/start-curtain'
import { HAPTIK, haptikArt, spieleTon, type RueckmeldungArt } from '@/lib/klang'

/**
 * 📱 §209 iOS-Feeling-Paket (Pascal): geteilte UX-Bausteine der Team-App —
 * Haptik, Pull-to-Refresh und Skeleton-Ladezustände.
 */

/** 📳 iOS-Rückfall (Safari kennt navigator.vibrate nicht): der <input type="checkbox" switch>-Trick
 *  (iOS 17.4+/18) — ein programmatischer Klick auf das Label löst das System-Tick aus. Funktioniert nur
 *  im Rahmen einer Nutzer-Geste; ohne Support passiert einfach nichts. Ein verstecktes, für Vorlese-
 *  Programme unsichtbares Element, einmal angelegt und wiederverwendet. */
let hapticEl: HTMLLabelElement | null = null
function iosTick() {
  if (!hapticEl || !hapticEl.isConnected) {
    hapticEl = document.createElement('label')
    hapticEl.setAttribute('aria-hidden', 'true')
    hapticEl.style.cssText = 'position:fixed;top:-100px;left:-100px;width:1px;height:1px;overflow:hidden;'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.tabIndex = -1
    input.setAttribute('switch', '')
    hapticEl.appendChild(input)
    document.body.appendChild(hapticEl)
  }
  hapticEl.click()
}

/** 📳 Haptik (§282.12, Pascal 7.10. Gestaltung 2) — Muster aus lib/klang.ts, abgestimmt auf die Töne:
 *  tap = leicht · gesendet = ein festerer Puls · erledigt/'success' = zwei Pulse · fehler/'error' = zwei lange Pulse.
 *  Android über navigator.vibrate; NUR wo vibrate fehlt (iOS-Safari) der Switch-Trick (iOS kennt nur ein
 *  Tick: Anzahl/Abstand machen den Unterschied). Vor der ersten Nutzer-Geste passiert gar nichts. */
export type HapticKind = 'tap' | 'success' | 'error'
export function haptic(kind: HapticKind | RueckmeldungArt = 'tap') {
  try {
    const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean; userActivation?: { hasBeenActive: boolean } }
    // Chrome blockt vibrate() vor der ersten Nutzer-Geste und meldet das als Konsolen-Fehler — dann gar nicht erst rufen
    if (nav.userActivation && !nav.userActivation.hasBeenActive) return
    const muster = HAPTIK[haptikArt(kind)]
    if (typeof nav.vibrate === 'function') {
      nav.vibrate(typeof muster.vibrate === 'number' ? muster.vibrate : [...muster.vibrate])
      return
    }
    for (const ms of muster.ios) {
      if (ms <= 0) iosTick()
      else setTimeout(() => { try { iosTick() } catch { /* egal */ } }, ms)
    }
  } catch { /* Haptik ist nice-to-have */ }
}

/** 🔔 Rückmeldung = Ton + Haptik aus einem Guss (Pascal 7.10.): sparsam einsetzen — Nachricht gesendet,
 *  Aufgabe erledigt (erst NACH der Server-Bestätigung), Fehler beim Speichern/Senden. 'tap' = nur Haptik.
 *  Der Ton folgt dem Schalter „Töne" (Mehr → Darstellung) und dem Stumm-Schalter des Geräts. */
export function rueckmeldung(art: RueckmeldungArt) {
  haptic(art)
  if (art !== 'tap') spieleTon(art)
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
      // §314: Der Knoten kann von React für eine ANDERE Ansicht weiterverwendet werden
      // (mobil wird aus der Chat-Liste der Thread) — der Ref zeigt dann nicht mehr auf
      // ihn. Ohne diese Prüfung löste jedes Abwärtsziehen im Thread ein Neu-Rendern je
      // Fingerbewegung und ab ~125 px ein Listen-Neuladen aus.
      if (ref.current !== el || busyRef.current || el.scrollTop > 0) { active = false; return }
      startY = e.touches[0].clientY
      active = true
      dist = 0
    }
    const move = (e: TouchEvent) => {
      if (ref.current !== el) { if (active) { active = false; setPull(0) } return }
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
    // iOS-27-Runde: Pille (Radius 999) mit Haarlinie um die Spur; aktives Segment mit eigenem
    // Schatten + feinem Rand, im Dark Mode HELLER als die Spur (--tm-seg-on) statt dunkler.
    // role tablist/tab + aria-selected: VoiceOver sagt an, welches Segment aktiv ist
    <div role="tablist" style={{ display: 'flex', background: 'var(--tm-seg-track, var(--tm-surface2, rgba(118,118,128,0.14)))', borderRadius: 999, padding: 3, gap: 2, boxShadow: 'inset 0 0 0 0.5px var(--tm-line, rgba(60,60,67,0.14))' }}>
      {options.map(([v, label]) => {
        const active = value === v
        return (
          <button key={v} type="button" role="tab" aria-selected={active} className="tm-press-btn" onClick={() => { haptic(); onChange(v) }} style={{
            flex: 1, minWidth: 0, padding: '6px 6px', borderRadius: 999, border: 'none',
            fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
            transition: 'background .15s, color .15s, box-shadow .15s, transform .14s',
            background: active ? 'var(--tm-seg-on, var(--tm-card, #fff))' : 'transparent',
            color: active ? (accent?.[v] ?? 'var(--tm-text, #111)') : 'var(--tm-muted, rgba(60,60,67,0.72))',
            boxShadow: active ? '0 1px 3px rgba(0,0,0,0.16), var(--tm-edge, 0 0 0 0.5px rgba(23,26,31,0.14))' : 'none',
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
    // ♿ role=status + unsichtbarer Text: VoiceOver sagt „Lädt…" statt leerer Flächen
    <div role="status" style={{ padding: kind === 'card' ? '2px 0' : 0 }}>
      <span className="tm-sr-only">Lädt…</span>
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
 *  Aufruf von überall — die TeamShell rendert den Host. Vorlese-Programme bekommen den Text über die
 *  dauerhafte Live-Region (BedienhilfenHost) angesagt: Fehler sofort (assertive), alles andere höflich.
 *  fehler weglassen = am Text erkennen (⚠️/📵 vorn oder „nicht geklappt"/„konnte nicht" …). */
export function tmToast(text: string, opts?: { fehler?: boolean }) {
  try { window.dispatchEvent(new CustomEvent('trimosa-toast', { detail: { text, fehler: opts?.fehler } })) } catch { /* SSR */ }
}

/* ═══════════════ ♿ Barrierefreiheit (Pascal 7.10., Gestaltung 4) ═══════════════
   Ansagen über Live-Regionen, Fokus-Führung in Dialogen/Blättern, Tastatur-Modus fürs Fokus-Ringlein.
   CSS dazu: Abschnitt „Barrierefreiheit" am Ende von app/globals.css (.tm-sr-only, Fokus-Ring). */

/** 🔊 Ansage für VoiceOver/TalkBack über die dauerhafte Live-Region der Shell, ohne sichtbaren Toast.
 *  dringend = unterbricht (Fehler), sonst wartet sie auf eine Sprechpause. Sparsam einsetzen. */
export function ansagen(text: string, dringend = false) {
  try { window.dispatchEvent(new CustomEvent('trimosa-ansage', { detail: { text, dringend } })) } catch { /* SSR */ }
}

/** Toast-Text sieht nach Fehler aus → dringend ansagen */
function istFehlerText(text: string): boolean {
  return /^\s*(⚠|📵|❌|✗)/u.test(text) || /nicht geklappt|konnte nicht|nicht gespeichert|nicht gesendet|fehlgeschlagen|\bfehler\b/i.test(text)
}
/** Deko-Symbole vorn (✓ ⚠️ 📵 🎉) nicht mitvorlesen — die Art steckt schon in der Ansage-Dringlichkeit */
function sprechText(text: string): string {
  return text.replace(/^[\s\p{Extended_Pictographic}✓✔✗️‍·–-]+/u, '').trim()
}

/** Offene Dialoge, oberster zuletzt — nur der oberste fängt Tab/Esc ab, und die Live-Regionen wandern
 *  in ihn hinein (bei aria-modal blenden Vorlese-Programme alles außerhalb aus, auch Live-Regionen). */
type DialogEintrag = { id: symbol; ref: RefObject<HTMLElement | null>; el: HTMLElement }
const dialogStapel: DialogEintrag[] = []
const stapelHoerer = new Set<() => void>()
function stapelGeaendert() { stapelHoerer.forEach((f) => f()) }
function stapelAbo(f: () => void) { stapelHoerer.add(f); return () => { stapelHoerer.delete(f) } }
/** aktuelles Element des obersten Blatts (ref.current: auch nach einem Neu-Mounten des Blatts richtig) */
function obersterDialog(): HTMLElement | null {
  const d = dialogStapel[dialogStapel.length - 1]
  return d ? (d.ref.current ?? d.el) : null
}
/** role/aria-modal/aria-labelledby ergänzen, ohne Vorhandenes zu überschreiben → liefert die Überschrift */
function dialogSemantik(el: HTMLElement): HTMLElement | null {
  if (!el.getAttribute('role')) el.setAttribute('role', 'dialog')
  if (!el.hasAttribute('aria-modal')) el.setAttribute('aria-modal', 'true')
  const titel = el.querySelector<HTMLElement>('h1, h2, h3, [role="heading"]')
  if (titel && !el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')) {
    if (!titel.id) titel.id = `tm-dlg-${Math.random().toString(36).slice(2, 9)}`
    el.setAttribute('aria-labelledby', titel.id)
  }
  return titel
}

/** Zuletzt angetippter Knopf: iOS-Safari fokussiert Knöpfe beim Antippen NICHT (activeElement bleibt body) —
 *  ohne diese Notiz wüsste ein Dialog nicht, wohin der Fokus beim Schließen zurück soll. */
let letzterKlick: { el: HTMLElement; at: number } | null = null
let klickHoererDran = false
function klickNotieren() {
  if (klickHoererDran || typeof document === 'undefined') return
  klickHoererDran = true
  document.addEventListener('click', (e) => {
    const el = (e.target as Element | null)?.closest?.('button, a[href], [role="button"], [role="tab"], [role="menuitem"], [tabindex]')
    if (el instanceof HTMLElement) letzterKlick = { el, at: Date.now() }
  }, true)
}

const FOKUSSIERBAR = 'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, audio[controls], video[controls], [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])'
function fokussierbare(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOKUSSIERBAR))
    .filter((n) => !n.closest('[inert]') && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden')
}
const istTextfeld = (n: Element | null) => !!n && (n.matches('textarea, select, [contenteditable]:not([contenteditable="false"])')
  || (n.matches('input') && !/^(button|submit|reset|checkbox|radio|range|color|file|image)$/i.test((n as HTMLInputElement).type)))

/** ♿ Fokus-Führung für Dialoge und Blätter — Ref ans Blatt hängen (das Element mit der Kartenfläche):
 *   · ergänzt role="dialog", aria-modal und aria-labelledby (erste Überschrift im Blatt), wenn sie fehlen
 *   · setzt den Fokus beim Öffnen ins Blatt: [data-dialog-start] → sonst die Überschrift → sonst das Blatt;
 *     hat schon ein Feld darin den Fokus (autoFocus), bleibt er dort
 *   · Fokus-Falle: Tab/Umschalt+Tab bleiben im obersten Blatt · Esc ruft onClose (null = Esc regelt die
 *     Komponente selbst) · beim Schließen zurück zum Auslöser (Textfelder nur bei Tastatur-Bedienung,
 *     sonst springt am iPhone die Tastatur auf).
 *  aktiv=false für Komponenten, die dauerhaft gemountet sind und das Blatt nur bedingt zeigen.
 *  Logik der Komponente bleibt unberührt — der Hook hängt nur Ereignis-Hörer an. */
export function useDialogFokus<T extends HTMLElement = HTMLDivElement>(onClose?: (() => void) | null, aktiv = true): RefObject<T | null> {
  const ref = useRef<T | null>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })
  // Blatt wurde neu gemountet (Komponente im Render definiert): Semantik nachziehen, Live-Regionen umziehen
  const letztesEl = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!aktiv || !ref.current || ref.current === letztesEl.current) return
    const neuGemountet = letztesEl.current !== null
    letztesEl.current = ref.current
    if (neuGemountet) { dialogSemantik(ref.current); stapelGeaendert() }
  })
  useEffect(() => {
    if (!aktiv) return
    const el = ref.current
    if (!el) return
    letztesEl.current = el
    klickNotieren()
    const id = Symbol('dialog')
    dialogStapel.push({ id, ref, el })
    stapelGeaendert()
    const blatt = (): HTMLElement => ref.current ?? el

    // Auslöser merken: frisch angetippter Knopf (iOS) vor dem fokussierten Element
    const aktivVorher = document.activeElement instanceof HTMLElement && document.activeElement !== document.body && !el.contains(document.activeElement)
      ? document.activeElement : null
    const geklickt = letzterKlick && Date.now() - letzterKlick.at < 1500 && !el.contains(letzterKlick.el) ? letzterKlick.el : null
    const ausloeser = geklickt ?? aktivVorher

    const titel = dialogSemantik(el)

    // Fokus ins Blatt
    if (!el.contains(document.activeElement)) {
      const ziel = el.querySelector<HTMLElement>('[data-dialog-start]') ?? titel ?? el
      if (!ziel.matches(FOKUSSIERBAR) && !ziel.hasAttribute('tabindex')) ziel.setAttribute('tabindex', '-1')
      try { ziel.focus({ preventScroll: true }) } catch { /* egal */ }
    }

    const onKey = (e: KeyboardEvent) => {
      if (dialogStapel[dialogStapel.length - 1]?.id !== id) return
      const el = blatt()
      // Fokus steht in einer fremden Ebene über dem Blatt (Dokumenten-Scanner, Popover …) — die regelt selbst
      const quelle = e.target instanceof Node ? e.target : null
      if (quelle && quelle !== document.body && quelle !== document.documentElement && !el.contains(quelle)) return
      if (e.key === 'Escape') {
        if (!closeRef.current || e.isComposing || e.defaultPrevented) return
        e.preventDefault()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const liste = fokussierbare(el)
      const jetzt = document.activeElement as HTMLElement | null
      if (!liste.length) { e.preventDefault(); return }
      const erstes = liste[0]
      const letztes = liste[liste.length - 1]
      const idx = jetzt ? liste.indexOf(jetzt) : -1
      // Fokus ins Leere gefallen (body) → zurück ins Blatt
      if (!jetzt || !el.contains(jetzt)) { e.preventDefault(); (e.shiftKey ? letztes : erstes).focus(); return }
      if (idx === -1) {
        // Fokus steht auf der Überschrift/dem Blatt selbst: nächstes bzw. voriges Element im Blatt
        const nach = liste.filter((n) => jetzt.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)
        const vor = liste.filter((n) => jetzt.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING)
        e.preventDefault()
        ;(e.shiftKey ? (vor[vor.length - 1] ?? letztes) : (nach[0] ?? erstes)).focus()
        return
      }
      if (e.shiftKey && idx === 0) { e.preventDefault(); letztes.focus() }
      else if (!e.shiftKey && idx === liste.length - 1) { e.preventDefault(); erstes.focus() }
    }
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
      const i = dialogStapel.findIndex((d) => d.id === id)
      if (i >= 0) dialogStapel.splice(i, 1)
      stapelGeaendert()
      letztesEl.current = null
      // Fokus zurück — nur wenn er noch im (geschlossenen) Blatt steht oder ins Leere gefallen ist
      const jetzt = document.activeElement
      // blatt(): beim Aufräumen evtl. schon null → el; neu gemountetes Blatt zählt mit
      const verwaist = !jetzt || jetzt === document.body || el.contains(jetzt) || blatt().contains(jetzt)
      if (!ausloeser || !verwaist || !ausloeser.isConnected) return
      if (istTextfeld(ausloeser) && !document.documentElement.hasAttribute('data-tm-tastatur')) return
      try { ausloeser.focus({ preventScroll: true }) } catch { /* egal */ }
    }
  }, [aktiv])
  return ref
}

/** ♿ Scroll-Verhalten für scrollIntoView/scrollTo: 'smooth', bei „Bewegung reduzieren" sofort ('auto').
 *  (Ein ausdrückliches behavior:'smooth' in JS schlägt die CSS-Regel scroll-behavior:auto.) */
export function sanftScroll(): ScrollBehavior {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'smooth'
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

/** ♿ Klickbare Fläche ohne <button> (Karte, Zeile, Kopf) für Tastatur und VoiceOver bedienbar machen:
 *  role=button, Tab-Stopp, Enter/Leertaste lösen aus — nur auf der Fläche selbst, nicht aus Kind-Knöpfen.
 *  Nicht auf Karten MIT Knöpfen darin setzen (Kinder eines role=button liest VoiceOver nicht einzeln) —
 *  dort einen Teil (z. B. den Titel) zum Knopf machen. Ohne onClick: keine Angaben. */
export function alsKnopf(onClick?: (() => void) | null) {
  if (!onClick) return {}
  return {
    role: 'button' as const,
    tabIndex: 0,
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
      e.preventDefault()
      onClick()
    },
  }
}

/** ♿ Host für Ansagen + Tastatur-Modus — EINMAL in der TeamShell rendern.
 *  · zwei dauerhafte, unsichtbare Live-Regionen (höflich/dringend): Toasts (tmToast) und ansagen()
 *    landen hier. Erst leeren, dann setzen — sonst sagt VoiceOver denselben Text kein zweites Mal an;
 *    nach 6 s wieder leer, damit beim Wischen durch die Seite kein alter Text auftaucht.
 *  · Tastatur-Modus (data-tm-tastatur an <html>): Tab/Pfeile setzen ihn, Zeiger/Touch nimmt ihn weg —
 *    Textfelder zeigen den Fokus-Ring nur dann (beim Antippen genügt der Cursor). */
export function BedienhilfenHost() {
  const [hoeflich, setHoeflich] = useState('')
  const [dringend, setDringend] = useState('')
  const ziel = useSyncExternalStore(stapelAbo, obersterDialog, () => null)
  useEffect(() => {
    const timer: Record<'h' | 'd', ReturnType<typeof setTimeout>[]> = { h: [], d: [] }
    const sag = (roh: string, eilig: boolean) => {
      const text = sprechText(roh)
      if (!text) return
      const k = eilig ? 'd' : 'h'
      const set = eilig ? setDringend : setHoeflich
      timer[k].forEach(clearTimeout)
      set('')
      timer[k] = [setTimeout(() => set(text), 120), setTimeout(() => set(''), 6000)]
    }
    const onToast = (e: Event) => {
      const d = (e as CustomEvent<{ text?: string; fehler?: boolean }>).detail
      if (d?.text) sag(d.text, d.fehler ?? istFehlerText(d.text))
    }
    const onAnsage = (e: Event) => {
      const d = (e as CustomEvent<{ text?: string; dringend?: boolean }>).detail
      if (d?.text) sag(d.text, !!d.dringend)
    }
    const root = document.documentElement
    const onKey = (e: KeyboardEvent) => {
      // nur Navigations-Tasten: Leertaste/Buchstaben kommen auch von der iPhone-Bildschirmtastatur
      if (e.key === 'Tab' || e.key.startsWith('Arrow')) root.setAttribute('data-tm-tastatur', '')
    }
    const onZeiger = () => root.removeAttribute('data-tm-tastatur')
    window.addEventListener('trimosa-toast', onToast)
    window.addEventListener('trimosa-ansage', onAnsage)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onZeiger, true)
    return () => {
      window.removeEventListener('trimosa-toast', onToast)
      window.removeEventListener('trimosa-ansage', onAnsage)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onZeiger, true)
      timer.h.forEach(clearTimeout); timer.d.forEach(clearTimeout)
      root.removeAttribute('data-tm-tastatur')
    }
  }, [])
  const regionen = (
    <>
      <div className="tm-sr-only" role="status" aria-live="polite" aria-atomic="true">{hoeflich}</div>
      <div className="tm-sr-only" role="alert" aria-live="assertive" aria-atomic="true">{dringend}</div>
    </>
  )
  return ziel ? createPortal(regionen, ziel) : regionen
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
const EMPTY_ART: Record<'house' | 'check' | 'chat' | 'calendar' | 'search' | 'bell' | 'box', string[]> = {
  house: ['M12 36 L44 12 L76 36', 'M22 30 V58 H66 V30', 'M39 58 V44 H49 V58', 'M14 14 a5 5 0 1 0 0.01 0'],
  check: ['M44 12 a20 20 0 1 0 0.01 0', 'M34 33 l7 7 l13 -14'],
  chat: ['M14 18 h36 a6 6 0 0 1 6 6 v12 a6 6 0 0 1 -6 6 h-22 l-8 7 v-7 h-6 a6 6 0 0 1 -6 -6 v-12 a6 6 0 0 1 6 -6 z', 'M60 30 h10 a5 5 0 0 1 5 5 v10 a5 5 0 0 1 -5 5 h-4 v6 l-7 -6 h-12 a5 5 0 0 1 -5 -5 v-3'],
  calendar: ['M18 16 h52 a4 4 0 0 1 4 4 v34 a4 4 0 0 1 -4 4 h-52 a4 4 0 0 1 -4 -4 v-34 a4 4 0 0 1 4 -4 z', 'M14 28 h60', 'M30 10 v10', 'M58 10 v10', 'M28 40 h6', 'M41 40 h6', 'M54 40 h6', 'M28 48 h6', 'M41 48 h6'],
  // Lupe (Filter/Suche ohne Treffer)
  search: ['M54 28 a14 14 0 1 1 -28 0 a14 14 0 1 1 28 0', 'M50 38 l12 12'],
  // Glocke (Mitteilungen)
  bell: ['M30 44 V30 a14 14 0 0 1 28 0 V44 l5 5 H25 z', 'M39 53 a5 5 0 0 0 10 0', 'M44 12 v4'],
  // Karton (Material/Belege)
  box: ['M20 24 L44 14 L68 24 V48 L44 58 L20 48 Z', 'M20 24 L44 34 L68 24', 'M44 34 V58', 'M32 19 L56 29'],
}
const keinAbo = () => () => {}
/** true erst nach der Hydration — fürs Rendern von Werten, die der Server nicht kennt (localStorage, Zufall). */
export function useHydrated(): boolean {
  return useSyncExternalStore(keinAbo, () => true, () => false)
}

/** Leerer Zustand (Pascal 7.10. Gestaltung 3): nie eine kahle Fläche — ein freundlicher Satz (title),
 *  der hilfreiche nächste Schritt (hint) und wo sinnvoll ein Knopf dafür (action).
 *  feiern = kleiner Erfolgsmoment (Haken zeichnet sich, ≤ 1,2 s; ohne Bewegung bei reduzierter Bewegung) —
 *  NUR setzen, wenn der Server die Speicherung bestätigt hat. compact = für Listen innerhalb einer Karte. */
export function EmptyState({ title, hint, icon = 'house', action, feiern = false, compact = false }: {
  title: string
  hint?: string
  icon?: keyof typeof EMPTY_ART
  action?: { label: string; onClick: () => void }
  feiern?: boolean
  compact?: boolean
}) {
  // Spruch erst NACH der Hydration zeigen: pickSpruch würfelt — Server-HTML und erster Client-Render wichen
  // sonst voneinander ab (React-Fehler #418 „Hydration failed … text", Live-Konsole 9.10.)
  const hydrated = useHydrated()
  const [spruch] = useState(() => pickSpruch(new Date(), null).text)
  const art = feiern ? 'check' : icon
  return (
    <div className={`tm-empty tm-enter${feiern ? ' tm-feiern' : ''}`} role="status"
      style={{ textAlign: 'center', padding: compact ? '18px 12px 14px' : '40px 24px 32px' }}>
      <svg width={compact ? 66 : 88} height={compact ? 48 : 64} viewBox="0 0 88 64" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block', margin: '0 auto' }}>
        {EMPTY_ART[art].map((d, i) => <path key={i} d={d} pathLength={feiern ? 1 : undefined} />)}
      </svg>
      <div className={feiern ? 'tm-feiern-titel' : undefined} style={{ fontSize: compact ? 14 : 15, fontWeight: 700, color: 'var(--tm-text, #171a1f)', marginTop: compact ? 10 : 14 }}>{title}</div>
      {hint && <div style={{ fontSize: 13, color: 'var(--tm-muted, #646b76)', marginTop: 6, lineHeight: 1.5 }}>{hint}</div>}
      {action && (
        <button type="button" className="tm-press-btn" onClick={() => { haptic(); action.onClick() }} style={{
          marginTop: 14, padding: '9px 16px', borderRadius: 999, border: 'none', cursor: 'pointer',
          background: 'var(--tm-accent-soft, rgba(174,141,45,0.13))', color: 'var(--tm-accent-dark, #8A7020)',
          fontSize: 13.5, fontWeight: 700, WebkitTapHighlightColor: 'transparent',
        }}>{action.label}</button>
      )}
      {!compact && !feiern && hydrated && spruch && <div style={{ fontSize: 12.5, color: 'var(--tm-muted2, #959ca7)', marginTop: 10, fontStyle: 'italic' }}>{spruch}</div>}
    </div>
  )
}
