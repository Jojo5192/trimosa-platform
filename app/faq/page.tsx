import type { Metadata } from 'next'
import Link from 'next/link'
import NavBar from '@/components/NavBar'
import { getUiLang } from '@/lib/i18n-server'
import { isUiLang, type UiLang } from '@/lib/i18n'
import { t } from '@/lib/i18n'
import { makeTr } from '@/lib/static-translate'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trimosa-app.vercel.app'

/**
 * ❓ FAQ (§161-Jupas ⑤): häufige Fragen als natives <details>-Accordion —
 * alle Texte stehen im SSR-HTML, dazu FAQPage-Strukturdaten (Chance auf
 * FAQ-Rich-Results). Übersetzt sich je Sprache automatisch (makeTr-Cache).
 */
export const revalidate = 3600
export const maxDuration = 120

const META_TITLE = 'Häufige Fragen (FAQ)'
const META_DESC = 'Antworten auf die häufigsten Fragen zu Buchung, Check-in, Türcode, Stornierung und Bezahlung bei TRIMOSA Apartments & Homes.'

export async function generateMetadata({ searchParams }: { searchParams?: Promise<{ lang?: string }> } = {}): Promise<Metadata> {
  const spLang = (await searchParams)?.lang
  const lang = isUiLang(spLang ?? '') ? (spLang as UiLang) : 'de'
  const tr = await makeTr(lang, lang === 'de' ? [] : [META_TITLE, META_DESC])
  const languages = {
    de: `${siteUrl}/faq`,
    en: `${siteUrl}/en/faq`, fr: `${siteUrl}/fr/faq`, nl: `${siteUrl}/nl/faq`,
    'x-default': `${siteUrl}/faq`,
  }
  return {
    title: tr(META_TITLE),
    description: tr(META_DESC),
    alternates: { canonical: lang === 'de' ? `${siteUrl}/faq` : `${siteUrl}/${lang}/faq`, languages },
  }
}

// Nur belegte Fakten — keine erfundenen Leistungen.
const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: 'Wann kann ich einchecken und bis wann muss ich auschecken?',
    a: 'Der Check-in ist ab 16:00 Uhr möglich, der Check-out bis 10:00 Uhr. Die genauen Zeiten deiner Wohnung findest du auf der Inseratsseite und in deiner persönlichen digitalen Gästemappe.',
  },
  {
    q: 'Wie funktioniert der Check-in? Brauche ich einen Schlüssel?',
    a: 'Alle Wohnungen haben Self-Check-in mit smartem Türschloss: Du bekommst einen persönlichen Türcode, der wenige Tage vor deiner Anreise automatisch in deiner digitalen Gästemappe erscheint. Kein Schlüsselübergabe-Termin nötig — du reist an, wann es dir passt.',
  },
  {
    q: 'Was ist die digitale Gästemappe?',
    a: 'Mit deiner Buchung erhältst du einen persönlichen Link zu deiner digitalen Gästemappe: Anfahrt, Parken, WLAN-Zugangsdaten, dein Türcode, Hausregeln und Tipps für die Region — alles an einem Ort, in deiner Sprache, und mit direktem Chat zu uns Gastgebern.',
  },
  {
    q: 'Wie bezahle ich meine Buchung?',
    a: 'Die Zahlung läuft sicher per Kreditkarte über unseren Zahlungsdienstleister Stripe. Nach Zahlungseingang bekommst du sofort deine Buchungsbestätigung per E-Mail.',
  },
  {
    q: 'Warum sollte ich direkt bei TRIMOSA buchen statt über ein Portal?',
    a: 'Auf trimosa.de zahlst du keine Vermittlungs- und Servicegebühren: Dieselbe Wohnung kostet dich zum selben Zeitraum auf den Portalen im Schnitt 5–10 % mehr. Dazu gilt unsere Bestpreis-Garantie — findest du denselben Zeitraum dort günstiger, gleichen wir den Preis an.',
  },
  {
    q: 'Kann ich meine Buchung stornieren?',
    a: 'Ja — es gilt die Stornierungsrichtlinie, die beim jeweiligen Inserat angezeigt wird (flexibel, moderat oder strikt). Stornieren kannst du selbst in deinem Gastbereich unter „Meine Reisen"; Erstattungen gehen automatisch auf dein Zahlungsmittel zurück. Alle Details findest du auf unserer Stornierungs-Seite.',
  },
  {
    q: 'Bekomme ich eine Rechnung?',
    a: 'Ja, automatisch: Deine Rechnung wird am Anreisetag erstellt und steht danach in deinem Gastbereich unter „Meine Reisen" als PDF bereit. Brauchst du einen abweichenden Rechnungsempfänger (z. B. deine Firma), schreib uns einfach vorab im Chat.',
  },
  {
    q: 'Sind Haustiere erlaubt?',
    a: 'Das ist je Wohnung unterschiedlich — du findest die Angabe in den Hausregeln auf der jeweiligen Inseratsseite. Schreib uns bei Fragen gern vorab über den Chat.',
  },
  {
    q: 'Gibt es WLAN in den Wohnungen?',
    a: 'Ja, alle Wohnungen haben kostenloses WLAN. Die Zugangsdaten findest du in deiner digitalen Gästemappe — inklusive QR-Code zum bequemen Verbinden weiterer Geräte.',
  },
  {
    q: 'In welchen Sprachen kann ich euch erreichen?',
    a: 'Schreib uns einfach in deiner Sprache — unser Chat übersetzt automatisch. Die Website und die Gästemappe gibt es auf Deutsch, Englisch, Französisch und Niederländisch.',
  },
  {
    q: 'Gibt es einen Mindestaufenthalt?',
    a: 'Je nach Wohnung und Zeitraum kann ein Mindestaufenthalt gelten. Der Buchungskalender auf der Inseratsseite zeigt dir direkt, welche Zeiträume buchbar sind.',
  },
]

