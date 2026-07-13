/**
 * Shared data + date helpers for the NavBar search (extracted from NavBar.tsx).
 */

export const LOCATION_SUGGESTIONS = [
  { label: 'Trier', sub: 'Rheinland-Pfalz' },
  { label: 'Bitburg', sub: 'Eifel' },
  { label: 'Raum Trier', sub: 'Rheinland-Pfalz' },
  { label: 'Südeifel', sub: 'Rheinland-Pfalz' },
  { label: 'Eifel', sub: 'Rheinland-Pfalz' },
  { label: 'Mosel', sub: 'Rheinland-Pfalz' },
  { label: 'Wittlich', sub: 'Rheinland-Pfalz' },
  { label: 'Koblenz', sub: 'Rheinland-Pfalz' },
  { label: 'Schliersee', sub: 'Bayern' },
  { label: 'Tegernsee', sub: 'Bayern' },
  { label: 'Garmisch-Partenkirchen', sub: 'Bayern' },
  { label: 'Füssen', sub: 'Bayern' },
  { label: 'Berchtesgaden', sub: 'Bayern' },
  { label: 'München', sub: 'Bayern' },
  { label: 'Augsburg', sub: 'Bayern' },
  { label: 'Nürnberg', sub: 'Bayern' },
  { label: 'Köln', sub: 'Nordrhein-Westfalen' },
  { label: 'Düsseldorf', sub: 'Nordrhein-Westfalen' },
  { label: 'Frankfurt', sub: 'Hessen' },
  { label: 'Stuttgart', sub: 'Baden-Württemberg' },
  { label: 'Hamburg', sub: 'Hamburg' },
  { label: 'Berlin', sub: 'Berlin' },
  { label: 'Leipzig', sub: 'Sachsen' },
  { label: 'Dresden', sub: 'Sachsen' },
  { label: 'Salzburg', sub: 'Österreich' },
  { label: 'Wien', sub: 'Österreich' },
  { label: 'Innsbruck', sub: 'Österreich' },
  { label: 'Luxemburg', sub: 'Luxemburg' },
]

export const DE_MONTHS_SHORT = ['Jan.','Feb.','Mär.','Apr.','Mai','Jun.','Jul.','Aug.','Sep.','Okt.','Nov.','Dez.']
export const DE_MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
export const DE_DAYS = ['Mo','Di','Mi','Do','Fr','Sa','So']

export function formatDate(iso: string): string {
  if (!iso) return ''
  const [, m, d] = iso.split('-')
  return `${parseInt(d)}. ${DE_MONTHS_SHORT[parseInt(m) - 1]}`
}

export function isoToDate(iso: string): Date | null {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function dateToIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

export function getFirstDayOfMonth(year: number, month: number) {
  // 0=Sun → convert to Mon-based index
  const d = new Date(year, month, 1).getDay()
  return d === 0 ? 6 : d - 1
}
