import Link from 'next/link'
import type { CSSProperties } from 'react'
import { t, type UiLang } from '@/lib/i18n'

/**
 * Quick-filter pills (locations + party size). Rendered both on the empty
 * homepage and inside the search-results header, so the two filters combine
 * (Ort + Personen) and stay reachable after the first click instead of
 * disappearing.
 */
export default function QuickFilters({
  locations,
  activeQ,
  activeGuests,
  checkin,
  checkout,
  compact = false,
  lang = 'de',
}: {
  locations: string[]
  activeQ?: string
  activeGuests?: string
  checkin?: string
  checkout?: string
  compact?: boolean
  lang?: UiLang
}) {
  function href(overrides: { q?: string; guests?: string }) {
    const params = new URLSearchParams()
    const nextQ = 'q' in overrides ? overrides.q : activeQ
    const nextGuests = 'guests' in overrides ? overrides.guests : activeGuests
    if (nextQ) params.set('q', nextQ)
    if (nextGuests) params.set('guests', nextGuests)
    if (checkin) params.set('checkin', checkin)
    if (checkout) params.set('checkout', checkout)
    const qs = params.toString()
    return qs ? `/?${qs}` : '/'
  }

  const pill = (isActive: boolean): CSSProperties => ({
    padding: compact ? '4px 11px' : '5px 13px',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: 500,
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    ...(isActive
      ? { backgroundColor: 'var(--gold)', color: '#fff' }
      : { backgroundColor: '#F5F3EF', color: '#444', border: '1px solid #E4E0D8' }),
  })

  const guestOptions = [
    { label: t(lang, 'Alle'), g: '' },
    { label: `2 ${t(lang, 'Pers.')}`, g: '2' },
    { label: `4 ${t(lang, 'Pers.')}`, g: '4' },
    { label: `6 ${t(lang, 'Pers.')}`, g: '6' },
    { label: `8 ${t(lang, 'Pers.')}`, g: '8' },
  ]

  return (
    <div className="filter-container" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
      <div className="filter-scroll">
        {[{ label: t(lang, 'Alle'), q: '' }, ...locations.map((loc) => ({ label: loc, q: loc }))].map((f) => {
          const isActive = f.q === '' ? !activeQ : activeQ === f.q
          return (
            <Link key={f.label} href={href({ q: f.q || undefined })} style={pill(isActive)}>
              {f.label}
            </Link>
          )
        })}
      </div>
      <div className="filter-scroll">
        {guestOptions.map((f) => {
          const isActive = activeGuests === f.g || (f.g === '' && !activeGuests)
          return (
            <Link key={f.label} href={href({ guests: f.g || undefined })} style={pill(isActive)}>
              {f.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
