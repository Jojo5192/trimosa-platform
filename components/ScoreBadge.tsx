'use client'

/**
 * Review-score badge for listing cards: a frosted-glass chip "★ 4,7 (50)".
 * On hover, a dark popover with the per-platform breakdown is rendered into
 * document.body via a portal — so it can never be clipped by sticky headers,
 * overflow containers, or stacking contexts, while the chip itself scrolls
 * underneath the page chrome like normal content.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface CardRating {
  overall: number
  count: number
  platforms: { source: string; score: number; count: number }[]
}

const PLATFORM_META: Record<string, { label: string; color: string }> = {
  airbnb: { label: 'Airbnb', color: '#FF5A5F' },
  booking: { label: 'Booking.com', color: '#2E7CF6' },
  google: { label: 'Google', color: '#34A853' },
  vrbo: { label: 'FeWo-direkt', color: '#8B5CF6' },
  trimosa: { label: 'TRIMOSA', color: '#D4AF37' },
}

function de(n: number, digits = 1): string {
  return n.toFixed(digits).replace('.', ',')
}

function stars(overall: number): string {
  const full = Math.round(overall)
  return '★'.repeat(full) + '☆'.repeat(5 - full)
}

const POP_HEIGHT_ESTIMATE = 260 // px incl. margin — used to pick open direction

export default function ScoreBadge({ rating, popDirection }: { rating: CardRating; popDirection?: 'up' | 'down' }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [pop, setPop] = useState<{ left: number; top?: number; bottom?: number; dir: 'up' | 'down' } | null>(null)

  function show() {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const dir = popDirection ?? (r.top < POP_HEIGHT_ESTIMATE ? 'down' : 'up')
    const left = Math.max(8, Math.min(r.left - 8, window.innerWidth - 235))
    setPop(dir === 'down'
      ? { left, top: r.bottom + 10, dir }
      : { left, bottom: window.innerHeight - r.top + 10, dir })
  }

  // Close on any scroll so the fixed-position popover never visually detaches.
  useEffect(() => {
    if (!pop) return
    const close = () => setPop(null)
    window.addEventListener('scroll', close, { passive: true, capture: true })
    return () => window.removeEventListener('scroll', close, { capture: true })
  }, [pop])

  return (
    <span
      ref={ref}
      className="score-badge"
      onMouseEnter={show}
      onMouseLeave={() => setPop(null)}
    >
      <span style={{ color: '#F2C94C', fontSize: '13px', lineHeight: 1, filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.3))' }}>★</span>
      <span style={{ fontWeight: 800, color: '#fff', fontSize: '13px', letterSpacing: '-0.01em' }}>{de(rating.overall)}</span>
      <span style={{ color: 'rgba(255,255,255,0.75)', fontWeight: 500, fontSize: '11px' }}>({rating.count})</span>

      {pop && typeof document !== 'undefined' && createPortal(
        <span
          className={`score-pop-portal ${pop.dir === 'down' ? 'score-pop-portal--down' : 'score-pop-portal--up'}`}
          style={{ left: pop.left, top: pop.top, bottom: pop.bottom }}
        >
          {/* Header: big score + stars */}
          <span style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '4px' }}>
            <span style={{ fontSize: '26px', fontWeight: 800, color: '#F5F0E8', lineHeight: 1, letterSpacing: '-0.02em' }}>{de(rating.overall, 2)}</span>
            <span style={{ color: 'var(--gold)', fontSize: '13px', letterSpacing: '2px' }}>{stars(rating.overall)}</span>
          </span>
          <span style={{ display: 'block', fontSize: '11px', color: 'rgba(245,240,232,0.55)', marginBottom: '12px' }}>
            {rating.count} Bewertung{rating.count !== 1 ? 'en' : ''} · {rating.platforms.length} Plattform{rating.platforms.length !== 1 ? 'en' : ''}
          </span>

          {/* Per-platform rows with score bars */}
          {rating.platforms.map((p) => {
            const meta = PLATFORM_META[p.source] ?? { label: p.source, color: '#888' }
            return (
              <span key={p.source} style={{ display: 'block', marginTop: '9px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '4px', whiteSpace: 'nowrap' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                  <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'rgba(245,240,232,0.85)' }}>{meta.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 800, color: '#F5F0E8' }}>{de(p.score)}</span>
                  <span style={{ fontSize: '10px', color: 'rgba(245,240,232,0.45)' }}>({p.count})</span>
                </span>
                <span style={{ display: 'block', height: '4px', borderRadius: '99px', background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', borderRadius: '99px', background: meta.color, width: `${Math.min(100, (p.score / 5) * 100)}%` }} />
                </span>
              </span>
            )
          })}
        </span>,
        document.body,
      )}
    </span>
  )
}
