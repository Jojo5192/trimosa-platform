import { supabaseAdmin } from '@/lib/supabase-admin'
import Link from 'next/link'
import Image from 'next/image'
import NavBar from '@/components/NavBar'
import SearchResults, { type CardData } from '@/components/SearchResults'
import { checkAvailability } from '@/lib/smoobu'
import { getMarkupMultiplier } from '@/lib/pricing'

/* ── Refined, muted card gradients ── */
const CARD_GRADIENTS = [
  { from: '#D6EAE8', to: '#4A8F96', accent: '#2E7A82' },   // still teal
  { from: '#DCEADC', to: '#567A5C', accent: '#3E6344' },   // sage
  { from: '#EDE5D0', to: '#A8882A', accent: '#8A6E1A' },   // warm gold
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

    return { listing, score, distanceKm, issues }
  })
    .sort((a, b) => b.score - a.score)
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; guests?: string; checkin?: string; checkout?: string }>
}) {
  const { q, guests, checkin, checkout } = await searchParams
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
  const ranked = hasSearch ? rankListings(filtered, q, guestsNum) : filtered.map(l => ({ listing: l, score: 0, distanceKm: null, issues: [] }))

  // Check Smoobu availability for all listings when dates are selected
  let availabilityMap: Record<string, { available: boolean; totalPrice: number }> = {}
  if (nights > 0) {
    const markup = await getMarkupMultiplier()
    const checks = ranked.map(async ({ listing }) => {
      const l = listing as Record<string, unknown>
      const id = l.id as string
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
  const cardData: CardData[] = ranked.map(({ listing, distanceKm, issues }) => {
    const l = listing as Record<string, unknown>
    const coords = getCoords(l.location as string)
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

  // When dates are selected: sort available first, then by distance; unavailable go last
  if (nights > 0) {
    cardData.sort((a, b) => {
      if (a.unavailable !== b.unavailable) return a.unavailable ? 1 : -1
      // Within same group: sort by distance if available, else keep original order
      if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm
      if (a.distanceKm !== null) return -1
      if (b.distanceKm !== null) return 1
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

      {hasSearch ? (
        /* ── Full-viewport split: listings + map ── */
        <SearchResults
          cards={cardData}
          centerLat={centerCoords?.[0]}
          centerLon={centerCoords?.[1]}
          searchQuery={q}
          searchGuests={guestsNum}
          searchCheckin={checkin}
          searchCheckout={checkout}
        />
      ) : (
        <>
          {/* ── Filter Bar (homepage only) ── */}
          <section className="filter-section" style={{ backgroundColor: '#fff', borderBottom: '1px solid #E4E2EC', padding: '12px 20px 11px' }}>
            <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
              <p className="filter-label">
                Beliebte Filter
              </p>
              <div className="filter-container" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                <div className="filter-scroll">
                  {[
                    { label: 'Alle', q: '' },
                    ...(() => {
                      // Build dynamic location filters from actual listings
                      const locationCounts: Record<string, number> = {}
                      for (const l of filtered) {
                        const loc = (l.location as string) || ''
                        if (loc) {
                          locationCounts[loc] = (locationCounts[loc] || 0) + 1
                        }
                      }
                      return Object.entries(locationCounts)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 6)
                        .map(([loc]) => ({ label: loc, q: loc }))
                    })(),
                  ].map((f) => {
                    const isActive = f.q === '' ? !q : q === f.q
                    const href = f.q ? `/?q=${encodeURIComponent(f.q)}` : '/'
                    return (
                      <Link key={f.label} href={href} style={{
                        padding: '5px 13px', borderRadius: '999px', fontSize: '12px', fontWeight: 500,
                        textDecoration: 'none', whiteSpace: 'nowrap',
                        ...(isActive ? { backgroundColor: '#A8882A', color: '#fff' } : { backgroundColor: '#F5F3EF', color: '#444', border: '1px solid #E4E0D8' }),
                      }}>{f.label}</Link>
                    )
                  })}
                </div>
                <div className="filter-scroll">
                  {[
                    { label: 'Alle', g: '' },
                    { label: '2 Pers.', g: '2' },
                    { label: '4 Pers.', g: '4' },
                    { label: '6 Pers.', g: '6' },
                    { label: '8 Pers.', g: '8' },
                  ].map((f) => {
                    const isActive = guests === f.g || (f.g === '' && !guests)
                    const href = f.g ? `/?guests=${f.g}` : '/'
                    return (
                      <Link key={f.label} href={href} style={{
                        padding: '5px 13px', borderRadius: '999px', fontSize: '12px', fontWeight: 500,
                        textDecoration: 'none', whiteSpace: 'nowrap',
                        ...(isActive ? { backgroundColor: '#A8882A', color: '#fff' } : { backgroundColor: '#F5F3EF', color: '#444', border: '1px solid #E4E0D8' }),
                      }}>{f.label}</Link>
                    )
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* ── Homepage Listings Grid ── */}
          <section style={{ maxWidth: '1440px', margin: '0 auto', padding: 'clamp(14px, 3vw, 24px) clamp(12px, 4vw, 20px) 80px' }}>
            <h1 style={{ fontSize: 'clamp(15px, 2vw, 22px)', fontWeight: 700, color: '#111', letterSpacing: '-0.3px', margin: '0 0 14px', lineHeight: 1.25 }}>
              Finde dein <span style={{ background: 'linear-gradient(135deg, #A8882A, #C4A235)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Premium-Apartment</span> für die perfekte Auszeit.
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
              { n: '02', title: 'Buchen', desc: 'Sichere dir dein Wunschdatum — direkt, ohne Umwege.', accent: '#A8882A' },
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

      {/* ── Host CTA ── */}
      <section style={{ padding: '48px 20px' }}>
        <div style={{
          maxWidth: '900px', margin: '0 auto', borderRadius: '20px', overflow: 'hidden',
          background: 'linear-gradient(135deg, #1A1814 0%, #2C2820 100%)',
          padding: '52px 40px', textAlign: 'center',
        }}>
          <p style={{ fontSize: '11px', fontWeight: 700, color: '#A8882A', letterSpacing: '0.12em', marginBottom: '12px' }}>FÜR GASTGEBER</p>
          <h2 style={{ fontSize: 'clamp(22px, 4vw, 32px)', fontWeight: 700, color: '#F5F0E8', letterSpacing: '-0.5px', margin: '0 0 12px' }}>
            Deine Unterkunft. Direkt gebucht.
          </h2>
          <p style={{ fontSize: '14px', color: 'rgba(245,240,232,0.45)', marginBottom: '28px', maxWidth: '400px', margin: '0 auto 28px', lineHeight: 1.6 }}>
            Günstiger als die Konkurrenz. Direkte Buchungen. Smoobu-Integration.
          </p>
          <Link href="/register" style={{
            display: 'inline-block', fontSize: '13px', fontWeight: 600,
            padding: '12px 28px', borderRadius: '999px', color: '#1A1814',
            background: 'linear-gradient(135deg, #C4A235, #A8882A)',
            textDecoration: 'none', letterSpacing: '0.01em',
          }}>
            Jetzt kostenlos starten →
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ borderTop: '1px solid #EEEBE4', padding: '24px 20px' }}>
        <div style={{ maxWidth: '1280px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <span style={{ fontSize: '11px', color: '#AAA6A0' }}>© 2026 TRIMOSA Apartments &amp; Homes</span>
          <div style={{ display: 'flex', gap: '20px' }}>
            {['Impressum', 'Datenschutz', 'AGB'].map((item) => (
              <a key={item} href="#" style={{ fontSize: '11px', color: '#AAA6A0', textDecoration: 'none' }}>{item}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  )
}
