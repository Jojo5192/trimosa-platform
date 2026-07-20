/**
 * 📖 Funktions-Handbuch der TRIMOSA-Plattform für den @c-Team-Bot.
 * Wird bei jeder Bot-Antwort als Kontext mitgegeben, damit er Fragen wie
 * „gibt es schon Push bei neuer Buchung?" korrekt beantworten kann.
 *
 * ⚠️ PFLEGE-REGEL (Session-Routine): Wenn neue Features gebaut werden,
 * dieses Handbuch in derselben Runde aktualisieren — sonst gibt der Bot
 * veraltete Auskünfte. Stand-Datum unten mitziehen.
 */

export const APP_HANDBOOK = `FUNKTIONS-HANDBUCH (Stand: 19. Juli 2026) — das kann die TRIMOSA-Plattform:

TEAM-APP (/team, als PWA auf dem Home-Bildschirm installierbar) — 5 Tabs:

💬 CHAT (Gäste-Kommunikation, alle Kanäle vereint):
- Unified Inbox: alle Gäste-Threads aus Website, Airbnb, Booking, FeWo-direkt usw. (via Smoobu) mit Plattform-Badge, Status (Vor Ort/Anreise in X Tg./Ehemalig), Sprach-Flagge.
- Filter: Alle · Unbeantwortet · Ungelesen · Vor Ort · Kommend. „Beantwortet" zählt auch Antworten über Smoobu/Portale.
- Thread-Kopf antippen: Gast-Karte (Aufenthalt, Personen, Wohnung, Kanal, Sprache). Buttons ✓ „Keine Antwort nötig" und 📞 „Telefonisch geklärt" (fließen in den Wochenbericht ein).
- Fremdsprachige Gast-Nachrichten werden automatisch auf Deutsch angezeigt (Flagge + „Original zeigen"); eigene Antworten werden beim Senden automatisch in die Gastsprache übersetzt (Original bleibt einsehbar). Hat der Gast noch nie geschrieben, wird die Sprache aus der Telefon-Vorwahl geschätzt (+31 → Niederländisch; Flagge mit ~ = Schätzung). Website-Gäste geben ihre Sprache implizit über die Sprachwahl der Website an (wird bei der Buchung gespeichert).
- ✨ KI-Antworten: Öffnet man einen unbeantworteten Thread, steht ein Vorschlag automatisch im Eingabefeld (nie automatisch gesendet). Werkstatt-Zeile darunter: Anweisung tippen ODER 🎤 antippen und diktieren („späterer Check-in geht klar") → Claude schreibt die fertige Antwort ins Feld. Die KI lernt aus der Wissensbasis (destillierte Chat-Historie seit 2019, täglich aktualisiert).

💼 INTERN (eigener Team-Messenger, getrennt von Gäste-Chats):
- Gruppen anlegen (Admins, Gastgeber UND Mitarbeiter; Ersteller verwaltet seine Gruppe), Mitglieder verwalten, umbenennen.
- Nachrichten mit Fotos, Videos, PDFs; 🎙️ Sprachnachrichten mit automatischem Transkript (wie iMessage); ❤️👍-Reaktionen per Doppeltipp oder Gedrückthalten; ↩︎ Antworten auf eine Nachricht (im Reaktions-Menü) mit verbundenem Zitat — Tipp aufs Zitat springt zum Original; iMessage-Design mit Sprechblasen.
- Gruppen-Info (Tipp auf den Namen): Mitglieder, Medien-Galerie mit Suche (Fotos/Videos/Audio/PDF-Tabs).
- @c am Nachrichtenanfang: Claude-Bot antwortet binnen ~1 Minute (Wissens-/Betriebsfragen; er kann KEINEN Code ändern — Änderungswünsche holt die nächste Dev-Session ab).

✅ AUFGABEN:
- Aufgaben mit Prio, Rotfrist (überfällig = rot + oben), Zuordnung (Wohnung/Standort/Allgemein), Sichtbarkeit (🔒 Admins/👥 Team/🌐 Alle), Zuweisung mit Push an die Person.
- Fotos an Aufgaben (auch Ergebnis-Fotos durch Handwerker), Kommentare, wiederkehrende Aufgaben (wöchentlich bis jährlich — Erledigen erzeugt automatisch die nächste), Erledigt-Bericht („Was wurde gemacht?").
- 🤖 Vorschläge-Reiter (nur Admins): KI analysiert täglich neue Gast-Nachrichten + Bewertungen und schlägt Aufgaben vor (Annehmen/Verwerfen).
- 🧾 QS-Block: geplante Qualitätschecks (halbjährlich je Wohnung, automatisch auf freie Tage gelegt, verschiebbar mit Belegungs-Warnung), Protokoll direkt in der App ausfüllen (Checkliste mit OK/Mangel, Stückzahlen, Fotos); Mängel werden automatisch Aufgaben-Vorschläge. Checklisten sind im Admin-Bereich editierbar (Standard/Standort/Wohnung mit Vererbung).

📅 KALENDER — drei Ansichten:
- 📊 Belegung: Smoobu-Stil-Grid, alle Wohnungen × Tage, Balken in Kanal-Farben mit Gastnamen, Wechseltage als Halbzellen, Tipp → Details + Chat-Link.
- 📋 Agenda: An-/Abreisen, Wechsel-Badges, fällige Aufgaben, QS-Termine, „Gerade frei"-Karten + Planungs-Vorschläge (Aufgaben in Frei-Fenster legen). Zweitansicht 📆 Wochenblick: 14 Tages-Kacheln mit Ereignis-Punkten.
- 🧹 Reinigung: jede Abreise als Slot (Wechseltag = Pflicht am Tag). Planungs-Doktrin: IMMER SCHNELLSTMÖGLICH reinigen (kurzfristige Buchungen!) — nur Sonn-/Feiertage werden (nach den Regeln der jeweiligen Kraft) übersprungen, und gebündelt wird nur, wenn es höchstens einen Tag kostet (gemeinsame Anfahrt mit einem Pflicht-Termin derselben Kraft am selben Standort). Jede Karte zeigt das Zeitfenster „Reinigen möglich: von – bis (Anreise)" und erklärt Verschiebungen per Chip (☀️ Sonntag übersprungen / 🚗 eine Anfahrt — zusammen mit X). Alle drei Unter-Ansichten (📋 Liste, 🗺 Touren, 💶 Kosten) sind nach REINIGUNGSKRAFT filterbar (Alle · 👤 Vanessa · 👤 Tip-Top …); Reinigungskräfte starten automatisch mit ihrem eigenen Filter, externe Dienstleister sehen ohnehin nur ihre Wohnungen. 💶 Kosten (NUR Admins/Gastgeber): erwartete Rechnung je KALENDERMONAT mit den Sätzen der JEWEILIGEN Kraft, zweistufig auffächerbar (Wohnung → einzelne Reinigungen mit Datum; Zulagen und Anfahrten ebenso). Regeln & Sätze (Sonn-/Feiertags-Meidung, Stundensatz, Anfahrt, Zulagen) sind im Admin-Bereich als Standard UND abweichend PRO Reinigungskraft hinterlegbar — inkl. Vertrags-Feinheiten: dritte Zuschlagsstufe für besondere Feiertage (Heiligabend, 1./2. Weihnachtstag, Silvester, 1. Mai), Anfahrt wahlweise je einzelner Reinigung statt je Einsatztag, und Umsatzsteuer-Ausweis (netto/brutto). Hinterlegte Verträge: Vanessa/VP Glanzteam (Pauschale = vereinbarte Stunden × 27,90 €, Anfahrt 5 € je Einsatz, Zuschläge 36,2/75,6/107,9 %, zzgl. 19 % USt, Sonn-/Feiertage werden gemieden) und Tip-Top Reinigung (15 €/h Paket M, Fahrzeit inklusive, keine Zuschläge, keine USt — darf daher auch sonn-/feiertags reinigen). Der Planer bündelt nur, wenn das bei der Kraft wirklich eine Anfahrt spart — bei Anfahrt-je-Reinigung oder 0-€-Anfahrt gilt strikt schnellstmöglich. Dazu „📄 Rechnung hochladen & prüfen": echte Monats-Rechnung (PDF/Foto) hochladen → Claude liest sie, vergleicht mit der Erwartung und zeigt Abweichung, Positionen und Auffälligkeiten.
- Admins können pro Person einstellen, wer welche Wohnungen im Kalender sieht; Dienstleister sehen nie Gastnamen.

⚙️ MEHR:
- Push-Einstellungen: „Push auf diesem Gerät" + Kategorien „Gäste-Chats", „Interne Gruppen" und „Neue Buchungen".
- 🧾 Qualitätssicherung: Archiv aller QS-Protokolle je Wohnung, PDF auf Abruf.

🔔 PUSH-BENACHRICHTIGUNGEN (was wann kommt):
- Neue Gast-Nachricht (alle Kanäle, ~10-Min-Takt via Smoobu-Abgleich; Website sofort) — deutsch übersetzt mit Sprach-Flagge.
- NEUE BUCHUNG/ANFRAGE: JA, eingebaut (seit 19.07.) — aus ALLEN Kanälen (Website sofort via Stripe, extern via Smoobu-Webhook). Admins/Gastgeber sehen den Betrag, Mitarbeiter nicht, Dienstleister bekommen keinen. Tipp öffnet den Gast-Thread. Abschaltbar unter ⚙️ Mehr → „Neue Buchungen".
- Interne Gruppen-Nachrichten, Aufgaben-Zuweisung, Aufgaben-Kommentar, QS-Termin/-Abschluss, Reaktions-Push, KI-Vorschlags-Digest.
- App-Icon-Badge zählt zu bearbeitende Threads und respektiert die Push-Kategorien. Ungelesen-Markierungen bleiben erhalten, bis man den Thread wirklich ansieht (Hintergrund-Aktualisierung markiert nichts mehr als gelesen). Push-Mitteilungen verschwinden automatisch aus der iOS-Mitteilungszentrale, sobald der zugehörige Thread in der App geöffnet wird.

👥 ROLLEN: Admin/Gastgeber (alles, inkl. Kosten & Beträgen) · Mitarbeiter/Staff (Chat, Aufgaben, Kalender — ohne Finanzdaten; Rechte im Admin-Bereich einstellbar) · Dienstleister/Provider (nur Intern-Chat, eigene Aufgaben, Kalender ohne Gastnamen).

WEBSITE (trimosa.de): Buchung mit Sofortbuchung/Anfrage je Inserat, Stripe-Zahlung (live), Bestpreis-Garantie, automatische Bestätigungs-Mail (mehrsprachig) + Host-Alert-Mail, beidseitiger Smoobu-Sync, Bewertungs-Import (Airbnb/Booking/FeWo/Google, täglicher Cron) mit Gesamtscore + „Das sagen unsere Gäste"-KI-Zusammenfassung, Reiseführer (4 Regionen, ~43 Erlebnis-Seiten, Kulinarik-Guide mit Google-Ratings, Komoot-Touren, persönliche Gastgeber-Empfehlungen), komplette Mehrsprachigkeit DE/EN/FR/NL, digitale Gästemappe je Buchung (/mappe/<token>, mehrsprachig; Türcode-Automatik = geplante Phase 2).

DASHBOARD (/dashboard, Admins/Gastgeber): Inserats-Editor (Fotos, Zimmer, Grundrisse, Buchungsmodus, Storno-Richtlinie, KI-Formulierhilfe ✨, Bewertungs-Sync, Übersetzungen), Gästemappen-Builder mit Live-Vorschau, Empfehlungen-Editor, Buchungsverwaltung, Admin-Bereich (Rollen, Aufgaben-Rechte, Kalender-Sichten, Reinigung inkl. Kosten-Sätze, QS-Einstellungen + Checklisten-Editor, Prompt-Studio für die KI-Texte, Chat-Wissensbasis).

AUTOMATIK IM HINTERGRUND: täglicher Bewertungs-Sync (rotierend) + Property-Review-Zuordnung, tägliche Wissensbasis-Destillation, tägliche KI-Aufgaben-Analyse, QS-Terminplanung + Konflikt-Verschiebung, 10-Min-Nachrichten-Poll, minütlicher @c-Bot, wöchentlicher Team-Wochenbericht per Mail (mittwochs, mit Kritik/Lob/Antwortzeit), und die Buchungsmail-Anreicherung: weitergeleitete Portal-Bestätigungsmails (v. a. FeWo-direkt) werden von Claude gelesen, mit der Buchung verknüpft und Preis/Gästezahl/Telefon automatisch in App UND Smoobu nachgetragen; aus umgeleiteten FeWo-Mails wird zusätzlich die Gast-Relay-E-Mail (Reply-To, @messages.homeaway.com) geerntet und in Smoobu hinterlegt — damit funktioniert der Chat mit FeWo-Gästen über die Team-App.`
