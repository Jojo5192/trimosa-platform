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
