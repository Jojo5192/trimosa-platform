'use client'

/**
 * 📖 Sprung-Navigation der Gästemappe (§154): sticky Chip-Leiste unter dem
 * Navy-Kopf — ein Tipp springt sanft zum Abschnitt, Scroll-Spy markiert den
 * aktiven Abschnitt in Gold (Muster: SectionNav §41). Die Leiste scrollt
 * horizontal und zieht den aktiven Chip automatisch ins Bild.
 */
import { useEffect, useRef, useState } from 'react'

export interface MappeNavItem { id: string; label: string; icon?: string }

export default function MappeNav({ items }: { items: MappeNavItem[] }) {
  const [active, setActive] = useState(items[0]?.id ?? '')
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        // aktiver Abschnitt = letzter, dessen Oberkante über der 120px-Linie liegt
        let current = items[0]?.id ?? ''
        for (const it of items) {
          const el = document.getElementById(it.id)
          if (el && el.getBoundingClientRect().top <= 120) current = it.id
        }
        setActive((a) => (a === current ? a : current))
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', onScroll) }
  }, [items])

  // aktiven Chip in der Leiste sichtbar halten
  useEffect(() => {
    const chip = barRef.current?.querySelector<HTMLElement>(`[data-nav="${active}"]`)
    chip?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [active])

  if (items.length < 3) return null

  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 40,
      background: 'rgba(245,243,238,0.88)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
      boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.15)',
    }}>
      <div ref={barRef} style={{
        maxWidth: 560, margin: '0 auto', display: 'flex', gap: 7,
        overflowX: 'auto', padding: '10px 16px', scrollbarWidth: 'none',
        WebkitOverflowScrolling: 'touch',
      }}>
        {items.map((it) => {
          const on = it.id === active
          return (
            <button
              key={it.id} data-nav={it.id} type="button"
              onClick={() => document.getElementById(it.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              style={{
                flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '7px 13px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
                fontSize: 12.5, fontWeight: 700, border: 'none', transition: 'background .15s, color .15s',
                background: on ? 'linear-gradient(135deg, var(--gold, #AE8D2D), #8A7020)' : 'rgba(255,255,255,0.85)',
                color: on ? '#fff' : '#6B6250',
                boxShadow: on ? '0 2px 8px rgba(138,112,32,0.3)' : '0 1px 3px rgba(0,0,0,0.06)',
              }}
            >
              {it.icon && <span style={{ fontSize: 13 }}>{it.icon}</span>}
              {it.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