export default async function FaqPage({ searchParams }: { searchParams?: Promise<{ lang?: string }> } = {}) {
  const spLang = (await searchParams)?.lang
  const lang = isUiLang(spLang ?? '') ? (spLang as UiLang) : await getUiLang()
  const TR = await makeTr(lang, lang === 'de' ? [] : FAQ_ITEMS.flatMap((i) => [i.q, i.a]))
  const items = FAQ_ITEMS.map((i) => ({ q: TR(i.q), a: TR(i.a) }))

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((i) => ({
      '@type': 'Question',
      name: i.q,
      acceptedAnswer: { '@type': 'Answer', text: i.a },
    })),
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F5F5F7' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <NavBar lang={lang} />
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '40px 20px 70px' }}>
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--gold)', textTransform: 'uppercase', margin: '0 0 8px' }}>
          FAQ
        </p>
        <h1 style={{ fontSize: 30, fontWeight: 800, color: '#111', margin: '0 0 10px', letterSpacing: '-0.5px' }}>
          {t(lang, 'Häufige Fragen')}
        </h1>
        <p style={{ fontSize: 14.5, color: '#666', lineHeight: 1.7, margin: '0 0 28px' }}>
          {t(lang, 'Alles Wichtige zu Buchung, Anreise und Aufenthalt — und wenn etwas fehlt, schreib uns einfach über den Chat.')}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((i, idx) => (
            <details key={idx} style={{
              background: '#fff', borderRadius: 16, border: '1px solid #E5E5EA',
              padding: '4px 18px', boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
            }}>
              <summary style={{ fontSize: 15, fontWeight: 700, color: '#111', padding: '13px 0', cursor: 'pointer', listStylePosition: 'inside' }}>
                {i.q}
              </summary>
              <p style={{ fontSize: 14, color: '#4A4438', lineHeight: 1.7, margin: '0 0 15px', paddingLeft: 2 }}>{i.a}</p>
            </details>
          ))}
        </div>

        <div style={{ marginTop: 30, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <Link href="/stornierung" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--gold)', textDecoration: 'none' }}>
            {t(lang, 'Stornierung & Erstattung')} →
          </Link>
          <Link href="/" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--gold)', textDecoration: 'none' }}>
            {t(lang, 'Unterkünfte entdecken')} →
          </Link>
        </div>
      </div>
    </div>
  )
}
