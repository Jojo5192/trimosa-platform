import type { Metadata } from 'next'
import LegalShell, { LegalSection, LegalP } from '@/components/LegalShell'

export const metadata: Metadata = {
  title: 'Datenschutzerklärung',
  description: 'Informationen zur Verarbeitung personenbezogener Daten auf der TRIMOSA-Plattform.',
}

export default function DatenschutzPage() {
  return (
    <LegalShell title="Datenschutzerklärung" updated="Juli 2026">
      <LegalSection heading="1. Verantwortliche Stelle">
        <LegalP>
          Verantwortlich für die Datenverarbeitung auf dieser Plattform ist:
        </LegalP>
        <LegalP>
          TRIMOSA Apartments &amp; Homes eGbR<br />
          Feldkirchener Str. 18a<br />
          85622 Weißenfeld<br />
          E-Mail: <a href="mailto:mail@trimosa.de" style={{ color: 'var(--gold)' }}>mail@trimosa.de</a>
        </LegalP>
        <LegalP>
          Verantwortliche Stelle ist die natürliche oder juristische Person, die allein oder
          gemeinsam mit anderen über die Zwecke und Mittel der Verarbeitung von personenbezogenen
          Daten entscheidet.
        </LegalP>
      </LegalSection>

      <LegalSection heading="2. Allgemeine Hinweise und Rechtsgrundlagen">
        <LegalP>
          Wir verarbeiten personenbezogene Daten im Einklang mit der Datenschutz-Grundverordnung
          (DSGVO) und dem Bundesdatenschutzgesetz (BDSG). Rechtsgrundlagen der Verarbeitung sind je
          nach Zweck: die Erfüllung eines Vertrags oder vorvertraglicher Maßnahmen (Art. 6 Abs. 1
          lit. b DSGVO), die Erfüllung rechtlicher Verpflichtungen (Art. 6 Abs. 1 lit. c DSGVO),
          Ihre Einwilligung (Art. 6 Abs. 1 lit. a DSGVO) sowie unsere berechtigten Interessen an
          einem sicheren und funktionsfähigen Betrieb der Plattform (Art. 6 Abs. 1 lit. f DSGVO).
        </LegalP>
        <LegalP>
          Die Datenübertragung im Internet (z. B. bei der Kommunikation per E-Mail) kann
          Sicherheitslücken aufweisen. Ein lückenloser Schutz der Daten vor dem Zugriff durch Dritte
          ist nicht möglich. Diese Website nutzt zum Schutz der Übertragung eine TLS-Verschlüsselung
          (erkennbar an „https://“ und dem Schloss-Symbol im Browser).
        </LegalP>
      </LegalSection>

      <LegalSection heading="3. Hosting und Bereitstellung (Vercel)">
        <LegalP>
          Diese Plattform wird bei der Vercel Inc. (USA) gehostet. Beim Aufruf der Website werden
          technisch notwendige Daten (u. a. IP-Adresse, Datum und Uhrzeit des Zugriffs, aufgerufene
          Seite, Browsertyp und Betriebssystem) in Server-Logfiles verarbeitet, um die Auslieferung
          der Seite sicherzustellen und die technische Sicherheit zu gewährleisten. Rechtsgrundlage
          ist Art. 6 Abs. 1 lit. f DSGVO. Es findet eine Übermittlung in die USA statt; diese wird
          auf die Standardvertragsklauseln der EU-Kommission gestützt.
        </LegalP>
      </LegalSection>

      <LegalSection heading="4. Datenbank, Anmeldung und Speicherung (Supabase)">
        <LegalP>
          Für Nutzerkonten, Anmeldung, Datenbank und Datei-Speicherung (z. B. Profil- und
          Objektfotos) setzen wir Supabase ein (Supabase Inc., USA). Die Daten werden in einem
          Rechenzentrum innerhalb der Europäischen Union (Region Frankfurt, Deutschland)
          gespeichert. Rechtsgrundlage ist die Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO) sowie
          unser berechtigtes Interesse am sicheren Betrieb (Art. 6 Abs. 1 lit. f DSGVO).
        </LegalP>
        <LegalP>
          Zur Anmeldung werden technisch notwendige Cookies gesetzt, die Ihre Sitzung
          aufrechterhalten (siehe Abschnitt „Cookies“).
        </LegalP>
      </LegalSection>

      <LegalSection heading="5. Registrierung und Nutzerkonto">
        <LegalP>
          Bei der Registrierung erheben wir die zur Kontoführung und Buchungsabwicklung
          erforderlichen Daten: Name bzw. Firmenname, Anschrift, Telefonnummer, E-Mail-Adresse,
          gewählter Anzeigename sowie – bei Unternehmen – die Umsatzsteuer-ID. Bei Nutzern mit
          Gastgeber-Funktion können zusätzlich Abrechnungs- und Bankdaten (u. a. IBAN, BIC)
          verarbeitet werden, soweit dies für Auszahlungen und die Rechnungsstellung erforderlich
          ist. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.
        </LegalP>
      </LegalSection>

      <LegalSection heading="6. Buchungsabwicklung und Channel-Manager (Smoobu)">
        <LegalP>
          Zur Verwaltung von Verfügbarkeiten, Preisen und Reservierungen sowie zur Synchronisierung
          mit angeschlossenen Buchungskanälen nutzen wir den Channel-Manager Smoobu (Smoobu GmbH,
          Berlin, Deutschland). Im Rahmen einer Buchung werden die für die Reservierung
          erforderlichen Daten (u. a. Name, Kontaktdaten, An- und Abreisedatum, Anzahl der Gäste)
          an Smoobu übermittelt und – sofern eine Unterkunft auch über externe Buchungsportale
          angeboten wird – zur Vermeidung von Doppelbuchungen mit diesen Kanälen abgeglichen.
          Rechtsgrundlage ist die Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO).
        </LegalP>
      </LegalSection>

      <LegalSection heading="7. Zahlungsabwicklung (Stripe)">
        <LegalP>
          Zahlungen werden über den Zahlungsdienstleister Stripe abgewickelt (Stripe Payments
          Europe, Ltd., Irland; ggf. mit Beteiligung der Stripe, Inc., USA). Zur Abwicklung einer
          Zahlung werden die erforderlichen Zahlungs- und Bestelldaten (u. a. Name, Betrag,
          Zahlungsmittelangaben) direkt an Stripe übermittelt und dort verarbeitet. Wir selbst
          erhalten und speichern keine vollständigen Kreditkartendaten. Rechtsgrundlage ist die
          Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO). Es kann eine Übermittlung in die USA
          stattfinden, die auf die Standardvertragsklauseln der EU-Kommission gestützt wird. Weitere
          Informationen:{' '}
          <a href="https://stripe.com/de/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)' }}>
            stripe.com/de/privacy
          </a>.
        </LegalP>
      </LegalSection>

      <LegalSection heading="8. E-Mail-Versand (Resend)">
        <LegalP>
          Für den Versand transaktionaler E-Mails (z. B. Buchungsbestätigungen) setzen wir den
          Dienst Resend (USA) ein. Hierbei werden die E-Mail-Adresse des Empfängers sowie die zum
          Versand nötigen Inhaltsdaten verarbeitet. Rechtsgrundlage ist die Vertragserfüllung
          (Art. 6 Abs. 1 lit. b DSGVO) bzw. unser berechtigtes Interesse an einer zuverlässigen
          Kommunikation (Art. 6 Abs. 1 lit. f DSGVO). Eine Übermittlung in die USA wird auf die
          Standardvertragsklauseln der EU-Kommission gestützt.
        </LegalP>
      </LegalSection>

      <LegalSection heading="9. Kartendarstellung (CARTO, OpenStreetMap, Google Maps)">
        <LegalP>
          Zur Darstellung der Lage von Unterkünften nutzen wir Kartendienste. Die Übersichtskarte
          verwendet Kartenkacheln von CARTO auf Basis von OpenStreetMap-Daten. Auf Detailseiten kann
          zusätzlich eine über Google Maps (Google Ireland Limited, Irland) eingebettete Karte
          angezeigt werden. Beim Laden der Karten wird Ihre IP-Adresse an den jeweiligen Anbieter
          übertragen, was technisch erforderlich ist, um die Karte auszuliefern. Rechtsgrundlage ist
          unser berechtigtes Interesse an einer ansprechenden Standortdarstellung (Art. 6 Abs. 1
          lit. f DSGVO).
        </LegalP>
      </LegalSection>

      <LegalSection heading="10. Anzeige von Gästebewertungen externer Plattformen">
        <LegalP>
          Auf unseren Unterkunftsseiten zeigen wir Gästebewertungen an, die Gäste öffentlich auf
          Buchungsplattformen (Airbnb, Booking.com, FeWo-direkt/Vrbo) sowie bei Google veröffentlicht
          haben. Dabei übernehmen wir die dort öffentlich einsehbaren Angaben (Vorname bzw.
          angezeigter Name, ggf. Profilbild, Bewertungstext, Sternebewertung und Datum) in unsere
          Datenbank und stellen sie gebündelt mit Quellenangabe dar. Google-Bewertungen beziehen wir
          über die offizielle Schnittstelle von Google (Places API); Bewertungen anderer Plattformen
          werden über den technischen Dienstleister Apify Technologies s.r.o. (Prag, Tschechische
          Republik, EU) aus den öffentlich zugänglichen Seiten ausgelesen. Rechtsgrundlage ist unser
          berechtigtes Interesse an einer transparenten Darstellung der Qualität unserer Unterkünfte
          anhand bereits öffentlich verfügbarer Bewertungen (Art. 6 Abs. 1 lit. f DSGVO). Als
          bewertende Person können Sie der Anzeige Ihrer Bewertung auf unserer Seite jederzeit
          widersprechen (Art. 21 DSGVO) – eine formlose Nachricht an{' '}
          <a href="mailto:mail@trimosa.de" style={{ color: 'var(--gold)' }}>mail@trimosa.de</a>{' '}
          genügt; wir entfernen die Bewertung dann umgehend.
        </LegalP>
      </LegalSection>

      <LegalSection heading="11. Cookies">
        <LegalP>
          Wir verwenden ausschließlich technisch notwendige Cookies, die für die Anmeldung und die
          Aufrechterhaltung Ihrer Sitzung erforderlich sind. Diese Cookies benötigen keine
          Einwilligung; Rechtsgrundlage ist § 25 Abs. 2 TTDSG in Verbindung mit Art. 6 Abs. 1
          lit. f bzw. lit. b DSGVO. Wir setzen keine Analyse-, Tracking- oder Marketing-Cookies ein.
        </LegalP>
      </LegalSection>

      <LegalSection heading="12. Schutz vor Missbrauch (Rate-Limiting)">
        <LegalP>
          Zum Schutz vor automatisiertem Missbrauch (z. B. massenhaften Registrierungs- oder
          Buchungsversuchen) speichern wir bei bestimmten Anfragen kurzfristig einen Zählwert in
          Verbindung mit Ihrer IP-Adresse bzw. Ihrer Nutzerkennung. Diese Daten werden nur zur
          Abwehr von Missbrauch verwendet und regelmäßig gelöscht. Rechtsgrundlage ist unser
          berechtigtes Interesse an der Sicherheit der Plattform (Art. 6 Abs. 1 lit. f DSGVO).
        </LegalP>
      </LegalSection>

      <LegalSection heading="13. Speicherdauer">
        <LegalP>
          Wir speichern personenbezogene Daten nur so lange, wie es für die genannten Zwecke
          erforderlich ist oder gesetzliche Aufbewahrungsfristen (insbesondere handels- und
          steuerrechtliche Fristen von bis zu zehn Jahren) dies vorschreiben. Danach werden die
          Daten gelöscht.
        </LegalP>
      </LegalSection>

      <LegalSection heading="14. Ihre Rechte">
        <LegalP>
          Sie haben im Rahmen der gesetzlichen Bestimmungen jederzeit das Recht auf unentgeltliche
          Auskunft über Ihre gespeicherten personenbezogenen Daten (Art. 15 DSGVO), auf Berichtigung
          (Art. 16 DSGVO), auf Löschung (Art. 17 DSGVO), auf Einschränkung der Verarbeitung
          (Art. 18 DSGVO), auf Datenübertragbarkeit (Art. 20 DSGVO) sowie ein Widerspruchsrecht
          gegen die Verarbeitung (Art. 21 DSGVO). Eine erteilte Einwilligung können Sie jederzeit mit
          Wirkung für die Zukunft widerrufen. Hierzu sowie zu weiteren Fragen können Sie sich
          jederzeit an <a href="mailto:mail@trimosa.de" style={{ color: 'var(--gold)' }}>mail@trimosa.de</a> wenden.
        </LegalP>
        <LegalP>
          Ihnen steht zudem ein Beschwerderecht bei einer Datenschutz-Aufsichtsbehörde zu,
          insbesondere in dem Mitgliedstaat Ihres gewöhnlichen Aufenthalts, Ihres Arbeitsplatzes
          oder des Orts des mutmaßlichen Verstoßes.
        </LegalP>
      </LegalSection>

      <LegalSection heading="15. Datenübermittlung in Drittstaaten">
        <LegalP>
          Einige der eingesetzten Dienste (u. a. Vercel, Stripe, Resend, Google) können
          personenbezogene Daten in Länder außerhalb der EU/des EWR – insbesondere in die USA –
          übermitteln. In diesen Ländern besteht möglicherweise kein mit der EU vergleichbares
          Datenschutzniveau. Soweit eine solche Übermittlung erfolgt, wird sie auf geeignete
          Garantien, insbesondere die Standardvertragsklauseln der EU-Kommission, gestützt.
        </LegalP>
      </LegalSection>
    </LegalShell>
  )
}
