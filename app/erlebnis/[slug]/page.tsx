import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { supabaseAdmin } from '@/lib/supabase-admin'
import NavBar from '@/components/NavBar'
import RegionMap, { type RegionMapListing } from '@/components/RegionMap'
import KomootEmbed from '@/components/KomootEmbed'
import ScoreBadge from '@/components/ScoreBadge'
import { getEmpfehlungen } from '@/lib/empfehlungen'
import EmpfehlungBubble from '@/components/EmpfehlungBubble'
import { buildCardRating } from '@/lib/rating'
import { POI_CATEGORIES, allPois, findPoi } from '@/lib/regions'
import { getUiLang } from '@/lib/i18n-server'
import { makeTr } from '@/lib/static-translate'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trimosa-app.vercel.app'

// Re-render at most hourly so listing photos and scores stay fresh
export const revalidate = 3600
export const maxDuration = 120

export function generateStaticParams() {
  return allPois().map(({ poi }) => ({ slug: poi.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const hit = findPoi(slug)
  if (!hit) return {}
  const { region, poi } = hit
  const title = `${poi.name} — Ausflugsziel in ${region.name}`
  const description = `${poi.text} Tipps & Karte von TRIMOSA — mit Ferienwohnungen in der Nähe.`
  return {
    title,
    description,
    alternates: { canonical: `${siteUrl}/erlebnis/${poi.slug}` },
    openGraph: { title, description, url: `${siteUrl}/erlebnis/${poi.slug}`, ...(poi.image ? { images: [poi.image.src] } : {}) },
  }
}

export default async function ErlebnisPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const hit = findPoi(slug)
  if (!hit) notFound()
  const { region, poi } = hit
  const category = POI_CATEGORIES[poi.category]
  const lang = await getUiLang()
  const foreignPois = allPois().filter(({ region: r }) => r.slug !== region.slug).map(({ poi: p }) => p)
  const siblingsAll = region.pois
  const T = await makeTr(lang, lang === 'de' ? [] : [
    poi.name, poi.text, ...poi.long,
    ...siblingsAll.flatMap((pp) => [pp.name, pp.short]),
    ...foreignPois.flatMap((pp) => [pp.name, pp.short]),
    ...(poi.komootTours ?? []).map((k) => k.title),
    category.label, 'Start',
    '💬 Persönliche Empfehlung deiner Gastgeber',
    'Lage & Umgebung',
    '{p} zusammen mit weiteren Ausflugszielen und unseren Apartments in {r}.',
    'Passende Touren',
    'Handverlesene Komoot-Touren zu diesem Ziel — Karte, Höhenprofil und GPX zum Nachfahren.',
    'Übernachten in der Nähe', 'Gäste', 'Schlafzimmer',
    'Mehr entdecken in {r}', 'Zur Region {r} →', 'Verfügbarkeit prüfen', 'Über uns',
  ])

  const { data: listings } = await supabaseAdmin
    .from('listings')
    .select('*')
    .eq('is_active', true)
    .ilike('location', `%${region.locationMatch}%`)
    .order('created_at', { ascending: false })

  const regionListings = listings ?? []
  const empfehlungen = await getEmpfehlungen()
  const poiEmp = empfehlungen.poi[poi.slug]
  const mapListings: RegionMapListing[] = regionListings
    .filter((l) => l.latitude != null && l.longitude != null)
    .map((l) => ({ id: l.id, slug: l.slug ?? undefined, title: l.title, lat: Number(l.latitude), lon: Number(l.longitude) }))

  const siblings = region.pois.filter((p) => p.slug !== poi.slug)

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Start', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: region.name, item: `${siteUrl}/region/${region.slug}` },
      { '@type': 'ListItem', position: 3, name: poi.name, item: `${siteUrl}/erlebnis/${poi.slug}` },
    ],
  }

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TouristAttraction',
    name: poi.name,
    description: poi.text,
    url: `${siteUrl}/erlebnis/${poi.slug}`,
    ...(poi.image ? { image: poi.image.src } : {}),
    geo: { '@type': 'GeoCoordinates', latitude: poi.lat, longitude: poi.lon },
    containedInPlace: { '@type': 'TouristDestination', name: region.name, url: `${siteUrl}/region/${region.slug}` },
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F5F5F7' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <NavBar lang={lang} />

      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '28px 20px 60px' }}>

        {/* ── Breadcrumb ── */}
        <p style={{ fontSize: '12.5px', color: '#8A8065', margin: '0 0 18px' }}>
          <Link href="/" style={{ color: '#8A8065', textDecoration: 'none' }}>{T('Start')}</Link>
          {' · '}
          <Link href={`/region/${region.slug}`} style={{ color: 'var(--gold-dark)', textDecoration: 'none', fontWeight: 600 }}>{region.name}</Link>
          {' · '}
          <span style={{ color: '#3A3427', fontWeight: 600 }}>{T(poi.name)}</span>
        </p>

        {/* ── Hero photo (Wikimedia Commons, proxied through next/image) ── */}
        {poi.image && (
          <div style={{ position: 'relative', height: 'clamp(200px, 34vw, 380px)', borderRadius: '20px', overflow: 'hidden', marginBottom: '22px', boxShadow: '0 10px 36px rgba(0,0,0,0.14)' }}>
            <Image src={poi.image.src} alt={poi.name} fill sizes="(max-width: 900px) 100vw, 900px" style={{ objectFit: 'cover' }} priority />
            <div style={{ position: 'absolute', inset: '55% 0 0 0', background: 'linear-gradient(to top, rgba(10,16,22,0.55), transparent)' }} />
            <span style={{ position: 'absolute', left: '16px', bottom: '12px', fontSize: 'clamp(20px, 3.5vw, 30px)', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.5))' }}>{poi.emoji}</span>
            <a href={poi.image.fileUrl} target="_blank" rel="noopener nofollow" style={{
              position: 'absolute', right: '10px', bottom: '10px', fontSize: '10px', color: 'rgba(255,255,255,0.85)',
              background: 'rgba(10,16,22,0.55)', padding: '4px 10px', borderRadius: '999px', textDecoration: 'none',
              backdropFilter: 'blur(6px)', maxWidth: '75%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              📷 {poi.image.author} · {poi.image.license} · Wikimedia Commons
            </a>
          </div>
        )}

        {/* ── Hero ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px', marginBottom: '18px', flexWrap: 'wrap' }}>
          {!poi.image && (
          <div style={{
            width: '84px', height: '84px', borderRadius: '26px', flexShrink: 0,
            background: `linear-gradient(135deg, ${category.color}22, ${category.color}0D)`,
            border: `2px solid ${category.color}44`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '42px',
          }}>{poi.emoji}</div>
          )}
          <div style={{ minWidth: '220px', flex: 1 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700,
              color: category.color, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px',
            }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: category.color }} />
              {T(category.label)} · {region.name}
            </span>
            <h1 style={{ fontSize: 'clamp(24px, 4.5vw, 36px)', fontWeight: 800, color: '#1A1400', letterSpacing: '-0.02em', margin: 0, lineHeight: 1.12 }}>
              {T(poi.name)}
            </h1>
          </div>
        </div>

        <p style={{ fontSize: '16.5px', lineHeight: 1.65, color: '#3A3427', fontWeight: 600, margin: '0 0 18px', maxWidth: '720px' }}>
          {T(poi.text)}
        </p>
        {poi.long.map((p) => (
          <p key={p.slice(0, 24)} style={{ fontSize: '15px', lineHeight: 1.8, color: '#3A3427', margin: '0 0 14px', maxWidth: '720px' }}>{T(p)}</p>
        ))}

        {/* ── Hosts' personal recommendation ── */}
        {poiEmp && poiEmp.length > 0 && (
          <div style={{
            maxWidth: '720px', margin: '24px 0 8px', borderRadius: '18px', padding: '18px 20px 16px',
            background: 'linear-gradient(135deg, #FDF9EE, #FAF3DD)', border: '1.5px solid var(--gold)',
            boxShadow: '0 6px 24px rgba(174,141,45,0.14)',
          }}>
            <p style={{ fontSize: '11px', fontWeight: 800, color: 'var(--gold-dark)', letterSpacing: '0.09em', textTransform: 'uppercase', margin: '0 0 12px' }}>
              {T('💬 Persönliche Empfehlung deiner Gastgeber')}
            </p>
            <EmpfehlungBubble empfehlungen={poiEmp} />
          </div>
        )}

        {/* ── Map ── */}
        <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#1A1400', margin: '34px 0 6px', letterSpacing: '-0.01em' }}>
          {T('Lage & Umgebung')}
        </h2>
        <p style={{ fontSize: '13.5px', color: '#6B6455', margin: '0 0 14px' }}>
          {T('{p} zusammen mit weiteren Ausflugszielen und unseren Apartments in {r}.').replace('{p}', T(poi.name)).replace('{r}', region.name)}
        </p>
        <RegionMap
          pois={region.pois.map((pp) => ({ ...pp, name: T(pp.name), short: T(pp.short) }))}
          listings={mapListings}
          center={[poi.lat, poi.lon]}
          zoom={12}
          showFilter={false}
          highlightSlug={poi.slug}
          height="clamp(300px, 45vh, 440px)"
          extraPois={foreignPois.map((pp) => ({ ...pp, name: T(pp.name), short: T(pp.short) }))}
          lang={lang}
        />

        {/* ── Matching Komoot tours (only when curated for this POI) ── */}
        {poi.komootTours && poi.komootTours.length > 0 && (
          <>
            <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#1A1400', margin: '36px 0 6px', letterSpacing: '-0.01em' }}>
              {T('Passende Touren')}
            </h2>
            <p style={{ fontSize: '13.5px', color: '#6B6455', margin: '0 0 14px' }}>
              {T('Handverlesene Komoot-Touren zu diesem Ziel — Karte, Höhenprofil und GPX zum Nachfahren.')}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: '14px' }}>
              {poi.komootTours.map((t) => {
                const emp = empfehlungen.tour[t.embedUrl]
                return (
                  <div key={t.embedUrl} style={emp ? { border: '1.5px solid var(--gold)', borderRadius: '18px', padding: '10px', background: '#FDFBF4', boxShadow: '0 4px 20px rgba(174,141,45,0.14)' } : undefined}>
                    {emp && <div style={{ margin: '2px 2px 10px' }}><EmpfehlungBubble empfehlungen={emp} /></div>}
                    <KomootEmbed title={T(t.title)} embedUrl={t.embedUrl} lang={lang} />
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* ── Nearby apartments ── */}
        {regionListings.length > 0 && (
          <>
            <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#1A1400', margin: '40px 0 14px', letterSpacing: '-0.01em' }}>
              {T('Übernachten in der Nähe')}
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '16px' }}>
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
                      <p style={{ fontSize: '11.5px', color: '#999', margin: '5px 0 0', lineHeight: 1 }}>{l.max_guests} {T('Gäste')} · {l.bedrooms} {T('Schlafzimmer')}</p>
                    </div>
                  </Link>
                )
              })}
            </div>
          </>
        )}

        {/* ── More destinations in the region ── */}
        <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#1A1400', margin: '40px 0 14px', letterSpacing: '-0.01em' }}>
          {T('Mehr entdecken in {r}').replace('{r}', region.name)}
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          {siblings.map((p) => {
            const c = POI_CATEGORIES[p.category].color
            return (
              <Link key={p.slug} href={`/erlebnis/${p.slug}`} style={{
                display: 'inline-flex', alignItems: 'center', gap: '8px', textDecoration: 'none',
                padding: '9px 15px 9px 11px', borderRadius: '999px', background: '#fff',
                border: '1px solid #E8E4DA', fontSize: '13px', fontWeight: 600, color: '#3A3427',
                boxShadow: `inset 3px 0 0 ${c}`,
              }}>
                <span style={{ fontSize: '15px' }}>{p.emoji}</span>{T(p.name)}
              </Link>
            )
          })}
        </div>

        {/* ── CTA ── */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px', marginTop: '38px' }}>
          <Link href={`/region/${region.slug}`} style={{
            display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '14px', fontWeight: 700,
            padding: '13px 26px', borderRadius: '999px', color: '#1A1400',
            background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))', textDecoration: 'none',
          }}>{T('Zur Region {r} →').replace('{r}', region.name)}</Link>
          <Link href={`/?q=${encodeURIComponent(region.locationMatch)}`} style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--gold-dark)', textDecoration: 'none' }}>
            {T('Verfügbarkeit prüfen')}
          </Link>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer style={{ borderTop: '1px solid #EEEBE4', padding: '24px 20px', background: '#fff' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <span style={{ fontSize: '11px', color: '#AAA6A0' }}>© 2026 TRIMOSA Apartments &amp; Homes</span>
          <div style={{ display: 'flex', gap: '20px' }}>
            {[{ label: T('Über uns'), href: '/ueber-uns' }, { label: 'Impressum', href: '/impressum' }, { label: 'Datenschutz', href: '/datenschutz' }, { label: 'AGB', href: '/agb' }].map((item) => (
              <Link key={item.href} href={item.href} style={{ fontSize: '11px', color: '#AAA6A0', textDecoration: 'none' }}>{item.label}</Link>
            ))}
          </div>
        </div>
      </footer>
    </div>
  )
}
