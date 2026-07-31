import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import NavBar from '@/components/NavBar'
import ScoreBadge from '@/components/ScoreBadge'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getPriceFromMap } from '@/lib/price-from'
import { buildCardRating } from '@/lib/rating'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trimosa.de'

/**
 * §226b: Niederländische Landingpage — KEINE Übersetzung der deutschen
 * LPs, sondern eine eigene Seite auf den nativen NL-Keywords
 * („vakantiehuis eifel", „vakantiewoning eifel"): Die Eifel ist ein
 * Top-Reiseziel für Niederländer, 17 % unseres Traffics ist Benelux.
 * Nur unter /nl/… gültig (html lang="nl" via §174-Middleware).
 */
export const revalidate = 3600

const META_TITLE = 'Vakantiehuis in de Eifel — direct van de verhuurder'
const META_DESC = 'Vakantiehuis in de Zuid-Eifel aan de rivier de Sauer, bij Trier en in Bitburg. Boek direct bij de verhuurder: 5–10% goedkoper dan de platforms, self-check-in met deurcode en Nederlandstalige service.'

type Props = { params: Promise<{ lang: string }> }

export function generateStaticParams() {
  return [{ lang: 'nl' }]
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params
  if (lang !== 'nl') return {}
  return {
    title: META_TITLE,
    description: META_DESC,
    alternates: { canonical: `${siteUrl}/nl/vakantiehuis-eifel` },
    openGraph: {
      title: META_TITLE,
      description: META_DESC,
      url: `${siteUrl}/nl/vakantiehuis-eifel`,
      siteName: 'TRIMOSA Apartments & Homes',
      images: [{ url: `${siteUrl}/og.jpg`, width: 1200, height: 630 }],
      locale: 'nl_NL',
      type: 'website',
    },
  }
}

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: 'Spreken jullie Nederlands?',
    a: 'Schrijf ons gewoon in het Nederlands — onze chat vertaalt automatisch en je krijgt in het Nederlands antwoord. Ook de website en je persoonlijke digitale gastenmap (met wifi-gegevens, deurcode en tips voor de omgeving) zijn volledig in het Nederlands beschikbaar.',
  },
  {
    q: 'Hoe werkt het inchecken?',
    a: 'Volledig digitaal: alle woningen hebben een slim deurslot met cijfercode. Je persoonlijke deurcode verschijnt enkele dagen voor aankomst automatisch in je digitale gastenmap — geen sleuteloverdracht, je komt aan wanneer het jou uitkomt.',
  },
  {
    q: 'Waarom direct boeken en niet via Airbnb of Booking?',
    a: 'Op trimosa.de betaal je geen bemiddelings- en servicekosten: dezelfde woning kost je in dezelfde periode op de platforms gemiddeld 5–10% meer. Vind je dezelfde periode daar toch goedkoper, dan passen wij onze prijs aan (laagste-prijs-garantie).',
  },
  {
    q: 'Wat kun je doen in de Zuid-Eifel en het Sauertal?',
    a: 'Direct voor de deur: het Sauertal-fietspad, kanoën en kajakken op de Sauer, wandelen in de Teufelsschlucht en het Müllerthal — de „Kleine Luxemburgse Zwitserland". Echternach ligt om de hoek en de Romeinse stad Trier (Porta Nigra, Dom) is dichtbij. Onze digitale gastenmap en de reisgids op de website staan vol tips.',
  },
  {
    q: 'Kan ik mijn elektrische auto opladen?',
    a: 'Ja — bij het huis in Minden aan de Sauer staat een eigen laadpunt (wallbox). Betalen gaat eenvoudig per QR-code met je bankkaart, zonder app.',
  },
]

const USPS = [
  { icon: '🏷️', title: 'Laagste-prijs-garantie', text: 'Geen platformkosten — op de boekingsplatforms betaal je gemiddeld 5–10% meer.' },
  { icon: '🔑', title: 'Self-check-in', text: 'Je deurcode verschijnt automatisch in je digitale gastenmap — geen sleuteloverdracht.' },
  { icon: '🇳🇱', title: 'Nederlandstalige service', text: 'Website, gastenmap en chat in het Nederlands — schrijf ons gewoon in je eigen taal.' },
  { icon: '⭐', title: 'Echte beoordelingen', text: 'Ruim 1.500 gastbeoordelingen via Airbnb, Booking.com, Google en FeWo-direkt.' },
]

interface Card {
  id: string; slug?: string; title: string; city: string
  maxGuests: number; bedrooms: number; priceFrom: number | null
  rating: ReturnType<typeof buildCardRating>; image?: string
}

