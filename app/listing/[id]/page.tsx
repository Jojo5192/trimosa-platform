import { supabaseAdmin } from '@/lib/supabase-admin'
import NavBar from '@/components/NavBar'
import BookingBox from './BookingBox'
import PhotoGrid from './PhotoGrid'
import Link from 'next/link'

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

const AMENITY_ICONS: Record<string, string> = {
  'WLAN': '📶',
  'Küche': '🍳',
  'Parkplatz': '🅿️',
  'Bergpanorama': '🏔️',
  'Kamin': '🪵',
  'Waschmaschine': '🧺',
  'Trockner': '👕',
  'Klimaanlage': '❄️',
  'Heizung': '🔥',
  'Haustiere erlaubt': '🐾',
  'Balkon / Terrasse': '🏡',
  'Garten': '🌿',
  'Pool': '🏊',
  'Sauna': '🧖',
  'Grill': '🍖',
  'E-Auto Ladepunkt': '⚡',
  'Seenähe': '🏞️',
  'Skigebiet in der Nähe': '⛷️',
  'Babyausstattung': '👶',
  'TV': '📺',
}

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data: listing } = await supabaseAdmin.from('listings').select('*').eq('id', id).single()

  if (!listing) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', backgroundColor: '#F5F5F7' }}>
        <p style={{ fontWeight: 700, fontSize: '18px', color: '#1D1D1F' }}>Unterkunft nicht gefunden</p>
        <Link href="/" style={{ fontSize: '13px', fontWeight: 600, padding: '8px 20px', borderRadius: '999px', color: '#8A7020', backgroundColor: '#FAF5E4', textDecoration: 'none' }}>
          ← Zurück zur Übersicht
        </Link>
      </div>
    )
  }

  // Fetch host profile
  const { data: hostProfile } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', listing.host_id)
    .maybeSingle()

  const images: string[] = listing.images ?? []
  const rooms: { id: string; name: string; description?: string; features?: string[]; images: string[] }[] = listing.rooms ?? []
  const amenities: string[] = listing.amenities ?? []
  const mainGradient = getGradientStyle(listing.location ?? '', listing.title ?? '')

  // Derive first image from rooms if not in flat images list
  const firstImage = images[0] ?? rooms.find(r => r.images.length > 0)?.images[0]
  // Collect all images for photo viewer fallback
  const allImagesFlat = images.length > 0 ? images : rooms.flatMap(r => r.images)

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F5F5F7' }}>
      <NavBar />

      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '32px 24px 80px' }}>

        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', marginBottom: '20px', color: '#6E6E73' }}>
          <Link href="/" style={{ color: '#B0912B', textDecoration: 'none' }}>Übersicht</Link>
          <span>›</span>
          <span>{listing.location}</span>
          <span>›</span>
          <span style={{ color: '#1D1D1F', fontWeight: 500 }}>{listing.title}</span>
        </div>

        {/* Title row */}
        <h1 style={{ fontSize: '28px', fontWeight: 700, color: '#1D1D1F', margin: '0 0 12px', letterSpacing: '-0.4px' }}>
          {listing.title}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 12px', borderRadius: '999px', backgroundColor: '#FAF5E4', fontSize: '12px', fontWeight: 600, color: '#8A7020' }}>
            ★★★★★ Neu
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', color: '#6E6E73' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#B0912B" strokeWidth={2}>
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            {listing.location}
          </span>
        </div>

        {/* ── PHOTO GRID (client component — handles click → viewer) ── */}
        <PhotoGrid
          rooms={rooms}
          allImages={allImagesFlat}
          listingTitle={listing.title}
          pricePerNight={listing.price_per_night}
          mainGradient={mainGradient}
          fallbackColors={fallbackColors}
        />

        {/* ── TWO-COLUMN LAYOUT ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '40px', alignItems: 'flex-start' }}>

          {/* LEFT COLUMN */}
          <div>

            {/* Quick stats */}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', paddingBottom: '28px', borderBottom: '1px solid #E5E5EA', marginBottom: '28px' }}>
              {[
                { icon: '👥', label: 'Gäste', val: `bis ${listing.max_guests}` },
                { icon: '🛏️', label: 'Schlafzimmer', val: listing.bedrooms ?? 1 },
                { icon: '🚿', label: 'Badezimmer', val: listing.bathrooms ?? 1 },
                { icon: '💰', label: 'Provision', val: '0 %' },
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
            <div style={{ marginBottom: '32px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '12px' }}>Über diese Unterkunft</h2>
              <p style={{ fontSize: '15px', lineHeight: 1.7, color: '#6E6E73', whiteSpace: 'pre-line', margin: 0 }}>
                {listing.description || 'Keine Beschreibung verfügbar. Der Gastgeber wird in Kürze weitere Details hinzufügen.'}
              </p>
            </div>

            {/* Amenities */}
            {amenities.length > 0 && (
              <div style={{ marginBottom: '32px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '16px' }}>Ausstattung</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  {amenities.map((a) => (
                    <div key={a} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', borderRadius: '12px', backgroundColor: '#fff', border: '1px solid #E5E5EA' }}>
                      <span style={{ fontSize: '18px', lineHeight: 1, flexShrink: 0 }}>{AMENITY_ICONS[a] ?? '✓'}</span>
                      <span style={{ fontSize: '13px', fontWeight: 500, color: '#1D1D1F' }}>{a}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Check-in / Check-out */}
            {(listing.check_in_time || listing.check_out_time) && (
              <div style={{ marginBottom: '32px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '16px' }}>An- & Abreise</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div style={{ borderRadius: '14px', padding: '16px', backgroundColor: '#fff', border: '1px solid #E5E5EA' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#B0912B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Check-in</div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#1D1D1F' }}>ab {listing.check_in_time ?? '15:00'} Uhr</div>
                  </div>
                  <div style={{ borderRadius: '14px', padding: '16px', backgroundColor: '#fff', border: '1px solid #E5E5EA' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#B0912B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Check-out</div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#1D1D1F' }}>bis {listing.check_out_time ?? '11:00'} Uhr</div>
                  </div>
                </div>
              </div>
            )}

            {/* House rules */}
            {listing.house_rules && (
              <div style={{ marginBottom: '32px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '12px' }}>Hausregeln</h2>
                <div style={{ borderRadius: '14px', padding: '18px', backgroundColor: '#fff', border: '1px solid #E5E5EA' }}>
                  <p style={{ fontSize: '14px', lineHeight: 1.7, color: '#6E6E73', whiteSpace: 'pre-line', margin: 0 }}>
                    {listing.house_rules}
                  </p>
                </div>
              </div>
            )}

            {/* Location */}
            <div style={{ marginBottom: '32px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '12px' }}>Lage</h2>
              <div style={{ borderRadius: '14px', padding: '18px', backgroundColor: '#FAF5E4', border: '1px solid #E8D9A0', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B0912B" strokeWidth={1.8}>
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
                </svg>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: '#8A7020' }}>{listing.location}</div>
                  {listing.address && <div style={{ fontSize: '12px', color: '#6E6E73', marginTop: '2px' }}>{listing.address}</div>}
                </div>
              </div>
            </div>

            {/* Host profile */}
            {hostProfile && (
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '16px' }}>Dein Gastgeber</h2>
                <div style={{ borderRadius: '16px', padding: '20px', backgroundColor: '#fff', border: '1px solid #E5E5EA' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: hostProfile.bio ? '14px' : '0' }}>
                    {hostProfile.avatar_url ? (
                      <img src={hostProfile.avatar_url} alt={hostProfile.display_name} style={{ width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #F0EDE6', flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'linear-gradient(135deg, #C4A235, #8A6818)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                        {hostProfile.display_name?.[0]?.toUpperCase() ?? '?'}
                      </div>
                    )}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '15px', color: '#1D1D1F' }}>{hostProfile.display_name || 'Gastgeber'}</div>
                      {hostProfile.location && <div style={{ fontSize: '12px', color: '#6E6E73', marginTop: '2px' }}>📍 {hostProfile.location}</div>}
                      {hostProfile.member_since && <div style={{ fontSize: '12px', color: '#6E6E73' }}>Mitglied seit {new Date(hostProfile.member_since).getFullYear()}</div>}
                    </div>
                  </div>
                  {hostProfile.bio && <p style={{ fontSize: '14px', lineHeight: 1.6, color: '#6E6E73', margin: '0 0 12px' }}>{hostProfile.bio}</p>}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '12px', color: '#6E6E73' }}>
                    {hostProfile.response_time && <span>⚡ Antwortet {hostProfile.response_time.toLowerCase()}</span>}
                    {hostProfile.languages?.length > 0 && <span>🌍 Spricht {hostProfile.languages.join(', ')}</span>}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN — Booking Box */}
          <div style={{ position: 'sticky', top: 'calc(var(--navbar-h, 88px) + 16px)' }}>
            <BookingBox listingId={listing.id} pricePerNight={listing.price_per_night} />
          </div>
        </div>
      </div>
    </div>
  )
}
