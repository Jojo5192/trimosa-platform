import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { supabaseAdmin } from '@/lib/supabase-admin'
import NavBar from '@/components/NavBar'
import RegionMap, { type RegionMapListing } from '@/components/RegionMap'
import ScoreBadge from '@/components/ScoreBadge'
import { buildCardRating } from '@/lib/rating'
import { REGIONS } from '@/lib/regions'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trimosa-app.vercel.app'

// Re-render at most hourly so listing photos, counts and scores stay fresh
export const revalidate = 3600

export function generateStaticParams() {
  return Object.keys(REGIONS).map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const region = REGIONS[slug]
  if (!region) return {}
  return {
    title: region.metaTitle,
    description: region.metaDescription,
    alternates: { canonical: `${siteUrl}/region/${region.slug}` },
    openGraph: { title: region.metaTitle, description: region.metaDescription, url: `${siteUrl}/region/${region.slug}` },
  }
}

export default async function RegionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const region = REGIONS[slug]
  if (!region) notFound()

  const { data: listings } = await supabaseAdmin
    .from('listings')
    .select('*')
    .eq('is_active', true)
    .ilike('location', `%${region.locationMatch}%`)
    .order('created_at', { ascending: false })

  const regionListings = listings ?? []

  const mapListings: RegionMapListing[] = regionListings
    .filter((l) => l.latitude != null && l.longitude != null)
    .map((l) => ({ id: l.id, slug: l.slug ?? undefined, title: l.title, lat: Number(l.latitude), lon: Number(l.longitude) }))

  const heroImages: string[] = regionListings
    .map((l) => (l.images as string[] | null)?.[0])
    .filter((img): img is string => !!img)
    .slice(0, 3)

  const otherRegions = Object.values(REGIONS).filter((r) => r.slug !== region.slug)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TouristDestination',
    name: region.name,
    description: region.metaDescription,
    url: `${siteUrl}/region/${region.slug}`,
    touristType: ['Familien', 'Aktivurlauber', 'Städtereisende'],
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F5F5F7' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <NavBar />

      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '32px 20px 60px' }}>

        {/* ── Hero ── */}
        <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 8px' }}>
          Ferienwohnungen · {region.name}
        </p>
        <h1 style={{ fontSize: 'clamp(26px, 5vw, 40px)', fontWeight: 800, color: '#1A1400', letterSpacing: '-0.02em', margin: '0 0 10px', lineHeight: 1.15 }}>
          {region.claim}
        </h1>

        {heroImages.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: heroImages.length > 1 ? '2fr 1fr' : '1fr', gridTemplateRows: heroImages.length > 2 ? '1fr 1fr' : '1fr', gap: '10px', margin: '22px 0 26px', height: 'clamp(220px, 38vw, 380px)' }}>
            {heroImages.map((img, i) => (
              <div key={img} style={{ position: 'relative', borderRadius: i === 0 ? '18px' : '14px', overflow: 'hidden', gridRow: i === 0 && heroImages.length > 2 ? '1 / 3' : undefined }}>
                <Image src={img} alt={`${region.name} — TRIMOSA Apartment`} fill sizes={i === 0 ? '(max-width: 768px) 100vw, 60vw' : '(max-width: 768px) 50vw, 30vw'} style={{ objectFit: 'cover' }} priority={i === 0} />
              </div>
            ))}
          </div>
        )}

        {region.intro.map((p) => (
          <p key={p.slice(0, 24)} style={{ fontSize: '15.5px', lineHeight: 1.75, color: '#3A3427', margin: '0 0 14px', maxWidth: '760px' }}>{p}</p>
        ))}

        {/* ── Highlights ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px', margin: '30px 0 42px' }}>
          {region.highlights.map((h) => (
            <div key={h.title} style={{ background: '#fff', borderRadius: '16px', border: '1px solid #EDE9DE', padding: '18px 18px 16px' }}>
              <div style={{ fontSize: '26px', marginBottom: '8px' }}>{h.emoji}</div>
              <p style={{ fontSize: '14px', fontWeight: 700, color: '#1A1400', margin: '0 0 4px' }}>{h.title}</p>
              <p style={{ fontSize: '13px', color: '#6B6455', margin: 0, lineHeight: 1.55 }}>{h.text}</p>
            </div>
          ))}
        </div>

        {/* ── Interactive experience map ── */}
        <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#1A1400', margin: '0 0 6px', letterSpacing: '-0.01em' }}>
          Entdecken: {region.name} interaktiv
        </h2>
        <p style={{ fontSize: '14px', color: '#6B6455', margin: '0 0 16px' }}>
          Sehenswürdigkeiten, Rad- und Wanderziele und Familien-Ausflüge — zusammen mit unseren Apartments auf einer Karte.
        </p>
        <RegionMap pois={region.pois} listings={mapListings} center={region.center} zoom={region.zoom} />

        {/* ── Listings ── */}
        <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#1A1400', margin: '44px 0 16px', letterSpacing: '-0.01em' }}>
          Unsere Apartments in {region.name}
        </h2>
        {regionListings.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
            {regionListings.map((l) => {
              const rating = buildCardRating(l as Record<string, unknown>)
              const img = (l.images as string[] | null)?.[0]
              return (
                <Link key={l.id} href={`/listing/${l.slug ?? l.id}`} className="listing-card" style={{ display: 'block', textDecoration: 'none', borderRadius: '14px', backgroundColor: '#fff', border: '1px solid #EAE7E0' }}>
                  <div style={{ position: 'relative', aspectRatio: '4/3', background: '#EDEBE4', overflow: 'hidden', borderRadius: '13px 13px 0 0' }}>
                    {img && <Image src={img} alt={l.title} fill sizes="(max-width: 768px) 50vw, 25vw" style={{ objectFit: 'cover' }} />}
                  </div>
                  {rating && (
                    <div style={{ display: 'flex', padding: '0 12px', marginTop: '-14px', position: 'relative', zIndex: 2 }}>
                      <ScoreBadge rating={rating} />
                    </div>
                  )}
                  <div style={{ padding: rating ? '7px 13px 13px' : '11px 13px 13px' }}>
                    <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#111', margin: 0, lineHeight: 1.3 }}>{l.title}</h3>
                    <p style={{ fontSize: '11.5px', color: '#999', margin: '5px 0 0', lineHeight: 1 }}>{l.max_guests} Gäste · {l.bedrooms} Schlafzimmer</p>
                  </div>
                </Link>
              )
            })}
          </div>
        ) : (
          <p style={{ fontSize: '14px', color: '#6B6455' }}>Aktuell sind hier keine Apartments verfügbar — schau bald wieder vorbei.</p>
        )}

        {/* ── CTA + cross links ── */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px', marginTop: '36px' }}>
          <Link href={`/?q=${encodeURIComponent(region.locationMatch)}`} style={{
            display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '14px', fontWeight: 700,
            padding: '13px 26px', borderRadius: '999px', color: '#1A1400',
            background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))', textDecoration: 'none',
          }}>Verfügbarkeit prüfen →</Link>
          <span style={{ fontSize: '13px', color: '#8A8065' }}>
            Weitere Regionen:{' '}
            {otherRegions.map((r, i) => (
              <span key={r.slug}>
                <Link href={`/region/${r.slug}`} style={{ color: 'var(--gold-dark)', fontWeight: 600 }}>{r.name}</Link>
                {i < otherRegions.length - 1 ? ' · ' : ''}
              </span>
            ))}
          </span>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer style={{ borderTop: '1px solid #EEEBE4', padding: '24px 20px', background: '#fff' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <span style={{ fontSize: '11px', color: '#AAA6A0' }}>© 2026 TRIMOSA Apartments &amp; Homes</span>
          <div style={{ display: 'flex', gap: '20px' }}>
            {[{ label: 'Über uns', href: '/ueber-uns' }, { label: 'Impressum', href: '/impressum' }, { label: 'Datenschutz', href: '/datenschutz' }, { label: 'AGB', href: '/agb' }].map((item) => (
              <Link key={item.href} href={item.href} style={{ fontSize: '11px', color: '#AAA6A0', textDecoration: 'none' }}>{item.label}</Link>
            ))}
          </div>
        </div>
      </footer>
    </div>
  )
}