function CardGrid({ cards }: { cards: Card[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(78vw, 250px), 1fr))', gap: 16 }}>
      {cards.map((card) => (
        <Link key={card.id} href={`/nl/listing/${card.slug ?? card.id}`} className="listing-card"
          style={{ display: 'block', textDecoration: 'none', borderRadius: 14, backgroundColor: '#fff', border: '1px solid #EAE7E0' }}>
          <div style={{ position: 'relative', aspectRatio: '4/3', background: '#E8E4DC', overflow: 'hidden', borderRadius: '13px 13px 0 0' }}>
            {card.image && (
              <Image src={card.image} alt={`${card.title} — vakantiehuis in de Eifel`} fill sizes="(max-width: 768px) 78vw, 250px" style={{ objectFit: 'cover' }} />
            )}
            <div style={{ position: 'absolute', top: 10, left: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.92)', color: '#333' }}>{card.city}</span>
            </div>
          </div>
          {card.rating && (
            <div style={{ display: 'flex', padding: '0 12px', marginTop: -14, position: 'relative', zIndex: 2 }}>
              <ScoreBadge rating={card.rating} />
            </div>
          )}
          <div style={{ padding: card.rating ? '7px 13px 13px' : '11px 13px 13px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
              <h3 style={{ fontSize: 13.5, fontWeight: 600, color: '#111', margin: 0, lineHeight: 1.3, flex: 1 }}>{card.title}</h3>
              {(card.priceFrom ?? 0) > 0 && (
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: '#999' }}>vanaf </span>€{card.priceFrom}
                  </span>
                  <span style={{ fontSize: 10, color: '#999', display: 'block', lineHeight: 1 }}>/nacht</span>
                </div>
              )}
            </div>
            <p style={{ fontSize: 11, color: '#999', margin: '5px 0 0', lineHeight: 1 }}>
              {card.maxGuests} gasten · {card.bedrooms} slaapkamers
            </p>
          </div>
        </Link>
      ))}
    </div>
  )
}

