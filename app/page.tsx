import { supabaseAdmin } from '@/lib/supabase-admin'
import Link from 'next/link'
import Image from 'next/image'
import NavBar from '@/components/NavBar'
import SearchResults, { type CardData } from '@/components/SearchResults'
import { t, type UiLang } from '@/lib/i18n'
import { getUiLang } from '@/lib/i18n-server'
import { makeTr } from '@/lib/static-translate'
import QuickFilters from '@/components/QuickFilters'
import ScoreBadge from '@/components/ScoreBadge'
import { checkAvailability, findFlexibleStay } from '@/lib/smoobu'
import { getHostMarkupMap } from '@/lib/pricing'
import { buildCardRating } from '@/lib/rating'
import { REGIONS } from '@/lib/regions'

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
  'minden': [49.8456, 6.4776], // Minden an der Sauer (Südeifel)
  'ralingen': [49.8167, 6.5333],
  'sirzenich': [49.7500, 6.6500],
  'kanzem': [49.6608, 6.5836],
  'saarburg': [49.6067, 6.5439], // before 'saar' — substring match
  'konz': [49.7005, 6.5793],
  'saar': [49.6400, 6.5600],
  'default': [48.1351, 11.5820], // München as fallback
}

function getCoords(location: string): [number, number] {
  const lower = location.toLowerCase()
  for (const [key, coords] of Object.entries(KNOWN_COORDS)) {
    if (lower.includes(key)) return coords
  }
  return KNOWN_COORDS['default']
}

