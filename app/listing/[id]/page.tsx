import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
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
import ScoreBadge, { type CardRating } from '@/components/ScoreBadge'

/* Weighted review rating from the synced per-platform score columns. */
function buildListingRating(l: Record<string, unknown>): CardRating | undefined {
  const platforms: CardRating['platforms'] = []
  for (const src of ['airbnb', 'booking', 'google', 'vrbo']) {
    const score = l[`${src}_score`]
    const count = l[`${src}_review_count`]
    if (score != null && count != null && Number(count) > 0) {
      platforms.push({ source: src, score: Math.round(Number(score) * 10) / 10, count: Number(count) })
    }
  }
  if (platforms.length === 0) return undefined
  const total = platforms.reduce((s, p) => s + p.score * p.count, 0)
  const count = platforms.reduce((s, p) => s + p.count, 0)
  return { overall: Math.round((total / count) * 100) / 100, count, platforms }
}

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trimosa-app.vercel.app'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const { data: listing } = await supabaseAdmin
    .from('listings')
    .select('title, description, location, city, images, is_active')
    .eq('id', id)
    .single()

  if (!listing || listing.is_active === false) return {}

  const city = listing.city || listing.location
  const title = `${listing.title} — Ferienwohnung in ${city}`
  const description = listing.description
    ? listing.description.slice(0, 155)
    : `${listing.title} in ${city} — buche direkt bei TRIMOSA, ohne Vermittler.`
  const image = listing.images?.[0]

  return {
    title,
    description,
    alternates: { canonical: `${siteUrl}/listing/${id}` },
    openGraph: {
      title,
      description,
      url: `${siteUrl}/listing/${id}`,
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

export default async function ListingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ checkin?: string; checkout?: string; guests?: string; review?: string }> }) {
  const { id } = await params
  const { checkin: searchCheckin, checkout: searchCheckout, guests: searchGuests, review: showReviewForm } = await searchParams
  const { data: listing } = await supabaseAdmin.from('listings').select('*').eq('id', id).single()

  if (!listing || listing.is_active === false) notFound()

  // Fetch host profile (for the host badge; booking settings now live on the listing)
  const { data: hostProfile } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', listing.host_id)
    .maybeSingle()

  const images: string[] = listing.images ?? []
  const rooms: { id: string; name: string; description?: string; features?: string[]; images: string[] }[] = listing.rooms ?? []
  const amenities: string[] = listing.amenities ?? []
  const mainGradient = getGradientStyle(listing.location ?? '', listing.title ?? '')
  const allImagesFlat = images.length > 0 ? images : rooms.flatMap(r => r.images)

  // Derive city: prefer explicit city field, then try to extract from address, fallback to location
  const displayCity = listing.city || listing.address?.split(',').pop()?.trim() || listing.location

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'VacationRental',
    name: listing.title,
    description: listing.description || undefined,
    url: `${siteUrl}/listing/${listing.id}`,
    image: allImagesFlat.length > 0 ? allImagesFlat : undefined,
    address: {
      '@type': 'PostalAddress',
      addressLocality: displayCity,
      addressCountry: 'DE',
    },
    numberOfRooms: listing.bedrooms,
    petsAllowed: listing.rule_pets_allowed ?? undefined,
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F5F5F7' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <NavBar />

      <div className="detail-container" style={{ maxWidth: '1100px', margin: '0 auto', padding: '32px 24px 0' }}>

        {/* ── Title ── */}
        <h1 className="detail-title" style={{ fontSize: '28px', fontWeight: 700, color: '#1D1D1F', margin: '0 0 12px', letterSpacing: '-0.4px' }}>
          {listing.title}
        </h1>

        {/* ── Rating + City + Host badge (aligned bottom) ── */}
        <div className="detail-meta-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
          {(() => {
            const rating = buildListingRating(listing as Record<string, unknown>)
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
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', color: '#6E6E73' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth={2}>
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            {displayCity}
          </span>
          {/* Spacer pushes host badge right */}
          <div style={{ flex: 1 }} />
          {hostProfile && (
            <HostBadge host={{
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
          rooms={rooms}
          allImages={allImagesFlat}
          listingTitle={listing.title}
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
                { icon: '👥', label: 'Gäste', val: `bis ${listing.max_guests}` },
                { icon: '🛏️', label: 'Schlafzimmer', val: listing.bedrooms ?? 1 },
                { icon: '🚿', label: 'Badezimmer', val: listing.bathrooms ?? 1 },
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
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '12px' }}>Über diese Unterkunft</h2>
              <p style={{ fontSize: '15px', lineHeight: 1.7, color: '#6E6E73', whiteSpace: 'pre-line', margin: 0, textAlign: 'justify' }}>
                {listing.description || 'Keine Beschreibung verfügbar. Der Gastgeber wird in Kürze weitere Details hinzufügen.'}
              </p>
            </div>

            {/* Amenities (client component with overlay) */}
            <AmenitiesSection amenities={amenities} />

            {/* Floor plans (multiple with labels) */}
            {((listing.floor_plan_urls && listing.floor_plan_urls.length > 0) || listing.floor_plan_url) && (
              <FloorPlanSection
                urls={
                  listing.floor_plan_urls && listing.floor_plan_urls.length > 0
                    ? listing.floor_plan_urls
                    : listing.floor_plan_url ? [listing.floor_plan_url] : []
                }
                labels={listing.floor_plan_labels ?? []}
              />
            )}

            {/* Occupancy calendar — 2 months, clickable dates feed into BookingBox */}
            <OccupancyCalendar listingId={listing.id} />

          </div>

          {/* RIGHT COLUMN — Booking Box */}
          <div className="detail-booking-col" style={{ position: 'sticky', top: 'calc(var(--navbar-h, 88px) + 16px)' }}>
            <BookingBox
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

          {/* Full-width Map */}
          <div style={{ marginTop: '40px', marginBottom: '32px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '16px' }}>Lage</h2>
            {listing.address ? (
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
              <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#1D1D1F', marginBottom: '8px' }}>Check-In Anweisungen</h2>
              <p style={{ fontSize: '13px', lineHeight: 1.7, color: '#6E6E73', whiteSpace: 'pre-line', margin: 0 }}>
                {listing.checkin_instructions}
              </p>
            </div>
          )}

          {/* Important Notes */}
          {listing.important_notes && (
            <div style={{ marginBottom: '32px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#1D1D1F', marginBottom: '8px' }}>Wichtige Hinweise</h2>
              <p style={{ fontSize: '13px', lineHeight: 1.7, color: '#92400E', whiteSpace: 'pre-line', margin: 0 }}>
                {listing.important_notes}
              </p>
            </div>
          )}

          {/* Reviews */}
          <ReviewsSection listingId={listing.id} showReviewForm={showReviewForm === 'true'} revyoosPropertyId={listing.revyoos_property_id ?? undefined} />

        </div>
      </div>

      {/* Fixed mobile booking bar — only visible on mobile via CSS */}
      <MobileBookingBar pricePerNight={listing.price_per_night} />
    </div>
  )
}
