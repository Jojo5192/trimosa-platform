'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'

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
export function haptic() {
  try {
    const nav = navigator as Navigator & { vibrate?: (pattern: number) => boolean }
    if (typeof nav.vibrate === 'function' && nav.vibrate(10)) return
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

/** Indikator-Zeile zum Pull-to-Refresh-Hook. */
export function PullHint({ pull, busy }: { pull: number; busy: boolean }) {
  if (pull <= 0 && !busy) return null
  return (
    <div style={{
      height: busy ? 48 : pull, display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', transition: busy ? 'none' : 'height .18s', flexShrink: 0,
    }}>
      <span
        className={busy ? 'team-ptr-spin' : undefined}
        style={{
          fontSize: 17, color: '#8A8065', display: 'inline-block',
          transform: busy ? undefined : `rotate(${Math.min(180, pull * 3)}deg)`,
        }}
      >{busy ? '⟳' : '↓'}</span>
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
    <div style={{ display: 'flex', background: 'rgba(118,118,128,0.14)', borderRadius: 10, padding: 2, gap: 2 }}>
      {options.map(([v, label]) => {
        const active = value === v
        return (
          <button key={v} type="button" onClick={() => { haptic(); onChange(v) }} style={{
            flex: 1, minWidth: 0, padding: '6px 4px', borderRadius: 8, border: 'none',
            fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
            transition: 'background .15s, color .15s, box-shadow .15s',
            background: active ? '#fff' : 'transparent',
            color: active ? (accent?.[v] ?? '#111') : 'rgba(60,60,67,0.72)',
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