function formatShortRange(ci: string, co: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  const a = new Date(ci + 'T00:00:00').toLocaleDateString('de-DE', opts)
  const b = new Date(co + 'T00:00:00').toLocaleDateString('de-DE', opts)
  return `${a} – ${b}`
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
  lang: UiLang = 'de',
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
          issues.push(t(lang, 'Anderer Ort'))
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
        issues.push(`Max. ${maxGuests} ${t(lang, 'Gäste')}`)
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
  searchParams: Promise<{ q?: string; guests?: string; checkin?: string; checkout?: string; view?: string; flex?: string }>
}) {
  const { q, guests, checkin, checkout, view, flex } = await searchParams
  const lang = await getUiLang()
  const T = await makeTr(lang, lang === 'de' ? [] : Object.values(REGIONS).map((r) => r.claim))
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

  // A search is active with a location, a guest count, OR just dates — a
  // date-only search should open the results + map view too.
  const hasSearch = !!(q || guestsNum || (checkin && checkout))
  // Map view can also be opened straight from the homepage (?view=map) without
  // any active filter — then we show all active listings on the map.
  const showResults = hasSearch || view === 'map'
  const ranked = hasSearch ? rankListings(filtered, q, guestsNum, lang) : filtered.map(l => ({ listing: l, score: 0, distanceKm: null, issues: [] as string[], matched: true }))

  // Top location names for the quick-filter pills (shared by homepage + search view)
  const locationCounts: Record<string, number> = {}
  for (const l of filtered) {
    const loc = (l.location as string) || ''
    if (loc) locationCounts[loc] = (locationCounts[loc] || 0) + 1
  }
  const topLocations = Object.entries(locationCounts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([loc]) => loc)

  // Check Smoobu availability for all listings when dates are selected.
  // Flexible dates (?flex=3) look for the nearest free window of the same
  // length instead of only the exact range.
  const flexDays = flex ? (parseInt(flex) || 3) : 0
  type Avail = { available: boolean; totalPrice: number; flexCheckin?: string; flexCheckout?: string }
  let availabilityMap: Record<string, Avail> = {}
  if (nights > 0) {
    // Each listing is priced with its own host's markup.
    const hostMarkup = await getHostMarkupMap(ranked.map(r => (r.listing as Record<string, unknown>).host_id as string))
    const checks = ranked.map(async ({ listing }): Promise<{ id: string } & Avail> => {
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
        if (flexDays > 0) {
          const found = await findFlexibleStay(smoobuId, checkin!, checkout!, flexDays)
          if (!found) return { id, available: false, totalPrice: 0 }
          return {
            id, available: true, totalPrice: Math.round(found.totalPrice * markup),
            ...(found.shifted ? { flexCheckin: found.checkIn, flexCheckout: found.checkOut } : {}),
          }
        }
        const result = await checkAvailability(smoobuId, checkin!, checkout!)
        if (result.available) return { id, available: true, totalPrice: Math.round(result.totalPrice * markup) }
        // Not free for the exact dates → still suggest the nearest alternative
        // window as a hint (point i), while keeping it marked unavailable.
        const alt = await findFlexibleStay(smoobuId, checkin!, checkout!, 3)
        if (alt && alt.shifted) return { id, available: false, totalPrice: 0, flexCheckin: alt.checkIn, flexCheckout: alt.checkOut }
        return { id, available: false, totalPrice: 0 }
      } catch {
        // On error, fall back to static price, assume available
        const ppn = (l.price_per_night as number) || 0
        return { id, available: true, totalPrice: ppn * nights }
      }
    })
    const results = await Promise.all(checks)
    for (const r of results) {
      availabilityMap[r.id] = { available: r.available, totalPrice: r.totalPrice, flexCheckin: r.flexCheckin, flexCheckout: r.flexCheckout }
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
    // When flexible dates found a nearby (shifted) window, note it for display.
    const flexNote = avail?.flexCheckin && avail?.flexCheckout
      ? formatShortRange(avail.flexCheckin, avail.flexCheckout)
      : undefined
    return {
      id,
      slug: (l.slug as string | null) ?? undefined,
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
      flexNote,
      rating: buildCardRating(l),
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
      name: 'Sirzenich, Trier, Bitburg, Sauertal, Südeifel, Kanzem, Saartal',
    },
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#ECEEF4' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
      <NavBar initialQ={q} initialGuests={guests} initialCheckin={checkin} initialCheckout={checkout} initialFlex={!!flex} lang={lang} />

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
          openMapByDefault={view === 'map'}
          lang={lang}
        />
      ) : (
        <>
          {/* ── Filter Bar (homepage) ── */}
          <section className="filter-section" style={{ backgroundColor: '#fff', borderBottom: '1px solid #E4E2EC', padding: '12px 20px 11px' }}>
            <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
              <p className="filter-label">
                {t(lang, 'Beliebte Filter')}
              </p>
              <QuickFilters locations={topLocations} activeQ={q} activeGuests={guests} checkin={checkin} checkout={checkout} lang={lang} />
            </div>
          </section>

          {/* ── Homepage Listings Grid ── */}
          <section style={{ maxWidth: '1440px', margin: '0 auto', padding: 'clamp(14px, 3vw, 24px) clamp(12px, 4vw, 20px) 80px' }}>
            <h1 style={{ fontSize: 'clamp(15px, 2vw, 22px)', fontWeight: 700, color: '#111', letterSpacing: '-0.3px', margin: '0 0 14px', lineHeight: 1.25 }}>
              {t(lang, 'Finde dein')} <span style={{ background: 'linear-gradient(135deg, var(--gold), var(--gold))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>{t(lang, 'Premium-Apartment')}</span> {t(lang, 'für die perfekte Auszeit.')}
            </h1>
            <div className="homepage-grid">
              {cardData.map((card, index) => {
                const g = CARD_GRADIENTS[index % CARD_GRADIENTS.length]
                return (
                  <Link key={card.id} href={`/listing/${card.slug ?? card.id}`} className="listing-card" target="_blank"
                    style={{ display: 'block', textDecoration: 'none', borderRadius: '14px', backgroundColor: '#fff', border: '1px solid #EAE7E0' }}>
                    <div className="card-image-wrap" style={{ position: 'relative', aspectRatio: '4/3', background: `linear-gradient(160deg, ${g.from} 0%, ${g.to} 100%)`, overflow: 'hidden', borderRadius: '13px 13px 0 0' }}>
                      {card.image
                        ? <Image src={card.image} alt={card.title} fill sizes="(max-width: 768px) 50vw, 25vw" style={{ objectFit: 'cover', ...(card.unavailable ? { filter: 'grayscale(60%) opacity(0.7)' } : {}) }} />
                        : <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle at 25% 25%, rgba(255,255,255,0.22) 0%, transparent 55%)' }} />
                      }
                      {card.unavailable && (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
                          <span style={{ fontSize: '11px', fontWeight: 700, padding: '5px 12px', borderRadius: '999px', backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff', backdropFilter: 'blur(4px)' }}>
                            {t(lang, 'Nicht verfügbar')}
                          </span>
                        </div>
                      )}
                      <div style={{ position: 'absolute', top: '10px', left: '10px' }}>
                        <span style={{ fontSize: '10px', fontWeight: 600, padding: '3px 8px', borderRadius: '999px', backgroundColor: 'rgba(255,255,255,0.92)', color: '#333' }}>{card.location}</span>
                      </div>
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '50%', background: `linear-gradient(to top, ${g.accent}55 0%, transparent 100%)` }} />
                    </div>
                    {/* Score chip straddling the photo edge */}
                    {card.rating && (
                      <div style={{ display: 'flex', padding: '0 12px', marginTop: '-14px', position: 'relative', zIndex: 2 }}>
                        <ScoreBadge rating={card.rating} />
                      </div>
                    )}
                    <div className="card-info" style={{ padding: card.rating ? '7px 13px 13px' : '11px 13px 13px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
                        <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#111', margin: 0, lineHeight: 1.3, flex: 1 }}>{card.title}</h3>
                        {(card.pricePerNight > 0 || card.totalPrice > 0) && (
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <span style={{ fontSize: '14px', fontWeight: 700, color: '#111' }}>
                              €{card.totalPrice > 0 ? card.totalPrice : card.pricePerNight}
                            </span>
                            <span style={{ fontSize: '10px', color: '#999', display: 'block', lineHeight: 1 }}>
                              {card.totalPrice > 0 ? `${card.nights} ${t(lang, 'Nächte')}` : t(lang, '/Nacht')}
                            </span>
                          </div>
                        )}
                      </div>
                      <p style={{ fontSize: '11px', color: '#999', margin: '5px 0 0', lineHeight: 1 }}>
                        {card.maxGuests} {t(lang, 'Gäste')} · {card.bedrooms} {t(lang, 'Schlafzimmer')}
                      </p>
                    </div>
                  </Link>
                )
              })}
            </div>
          </section>

          {/* ── Regions discovery (below the apartments — they stay the star) ── */}
          <section style={{ maxWidth: '1440px', margin: '0 auto', padding: '0 clamp(12px, 4vw, 20px) 56px' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gold-dark)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 6px' }}>
              {t(lang, 'Mehr als eine Unterkunft')}
            </p>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 'clamp(17px, 2.4vw, 24px)', fontWeight: 800, color: '#111', letterSpacing: '-0.4px', margin: 0 }}>
                {t(lang, 'Entdecke unsere Regionen')}
              </h2>
              <span style={{ fontSize: '12.5px', color: '#8A8578' }}>
                {t(lang, 'Ausflugsziele, Karten & Tipps —')}{' '}
                <Link href="/ueber-uns" style={{ color: 'var(--gold-dark)', fontWeight: 600 }}>{t(lang, 'über TRIMOSA →')}</Link>
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(46vw, 250px), 1fr))', gap: '14px' }}>
              {Object.values(REGIONS).map((r) => {
                const hasListings = (allListings ?? [])
                  .some((l) => ((l.location as string) || '').toLowerCase().includes(r.locationMatch.toLowerCase()))
                // Signature photo of the region (first curated hero POI) —
                // deliberately NOT an apartment shot; those live in the grid above
                const img = (r.heroSlugs
                  .map((s) => r.pois.find((p) => p.slug === s)?.image?.src)
                  .find((s): s is string => !!s))
                  ?? r.pois.find((p) => p.image)?.image?.src
                return (
                  <Link key={r.slug} href={`/region/${r.slug}`} className="listing-card" style={{
                    position: 'relative', display: 'block', textDecoration: 'none',
                    borderRadius: '16px', overflow: 'hidden', aspectRatio: '16/10',
                    background: 'linear-gradient(135deg, #12222E, #1E3A4C)',
                  }}>
                    {img && <Image src={img} alt={r.name} fill sizes="(max-width: 768px) 50vw, 350px" style={{ objectFit: 'cover' }} />}
                    <div style={{ position: 'absolute', inset: '35% 0 0 0', background: 'linear-gradient(to top, rgba(8,14,20,0.82), transparent)' }} />
                    {r.comingSoon && !hasListings && (
                      <span style={{ position: 'absolute', top: '10px', right: '10px', fontSize: '9.5px', fontWeight: 800, letterSpacing: '0.07em', color: '#1A1400', background: 'linear-gradient(135deg, var(--gold), #E3C878)', padding: '3.5px 9px', borderRadius: '999px', textTransform: 'uppercase', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>{t(lang, 'Bald')}</span>
                    )}
                    <div style={{ position: 'absolute', left: '14px', right: '14px', bottom: '12px' }}>
                      <p style={{ fontSize: '15.5px', fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '-0.2px', textShadow: '0 1px 6px rgba(0,0,0,0.4)' }}>
                        {r.emoji} {r.name}
                      </p>
                      <p style={{ fontSize: '11.5px', color: 'rgba(255,255,255,0.82)', margin: '3px 0 0', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>
                        {T(r.claim)}
                      </p>
                    </div>
                  </Link>
                )
              })}
            </div>
          </section>

          {/* Floating map-view toggle — booking-site style, bottom center */}
          <Link href="/?view=map" aria-label={t(lang, 'Karte anzeigen')} style={{
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
            {t(lang, 'Karte anzeigen')}
          </Link>
        </>
      )}

      {/* ── How it works ── */}
      <section style={{ backgroundColor: '#fff', borderTop: '1px solid #EEEBE4', padding: '56px 20px' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#111', textAlign: 'center', marginBottom: '32px', letterSpacing: '-0.3px' }}>
            {t(lang, 'So einfach geht’s')}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
            {[
              { n: '01', title: t(lang, 'Entdecken'), desc: t(lang, 'Stöbere durch handverlesene Premium-Apartments in den schönsten Regionen.'), accent: '#0C9AAB' },
              { n: '02', title: t(lang, 'Buchen'), desc: t(lang, 'Sichere dir dein Wunschdatum — direkt, ohne Umwege.'), accent: 'var(--gold)' },
              { n: '03', title: t(lang, 'Ankommen'), desc: t(lang, 'Schlüssel rein, Koffer ab — und einfach da sein. Kein Schnickschnack, kein Stress.'), accent: '#4A8A60' },
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
          <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.12em', margin: '0 0 12px', textAlign: 'center' }}>{t(lang, 'DIREKT BEI TRIMOSA')}</p>
          <h2 style={{ fontSize: 'clamp(22px, 4vw, 32px)', fontWeight: 700, color: '#F5F0E8', letterSpacing: '-0.5px', margin: '0 0 14px', textAlign: 'center' }}>
            {t(lang, 'Ohne Umwege. Direkt gebucht.')}
          </h2>
          <p style={{ fontSize: '14px', color: 'rgba(245,240,232,0.6)', lineHeight: 1.65, maxWidth: '560px', margin: '0 auto 18px', textAlign: 'center' }}>
            {t(lang, 'Rund 20 eigene Ferienwohnungen in Trier, Bitburg, der Südeifel — und bald an der Saar.')}{' '}
            {t(lang, 'Handverlesen und kuratiert von Johannes, Pascal und Dominik.')}
          </p>

          {/* Name story one-liner */}
          <p style={{ fontSize: '13px', color: 'rgba(245,240,232,0.75)', margin: '0 auto 30px', textAlign: 'center', maxWidth: '520px', lineHeight: 1.6 }}>
            <span style={{
              fontWeight: 800, letterSpacing: '0.04em',
              background: 'linear-gradient(135deg, var(--gold), #E3C878)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
            }}>TRI·MO·SA</span>
            {' '}{t(lang, '— unser Name ist unsere Heimat:')} <strong style={{ color: '#F5F0E8' }}>Tri</strong>er,{' '}
            <strong style={{ color: '#F5F0E8' }}>Mo</strong>sel, <strong style={{ color: '#F5F0E8' }}>Sa</strong>uer &amp; Saar.
          </p>

          {/* CTA */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <Link href="/?view=map" style={{
              display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '13px', fontWeight: 700,
              padding: '12px 26px', borderRadius: '999px', color: '#1A1400',
              background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))', textDecoration: 'none',
            }}>{t(lang, 'Alle Unterkünfte ansehen →')}</Link>
            <Link href="/ueber-uns" style={{
              display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '13px', fontWeight: 700,
              padding: '11px 24px', borderRadius: '999px', color: '#F5F0E8',
              border: '1.5px solid rgba(245,240,232,0.45)', textDecoration: 'none',
            }}>{t(lang, 'Lerne uns kennen →')}</Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ borderTop: '1px solid #EEEBE4', padding: '24px 20px' }}>
        <div style={{ maxWidth: '1280px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <span style={{ fontSize: '11px', color: '#AAA6A0' }}>© 2026 TRIMOSA Apartments &amp; Homes</span>
          <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap' }}>
            {[
              { label: t(lang, 'Über uns'), href: '/ueber-uns' },
              { label: 'Trier', href: '/region/trier' },
              { label: 'Bitburg', href: '/region/bitburg' },
              { label: 'Südeifel', href: '/region/suedeifel' },
              { label: 'Saartal', href: '/region/saar' },
              { label: t(lang, 'Impressum'), href: '/impressum' },
              { label: t(lang, 'Datenschutz'), href: '/datenschutz' },
              { label: t(lang, 'AGB'), href: '/agb' },
            ].map((item) => (
              <Link key={item.href} href={item.href} style={{ fontSize: '11px', color: '#AAA6A0', textDecoration: 'none' }}>{item.label}</Link>
            ))}
          </div>
        </div>
      </footer>
    </div>
  )
}
