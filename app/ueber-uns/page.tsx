import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { supabaseAdmin } from '@/lib/supabase-admin'
import NavBar from '@/components/NavBar'
import { buildCardRating } from '@/lib/rating'
import { REGIONS } from '@/lib/regions'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trimosa-app.vercel.app'

// Re-render at most hourly so listing photos, counts and scores stay fresh
export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Über uns — TRIMOSA Apartments & Homes',
  description:
    'Drei Freunde, eine Idee: moderne Ferienwohnungen in Trier, an Mosel, Sauer und Saar. TRI·MO·SA — unser Name ist unsere Heimat. Lerne uns kennen.',
  alternates: { canonical: `${siteUrl}/ueber-uns` },
}

const FOUNDERS = [
  { name: 'Johannes Görgen', initials: 'JG' },
  { name: 'Pascal Junk', initials: 'PJ' },
  { name: 'Dominik Palzer', initials: 'DP' },
]

const VALUES = [
  { emoji: '🔑', title: 'Ankommen', text: 'Flexibler Self-Check-in mit elektronischen Türschlössern, klare Infos vorab, keine Wartezeiten. Einfach Schlüsselcode rein und da sein.' },
  { emoji: '🛋️', title: 'Wohlfühlen', text: 'Frisch renoviert, durchdacht eingerichtet, ehrlich fotografiert. Schnelles WLAN, Smart-TV, vollwertige Küchen — ein Zuhause auf Zeit, kein Hotelzimmer.' },
  { emoji: '🥾', title: 'Entdecken', text: 'Wir sind hier aufgewachsen: Von der Mosel bis zur Teufelsschlucht geben wir euch unsere Lieblingsorte mit — ohne Umwege über Reiseführer-Floskeln.' },
]

