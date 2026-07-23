'use client'

/**
 * 📱 iMessage-Swipe-Back (§157): Wisch vom LINKEN RAND Richtung Mitte führt
 * aus dem Thread zurück zur Liste. Startet nur am Rand (<32px), lockt erst
 * bei klar horizontaler Bewegung (vertikales Scrollen bleibt unberührt),
 * zieht den Thread live mit dem Finger mit; loslassen jenseits von 70px →
 * zurück, sonst schnappt er zurück. Rein additiv — der ‹-Button bleibt.
 */
import { useRef } from 'react'

export function useSwipeBack(onBack: () => void) {
  const ref = useRef<HTMLDivElement | null>(null)
  const s = useRef({ x: 0, y: 0, active: false, locked: false })

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    s.current = { x: t.clientX, y: t.clientY, active: t.clientX < 32, locked: false }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    const st = s.current
    if (!st.active) return
    const t = e.touches[0]
    const dx = t.clientX - st.x
    const dy = t.clientY - st.y
    if (!st.locked) {
      // Richtung entscheiden: deutlich vertikal → Geste freigeben (Scrollen)
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { st.active = false; return }
      if (dx < 8) return
      st.locked = true
    }
    if (ref.current) {
      ref.current.style.transition = 'none'
      ref.current.style.transform = `translateX(${Math.max(0, dx)}px)`
    }
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const st = s.current
    if (!st.active || !st.locked) { st.active = false; return }
    st.active = false
    const dx = (e.changedTouches[0]?.clientX ?? st.x) - st.x
    const el = ref.current
    if (!el) { if (dx > 70) onBack(); return }
    el.style.transition = 'transform .22s ease'
    if (dx > 70) {
      el.style.transform = 'translateX(100%)'
      setTimeout(() => {
        onBack()
        el.style.transition = 'none'
        el.style.transform = ''
      }, 190)
    } else {
      el.style.transform = ''
      setTimeout(() => { el.style.transition = 'none' }, 240)
    }
  }
  return { ref, onTouchStart, onTouchMove, onTouchEnd }
}
