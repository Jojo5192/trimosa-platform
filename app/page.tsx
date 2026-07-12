import { supabaseAdmin } from '@/lib/supabase-admin'
import Link from 'next/link'
import Image from 'next/image'
import NavBar from '@/components/NavBar'
import SearchResults, { type CardData } from '@/components/SearchResults'
import QuickFilters from '@/components/QuickFilters'
import { checkAvailability } from '@/lib/smoobu'
import { getHostMarkupMap } from '@/lib/pricing'

/* ── Refined, muted card gradients ── */
const CARD_GRADIENTS = [
  { from: '#D6EAE8', to: '#4A8F96', accent: '#2E7A82' },   // still teal
  { from: '#DCEADC', to: '#567A5C', accent: '#3E6344' },   // sage
  { from: '#EDE5D0', to: 'var(--gold)', accent: 'var(--gold-dark)' },   // warm gold
  { from: '#E4DFF0', to: '#7A6EA0', accent: '#5E537E' },   // muted lavender
  { from: '#EDE1D8', to: '#A8705A', accent: '#8A5A44' },   // terracotta
  { from: '#D8E8F0', to: '#4A7EA8', accent: '#326080' },   // steel blue
  { from: '#DBE8DE', to: '#507860', accent: '#3A5E4A' },   // forest
  { from: '#EDE8D0', to: '#A89050', accent: '#8A7238' },   // sand
]

/* ── Known locations with approximate coordinates for distance calc ── */
const KNOWN_COORDS: Record<string, [number, number]> = {
  'schliersee': [47.7345, 11.8538],
  'tegernsee': [47.7128, 11.7583],
  'garmisch': [47.5009, 11.0953],
  'zugspitze': [47.4211, 10.9856],
  'münchen': [48.1351, 11.5820],
  'munich': [48.1351, 11.5820],
  'füssen': [47.5697, 10.7005],
  'allgäu': [47.5500, 10.3200],
  'berchtesgaden': [47.6322, 13.0044],
  'bayern': [48.7904, 11.4979],
  'trier': [49.7490, 6.6371],
  'eifel': [50.1500, 6.7500],
  'südeifel': [49.9000, 6.4500],
  'bitburg': [49.9747, 6.5248],
  'wittlich': [49.9862, 6.8917],
  'mosel': [50.0500, 7.0000],
  'minden': [52.2887, 8.9168],
  'ralingen': [49.8167, 6.5333],
  'sirzenich': [49.7500, 6.6500],
  'default': [48.1351, 11.5820], // München as fallback
}

