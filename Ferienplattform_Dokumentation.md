# TRIMOSA Apartments & Homes — Ferienplattform
## Projektdokumentation für Cowork
**Stand: 10. April 2026**

---

## 1. Projektübersicht

Ziel ist der Aufbau einer eigenen Ferienplattform — ein AirBnB-Klon für zunächst ca. 20 Ferienwohnungen, mit Fokus auf exzellente Nutzererfahrung für Gäste und Gastgeber. Die Plattform soll sowohl eigene Wohnungen (TRIMOSA) als auch Wohnungen externer Gastgeber verwalten können.

### Kernfunktionen (Zielzustand)
- **Gäste:** Suche, Detailansicht, Buchungsanfrage, Zahlung
- **Gastgeber:** Registrierung, Login, Inserate verwalten, Smoobu-Synchronisation
- **Admin:** Plattformverwaltung, Provision, Support
- **Smoobu-Integration:** Preise und Verfügbarkeiten bidirektional synchronisieren
- **Zahlungsabwicklung:** Stripe Connect (Provision wird automatisch einbehalten)

### Tech-Stack

| Bereich | Technologie |
|---|---|
| Frontend & Backend | Next.js 16 (App Router, TypeScript, React) |
| Styling | Tailwind CSS v4 |
| Datenbank & Auth | Supabase (PostgreSQL + Auth + Storage) |
| Zahlungen | Stripe / Stripe Connect (geplant) |
| Channel Manager | Smoobu API (geplant) |
| Hosting | Vercel (geplant) |
| Editor | Cursor (KI-gestützter Code-Editor) |
| Dev-Server | `npm run dev` → localhost:3000 |

---

## 2. Projektstruktur

**Projektordner:** `~/projekte/ferienplattform`

```
ferienplattform/
├── app/
│   ├── page.tsx                ← Startseite (Listings-Übersicht)
│   ├── listing/[id]/page.tsx   ← Detailseite einer Unterkunft
│   ├── login/page.tsx          ← Login-Seite
│   ├── register/page.tsx       ← Registrierung (Gast & Gastgeber)
│   ├── layout.tsx              ← Root Layout
│   └── globals.css             ← Tailwind CSS (@import "tailwindcss")
├── lib/
│   └── supabase.ts             ← Supabase Client
├── .env.local                  ← API Keys (NICHT in Git!)
├── postcss.config.js           ← PostCSS mit @tailwindcss/postcss
└── next.config.ts              ← Next.js Konfiguration
```

---

## 3. Aktueller Stand

| Aufgabe | Status |
|---|---|
| Next.js Projekt erstellt und lokal lauffähig | ✅ Fertig |
| Supabase Projekt angelegt (ferienplattform) | ✅ Fertig |
| Supabase mit Next.js verbunden (.env.local) | ✅ Fertig |
| Datenbank-Schema: listings + bookings Tabellen | ✅ Fertig |
| 3 Testdatensätze in der Datenbank | ✅ Fertig |
| Startseite zeigt echte Daten aus DB | ✅ Fertig |
| Detailseite /listing/[id] mit Buchungsbox | ✅ Fertig |
| Login-Seite /login erstellt | ✅ Fertig |
| Registrierungsseite /register erstellt | ✅ Fertig |
| **Tailwind CSS v4 korrekt konfiguriert** | ⚠️ Problem |
| Login-Funktionalität vollständig testen | ⏳ Offen |
| Buchungsanfrage in DB speichern | ⏳ Offen |

### Bekanntes Problem: Tailwind CSS

Das Tailwind CSS Styling wird auf manchen Seiten nicht korrekt angewendet — Seiten erscheinen ohne Layout-Formatting (kein Grid, kein Padding, kein Rounding). Die Funktionalität ist vorhanden, aber das visuelle Design fehlt.

**Was bisher versucht wurde:**
- Wechsel von Tailwind v4 zu v3 und zurück
- `postcss.config.mjs` gelöscht (Konflikt mit `postcss.config.js`)
- `tailwind.config.js` mit content-Pfaden erstellt und wieder gelöscht
- `globals.css` auf `@import "tailwindcss"` umgestellt

**Vermutete Ursache:** Konflikt zwischen Tailwind v4 und dem Turbopack-Dev-Server von Next.js 16.

**Lösungsansatz — Turbopack deaktivieren:**

In `package.json` den dev-Script prüfen und `--turbopack` entfernen falls vorhanden:
```json
"dev": "next dev"
```

Außerdem sicherstellen dass `postcss.config.js` (nicht .mjs!) folgenden Inhalt hat:
```js
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
```

Und `app/globals.css`:
```css
@import "tailwindcss";
```

---

## 4. Nächste Schritte (nach Priorität)

### 🔴 Priorität 1 — Tailwind CSS fixen
Dringendster Schritt. Ohne Styling kann die Nutzererfahrung nicht bewertet werden.

1. `package.json` öffnen → in `"dev"` Script prüfen ob `--turbopack` drin steht → entfernen
2. `postcss.config.js` korrekt setzen (siehe oben)
3. `globals.css` auf `@import "tailwindcss"` setzen
4. Dev-Server neu starten: `npm run dev`
5. localhost:3000/register aufrufen → sollte zentriertes Formular mit Padding zeigen