export default async function VakantiehuisEifelPage({ params }: Props) {
  const { lang } = await params
  if (lang !== 'nl') notFound()

  const { data: listings } = await supabaseAdmin
    .from('listings')
    .select('*')
    .eq('is_active', true)
  const priceFromMap = await getPriceFromMap()

  const toCard = (l: Record<string, unknown>): Card => ({
    id: l.id as string,
    slug: (l.slug as string | null) ?? undefined,
    title: l.title as string,
    city: (l.city as string) || (l.location as string) || '',
    maxGuests: (l.max_guests as number) || 0,
    bedrooms: (l.bedrooms as number) || 0,
    priceFrom: priceFromMap[l.id as string] ?? null,
    rating: buildCardRating(l),
    image: (() => {
      const flat = (l.images as string[] | null) ?? []
      if (flat[0]) return flat[0]
      const rooms = (l.rooms as { images?: string[] }[] | null) ?? []
      for (const r of rooms) { if (r.images?.[0]) return r.images[0] }
      return undefined
    })(),
  })
  const byCity = (matches: string[]) => (listings ?? [])
    .filter((l) => {
      const city = String(l.city ?? l.location ?? '').toLowerCase()
      return matches.some((m) => city.includes(m))
    })
    .map((l) => toCard(l as Record<string, unknown>))

  const sauerCards = byCity(['sauer', 'minden', 'ralingen'])
  const bitburgCards = byCity(['bitburg'])
  const trierCards = byCity(['sirzenich', 'trier'])

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map((i) => ({
      '@type': 'Question',
      name: i.q,
      acceptedAnswer: { '@type': 'Answer', text: i.a },
    })),
  }
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Start', item: `${siteUrl}/nl` },
      { '@type': 'ListItem', position: 2, name: 'Vakantiehuis in de Eifel', item: `${siteUrl}/nl/vakantiehuis-eifel` },
    ],
  }

  const h2Style = { fontSize: 19, fontWeight: 800, color: '#111', margin: '30px 0 14px' } as const

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F5F5F7' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <NavBar lang="nl" />

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '36px 20px 70px' }}>
        <p style={{ fontSize: 12.5, color: '#999', margin: '0 0 14px' }}>
          <Link href="/nl" style={{ color: '#999', textDecoration: 'none' }}>Start</Link>
          {' · '}
          <span style={{ color: '#555' }}>Vakantiehuis in de Eifel</span>
        </p>

        <h1 style={{ fontSize: 'clamp(24px, 4vw, 34px)', fontWeight: 800, color: '#111', margin: '0 0 14px', letterSpacing: '-0.5px', lineHeight: 1.2 }}>
          Vakantiehuis in de Eifel — <span style={{ background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>direct van de verhuurder</span>
        </h1>
        <p style={{ fontSize: 15, color: '#555', lineHeight: 1.75, margin: '0 0 12px', maxWidth: 780 }}>
          Op zoek naar een vakantiehuis of vakantiewoning in de Duitse Eifel? Onze zeven appartementen liggen in de Zuid-Eifel — in Minden en Ralingen direct aan de rivier de Sauer, op de grens met Luxemburg — en in Bitburg en Sirzenich bij de Romeinse stad Trier. Veel van onze gasten komen uit Nederland en België: de regio is vanuit de Benelux makkelijk bereikbaar en je zit hier midden in de natuur, met fietsen, kanoën en wandelen voor de deur.
        </p>
        <p style={{ fontSize: 15, color: '#555', lineHeight: 1.75, margin: '0 0 12px', maxWidth: 780 }}>
          Je boekt direct bij de verhuurders — drie vrienden, geen anoniem platform: zonder bemiddelingskosten, met laagste-prijs-garantie en volledig digitale check-in. Je deurcode verschijnt enkele dagen voor aankomst automatisch in je persoonlijke gastenmap — in het Nederlands.
        </p>

        <h2 style={h2Style}>Aan de Sauer — Zuid-Eifel, grens Luxemburg</h2>
        <p style={{ fontSize: 14, color: '#666', lineHeight: 1.7, margin: '0 0 14px', maxWidth: 780 }}>
          Direct aan de rivier: kanoën en kajakken op de Sauer, het Sauertal-fietspad voor de deur, de Teufelsschlucht en het Müllerthal om de hoek. Gratis parkeren bij het huis; in Minden laad je je elektrische auto aan de eigen wallbox.
        </p>
        <CardGrid cards={sauerCards} />

        <h2 style={h2Style}>In Bitburg</h2>
        <p style={{ fontSize: 14, color: '#666', lineHeight: 1.7, margin: '0 0 14px', maxWidth: 780 }}>
          Centraal in het bekende bierstadje: de Bitburger Erlebniswelt en het Cascade-zwembad liggen op een paar minuten.
        </p>
        <CardGrid cards={bitburgCards} />

        <h2 style={h2Style}>Bij Trier — Sirzenich</h2>
        <p style={{ fontSize: 14, color: '#666', lineHeight: 1.7, margin: '0 0 14px', maxWidth: 780 }}>
          Rustig wonen net buiten de stad: in zo&apos;n tien minuten sta je bij de Porta Nigra, de Dom en de Hauptmarkt van Trier — en je parkeert gratis bij het huis.
        </p>
        <CardGrid cards={trierCards} />

        <h2 style={h2Style}>Waarom direct bij TRIMOSA boeken</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {USPS.map((u) => (
            <div key={u.title} style={{ background: '#fff', borderRadius: 14, border: '1px solid #EAE7E0', padding: '16px 16px 14px' }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>{u.icon}</div>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#111', margin: '0 0 4px' }}>{u.title}</p>
              <p style={{ fontSize: 12.5, color: '#666', lineHeight: 1.55, margin: 0 }}>{u.text}</p>
            </div>
          ))}
        </div>

        <h2 style={h2Style}>Veelgestelde vragen</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {FAQ_ITEMS.map((i, idx) => (
            <details key={idx} style={{ background: '#fff', borderRadius: 16, border: '1px solid #E5E5EA', padding: '4px 18px', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
              <summary style={{ fontSize: 15, fontWeight: 700, color: '#111', padding: '13px 0', cursor: 'pointer', listStylePosition: 'inside' }}>{i.q}</summary>
              <p style={{ fontSize: 14, color: '#4A4438', lineHeight: 1.7, margin: '0 0 15px', paddingLeft: 2 }}>{i.a}</p>
            </details>
          ))}
        </div>

        <div style={{ marginTop: 30, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <Link href="/nl/region/suedeifel" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--gold)', textDecoration: 'none' }}>
            Reisgids Zuid-Eifel & Sauertal →
          </Link>
          <Link href="/nl/faq" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--gold)', textDecoration: 'none' }}>
            Alle veelgestelde vragen →
          </Link>
          <Link href="/nl" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--gold)', textDecoration: 'none' }}>
            Alle accommodaties →
          </Link>
        </div>
      </div>
    </div>
  )
}