function getCoords(location: string): [number, number] {
  const lower = location.toLowerCase()
  for (const [key, coords] of Object.entries(KNOWN_COORDS)) {
    if (lower.includes(key)) return coords
  }
  return KNOWN_COORDS['default']
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/* ── Scoring & ranking ── */
interface ScoredListing {
  listing: Record<string, unknown>
  score: number
  distanceKm: number | null
  issues: string[]
  matched: boolean   // fully matches the active filters (no issues)
}

function rankListings(
  listings: Record<string, unknown>[],
  query: string | undefined,
  guestsFilter: number | undefined,
): ScoredListing[] {
  const searchCoords = query ? getCoords(query) : null
  const qLower = query?.toLowerCase() ?? ''

  return listings.map((listing) => {
    let score = 0
    const issues: string[] = []
    const loc = (listing.location as string || '').toLowerCase()
    const title = (listing.title as string || '').toLowerCase()
    const maxGuests = listing.max_guests as number
    const price = listing.price_per_night as number

    // Location match
    if (qLower) {
      if (loc.includes(qLower) || title.includes(qLower)) {
        score += 100 // exact match
      } else {
        // partial / fuzzy: check word overlap
        const words = qLower.split(/\s+/)
        const matchedWords = words.filter(w => loc.includes(w) || title.includes(w))
        score += matchedWords.length * 30
        if (matchedWords.length === 0) {
          issues.push('Anderer Ort')
        }
      }
    }

    // Distance
    let distanceKm: number | null = null
    if (searchCoords) {
      const listingCoords = getCoords(listing.location as string)
      distanceKm = Math.round(haversineKm(searchCoords[0], searchCoords[1], listingCoords[0], listingCoords[1]))
      // Closer = higher score (max +50 for 0km, 0 for 500km+)
      score += Math.max(0, 50 - distanceKm * 0.1)
    }

    // Guest match
    if (guestsFilter) {
      if (maxGuests >= guestsFilter) {
        score += 40
      } else {
        score += 10
        issues.push(`Max. ${maxGuests} Gäste`)
      }
    }

    // Price bonus (prefer listings with actual prices)
    if (price > 0) score += 20

    return { listing, score, distanceKm, issues, matched: issues.length === 0 }
  })
    // Grouped sort: fully-matching results first (by relevance), then the
    // rest ("close by") sorted by distance, so a filter click surfaces the
    // real matches on top instead of one flat score list.
    .sort((a, b) => {
      if (a.matched !== b.matched) return a.matched ? -1 : 1
      if (a.matched) return b.score - a.score
      if (a.distanceKm !== null && b.distanceKm !== null && a.distanceKm !== b.distanceKm)
        return a.distanceKm - b.distanceKm
      return b.score - a.score
    })
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; guests?: string; checkin?: string; checkout?: string; view?: string }>
}) {
  const { q, guests, checkin, checkout, view } = await searchParams
  const guestsNum = guests ? parseInt(guests) : undefined

  // Calculate nights for total price display
  let nights = 0
  if (checkin && checkout) {
    const d1 = new Date(checkin)
    const d2 = new Date(checkout)
    const diff = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24))
    if (diff > 0) nights = diff
  }

  const { data: allListings } = await supabaseAdmin.from('listings').select('*').eq('is_active', true).order('created_at', { ascending: false })
  const filtered = allListings ?? []

  const hasSearch = !!(q || guestsNum)
  // Map view can also be opened straight from the homepage (?view=map) without
  // any active filter — then we show all active listings on the map.
  const showResults = hasSearch || view === 'map'
  const ranked = hasSearch ? rankListings(filtered, q, guestsNum) : filtered.map(l => ({ listing: l, score: 0, distanceKm: null, issues: [] as string[], matched: true }))

  // Top location names for the quick-filter pills (shared by homepage + search view)
  const locationCounts: Record<string, number> = {}
  for (const l of filtered) {
    const loc = (l.location as string) || ''
    if (loc) locationCounts[loc] = (locationCounts[loc] || 0) + 1
  }
  const topLocations = Object.entries(locationCounts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([loc]) => loc)

  // Check Smoobu availability for all listings when dates are selected
  let availabilityMap: Record<string, { available: boolean; totalPrice: number }> = {}
  if (nights > 0) {
    // Each listing is priced with its own host's markup.
    const hostMarkup = await getHostMarkupMap(ranked.map(r => (r.listing as Record<string, unknown>).host_id as string))
    const checks = ranked.map(async ({ listing }) => {
      const l = listing as Record<string, unknown>
      const id = l.id as string
      const markup = hostMarkup[l.host_id as string] ?? 1
      const smoobuId = l.smoobu_id as string | number | null
      if (!smoobuId) {
        // No Smoobu — use static price, assume available
        const ppn = (l.price_per_night as number) || 0
        return { id, available: true, totalPrice: ppn * nights }
      }
      try {
        const result = await checkAvailability(smoobuId, checkin!, checkout!)
        return { id, available: result.available, totalPrice: Math.round(result.totalPrice * markup) }
      } catch {
        // On error, fall back to static price, assume available
        const ppn = (l.price_per_night as number) || 0
        return { id, available: true, totalPrice: ppn * nights }
      }
    })
    const results = await Promise.all(checks)
    for (const r of results) {
      availabilityMap[r.id] = { available: r.available, totalPrice: r.totalPrice }
    }
  }

  // Serialize all card data for the client component
  const cardData: CardData[] = ranked.map(({ listing, distanceKm, issues, matched }) => {
    const l = listing as Record<string, unknown>
    // Prefer the listing's own saved coordinates (set via the editor's map pin);
    // fall back to the coarse location-name lookup only when they're missing, so
    // markers sit on the real address instead of stacking on the town centroid.
    const latRaw = l.latitude != null ? Number(l.latitude) : null
    const lonRaw = l.longitude != null ? Number(l.longitude) : null
    const hasRealCoords = latRaw != null && lonRaw != null && (latRaw !== 0 || lonRaw !== 0)
    const coords: [number, number] = hasRealCoords ? [latRaw, lonRaw] : getCoords(l.location as string)
    const ppn = (l.price_per_night as number) || 0
    const id = l.id as string
    const avail = availabilityMap[id]
    const tp = avail ? avail.totalPrice : (nights > 0 && ppn > 0 ? ppn * nights : 0)
    const unavailable = avail ? !avail.available : false
    return {
      id,
      title: l.title as string,
      location: l.location as string,
      maxGuests: (l.max_guests as number) || 0,
      bedrooms: (l.bedrooms as number) || 0,
      pricePerNight: ppn,
      totalPrice: tp,
      nights,
      distanceKm,
      issues,
      matched,
      lat: coords[0],
      lon: coords[1],
      unavailable,
      image: (() => {
        const flat = (l.images as string[] | null) ?? []
        if (flat[0]) return flat[0]
        const rooms = (l.rooms as { images?: string[] }[] | null) ?? []
        for (const r of rooms) { if (r.images?.[0]) return r.images[0] }
        return undefined
      })(),
    }
  })

  // When dates are selected: unavailable always sink to the bottom, but keep
  // the matched-first grouping within the available set (ranked order already
  // encodes it, so only re-sort by availability here — stable within groups).
  if (nights > 0) {
    cardData.sort((a, b) => {
      if (a.unavailable !== b.unavailable) return a.unavailable ? 1 : -1
      return 0
    })
  }

  const centerCoords = q ? getCoords(q) : null

  const organizationJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'TRIMOSA',
    url: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trimosa-app.vercel.app',
    areaServed: {
      '@type': 'Place',
      name: 'Sirzenich, Trier, Bitburg, Sauertal, Südeifel',
    },
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#ECEEF4' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
      <NavBar initialQ={q} initialGuests={guests} initialCheckin={checkin} initialCheckout={checkout} />

      {showResults ? (
        /* ── Full-viewport split: listings + map ── */
        <SearchResults
          cards={cardData}
          centerLat={centerCoords?.[0]}
          centerLon={centerCoords?.[1]}
          searchQuery={q}
          searchGuests={guestsNum}
          searchCheckin={checkin}
          searchCheckout={checkout}
          locations={topLocations}
        />
      ) : (
        <>
          {/* ── Filter Bar (homepage) ── */}
          <section className="filter-section" style={{ backgroundColor: '#fff', borderBottom: '1px solid #E4E2EC', padding: '12px 20px 11px' }}>
            <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
              <p className="filter-label">
                Beliebte Filter
              </p>
              <QuickFilters locations={topLocations} activeQ={q} activeGuests={guests} checkin={checkin} checkout={checkout} />
            </div>
          </section>

          {/* ── Homepage Listings Grid ── */}
          <section style={{ maxWidth: '1440px', margin: '0 auto', padding: 'clamp(14px, 3vw, 24px) clamp(12px, 4vw, 20px) 80px' }}>
            <h1 style={{ fontSize: 'clamp(15px, 2vw, 22px)', fontWeight: 700, color: '#111', letterSpacing: '-0.3px', margin: '0 0 14px', lineHeight: 1.25 }}>
              Finde dein <span style={{ background: 'linear-gradient(135deg, var(--gold), var(--gold))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Premium-Apartment</span> für die perfekte Auszeit.
            </h1>
            <div className="homepage-grid">
              {cardData.map((card, index) => {
                const g = CARD_GRADIENTS[index % CARD_GRADIENTS.length]
                return (
                  <Link key={card.id} href={`/listing/${card.id}`} className="listing-card" target="_blank"
                    style={{ display: 'block', textDecoration: 'none', borderRadius: '14px', overflow: 'hidden', backgroundColor: '#fff', border: '1px solid #EAE7E0' }}>
                    <div className="card-image-wrap" style={{ position: 'relative', aspectRatio: '4/3', background: `linear-gradient(160deg, ${g.from} 0%, ${g.to} 100%)`, overflow: 'hidden' }}>
                      {card.image
                        ? <Image src={card.image} alt={card.title} fill sizes="(max-width: 768px) 50vw, 25vw" style={{ objectFit: 'cover', ...(card.unavailable ? { filter: 'grayscale(60%) opacity(0.7)' } : {}) }} />
                        : <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle at 25% 25%, rgba(255,255,255,0.22) 0%, transparent 55%)' }} />
                      }
                      {card.unavailable && (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
                          <span style={{ fontSize: '11px', fontWeight: 700, padding: '5px 12px', borderRadius: '999px', backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff', backdropFilter: 'blur(4px)' }}>
                            Nicht verfügbar
                          </span>
                        </div>
                      )}
                      <div style={{ position: 'absolute', top: '10px', left: '10px' }}>
                        <span style={{ fontSize: '10px', fontWeight: 600, padding: '3px 8px', borderRadius: '999px', backgroundColor: 'rgba(255,255,255,0.92)', color: '#333' }}>{card.location}</span>
                      </div>
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '50%', background: `linear-gradient(to top, ${g.accent}55 0%, transparent 100%)` }} />
                    </div>
                    <div className="card-info" style={{ padding: '11px 13px 13px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
                        <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#111', margin: 0, lineHeight: 1.3, flex: 1 }}>{card.title}</h3>
                        {(card.pricePerNight > 0 || card.totalPrice > 0) && (
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <span style={{ fontSize: '14px', fontWeight: 700, color: '#111' }}>
                              €{card.totalPrice > 0 ? card.totalPrice : card.pricePerNight}
                            </span>
                            <span style={{ fontSize: '10px', color: '#999', display: 'block', lineHeight: 1 }}>
                              {card.totalPrice > 0 ? `${card.nights} Nächte` : '/Nacht'}
                            </span>
                          </div>
                        )}
                      </div>
                      <p style={{ fontSize: '11px', color: '#999', margin: '5px 0 0', lineHeight: 1 }}>{card.maxGuests} Gäste · {card.bedrooms} Schlafzimmer</p>
                    </div>
                  </Link>
                )
              })}
            </div>
          </section>

          {/* Floating map-view toggle — booking-site style, bottom center */}
          <Link href="/?view=map" aria-label="Karte anzeigen" style={{
            position: 'fixed', bottom: '26px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 50, display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '12px 22px', borderRadius: '999px',
            background: '#12222E', color: '#fff', fontSize: '14px', fontWeight: 700,
            textDecoration: 'none', boxShadow: '0 8px 28px rgba(18,34,46,0.38)',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
              <line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" />
            </svg>
            Karte anzeigen
          </Link>
        </>
      )}

      {/* ── How it works ── */}
      <section style={{ backgroundColor: '#fff', borderTop: '1px solid #EEEBE4', padding: '56px 20px' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#111', textAlign: 'center', marginBottom: '32px', letterSpacing: '-0.3px' }}>
            So einfach geht&apos;s
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
            {[
              { n: '01', title: 'Entdecken', desc: 'Stöbere durch handverlesene Premium-Apartments in den schönsten Regionen.', accent: '#0C9AAB' },
              { n: '02', title: 'Buchen', desc: 'Sichere dir dein Wunschdatum — direkt, ohne Umwege.', accent: 'var(--gold)' },
              { n: '03', title: 'Ankommen', desc: 'Schlüssel rein, Koffer ab — und einfach da sein. Kein Schnickschnack, kein Stress.', accent: '#4A8A60' },
            ].map((item) => (
              <div key={item.n} style={{ padding: '24px', borderRadius: '16px', border: '1px solid #EEEBE4', backgroundColor: '#FAFAF8' }}>
                <div style={{ fontSize: '11px', fontWeight: 800, color: item.accent, letterSpacing: '0.1em', marginBottom: '12px' }}>
                  {item.n}
                </div>
                <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#111', margin: '0 0 8px' }}>{item.title}</h3>
                <p style={{ fontSize: '13px', color: '#777', lineHeight: 1.6, margin: 0 }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Direkt bei TRIMOSA (Über uns · Vorteile · Regionen · Kontakt) ── */}
      <section style={{ padding: '48px 20px' }}>
        <div style={{
          maxWidth: '900px', margin: '0 auto', borderRadius: '20px', overflow: 'hidden',
          background: 'linear-gradient(135deg, #12222E 0%, #172A22 100%)',
          padding: 'clamp(34px, 6vw, 52px) clamp(22px, 5vw, 48px)',
        }}>
          <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.12em', margin: '0 0 12px', textAlign: 'center' }}>DIREKT BEI TRIMOSA</p>
          <h2 style={{ fontSize: 'clamp(22px, 4vw, 32px)', fontWeight: 700, color: '#F5F0E8', letterSpacing: '-0.5px', margin: '0 0 14px', textAlign: 'center' }}>
            Ohne Umwege gebucht. Persönlich betreut.
          </h2>
          <p style={{ fontSize: '14px', color: 'rgba(245,240,232,0.6)', lineHeight: 1.65, maxWidth: '560px', margin: '0 auto 32px', textAlign: 'center' }}>
            Rund 20 eigene Ferienwohnungen in Sirzenich, Trier, Bitburg und der Südeifel –
            handverlesen und persönlich betreut von Johannes, Pascal und Dominik.
          </p>

          {/* Vorteile: direkt buchen */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '14px', marginBottom: '30px' }}>
            {[
              { icon: '💶', title: 'Fairer Direktpreis', desc: 'Keine Portalgebühren wie bei Airbnb & Co.' },
              { icon: '💬', title: 'Persönlicher Kontakt', desc: 'Direkter Draht statt Callcenter.' },
              { icon: '📍', title: 'Lokale Gastgeber', desc: 'Vor Ort in der Region Trier / Eifel.' },
            ].map((b) => (
              <div key={b.title} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '14px', padding: '18px 16px', textAlign: 'center', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ fontSize: '22px', marginBottom: '8px' }}>{b.icon}</div>
                <p style={{ fontSize: '13px', fontWeight: 700, color: '#F5F0E8', margin: '0 0 4px' }}>{b.title}</p>
                <p style={{ fontSize: '12px', color: 'rgba(245,240,232,0.5)', margin: 0, lineHeight: 1.45 }}>{b.desc}</p>
              </div>
            ))}
          </div>

          {/* Regionen */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '9px', marginBottom: '28px' }}>
            <span style={{ fontSize: '12px', color: 'rgba(245,240,232,0.45)', fontWeight: 600 }}>Regionen:</span>
            {['Trier', 'Bitburg', 'Südeifel'].map((r) => (
              <Link key={r} href={`/?q=${encodeURIComponent(r)}`} style={{
                fontSize: '12.5px', fontWeight: 600, color: '#F5F0E8', textDecoration: 'none',
                padding: '6px 14px', borderRadius: '999px', border: '1px solid rgba(174,141,45,0.5)',
                background: 'rgba(174,141,45,0.14)',
              }}>{r}</Link>
            ))}
          </div>

          {/* CTAs */}
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '12px' }}>
            <Link href="/?view=map" style={{
              display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '13px', fontWeight: 700,
              padding: '12px 26px', borderRadius: '999px', color: '#1A1400',
              background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))', textDecoration: 'none',
            }}>Alle Unterkünfte ansehen →</Link>
            <a href="mailto:mail@trimosa.de" style={{
              display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '13px', fontWeight: 600,
              padding: '12px 24px', borderRadius: '999px', color: '#F5F0E8', textDecoration: 'none',
              border: '1px solid rgba(245,240,232,0.25)',
            }}>Kontakt aufnehmen</a>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ borderTop: '1px solid #EEEBE4', padding: '24px 20px' }}>
        <div style={{ maxWidth: '1280px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <span style={{ fontSize: '11px', color: '#AAA6A0' }}>© 2026 TRIMOSA Apartments &amp; Homes</span>
          <div style={{ display: 'flex', gap: '20px' }}>
            {[
              { label: 'Impressum', href: '/impressum' },
              { label: 'Datenschutz', href: '/datenschutz' },
              { label: 'AGB', href: '/agb' },
            ].map((item) => (
              <Link key={item.href} href={item.href} style={{ fontSize: '11px', color: '#AAA6A0', textDecoration: 'none' }}>{item.label}</Link>
            ))}
          </div>
        </div>
      </footer>
    </div>
  )
}
