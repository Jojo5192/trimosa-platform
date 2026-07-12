/**
 * Review-score badge for listing cards: a gold pill "★ 4,7 (50)".
 * On hover, a dark popover shows the overall score plus a per-platform
 * breakdown with score bars. Pure markup + CSS (.score-badge / .score-pop in
 * globals.css), so it works in server components and client components alike.
 */
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

export default function ScoreBadge({ rating, popDirection = 'up' }: { rating: CardRating; popDirection?: 'up' | 'down' }) {
  return (
    <span className="score-badge">
      <span style={{ color: '#F2C94C', fontSize: '13px', lineHeight: 1, filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.3))' }}>★</span>
      <span style={{ fontWeight: 800, color: '#fff', fontSize: '13px', letterSpacing: '-0.01em' }}>{de(rating.overall)}</span>
      <span style={{ color: 'rgba(255,255,255,0.75)', fontWeight: 500, fontSize: '11px' }}>({rating.count})</span>

      <span className={popDirection === 'down' ? 'score-pop score-pop--down' : 'score-pop'}>
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
      </span>
    </span>
  )
}
