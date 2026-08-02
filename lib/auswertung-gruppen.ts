/**
 * 📊 Konten-GRUPPEN der Auswertung (§243ae) — CLIENT-SICHER (keine
 * Server-Imports!): die verständliche interne Kategorisierung
 * („Reinigung/Energie/Portale/IT …"). sevdesk-Konten bleiben SKR/EÜR-treu
 * (Doktrin §243ac) — diese Übersetzung lebt nur in der App-Auswertung.
 */

export const KONTO_GRUPPEN: { id: string; label: string; emoji: string; konten: string[] }[] = [
  { id: 'reinigung', label: 'Reinigung', emoji: '🧹', konten: ['6330'] },
  { id: 'gaeste', label: 'Gästeservice & Fremdleistungen', emoji: '🤝', konten: ['5900', '5901'] },
  { id: 'portale', label: 'Portal-Provisionen', emoji: '🌐', konten: ['5923', '6770'] },
  { id: 'miete', label: 'Miete & Pacht', emoji: '🏠', konten: ['6310'] },
  { id: 'energie', label: 'Energie, Wasser & Entsorgung', emoji: '⚡', konten: ['6325', '6345'] },
  { id: 'instandhaltung', label: 'Instandhaltung & Handwerker', emoji: '🔧', konten: ['6335', '6450', '6845'] },
  { id: 'ausstattung', label: 'Ausstattung & Einrichtung', emoji: '🛋', konten: ['6850', '5100', '6815'] },
  { id: 'it', label: 'IT, Software & Telefon', emoji: '💻', konten: ['6837', '5960', '6810', '6805', '6495'] },
  { id: 'verwaltung', label: 'Verwaltung & Buchführung', emoji: '📋', konten: ['6830', '6300', '6853'] },
  { id: 'versicherung', label: 'Versicherungen & Beiträge', emoji: '🛡', konten: ['6400', '6420'] },
  { id: 'reise', label: 'Reisekosten', emoji: '✈️', konten: ['6680'] },
  { id: 'bank', label: 'Zinsen & Bankgebühren', emoji: '💳', konten: ['6855', '7300', '7310'] },
]

/** Konten, die NICHT erfolgswirksam sind — separat ausgewiesen, nie „Ausgabe". */
export const NEUTRAL_GRUPPEN: { id: string; label: string; test: (nr: string) => boolean }[] = [
  { id: 'privat', label: 'Privatentnahmen', test: (nr) => nr === '2100' || nr === '2180' },
  { id: 'durchlaufend', label: 'Durchlaufende Posten & Tilgung', test: (nr) => nr === '1370' || nr === '3150' },
  { id: 'anlagen', label: 'Anlagenkäufe (aktiviert — AfA läuft in sevdesk)', test: (nr) => /^0\d/.test(nr) },
]

export function gruppeFuerKonto(nr: string): { id: string; label: string; emoji: string } {
  for (const g of KONTO_GRUPPEN) if (g.konten.includes(nr)) return { id: g.id, label: g.label, emoji: g.emoji }
  return { id: 'sonstiges', label: 'Sonstiges', emoji: '📦' }
}

export function neutralFuerKonto(nr: string): { id: string; label: string } | null {
  for (const n of NEUTRAL_GRUPPEN) if (n.test(nr)) return n
  return null
}

/** Kanal-Anzeige (Farben = OccupancyGrid-Familie §111). */
export const KANAL_META: Record<string, { label: string; color: string }> = {
  booking: { label: 'Booking.com', color: '#1A4FA0' },
  airbnb: { label: 'Airbnb', color: '#E0565B' },
  fewo: { label: 'FeWo-direkt', color: '#8B5CF6' },
  hometogo: { label: 'HomeToGo', color: '#0E9F8A' },
  direkt: { label: 'Direkt / Website', color: '#B0912B' },
}
