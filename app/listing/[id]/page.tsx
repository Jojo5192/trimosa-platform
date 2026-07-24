import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase-admin'
import NavBar from '@/components/NavBar'
import BookingBox from './BookingBox'
import PhotoGrid from './PhotoGrid'
import {
  HostBadge,
  AmenitiesSection,
  FloorPlanSection,
  OccupancyCalendar,
  ReviewsSection,
  HouseRulesDisplay,
} from './DetailSections'
import MobileBookingBar from './MobileBookingBar'
import ScoreBadge from '@/components/ScoreBadge'
import RegionMap from '@/components/RegionMap'
import Link from 'next/link'
import Image from 'next/image'
import { buildCardRating } from '@/lib/rating'
import { getInitialReviews } from '@/lib/reviews-data'
import { REGIONS } from '@/lib/regions'
import { TRANSLATION_LANGS, type TranslationEntry } from '@/lib/listing-translate'
import { t, isUiLang, type UiLang } from '@/lib/i18n'
import { getUiLang } from '@/lib/i18n-server'
import { makeTr } from '@/lib/static-translate'
import { getHostTeam } from '@/lib/hosts'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trimosa-app.vercel.app'

// The [id] param accepts both the speaking slug (canonical) and the legacy
// UUID (old links / internal references) — UUIDs 301-redirect to the slug.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function listingLookup(param: string): { column: 'id' | 'slug'; value: string } {
  return UUID_RE.test(param) ? { column: 'id', value: param } : { column: 'slug', value: param }
}

const FEWO_WORD: Record<string, string> = {
  de: 'Ferienwohnung in',
  en: 'Holiday apartment in',
  fr: 'Appartement de vacances à',
  nl: 'Vakantieappartement in',
}

export async function generateMetadata({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ lang?: string }> }): Promise<Metadata> {
  const { id } = await params
  const { lang: langParam } = await searchParams
  const lookup = listingLookup(id)
  const { data: listing } = await supabaseAdmin
    .from('listings')
    .select('title, description, location, city, images, is_active, slug, id, translations')
    .eq(lookup.column, lookup.value)
    .single()

  if (!listing || listing.is_active === false) return {}

  const canonicalPath = `/listing/${listing.slug ?? listing.id}`
  const tr = (listing.translations ?? {}) as Record<string, TranslationEntry>
  const availableLangs = TRANSLATION_LANGS.filter((l) => tr[l]?.title)
  const activeLang = availableLangs.find((l) => l === langParam) ?? null
  const t = activeLang ? tr[activeLang] : null

  const city = listing.city || listing.location
  const baseTitle = t?.title ?? listing.title
  const baseDescription = t?.description ?? listing.description
  const title = `${baseTitle} — ${FEWO_WORD[activeLang ?? 'de']} ${city}`
  const description = baseDescription
    ? baseDescription.slice(0, 155)
    : `${baseTitle} in ${city} — buche direkt bei TRIMOSA, ohne Vermittler.`
  const image = listing.images?.[0]

  return {
    title,
    description,
    alternates: {
      canonical: activeLang ? `${siteUrl}${canonicalPath}?lang=${activeLang}` : `${siteUrl}${canonicalPath}`,
      languages: availableLangs.length > 0 ? {
        de: `${siteUrl}${canonicalPath}`,
        ...Object.fromEntries(availableLangs.map((l) => [l, `${siteUrl}${canonicalPath}?lang=${l}`])),
        'x-default': `${siteUrl}${canonicalPath}`,
      } : undefined,
    },
    openGraph: {
      title,
      description,
      url: `${siteUrl}${canonicalPath}`,
      images: image ? [{ url: image }] : undefined,
    },
  }
}

