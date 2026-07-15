import type { Metadata } from 'next'
import LegalShell, { LegalSection, LegalP } from '@/components/LegalShell'

// First visit per language AI-translates the page (then cached)
export const maxDuration = 120

export const metadata: Metadata = {
  title: 'AGB',
  description: 'Allgemeine Geschäftsbedingungen der TRIMOSA Apartments & Homes eGbR für die Vermietung von Ferienwohnungen.',
}

export default function AgbPage() {
  return (
    <LegalShell title="Allgemeine Geschäftsbedingungen (AGB)" updated="Juli 2026">
      <LegalSection heading="1. Geltungsbereich">
        <LegalP>
          Diese Allgemeinen Geschäftsbedingungen (AGB) gelten für sämtliche Mietverhältnisse über
          Ferienwohnungen, die über die Plattform <strong>trimosa.de</strong> zwischen dem Mieter
          (nachfolgend „Gast“) und der TRIMOSA Apartments &amp; Homes eGbR, Feldkirchener Str. 18a,
          85622 Weißenfeld (nachfolgend „Vermieter“), zustande kommen. Abweichende Bedingungen des
          Gastes werden nicht anerkannt, es sei denn, der Vermieter stimmt deren Geltung
          ausdrücklich schriftlich zu.
        </LegalP>
      </LegalSection>

      <LegalSection heading="2. Vertragsabschluss und Buchung">
        <LegalP>
          Die Darstellung der Unterkünfte auf der Plattform stellt kein rechtlich bindendes Angebot,
          sondern eine Aufforderung zur Abgabe einer Buchung dar. Je nach Unterkunft stehen zwei
          Buchungswege zur Verfügung:
        </LegalP>
        <LegalP>
          <strong>a) Sofortbuchung:</strong> Mit Abschluss des Buchungsvorgangs und erfolgreicher
          Bezahlung kommt der Mietvertrag verbindlich zustande.
        </LegalP>
        <LegalP>
          <strong>b) Buchungsanfrage:</strong> Der Gast sendet eine unverbindliche Anfrage. Der
          Mietvertrag kommt erst mit der ausdrücklichen Bestätigung durch den Vermieter zustande.
          Lehnt der Vermieter die Anfrage ab, wird ein bereits gezahlter Betrag vollständig
          zurückerstattet.
        </LegalP>
        <LegalP>
          Welcher Buchungsweg für eine Unterkunft möglich ist, wird beim jeweiligen Inserat
          angezeigt.
        </LegalP>
      </LegalSection>

      <LegalSection heading="3. Preise und Zahlung">
        <LegalP>
          Es gelten die zum Zeitpunkt der Buchung beim jeweiligen Inserat angegebenen Preise. Der
          Gesamtmietpreis ist – sofern nicht ausdrücklich anders vereinbart – im Voraus fällig und
          wird online per Kreditkarte über unseren Zahlungsdienstleister Stripe abgewickelt. Der
          Mietpreis versteht sich inklusive der gesetzlichen Umsatzsteuer.
        </LegalP>
      </LegalSection>

      <LegalSection heading="4. Stornierung durch den Gast">
        <LegalP>
          Für die Stornierung gilt die <strong>Stornierungsrichtlinie, die beim jeweiligen Inserat
          angegeben ist</strong> und dem Gast vor Abschluss der Buchung angezeigt wird. Die
          Unterkünfte können unterschiedlichen Richtlinien (z. B. flexibel, moderat oder streng)
          unterliegen; maßgeblich ist stets die für die konkrete Buchung angezeigte und bestätigte
          Richtlinie.
        </LegalP>
        <LegalP>
          Eine fristgerechte Stornierung führt zu einer Rückerstattung in der nach der jeweiligen
          Richtlinie vorgesehenen Höhe. Erstattungen erfolgen über denselben Zahlungsweg, über den
          die Zahlung geleistet wurde.
        </LegalP>
        <LegalP>
          Ein gesetzliches Widerrufsrecht besteht bei der Vermietung von Ferienwohnungen zu einem
          bestimmten Termin bzw. Zeitraum gemäß § 312g Abs. 2 Nr. 9 BGB nicht.
        </LegalP>
      </LegalSection>

      <LegalSection heading="5. Mietdauer, An- und Abreise">
        <LegalP>
          Die Mietdauer ergibt sich aus der Buchungsbestätigung. An- und Abreisezeiten richten sich
          nach den beim jeweiligen Inserat angegebenen Check-in- und Check-out-Zeiten. Eine
          Verlängerung des Aufenthalts ist nur nach vorheriger Zustimmung des Vermieters möglich.
        </LegalP>
      </LegalSection>

      <LegalSection heading="6. Pflichten und Verhalten des Gastes">
        <LegalP>
          Die Ferienwohnung ist pfleglich zu behandeln. Es gelten die beim jeweiligen Inserat
          angegebenen Hausregeln (u. a. zu Rauchen, Haustieren, Ruhezeiten und Veranstaltungen).
          Schäden, die durch den Gast oder mitreisende Personen verursacht werden, sind dem
          Vermieter unverzüglich mitzuteilen und vom Gast zu ersetzen. Die Unterkunft darf nur von
          der in der Buchung angegebenen Anzahl an Personen genutzt werden. Eine Untervermietung
          oder Überlassung an Dritte ist untersagt.
        </LegalP>
      </LegalSection>

      <LegalSection heading="7. Haftung des Vermieters">
        <LegalP>
          Der Vermieter haftet für Schäden nur bei Vorsatz oder grober Fahrlässigkeit. Bei der
          Verletzung wesentlicher Vertragspflichten (Kardinalpflichten) haftet der Vermieter auch
          bei einfacher Fahrlässigkeit, jedoch begrenzt auf den vertragstypischen, vorhersehbaren
          Schaden. Die Haftung für Schäden aus der Verletzung des Lebens, des Körpers oder der
          Gesundheit bleibt unberührt. Eine Haftung für Störungen der Wasser-, Strom- oder
          Internetversorgung sowie für Ereignisse höherer Gewalt ist ausgeschlossen. Für persönliche
          Gegenstände des Gastes wird keine Haftung übernommen.
        </LegalP>
      </LegalSection>

      <LegalSection heading="8. Rücktritt durch den Vermieter">
        <LegalP>
          Der Vermieter ist berechtigt, aus wichtigem Grund vom Vertrag zurückzutreten, insbesondere
          wenn die Ferienwohnung aufgrund unvorhersehbarer Umstände (z. B. Schäden, höhere Gewalt)
          nicht nutzbar ist. In diesem Fall wird der bereits gezahlte Mietpreis vollständig
          zurückerstattet. Weitergehende Ansprüche des Gastes, insbesondere Schadensersatzansprüche,
          bestehen nicht.
        </LegalP>
      </LegalSection>

      <LegalSection heading="9. Datenschutz">
        <LegalP>
          Personenbezogene Daten des Gastes werden ausschließlich im Rahmen der geltenden
          Datenschutzgesetze verarbeitet. Einzelheiten enthält unsere{' '}
          <a href="/datenschutz" style={{ color: 'var(--gold)' }}>Datenschutzerklärung</a>.
        </LegalP>
      </LegalSection>

      <LegalSection heading="10. Schlussbestimmungen">
        <LegalP>
          Sollte eine Bestimmung dieser AGB ganz oder teilweise unwirksam sein oder werden, bleibt
          die Wirksamkeit der übrigen Bestimmungen hiervon unberührt. Es gilt das Recht der
          Bundesrepublik Deutschland.
        </LegalP>
      </LegalSection>
    </LegalShell>
  )
}