export default async function UeberUnsPage() {
  const { data: listings } = await supabaseAdmin
    .from('listings')
    .select('*')
    .eq('is_active', true)

  const all = listings ?? []
  const apartmentCount = all.length
  // Aggregate review stats across all listings (weighted)
  let totalScore = 0
  let totalCount = 0
  for (const l of all) {
    const r = buildCardRating(l as Record<string, unknown>)
    if (r) { totalScore += r.overall * r.count; totalCount += r.count }
  }
  const avgScore = totalCount > 0 ? (totalScore / totalCount).toFixed(2).replace('.', ',') : null

  const collageImages: string[] = all
    .map((l) => (l.images as string[] | null)?.[0])
    .filter((img): img is string => !!img)
    .slice(0, 4)

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F5F5F7' }}>
      <NavBar />

      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '40px 20px 60px' }}>

        {/* ── Hero ── */}
        <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 8px', textAlign: 'center' }}>
          Über TRIMOSA
        </p>
        <h1 style={{ fontSize: 'clamp(28px, 5vw, 42px)', fontWeight: 800, color: '#1A1400', letterSpacing: '-0.02em', margin: '0 auto 14px', lineHeight: 1.15, textAlign: 'center', maxWidth: '640px' }}>
          Drei Freunde. Eine Region. Ein Zuhause auf Zeit.
        </h1>
        <p style={{ fontSize: '16px', lineHeight: 1.75, color: '#3A3427', margin: '0 auto 30px', maxWidth: '660px', textAlign: 'center' }}>
          TRIMOSA ist ein junges, regional verwurzeltes Unternehmen aus der Region Trier. Was mit einer
          gemeinsamen Leidenschaft für Immobilien und Gastfreundschaft begann, sind heute moderne
          Ferienwohnungen zwischen Mosel und Eifel — jede einzelne handverlesen, frisch renoviert und
          persönlich eingerichtet.
        </p>

        {/* ── Photo collage ── */}
        {collageImages.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(collageImages.length, 4)}, 1fr)`, gap: '10px', margin: '0 0 36px', height: 'clamp(140px, 22vw, 220px)' }}>
            {collageImages.map((img, i) => (
              <div key={img} style={{ position: 'relative', borderRadius: '14px', overflow: 'hidden', transform: `translateY(${i % 2 === 0 ? 0 : 12}px)` }}>
                <Image src={img} alt="TRIMOSA Apartment" fill sizes="25vw" style={{ objectFit: 'cover' }} />
              </div>
            ))}
          </div>
        )}

        {/* ── Numbers ── */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 'clamp(24px, 6vw, 64px)', flexWrap: 'wrap', margin: '0 0 44px', padding: '22px 20px', background: '#fff', borderRadius: '18px', border: '1px solid #EDE9DE' }}>
          {[
            { value: String(apartmentCount), label: 'Apartments' },
            { value: String(Object.keys(REGIONS).length), label: 'Regionen' },
            ...(avgScore ? [{ value: `★ ${avgScore}`, label: `${totalCount} Bewertungen` }] : []),
            { value: '100 %', label: 'Direktbuchung' },
          ].map((s) => (
            <div key={s.label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 'clamp(22px, 4vw, 30px)', fontWeight: 800, color: '#1A1400', letterSpacing: '-0.02em' }}>{s.value}</div>
              <div style={{ fontSize: '12px', color: '#8A8065', fontWeight: 600, marginTop: '2px' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── Name story: TRI·MO·SA ── */}
        <div style={{
          margin: '0 0 44px', padding: 'clamp(26px, 5vw, 40px) clamp(20px, 4vw, 40px)',
          background: 'linear-gradient(135deg, #12222E, #1E3A4C)', borderRadius: '22px', textAlign: 'center',
        }}>
          <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.12em', textTransform: 'uppercase', margin: '0 0 18px' }}>
            Unser Name ist unsere Heimat
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'stretch', gap: 'clamp(8px, 2.5vw, 18px)', flexWrap: 'wrap' }}>
            {[
              { letters: 'TRI', stands: 'Trier', text: 'Deutschlands älteste Stadt — unser Zuhause und Ausgangspunkt.' },
              { letters: 'MO', stands: 'Mosel', text: 'Der Fluss, der die Region prägt — Weinberge, Radwege, Lebensgefühl.' },
              { letters: 'SA', stands: 'Sauer & Saar', text: 'Die wilden Täler — Südeifel, Luxemburg-Grenze und großes Riesling-Terroir.' },
            ].map((b, i) => (
              <div key={b.letters} style={{ display: 'flex', alignItems: 'center', gap: 'clamp(8px, 2.5vw, 18px)' }}>
                <div style={{ width: 'clamp(150px, 24vw, 210px)' }}>
                  <div style={{
                    fontSize: 'clamp(30px, 6vw, 46px)', fontWeight: 800, letterSpacing: '0.04em', lineHeight: 1,
                    background: 'linear-gradient(135deg, var(--gold), #E3C878)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
                  }}>{b.letters}</div>
                  <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#fff', margin: '7px 0 5px' }}>{b.stands}</div>
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.68)', lineHeight: 1.55 }}>{b.text}</div>
                </div>
                {i < 2 && <span style={{ fontSize: 'clamp(20px, 4vw, 30px)', color: 'rgba(255,255,255,0.25)', fontWeight: 300 }}>·</span>}
              </div>
            ))}
          </div>
        </div>

        {/* ── Story ── */}
        <div style={{ maxWidth: '700px', margin: '0 auto 44px' }}>
          <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#1A1400', margin: '0 0 12px', letterSpacing: '-0.01em' }}>Wie alles begann</h2>
          <p style={{ fontSize: '15px', lineHeight: 1.8, color: '#3A3427', margin: '0 0 12px' }}>
            Johannes, Pascal und Dominik kennen sich seit Jahren — und teilen neben der Freundschaft
            zwei Dinge: die Begeisterung für schöne Räume und die Überzeugung, dass unsere Heimat
            zwischen Mosel, Sauer und Eifel mehr Besucher verdient, die sie so erleben wie wir.
          </p>
          <p style={{ fontSize: '15px', lineHeight: 1.8, color: '#3A3427', margin: '0 0 12px' }}>
            Aus der ersten gemeinsam renovierten Wohnung wurde schnell mehr. Heute betreiben wir als
            TRIMOSA Apartments &amp; Homes eine wachsende Familie von Ferienwohnungen in Trier,
            Bitburg und der Südeifel — und erweitern sie Stück für Stück um{' '}
            <em>immer neue Orte zum Ankommen, Wohlfühlen und Entdecken</em>. Als Nächstes:
            vier Apartments im denkmalgeschützten ehemaligen Weingut in{' '}
            <Link href="/region/saar" style={{ color: 'var(--gold-dark)', fontWeight: 600 }}>Kanzem an der Saar</Link>{' '}
            und eine dritte Wohnung in Minden an der Sauer.
          </p>
          <p style={{ fontSize: '15px', lineHeight: 1.8, color: '#3A3427', margin: 0 }}>
            Dabei bleibt alles in unserer Hand: Wir richten selbst ein, schreiben unsere Texte selbst,
            und wenn ihr bucht, bucht ihr direkt bei uns — ohne Vermittler, ohne versteckte Gebühren.
          </p>
        </div>

        {/* ── Values ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', margin: '0 0 44px' }}>
          {VALUES.map((v) => (
            <div key={v.title} style={{ background: '#fff', borderRadius: '16px', border: '1px solid #EDE9DE', padding: '22px 20px' }}>
              <div style={{ fontSize: '28px', marginBottom: '10px' }}>{v.emoji}</div>
              <p style={{ fontSize: '15px', fontWeight: 700, color: '#1A1400', margin: '0 0 6px' }}>{v.title}</p>
              <p style={{ fontSize: '13.5px', color: '#6B6455', margin: 0, lineHeight: 1.6 }}>{v.text}</p>
            </div>
          ))}
        </div>

        {/* ── Founders ── */}
        <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#1A1400', margin: '0 0 16px', letterSpacing: '-0.01em', textAlign: 'center' }}>Die drei hinter TRIMOSA</h2>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 'clamp(16px, 4vw, 40px)', flexWrap: 'wrap', margin: '0 0 48px' }}>
          {FOUNDERS.map((f) => (
            <div key={f.name} style={{ textAlign: 'center' }}>
              <div style={{
                width: '84px', height: '84px', borderRadius: '50%', margin: '0 auto 10px',
                background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '26px', fontWeight: 800, color: '#fff', letterSpacing: '0.02em',
                boxShadow: '0 6px 18px rgba(174,141,45,0.3)',
              }}>{f.initials}</div>
              <p style={{ fontSize: '14px', fontWeight: 700, color: '#1A1400', margin: 0 }}>{f.name}</p>
              <p style={{ fontSize: '12px', color: '#8A8065', margin: '2px 0 0' }}>Gründer &amp; Gastgeber</p>
            </div>
          ))}
        </div>

        {/* ── Regions ── */}
        <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#1A1400', margin: '0 0 14px', letterSpacing: '-0.01em', textAlign: 'center' }}>Unsere Regionen</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', margin: '0 0 40px' }}>
          {Object.values(REGIONS).map((r) => (
            <Link key={r.slug} href={`/region/${r.slug}`} style={{ display: 'block', textDecoration: 'none', background: '#fff', borderRadius: '16px', border: '1px solid #EDE9DE', padding: '20px', transition: 'box-shadow 0.15s' }}>
              <p style={{ fontSize: '15px', fontWeight: 700, color: '#1A1400', margin: '0 0 4px' }}>{r.name}</p>
              <p style={{ fontSize: '13px', color: '#6B6455', margin: '0 0 10px', lineHeight: 1.5 }}>{r.claim}</p>
              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--gold-dark)' }}>Region entdecken →</span>
            </Link>
          ))}
        </div>

        {/* ── CTA ── */}
        <div style={{ textAlign: 'center' }}>
          <Link href="/?view=map" style={{
            display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '14px', fontWeight: 700,
            padding: '14px 30px', borderRadius: '999px', color: '#1A1400',
            background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))', textDecoration: 'none',
          }}>Alle Unterkünfte ansehen →</Link>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer style={{ borderTop: '1px solid #EEEBE4', padding: '24px 20px', background: '#fff' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <span style={{ fontSize: '11px', color: '#AAA6A0' }}>© 2026 TRIMOSA Apartments &amp; Homes</span>
          <div style={{ display: 'flex', gap: '20px' }}>
            {[{ label: 'Impressum', href: '/impressum' }, { label: 'Datenschutz', href: '/datenschutz' }, { label: 'AGB', href: '/agb' }].map((item) => (
              <Link key={item.href} href={item.href} style={{ fontSize: '11px', color: '#AAA6A0', textDecoration: 'none' }}>{item.label}</Link>
            ))}
          </div>
        </div>
      </footer>
    </div>
  )
}