/* Fallback gradient when no photos uploaded yet */
function getGradientStyle(location: string, title: string): React.CSSProperties {
  const text = (location + title).toLowerCase()
  if (text.includes('see') || text.includes('teger') || text.includes('schlier') || text.includes('chiem'))
    return { background: 'linear-gradient(135deg, #67E8F9, #22D3EE, #0EA5E9)' }
  if (text.includes('zugspitz') || text.includes('alp') || text.includes('berg') || text.includes('garm'))
    return { background: 'linear-gradient(135deg, #6EE7B7, #2DD4BF, #06B6D4)' }
  if (text.includes('münchen') || text.includes('munich') || text.includes('stadt'))
    return { background: 'linear-gradient(135deg, #94A3B8, #64748B, #475569)' }
  if (text.includes('allgäu') || text.includes('füssen'))
    return { background: 'linear-gradient(135deg, #C4B5FD, #A78BFA, #818CF8)' }
  return { background: 'linear-gradient(135deg, #FCD34D, #FBBF24, #F59E0B)' }
}

const fallbackColors = [
  'linear-gradient(135deg, #BAE6FD, #38BDF8)',
  'linear-gradient(135deg, #A7F3D0, #34D399)',
  'linear-gradient(135deg, #FDE68A, #FBBF24)',
  'linear-gradient(135deg, #DDD6FE, #A78BFA)',
]

