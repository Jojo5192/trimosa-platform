import type { Metadata } from 'next'
import LegalShell, { LegalSection, LegalP } from '@/components/LegalShell'

// §161-Jupas ⑤: Storno-/Erstattungs-Richtlinien als eigene, verlinkte Seite
// (Inhalte existierten bisher nur je Inserat + in den AGB).
// First visit per language AI-translates the page (then cached)
export const maxDuration = 120

export const metadata: Metadata = {
  title: 'Stornierung & Erstattung',
  description: 'Stornierungsbedingungen und Erstattungen bei TRIMOSA Apartments & Homes — Richtlinien, Ablauf und Fristen im Überblick.',
}

export default function StornierungPage() {
  return (
    <LegalShell title="Stornierung & Erstattung">
      <LegalSection heading="Welche Stornierungsbedingungen gelten für meine Buchung?">
        <LegalP>
          Verbindlich ist immer die Stornierungsrichtlinie, die beim
          jeweiligen Inserat angezeigt wird — du siehst sie vor der Buchung
          direkt in der Buchungsbox und danach in deiner Buchungsübersicht.
          Wir verwenden drei Richtlinien-Typen: <strong>Flexibel</strong>{' '}
          (kostenlose Stornierung bis kurz vor Check-in),{' '}
          <strong>Moderat</strong> (kostenlose Stornierung bis einige Tage
          vor Check-in) und <strong>Strikt</strong> (eingeschränkte
          Stornierung). Die genauen Fristen und Erstattungssätze deiner
          Wohnung stehen am Inserat.
        </LegalP>
      </LegalSection>

      <LegalSection heading="Wie storniere ich?">
        <LegalP>
          Am einfachsten selbst in deinem Gastbereich: „Meine Reisen" →
          Buchung öffnen → „Buchung stornieren". Die geltenden Bedingungen
          und eine eventuelle Erstattung werden dir vor der Bestätigung
          angezeigt. Alternativ kannst du uns jederzeit über den Chat oder
          per E-Mail erreichen — wir kümmern uns dann darum.
        </LegalP>
      </LegalSection>

      <LegalSection heading="Wann und wie erhalte ich meine Erstattung?">
        <LegalP>
          Erstattungen veranlassen wir automatisch auf das bei der Buchung
          verwendete Zahlungsmittel. Je nach Bank dauert die Gutschrift in
          der Regel 5–10 Werktage. Du erhältst eine Bestätigung per E-Mail,
          sobald die Erstattung veranlasst wurde.
        </LegalP>
      </LegalSection>

      <LegalSection heading="Was passiert bei Buchungsanfragen?">
        <LegalP>
          Bei Wohnungen mit Buchung auf Anfrage wird deine Zahlung bereits
          bei der Anfrage erfasst. Können wir die Anfrage nicht bestätigen,
          erhältst du automatisch den vollen Betrag zurück.
        </LegalP>
      </LegalSection>

      <LegalSection heading="Buchungen über Airbnb, Booking.com oder FeWo-direkt">
        <LegalP>
          Hast du über ein Portal gebucht, gelten die Stornierungs- und
          Erstattungsbedingungen des jeweiligen Portals — bitte storniere
          in diesem Fall auch direkt dort.
        </LegalP>
      </LegalSection>

      <LegalSection heading="Widerrufsrecht">
        <LegalP>
          Bei Beherbergungsleistungen zu einem festen Termin besteht gemäß
          § 312g Abs. 2 Nr. 9 BGB kein gesetzliches Widerrufsrecht — es
          gelten die oben beschriebenen Stornierungsbedingungen. Details
          findest du in unseren AGB.
        </LegalP>
      </LegalSection>
    </LegalShell>
  )
}
