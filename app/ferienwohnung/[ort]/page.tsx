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
 * §226: Kommerzielle Standort-Landingpages („Ferienwohnung <Ort>") — die
 * /region/*-Seiten sind Reiseführer; DIESE Seiten zielen auf die
 * Buchungs-Suchanfragen (Search-Console-Befund 30.07.: „ferienwohnung
 * bitburg" 18 Impressionen ohne Klick, „ferienwohnung trier" 0 Impressionen).
 * Bewusst NUR deutsch (deutsche Keywords), Inhalte rein faktenbasiert.
 */
export const revalidate = 3600
export const dynamicParams = false

interface OrtConfig {
  h1: string
  metaTitle: string
  metaDesc: string
  /** listings.city muss einen dieser Teilstrings enthalten */
  cityMatch: string[]
  regionSlug: string
  regionLabel: string
  intro: string[]
  faq: { q: string; a: string }[]
}

const ORTE: Record<string, OrtConfig> = {
  bitburg: {
    h1: 'Ferienwohnung in Bitburg',
    metaTitle: 'Ferienwohnung Bitburg — direkt vom Gastgeber buchen',
    metaDesc: 'Ferienwohnung in Bitburg direkt vom Gastgeber: Bestpreis ohne Portalgebühren, Self-Check-in per Türcode, kostenloses WLAN. Jetzt verfügbare Termine prüfen.',
    cityMatch: ['bitburg'],
    regionSlug: 'bitburg',
    regionLabel: 'Bitburg & Umgebung',
    intro: [
      'Du suchst eine Ferienwohnung in Bitburg? Bei uns buchst du direkt beim Gastgeber — ohne Vermittlungs- und Servicegebühren der Portale und mit Bestpreis-Garantie. Unsere Wohnung in Bitburg liegt zentral: Die Bitburger Erlebniswelt, das Cascade-Erlebnisbad und die Innenstadt erreichst du in wenigen Minuten.',
      'Der Check-in läuft komplett digital: Dein persönlicher Türcode erscheint automatisch wenige Tage vor der Anreise in deiner digitalen Gästemappe — kein Schlüsselübergabe-Termin, du reist an, wann es dir passt.',
    ],
    faq: [
      { q: 'Wo liegt die Ferienwohnung in Bitburg?', a: 'Unser City Home liegt zentral in Bitburg — Innenstadt, Bitburger Erlebniswelt und das Cascade-Erlebnisbad sind in wenigen Minuten erreichbar. Die genaue Lage mit Karte findest du auf der Inseratsseite.' },
      { q: 'Kann ich in Bitburg ohne Schlüsselübergabe einchecken?', a: 'Ja — alle TRIMOSA-Wohnungen haben Self-Check-in mit smartem Türschloss. Dein persönlicher Türcode erscheint automatisch wenige Tage vor der Anreise in deiner digitalen Gästemappe.' },
      { q: 'Warum direkt buchen statt über Airbnb oder Booking?', a: 'Auf trimosa.de zahlst du keine Vermittlungs- und Servicegebühren: Dieselbe Wohnung kostet dich zum selben Zeitraum auf den Portalen im Schnitt 5–10 % mehr. Findest du denselben Zeitraum dort trotzdem günstiger, gleichen wir den Preis an.' },
      { q: 'Gibt es WLAN und Parkmöglichkeiten?', a: 'Ja — kostenloses WLAN ist in allen Wohnungen inklusive (Zugangsdaten samt QR-Code in der Gästemappe), und in unmittelbarer Nähe der Wohnung gibt es kostenlose Parkmöglichkeiten.' },
    ],
  },
  trier: {
    h1: 'Ferienwohnung bei Trier',
    metaTitle: 'Ferienwohnung Trier (Sirzenich) — direkt vom Gastgeber buchen',
    metaDesc: 'Ferienwohnung bei Trier in ruhiger Lage (Sirzenich): Bestpreis ohne Portalgebühren, kostenlose Parkplätze, Self-Check-in per Türcode. Jetzt verfügbare Termine prüfen.',
    cityMatch: ['sirzenich', 'trier'],
    regionSlug: 'trier',
    regionLabel: 'Trier & Umgebung',
    intro: [
      'Du suchst eine Ferienwohnung in Trier oder Umgebung? Unsere drei Wohnungen liegen in Sirzenich — einem ruhigen Ortsteil direkt vor den Toren der Stadt. Porta Nigra, Dom und Hauptmarkt erreichst du mit dem Auto in rund zehn Minuten, parkst aber kostenlos direkt am Haus statt teuer in der Innenstadt.',
      'Gebucht wird direkt beim Gastgeber: ohne Portalgebühren, mit Bestpreis-Garantie und komplett digitalem Check-in — dein Türcode erscheint automatisch wenige Tage vor der Anreise in deiner digitalen Gästemappe.',
    ],
    faq: [
      { q: 'Wie weit ist es von Sirzenich in die Trierer Innenstadt?', a: 'Mit dem Auto brauchst du rund zehn Minuten bis in die Trierer Innenstadt (Porta Nigra, Dom, Hauptmarkt). Dafür wohnst du ruhig, ohne Stadtlärm — und parkst kostenlos direkt am Haus.' },
      { q: 'Gibt es kostenlose Parkplätze?', a: 'Ja — an unseren Wohnungen in Sirzenich parkst du kostenlos direkt am Haus. Die genaue Parksituation mit Fotos findest du in deiner digitalen Gästemappe.' },
      { q: 'Wie funktioniert der Check-in?', a: 'Komplett digital: Alle Wohnungen haben smarte Türschlösser mit Zahlencode. Dein persönlicher Code erscheint automatisch wenige Tage vor der Anreise in deiner digitalen Gästemappe — kein Schlüsseltermin nötig.' },
      { q: 'Warum direkt buchen statt über ein Portal?', a: 'Auf trimosa.de zahlst du keine Vermittlungs- und Servicegebühren: Dieselbe Wohnung kostet dich zum selben Zeitraum auf den Portalen im Schnitt 5–10 % mehr. Dazu gilt unsere Bestpreis-Garantie.' },
    ],
  },
  suedeifel: {
    h1: 'Ferienwohnung Südeifel & Sauertal',
    metaTitle: 'Ferienwohnung Südeifel & Sauertal — direkt vom Gastgeber buchen',
    metaDesc: 'Ferienwohnung im Sauertal an der Grenze zu Luxemburg: direkt am Fluss, Bestpreis ohne Portalgebühren, Self-Check-in, E-Auto-Ladepunkt. Jetzt Termine prüfen.',
    cityMatch: ['sauer', 'minden', 'ralingen'],
    regionSlug: 'suedeifel',
    regionLabel: 'Südeifel & Sauertal',
    intro: [
      'Du suchst eine Ferienwohnung in der Südeifel? Unsere Wohnungen liegen in Minden und Ralingen direkt an der Sauer — dem Grenzfluss zu Luxemburg. Vor der Tür: der Sauertal-Radweg, Kanutouren auf der Sauer, die Teufelsschlucht und das Müllerthal; Echternach und Trier sind schnell erreicht.',
      'Gebucht wird direkt beim Gastgeber: ohne Portalgebühren, mit Bestpreis-Garantie und digitalem Check-in per Türcode. In Minden lädst du dein E-Auto an der hauseigenen Wallbox.',
    ],
    faq: [
      { q: 'Wo liegen die Ferienwohnungen genau?', a: 'In Minden an der Sauer und in Ralingen — beide Orte liegen direkt am Fluss an der Grenze zu Luxemburg. Echternach, die Teufelsschlucht und das Müllerthal sind in wenigen Minuten erreichbar, Trier in rund einer halben Stunde.' },
      { q: 'Kann ich mein E-Auto laden?', a: 'Ja — am Haus in Minden gibt es einen eigenen E-Auto-Ladepunkt (Wallbox). Bezahlt wird bequem per QR-Code und Karte, ganz ohne App.' },
      { q: 'Was kann ich im Sauertal unternehmen?', a: 'Direkt vor der Tür: der Sauertal-Radweg, Kanu- und Kajaktouren auf der Sauer, Wandern in der Teufelsschlucht und im Müllerthal (Luxemburgs „Kleine Schweiz"). Unsere digitale Gästemappe und der Reiseführer auf der Website stecken voller Tipps.' },
      { q: 'Wie funktioniert der Check-in?', a: 'Komplett digital: Dein persönlicher Türcode erscheint automatisch wenige Tage vor der Anreise in deiner digitalen Gästemappe — kein Schlüsseltermin, du reist an, wann es dir passt.' },
    ],
  },
}

export function generateStaticParams() {
  return Object.keys(ORTE).map((ort) => ({ ort }))
}

export async function generateMetadata({ params }: { params: Promise<{ ort: string }> }): Promise<Metadata> {
  const { ort } = await params
  const cfg = ORTE[ort]
  if (!cfg) return {}
  return {
    title: cfg.metaTitle,
    description: cfg.metaDesc,
    alternates: { canonical: `${siteUrl}/ferienwohnung/${ort}` },
    openGraph: {
      title: cfg.metaTitle,
      description: cfg.metaDesc,
      url: `${siteUrl}/ferienwohnung/${ort}`,
      siteName: 'TRIMOSA Apartments & Homes',
      images: [{ url: `${siteUrl}/og.jpg`, width: 1200, height: 630 }],
      locale: 'de_DE',
      type: 'website',
    },
  }
}

const USPS = [
  { icon: '🏷️', title: 'Bestpreis-Garantie', text: 'Ohne Portalgebühren — auf den Portalen zahlst du im Schnitt 5–10 % mehr.' },
  { icon: '🔑', title: 'Self-Check-in', text: 'Türcode kommt automatisch in deine digitale Gästemappe — kein Schlüsseltermin.' },
  { icon: '🤝', title: 'Direkt vom Gastgeber', text: 'Persönlicher Kontakt zu Johannes, Pascal & Dominik — Chat in deiner Sprache.' },
  { icon: '⭐', title: 'Echte Bewertungen', text: 'Über 1.500 Gästebewertungen von Airbnb, Booking.com, Google & FeWo-direkt.' },
]

export default async function FerienwohnungPage({ params }: { params: Promise<{ ort: string }> }) {
  const { ort } = await params
  const cfg = ORTE[ort]
  if (!cfg) notFound()

  const { data: listings } = await supabaseAdmin
    .from('listings')
    .select('*')
    .eq('is_active', true)
  const priceFromMap = await getPriceFromMap()

  const cards = (listings ?? [])
    .filter((l) => {
      const city = String(l.city ?? l.location ?? '').toLowerCase()
      return cfg.cityMatch.some((m) => city.includes(m))
    })
    .map((l) => ({
      id: l.id as string,
      slug: (l.slug as string | null) ?? undefined,
      title: l.title as string,
      city: (l.city as string) || (l.location as string) || '',
      maxGuests: (l.max_guests as number) || 0,
      bedrooms: (l.bedrooms as number) || 0,
      priceFrom: priceFromMap[l.id as string] ?? null,
      rating: buildCardRating(l as Record<string, unknown>),
      image: (() => {
        const flat = (l.images as string[] | null) ?? []
        if (flat[0]) return flat[0]
        const rooms = (l.rooms as { images?: string[] }[] | null) ?? []
        for (const r of rooms) { if (r.images?.[0]) return r.images[0] }
        return undefined
      })(),
    }))

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: cfg.faq.map((i) => ({
      '@type': 'Question',
      name: i.q,
      acceptedAnswer: { '@type': 'Answer', text: i.a },
    })),
  }
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Start', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: cfg.h1, item: `${siteUrl}/ferienwohnung/${ort}` },
    ],
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F5F5F7' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <NavBar lang="de" />

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '36px 20px 70px' }}>
        {/* Breadcrumb */}
        <p style={{ fontSize: 12.5, color: '#999', margin: '0 0 14px' }}>
          <Link href="/" style={{ color: '#999', textDecoration: 'none' }}>Start</Link>
          {' · '}
          <span style={{ color: '#555' }}>{cfg.h1}</span>
        </p>

        <h1 style={{ fontSize: 'clamp(24px, 4vw, 34px)', fontWeight: 800, color: '#111', margin: '0 0 14px', letterSpacing: '-0.5px', lineHeight: 1.2 }}>
          {cfg.h1} <span style={{ background: 'var(--gold)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>direkt vom Gastgeber</span>
        </h1>
        {cfg.intro.map((p, i) => (
          <p key={i} style={{ fontSize: 15, color: '#555', lineHeight: 1.75, margin: '0 0 12px', maxWidth: 780 }}>{p}</p>
        ))}

        {/* Wohnungs-Grid */}
        <h2 style={{ fontSize: 19, fontWeight: 800, color: '#111', margin: '30px 0 14px' }}>
          {cards.length === 1 ? 'Unsere Wohnung vor Ort' : `Unsere ${cards.length} Wohnungen vor Ort`}
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(78vw, 250px), 1fr))', gap: 16 }}>
          {cards.map((card) => (
            <Link key={card.id} href={`/listing/${card.slug ?? card.id}`} className="listing-card"
              style={{ display: 'block', textDecoration: 'none', borderRadius: 14, backgroundColor: '#fff', border: '1px solid #EAE7E0' }}>
              <div style={{ position: 'relative', aspectRatio: '4/3', background: '#E8E4DC', overflow: 'hidden', borderRadius: '13px 13px 0 0' }}>
                {card.image && (
                  <Image src={card.image} alt={`${card.title} — ${cfg.h1}`} fill sizes="(max-width: 768px) 78vw, 250px" style={{ objectFit: 'cover' }} />
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
                        <span style={{ fontSize: 10, fontWeight: 600, color: '#999' }}>ab </span>€{card.priceFrom}
                      </span>
                      <span style={{ fontSize: 10, color: '#999', display: 'block', lineHeight: 1 }}>/Nacht</span>
                    </div>
                  )}
                </div>
                <p style={{ fontSize: 11, color: '#999', margin: '5px 0 0', lineHeight: 1 }}>
                  {card.maxGuests} Gäste · {card.bedrooms} Schlafzimmer
                </p>
              </div>
            </Link>
          ))}
        </div>

        {/* USPs */}
        <h2 style={{ fontSize: 19, fontWeight: 800, color: '#111', margin: '34px 0 14px' }}>Darum direkt bei TRIMOSA buchen</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {USPS.map((u) => (
            <div key={u.title} style={{ background: '#fff', borderRadius: 14, border: '1px solid #EAE7E0', padding: '16px 16px 14px' }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>{u.icon}</div>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#111', margin: '0 0 4px' }}>{u.title}</p>
              <p style={{ fontSize: 12.5, color: '#666', lineHeight: 1.55, margin: 0 }}>{u.text}</p>
            </div>
          ))}
        </div>

        {/* FAQ */}
        <h2 style={{ fontSize: 19, fontWeight: 800, color: '#111', margin: '34px 0 14px' }}>Häufige Fragen</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cfg.faq.map((i, idx) => (
            <details key={idx} style={{ background: '#fff', borderRadius: 16, border: '1px solid #E5E5EA', padding: '4px 18px', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
              <summary style={{ fontSize: 15, fontWeight: 700, color: '#111', padding: '13px 0', cursor: 'pointer', listStylePosition: 'inside' }}>{i.q}</summary>
              <p style={{ fontSize: 14, color: '#4A4438', lineHeight: 1.7, margin: '0 0 15px', paddingLeft: 2 }}>{i.a}</p>
            </details>
          ))}
        </div>

        {/* Region-Teaser + weitere Links */}
        <div style={{ marginTop: 30, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <Link href={`/region/${cfg.regionSlug}`} style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--gold)', textDecoration: 'none' }}>
            Reiseführer {cfg.regionLabel} →
          </Link>
          <Link href="/faq" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--gold)', textDecoration: 'none' }}>
            Alle häufigen Fragen →
          </Link>
          <Link href="/" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--gold)', textDecoration: 'none' }}>
            Alle Unterkünfte →
          </Link>
        </div>
      </div>
    </div>
  )
}
