/**
 * Compact review-score badge for listing cards: "★ 4,7 (50)".
 * On hover, a small dark popover breaks the score down per platform.
 * Pure markup + CSS (.score-badge / .score-pop in globals.css), so it works
 * in server components (homepage grid) and client components alike.
 */
export interface CardRating {
  overall: number
  count: number
  platforms: { source: string; score: number; count: number }[]
}

const PLATFORM_META: Record<string, { label: string; color: string }> = {
  airbnb: { label: 'Airbnb', color: '#FF5A5F' },
  booking: { label: 'Booking.com', color: '#0071C2' },
  google: { label: 'Google', color: '#4285F4' },
  vrbo: { label: 'FeWo-direkt', color: '#6C3BAA' },
  trimosa: { label: 'TRIMOSA', color: '#AE8D2D' },
}

function de(n: number, digits = 1): string {
  return n.toFixed(digits).replace('.', ',')
}

export default function ScoreBadge({ rating }: { rating: CardRating }) {
  return (
    <span className="score-badge">
      <span style={{ color: 'var(--gold)', fontSize: '11px' }}>★</span>
      <span style={{ fontWeight: 700, color: '#111' }}>{de(rating.overall)}</span>
      <span style={{ color: '#999', fontWeight: 400 }}>({rating.count})</span>

      <span className="score-pop">
        <span style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#F5F0E8', marginBottom: '7px', whiteSpace: 'nowrap' }}>
          ★ {de(rating.overall, 2)} · {rating.count} Bewertung{rating.count !== 1 ? 'en' : ''}
        </span>
        {rating.platforms.map((p) => {
          const meta = PLATFORM_META[p.source] ?? { label: p.source, color: '#888' }
          return (
            <span key={p.source} style={{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '4px', whiteSpace: 'nowrap' }}>
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
              <span style={{ fontSize: '11px', color: 'rgba(245,240,232,0.75)', minWidth: '76px' }}>{meta.label}</span>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#F5F0E8' }}>{de(p.score)}</span>
              <span style={{ fontSize: '10px', color: 'rgba(245,240,232,0.45)' }}>({p.count})</span>
            </span>
          )
        })}
      </span>
    </span>
  )
}
