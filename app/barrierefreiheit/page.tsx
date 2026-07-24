import type { Metadata } from 'next'
import LegalShell, { LegalSection, LegalP } from '@/components/LegalShell'

// §161-Jupas ④: Erklärung zur Barrierefreiheit (BFSG, seit 28.06.2025 für
// Dienstleistungen im elektronischen Geschäftsverkehr). Ehrlich formuliert:
// teilweise konform, bekannte Einschränkungen benannt, Feedback-Weg offen.
// First visit per language AI-translates the page (then cached)
export const maxDuration = 120

export const metadata: Metadata = {
  title: 'Barrierefreiheit',
  description: 'Erklärung zur Barrierefreiheit der Website trimosa.de gemäß Barrierefreiheitsstärkungsgesetz (BFSG).',
}

export default function BarrierefreiheitPage() {
  return (
    <LegalShell title="Erklärung zur Barrierefreiheit">
      <LegalSection heading="Geltungsbereich">
        <LegalP>
          Diese Erklärung zur Barrierefreiheit gilt für die Website
          trimosa.de der TRIMOSA Apartments &amp; Homes eGbR, einschließlich
          der Buchungsstrecke und der digitalen Gästemappen. Sie wird auf
          Grundlage des Barrierefreiheitsstärkungsgesetzes (BFSG)
          veröffentlicht, das die europäische Richtlinie (EU) 2019/882
          (European Accessibility Act) umsetzt.
        </LegalP>
      </LegalSection>

      <LegalSection heading="Stand der Vereinbarkeit">
        <LegalP>
          Diese Website ist mit den Anforderungen der EN 301 549 bzw. den
          Web Content Accessibility Guidelines (WCAG) 2.1, Stufe AA,
          teilweise vereinbar. Wir arbeiten fortlaufend daran, die
          Barrierefreiheit weiter zu verbessern.
        </LegalP>
      </LegalSection>

      <LegalSection heading="Umgesetzte Maßnahmen">
        <LegalP>
          Die Website ist vollständig responsiv und mit Tastatur bedienbar,
          nutzt semantisches HTML mit strukturierten Überschriften, erlaubt
          das Zoomen auf allen öffentlichen Seiten, verwendet ausreichende
          Schriftgrößen sowie beschreibende Linktexte und stellt Inhalte in
          vier Sprachen (Deutsch, Englisch, Französisch, Niederländisch)
          bereit. Bilder der Unterkünfte und des Reiseführers tragen
          Alternativtexte.
        </LegalP>
      </LegalSection>

      <LegalSection heading="Bekannte Einschränkungen">
        <LegalP>
          Trotz unserer Bemühungen sind einzelne Bereiche noch nicht
          vollständig barrierefrei: Die interaktiven Landkarten
          (Unterkunfts- und Ausflugskarten) sind mit Screenreadern und rein
          per Tastatur nur eingeschränkt bedienbar — die dort gezeigten
          Informationen (Adressen, Ausflugsziele, Preise) stehen jedoch
          auch als Text auf den jeweiligen Seiten zur Verfügung. Vereinzelt
          können Farbkontraste dekorativer Elemente unter den empfohlenen
          Werten liegen. Von externen Plattformen übernommene Inhalte
          (z. B. eingebettete Radtouren-Karten) liegen außerhalb unseres
          Einflussbereichs.
        </LegalP>
      </LegalSection>

      <LegalSection heading="Barriere melden — Feedback und Kontakt">
        <LegalP>
          Sind Ihnen Mängel beim barrierefreien Zugang zu Inhalten von
          trimosa.de aufgefallen, oder benötigen Sie Informationen in einer
          zugänglicheren Form? Dann schreiben Sie uns gern an{' '}
          <a href="mailto:mail@trimosa.de" style={{ color: 'var(--gold)' }}>mail@trimosa.de</a>.
          Wir antworten in der Regel innerhalb weniger Tage und bemühen
          uns, gemeldete Barrieren zeitnah zu beheben.
        </LegalP>
      </LegalSection>

      <LegalSection heading="Durchsetzungsverfahren">
        <LegalP>
          Sollten Sie auf Mitteilungen oder Anfragen zur Barrierefreiheit
          keine zufriedenstellende Antwort erhalten, können Sie sich an die
          zuständige Marktüberwachungsbehörde wenden. Zentrale
          Anlaufstelle ist die Marktüberwachungsstelle der Länder für die
          Barrierefreiheit von Produkten und Dienstleistungen (MLBF),
          Sachsen-Anhalt.
        </LegalP>
      </LegalSection>

      <LegalSection heading="Erstellung dieser Erklärung">
        <LegalP>
          Diese Erklärung wurde am 24. Juli 2026 auf Grundlage einer
          Selbstbewertung erstellt und wird bei wesentlichen Änderungen der
          Website überprüft und aktualisiert.
        </LegalP>
      </LegalSection>
    </LegalShell>
  )
}