export default async function ListingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ checkin?: string; checkout?: string; guests?: string; review?: string; lang?: string }> }) {
  const { id } = await params
  const { checkin: searchCheckin, checkout: searchCheckout, guests: searchGuests, review: showReviewForm, lang: langParam } = await searchParams
  const lookup = listingLookup(id)
  const { data: listing } = await supabaseAdmin.from('listings').select('*').eq(lookup.column, lookup.value).single()

  if (!listing || listing.is_active === false) notFound()

  // Legacy UUID links → 301 to the speaking URL (query params preserved)
  if (lookup.column === 'id' && listing.slug) {
    const qs = new URLSearchParams()
    if (searchCheckin) qs.set('checkin', searchCheckin)
    if (searchCheckout) qs.set('checkout', searchCheckout)
    if (searchGuests) qs.set('guests', searchGuests)
    if (showReviewForm) qs.set('review', showReviewForm)
    permanentRedirect(`/listing/${listing.slug}${qs.toString() ? `?${qs}` : ''}`)
  }

  // Fetch host profile (for the host badge; booking settings now live on the listing)
  const { data: hostProfile } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', listing.host_id)
    .maybeSingle()

  const images: string[] = listing.images ?? []
  const roomsRaw: { id: string; name: string; description?: string; features?: string[]; images: string[] }[] = listing.rooms ?? []

  // Language layer: the site-wide cookie (flag switcher) drives the language;
  // an explicit ?lang= (SEO/hreflang links) overrides it. German is canonical.
  const cookieLang = await getUiLang()
  const hostTeam = await getHostTeam()
  const lang: UiLang = isUiLang(langParam) ? langParam : cookieLang
  const tr = (listing.translations ?? {}) as Record<string, TranslationEntry>
  const availableLangs = TRANSLATION_LANGS.filter((l) => tr[l]?.title)
  const activeLang = availableLangs.find((l) => l === lang) ?? null
  const tc = activeLang ? tr[activeLang] : null
  const displayTitle = tc?.title ?? listing.title
  const displayDescription = tc?.description ?? listing.description
  // Editorial bits without per-listing translations (room keywords, AI guest
  // summary): AI-translated once, cached forever (lib/static-translate)
  // Region context for the map + teaser (matched via listing location)
  const region = Object.values(REGIONS).find((r) =>
    ((listing.location as string) || '').toLowerCase().includes(r.locationMatch.toLowerCase())
  )
  const TR = await makeTr(lang, lang === 'de' ? [] : [
    ...roomsRaw.flatMap((r) => r.features ?? []),
    ...(listing.guest_summary ? [listing.guest_summary as string] : []),
    'Die Unterkunft und die schönsten Ausflugsziele in {r} auf einer Karte.',
    ...(region ? region.pois.flatMap((pp) => [pp.name, pp.text]) : []),
    ...(region ? Object.values(REGIONS).filter((r) => r.slug !== region.slug).flatMap((r) => r.pois).flatMap((pp) => [pp.name, pp.text]) : []),
    ...(region ? [region.claim] : []),
  ])
  const rooms = roomsRaw.map((r) => ({
    ...r,
    name: tc?.rooms?.[r.id]?.name ?? r.name,
    description: tc?.rooms?.[r.id]?.description ?? r.description,
    features: (r.features ?? []).map((f) => TR(f)),
  }))
  const amenities: string[] = listing.amenities ?? []
  const mainGradient = getGradientStyle(listing.location ?? '', listing.title ?? '')
  const allImagesFlat = images.length > 0 ? images : rooms.flatMap(r => r.images)

  // Derive city: prefer explicit city field, then try to extract from address, fallback to location
  const displayCity = listing.city || listing.address?.split(',').pop()?.trim() || listing.location

  // §161-Jupas ①: Gesamtscore + erste Bewertungen SERVERSEITIG — speist
  // aggregateRating/review im JSON-LD (Google-Sterne-Snippets) und rendert
  // echte Review-Texte ins initiale HTML (statt „Laden…")
  const listingRating = buildCardRating(listing as Record<string, unknown>)
  const initialReviews = await getInitialReviews(listing as Record<string, unknown>)
  const reviewItems = initialReviews.reviews
    .filter((r) => (r.review_text ?? '').trim().length >= 20 && r.rating > 0)
    .slice(0, 8)
    .map((r) => ({
      '@type': 'Review',
      author: { '@type': 'Person', name: r.author_name || 'Gast' },
      datePublished: (r.review_date ?? '').slice(0, 10) || undefined,
      reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5, worstRating: 1 },
      reviewBody: (r.review_text ?? '').slice(0, 500),
    }))

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'VacationRental',
    name: listing.title,
    description: listing.description || undefined,
    url: `${siteUrl}/listing/${listing.slug ?? listing.id}`,
    image: allImagesFlat.length > 0 ? allImagesFlat : undefined,
    address: {
      '@type': 'PostalAddress',
      addressLocality: displayCity,
      addressCountry: 'DE',
    },
    numberOfRooms: listing.bedrooms,
    petsAllowed: listing.rule_pets_allowed ?? undefined,
    ...(listingRating ? {
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: listingRating.overall,
        reviewCount: listingRating.count,
        bestRating: 5,
        worstRating: 1,
      },
    } : {}),
    ...(reviewItems.length ? { review: reviewItems } : {}),
  }

  const regionHero = region?.heroSlugs
    .map((s) => region.pois.find((p) => p.slug === s)?.image?.src)
    .find((s): s is string => !!s)
  const mapLat = listing.latitude != null ? Number(listing.latitude) : null
  const mapLon = listing.longitude != null ? Number(listing.longitude) : null
  const hasCoords = mapLat != null && mapLon != null && (mapLat !== 0 || mapLon !== 0)

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F5F5F7' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <NavBar lang={lang} />

      <div className="detail-container" style={{ maxWidth: '1100px', margin: '0 auto', padding: '32px 24px 0' }}>

        {/* ── Title + Score + Address ── */}
        <div className="detail-meta-row" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px', marginBottom: '22px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '13px', flexWrap: 'wrap', marginBottom: '9px' }}>
              <h1 className="detail-title" style={{ fontSize: 'clamp(24px, 4vw, 30px)', fontWeight: 800, color: '#1D1D1F', margin: 0, letterSpacing: '-0.4px', lineHeight: 1.15 }}>
                {displayTitle}
              </h1>
              {(() => {
                const rating = buildCardRating(listing as Record<string, unknown>)
                return rating ? (
                  <a href="#reviews-section" style={{ textDecoration: 'none', display: 'inline-flex' }} title="Zu den Bewertungen">
                    <ScoreBadge rating={rating} popDirection="down" />
                  </a>
                ) : (
                  <a href="#reviews-section" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 12px', borderRadius: '999px', backgroundColor: '#FAF5E4', fontSize: '12px', fontWeight: 600, color: 'var(--gold-dark)', textDecoration: 'none', cursor: 'pointer' }}>
                    ★ Neu
                  </a>
                )
              })()}
            </div>
            <p style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap', margin: 0, fontSize: '14px', color: '#6E6E73', lineHeight: 1.5 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth={2} style={{ flexShrink: 0 }}>
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
              <span>{listing.address || displayCity}</span>
              <a href="#lage" style={{ color: 'var(--gold-dark)', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                {t(lang, 'Auf der Karte ansehen ↓')}
              </a>
            </p>
            {activeLang && (
              <p style={{ margin: '8px 0 0', fontSize: '11.5px', color: '#98938A' }}>
                🌐 {t(lang, 'automatisch übersetzt')}
              </p>
            )}
          </div>
          {hostProfile && (
            <HostBadge lang={lang} team={hostTeam.map((m) => ({ firstName: m.firstName, initials: m.initials, avatarUrl: m.avatarUrl }))} host={{
              id: hostProfile.id,
              display_name: hostProfile.display_name,
              avatar_url: hostProfile.avatar_url,
              bio: hostProfile.bio,
              location: hostProfile.location,
              member_since: hostProfile.member_since,
              languages: hostProfile.languages,
            }} />
          )}
        </div>

        {/* ── PHOTO GRID ── */}
        <PhotoGrid
          lang={lang}
          rooms={rooms}
          allImages={allImagesFlat}
          listingTitle={displayTitle}
          pricePerNight={listing.price_per_night}
          mainGradient={mainGradient}
          fallbackColors={fallbackColors}
        />

        {/* ── TWO-COLUMN LAYOUT ── */}
        <div className="detail-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '40px', alignItems: 'flex-start' }}>

          {/* LEFT COLUMN */}
          <div>

            {/* Quick stats with Host badge */}
            <div className="detail-stats" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', paddingBottom: '28px', borderBottom: '1px solid #E5E5EA', marginBottom: '28px' }}>
              {[
                { icon: '👥', label: t(lang, 'Gäste'), val: t(lang, 'bis {n}', { n: listing.max_guests }) },
                { icon: '🛏️', label: t(lang, 'Schlafzimmer'), val: listing.bedrooms ?? 1 },
                { icon: '🚿', label: t(lang, 'Badezimmer'), val: listing.bathrooms ?? 1 },
              ].map((item) => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderRadius: '14px', backgroundColor: '#fff', border: '1px solid #E5E5EA', flex: '1 1 130px', minWidth: '120px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: '#FAF5E4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '17px', flexShrink: 0 }}>
                    {item.icon}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: '#1D1D1F' }}>{item.val}</div>
                    <div style={{ fontSize: '11px', color: '#6E6E73' }}>{item.label}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Description */}
            <div className="detail-description" style={{ marginBottom: '32px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '12px' }}>{t(lang, 'Über diese Unterkunft')}</h2>
              <p style={{ fontSize: '15px', lineHeight: 1.7, color: '#6E6E73', whiteSpace: 'pre-line', margin: 0 }}>
                {displayDescription || t(lang, 'Keine Beschreibung verfügbar. Der Gastgeber wird in Kürze weitere Details hinzufügen.')}
              </p>
            </div>

            {/* Amenities (client component with overlay) */}
            <AmenitiesSection amenities={amenities} lang={lang} />

            {/* Floor plans (multiple with labels) */}
            {((listing.floor_plan_urls && listing.floor_plan_urls.length > 0) || listing.floor_plan_url) && (
              <FloorPlanSection
                lang={lang}
                urls={
                  listing.floor_plan_urls && listing.floor_plan_urls.length > 0
                    ? listing.floor_plan_urls
                    : listing.floor_plan_url ? [listing.floor_plan_url] : []
                }
                labels={listing.floor_plan_labels ?? []}
              />
            )}

            {/* Occupancy calendar — 2 months, clickable dates feed into BookingBox */}
            <OccupancyCalendar listingId={listing.id} lang={lang} />

          </div>

          {/* RIGHT COLUMN — Booking Box */}
          <div className="detail-booking-col" style={{ position: 'sticky', top: 'calc(var(--navbar-h, 88px) + 16px)' }}>
            <BookingBox
              lang={lang}
              listingId={listing.id}
              pricePerNight={listing.price_per_night}
              hostId={listing.host_id}
              allowInstant={listing.allow_instant_booking ?? true}
              allowRequests={listing.allow_requests ?? true}
              minRequestNights={listing.min_request_nights ?? 1}
              cancellationPolicy={listing.cancellation_policy ?? 'moderat'}
              initialCheckIn={searchCheckin}
              initialCheckOut={searchCheckout}
              initialGuests={searchGuests ? parseInt(searchGuests) : undefined}
            />
          </div>
        </div>

        {/* ── FULL-WIDTH SECTIONS (below two-column layout) ── */}
        <div style={{ paddingBottom: '80px' }}>

          {/* Full-width Map — own Leaflet style (matches the search map),
              with the region's destinations one zoom-out away */}
          <div id="lage" style={{ marginTop: '40px', marginBottom: '32px', scrollMarginTop: '96px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '6px' }}>{t(lang, 'Lage & Umgebung')}</h2>
            {region && (
              <p style={{ fontSize: '13.5px', color: '#6E6E73', margin: '0 0 14px' }}>
                {TR('Die Unterkunft und die schönsten Ausflugsziele in {r} auf einer Karte.').replace('{r}', region?.name ?? '')}
              </p>
            )}
            {hasCoords ? (
              <>
                <RegionMap
                  pois={(region?.pois ?? []).map((pp) => ({ ...pp, name: TR(pp.name), text: TR(pp.text) }))}
                  lang={lang}
                  listings={[{ id: listing.id, slug: listing.slug ?? undefined, title: listing.title, lat: mapLat!, lon: mapLon! }]}
                  center={[mapLat!, mapLon!]}
                  zoom={14}
                  tiles="voyager"
                  extraPois={Object.values(REGIONS).filter((r) => r.slug !== region?.slug).flatMap((r) => r.pois).map((pp) => ({ ...pp, name: TR(pp.name), text: TR(pp.text) }))}
                  height="clamp(320px, 45vh, 420px)"
                />

                {/* Region teaser — the elegant road into the region content */}
                {region && (
                  <Link href={`/region/${region.slug}`} className="listing-card" style={{
                    display: 'flex', flexWrap: 'wrap', marginTop: '18px', borderRadius: '18px', overflow: 'hidden',
                    background: 'linear-gradient(135deg, #12222E, #1E3A4C)', textDecoration: 'none',
                  }}>
                    {regionHero && (
                      <div style={{ position: 'relative', flex: '1 1 240px', minHeight: '170px' }}>
                        <Image src={regionHero} alt={region.name} fill sizes="(max-width: 768px) 100vw, 380px" style={{ objectFit: 'cover' }} />
                        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to right, transparent 60%, #16293A)' }} className="hidden md:block" />
                      </div>
                    )}
                    <div style={{ flex: '1.5 1 300px', padding: 'clamp(18px, 3vw, 26px) clamp(18px, 3.5vw, 30px)' }}>
                      <p style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.11em', textTransform: 'uppercase', margin: '0 0 7px' }}>
                        {t(lang, 'Deine Region')}
                      </p>
                      <p style={{ fontSize: 'clamp(17px, 2.5vw, 21px)', fontWeight: 800, color: '#fff', margin: '0 0 5px', letterSpacing: '-0.3px' }}>
                        {region.emoji} {region.name}
                      </p>
                      <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.72)', margin: '0 0 13px', lineHeight: 1.55 }}>
                        {TR(region.claim)}
                      </p>
                      <p style={{ display: 'flex', flexWrap: 'wrap', gap: '7px', margin: '0 0 15px' }}>
                        {region.heroSlugs.slice(0, 3).map((s) => {
                          const p = region.pois.find((x) => x.slug === s)
                          return p ? (
                            <span key={s} style={{ fontSize: '11.5px', fontWeight: 600, color: 'rgba(255,255,255,0.85)', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.18)', padding: '4px 11px', borderRadius: '999px' }}>
                              {p.emoji} {TR(p.name)}
                            </span>
                          ) : null
                        })}
                      </p>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', fontWeight: 700,
                        color: '#1A1400', background: 'linear-gradient(135deg, var(--gold), #E3C878)',
                        padding: '9px 18px', borderRadius: '999px',
                      }}>{t(lang, 'Region entdecken →')}</span>
                    </div>
                  </Link>
                )}
              </>
            ) : listing.address ? (
              <div className="detail-map" style={{ borderRadius: '16px', overflow: 'hidden', border: '1px solid #E5E5EA', height: '360px' }}>
                <iframe
                  title="Karte"
                  width="100%"
                  height="100%"
                  style={{ border: 0 }}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  src={`https://www.google.com/maps?q=${encodeURIComponent(listing.address)}&output=embed`}
                />
              </div>
            ) : (
              <div style={{ borderRadius: '16px', padding: '24px', backgroundColor: '#FAF5E4', border: '1px solid #E8D9A0', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth={1.8}>
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
                </svg>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--gold-dark)' }}>{displayCity}</div>
                  {listing.location && listing.location !== displayCity && (
                    <div style={{ fontSize: '12px', color: '#6E6E73', marginTop: '2px' }}>{listing.location}</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* House Rules (structured + text) */}
          <HouseRulesDisplay
            lang={lang}
            rules={{
              pets_allowed: listing.rule_pets_allowed,
              events_allowed: listing.rule_events_allowed,
              smoking_allowed: listing.rule_smoking_allowed,
              quiet_hours: listing.rule_quiet_hours,
              quiet_start: listing.rule_quiet_start,
              quiet_end: listing.rule_quiet_end,
              commercial_photo: listing.rule_commercial_photo,
              max_guests: listing.rule_max_guests ?? listing.max_guests,
              additional_rules: listing.rule_additional_rules,
            }}
            checkIn={listing.check_in_time}
            checkOut={listing.check_out_time}
            legacyText={listing.house_rules_details || listing.house_rules}
          />

          {/* Check-in Instructions */}
          {listing.checkin_instructions && (
            <div style={{ marginBottom: '32px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#1D1D1F', marginBottom: '8px' }}>{t(lang, 'Check-In Anweisungen')}</h2>
              <p style={{ fontSize: '13px', lineHeight: 1.7, color: '#6E6E73', whiteSpace: 'pre-line', margin: 0 }}>
                {listing.checkin_instructions}
              </p>
            </div>
          )}

          {/* Important Notes */}
          {listing.important_notes && (
            <div style={{ marginBottom: '32px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#1D1D1F', marginBottom: '8px' }}>{t(lang, 'Wichtige Hinweise')}</h2>
              <p style={{ fontSize: '13px', lineHeight: 1.7, color: '#92400E', whiteSpace: 'pre-line', margin: 0 }}>
                {listing.important_notes}
              </p>
            </div>
          )}

          {/* AI guest summary — generated server-side from imported review texts */}
          {listing.guest_summary && (
            <div style={{
              marginBottom: '20px', borderRadius: '18px', padding: '18px 20px 15px',
              background: 'linear-gradient(135deg, #FDF9EE, #FAF3DD)', border: '1.5px solid var(--gold)',
            }}>
              <p style={{ fontSize: '11px', fontWeight: 800, color: 'var(--gold-dark)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 8px' }}>
                {t(lang, '💬 Das sagen unsere Gäste')}
              </p>
              <p style={{ fontSize: '14.5px', lineHeight: 1.7, color: '#3A3427', margin: '0 0 8px' }}>
                {TR(listing.guest_summary)}
              </p>
              <p style={{ fontSize: '10.5px', color: '#A89968', margin: 0 }}>
                {t(lang, 'Automatisch zusammengefasst aus echten Gästebewertungen — die Originale stehen darunter.')}
              </p>
            </div>
          )}

          {/* Reviews */}
          <ReviewsSection listingId={listing.id} showReviewForm={showReviewForm === 'true'} lang={lang} initial={initialReviews} />

        </div>
      </div>

      {/* Fixed mobile booking bar — only visible on mobile via CSS */}
      <MobileBookingBar pricePerNight={listing.price_per_night} lang={lang} />
    </div>
  )
}
