import type { Metadata } from 'next'
import LegalShell, { LegalSection, LegalP } from '@/components/LegalShell'

// First visit per language AI-translates the page (then cached)
export const maxDuration = 120

export const metadata: Metadata = {
  title: 'Impressum',
  description: 'Impressum der TRIMOSA Apartments & Homes eGbR.',
}

export default function ImpressumPage() {
  return (
    <LegalShell title="Impressum">
      <LegalSection heading="Angaben gemäß § 5 TMG">
        <LegalP>
          TRIMOSA Apartments &amp; Homes eGbR<br />
          Feldkirchener Str. 18a<br />
          85622 Weißenfeld
        </LegalP>
      </LegalSection>

      <LegalSection heading="Rechtsform">
        <LegalP>eingetragene Gesellschaft bürgerlichen Rechts (eGbR)</LegalP>
      </LegalSection>

      <LegalSection heading="Vertreten durch">
        <LegalP>
          Die TRIMOSA Apartments &amp; Homes eGbR wird vertreten durch die Inhaber
          Johannes Görgen, Pascal Junk und Dominik Palzer.
        </LegalP>
      </LegalSection>

      <LegalSection heading="Kontakt">
        <LegalP>
          E-Mail: <a href="mailto:mail@trimosa.de" style={{ color: 'var(--gold)' }}>mail@trimosa.de</a>
        </LegalP>
      </LegalSection>

      <LegalSection heading="Umsatzsteuer-ID">
        <LegalP>
          Umsatzsteuer-Identifikationsnummer gemäß § 27 a Umsatzsteuergesetz:<br />
          DE452429162
        </LegalP>
      </LegalSection>

      <LegalSection heading="Verbraucherstreitbeilegung / Universalschlichtungsstelle">
        <LegalP>
          Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS)
          bereit, die Sie unter{' '}
          <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)' }}>
            ec.europa.eu/consumers/odr/
          </a>{' '}
          finden. Unsere E-Mail-Adresse finden Sie oben im Impressum.
        </LegalP>
        <LegalP>
          Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer
          Verbraucherschlichtungsstelle teilzunehmen.
        </LegalP>
      </LegalSection>

      <LegalSection heading="Haftung für Inhalte">
        <LegalP>
          Als Diensteanbieter sind wir gemäß § 7 Abs. 1 TMG für eigene Inhalte auf diesen Seiten
          nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 TMG sind wir als
          Diensteanbieter jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde
          Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige
          Tätigkeit hinweisen. Verpflichtungen zur Entfernung oder Sperrung der Nutzung von
          Informationen nach den allgemeinen Gesetzen bleiben hiervon unberührt.
        </LegalP>
      </LegalSection>

      <LegalSection heading="Haftung für Links">
        <LegalP>
          Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen
          Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr
          übernehmen. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder
          Betreiber der Seiten verantwortlich.
        </LegalP>
      </LegalSection>

      <LegalSection heading="Urheberrecht">
        <LegalP>
          Die durch die Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen
          dem deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art
          der Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen der schriftlichen
          Zustimmung des jeweiligen Autors bzw. Erstellers.
        </LegalP>
      </LegalSection>
    </LegalShell>
  )
}