### 🟠 Priorität 2 — Login & Auth vollständig machen
- Supabase Email-Bestätigung für Dev deaktivieren (Supabase Dashboard → Auth → Settings → "Enable email confirmations" ausschalten)
- Nach Login: Nutzer wird auf Startseite weitergeleitet ✓ (bereits implementiert)
- Navigation zeigt eingeloggten Nutzer (Name + Logout-Button)
- Geschützte Routen: /dashboard nur für eingeloggte Gastgeber

### 🟡 Priorität 3 — Buchungsanfrage speichern
- "Anfrage senden" Button auf Detailseite funktional machen
- Buchung in `bookings`-Tabelle in Supabase speichern
- Bestätigungs-E-Mail an Gast senden (Resend.com)
- Gastgeber wird per E-Mail benachrichtigt

### 🟢 Priorität 4 — Gastgeber-Dashboard
- Seite `/dashboard` mit Übersicht aller eigenen Inserate
- Buchungsanfragen annehmen / ablehnen
- Neues Inserat erstellen (Titel, Beschreibung, Preis, Fotos)
- Fotos hochladen über Supabase Storage

### 🔵 Priorität 5 — Smoobu Integration
- Smoobu OAuth-Connect für Gastgeber
- Verfügbarkeiten und Preise aus Smoobu lesen
- Buchungen aus Plattform zurück zu Smoobu schreiben
- Webhook für Echtzeit-Updates einrichten

---

## 5. Datenbank-Schema (Supabase / PostgreSQL)

### Tabelle: `listings`

| Feld | Typ | Beschreibung |
|---|---|---|
| id | uuid | Primärschlüssel (auto-generiert) |
| created_at | timestamp | Erstellungsdatum |
| title | text | Titel der Unterkunft |
| description | text | Beschreibungstext |
| location | text | Ort (z.B. Schliersee, Bayern) |
| price_per_night | integer | Preis pro Nacht in Euro |
| max_guests | integer | Maximale Gästeanzahl |
| bedrooms | integer | Anzahl Schlafzimmer |
| images | text[] | Array von Bild-URLs |
| host_id | uuid | Referenz auf auth.users |
| is_active | boolean | Sichtbar auf Plattform? |

### Tabelle: `bookings`

| Feld | Typ | Beschreibung |
|---|---|---|
| id | uuid | Primärschlüssel |
| created_at | timestamp | Buchungsdatum |
| listing_id | uuid | Referenz auf listings |
| guest_id | uuid | Referenz auf auth.users |
| check_in | date | Anreisedatum |
| check_out | date | Abreisedatum |
| total_price | integer | Gesamtpreis in Euro |
| status | text | pending / confirmed / cancelled |

### Testdaten (bereits in DB)
```sql
-- Chalet am Schliersee: €150/Nacht, 4 Gäste, 2 Schlafzimmer
-- Almhütte Zugspitze: €120/Nacht, 2 Gäste, 1 Schlafzimmer
-- Ferienwohnung Tegernsee: €95/Nacht, 3 Gäste, 1 Schlafzimmer
```

---

## 6. Konfiguration & Zugänge

### .env.local (NICHT in Git committen!)
```
NEXT_PUBLIC_SUPABASE_URL=https://wccrfgjzxpztfmnqpfiy.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[Publishable Key aus Supabase → Settings → API Keys]
```

### Supabase Projekt
- **Organisation:** TRIMOSA Apartments & Homes
- **Projektname:** ferienplattform
- **Project ID:** wccrfgjzxpztfmnqpfiy
- **Region:** Central EU (Frankfurt)
- **Owner:** johannesgoergen@icloud.com

### Dev-Server starten
```bash
cd ~/projekte/ferienplattform
npm run dev
# → Browser: localhost:3000
```

---

## 7. Code-Referenz: Wichtige Dateien

### lib/supabase.ts
```typescript
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
```

### Daten aus DB laden (Server Component)
```typescript
const { data: listings } = await supabase
  .from('listings')
  .select('*')
  .eq('is_active', true)
```

---

## 8. Hinweise für Cowork

- **Projektordner:** `~/projekte/ferienplattform`
- **Supabase-Keys** stehen in `.env.local` — diese Datei NIE in Git committen
- **Immer komplette Dateien** ausgeben, nie nur Code-Schnipsel
- **Nach jeder Änderung** speichern (CMD+S in Cursor)
- **Dev-Server** läuft auf localhost:3000 — Browser manuell neu laden nach Änderungen
- **Next.js 16** mit App Router — alle Seiten liegen in `/app/`
- **Supabase Client** wird aus `@/lib/supabase` importiert
- **TypeScript** ist aktiv — auf korrekte Typen achten
- **Tailwind CSS v4** — kein `tailwind.config.js` nötig, nur `@import "tailwindcss"` in globals.css

**Dringendstes Problem:** Tailwind CSS Styling funktioniert noch nicht korrekt. Bitte als erstes beheben, dann Login testen, dann Buchungsanfragen implementieren.
