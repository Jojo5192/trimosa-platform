import { supabaseAdmin } from '@/lib/supabase-admin'
import { listReservations } from '@/lib/smoobu'

/**
 * 🎯 Property-Review-Matching (§124): Booking bewertet je PROPERTY — teilen
 * sich mehrere Wohnungen eine Booking-Unterkunft (Sirzenich-Haus, Minden),
 * importiert der Sync dieselben Reviews an alle Geschwister-Listings. Diese
 * Routine ordnet sie der RICHTIGEN Wohnung zu: Reviewer-Vorname + Datum der
 * Bewertung werden gegen die komplette SMOOBU-Reservierungshistorie (Gast,
 * Apartment, Abreise) gematcht. Eindeutiger Treffer → Review bleibt nur am
 * gematchten Listing, die Kopien der Geschwister werden gelöscht.
 * Kein/mehrdeutiger Treffer → Review bleibt Property-weit (Anzeige überall).
 *
 * Idempotent & selbstheilend: Der tägliche Review-Sync stellt Kopien wieder
 * her — darum läuft das Matching im Anschluss an den Sync-Cron erneut.
 */

const WINDOW_BEFORE = 3   // Bewertung max. 3 Tage VOR Abreise (Datums-Toleranz)
const WINDOW_AFTER = 45   // … bis 45 Tage nach Abreise

function bookingSlug(url: string | null): string | null {
  const m = (url ?? '').match(/hotel\/[a-z]{2}\/([a-z0-9-]+)/)
  return m ? m[1] : null
}
const firstToken = (s: string | null | undefined) =>
  (s ?? '').trim().toLowerCase().split(/\s+/)[0] || ''

export type MatchReport = {
  gruppen: number
  dubletten: number
  reservierungen: number
  eindeutig: number
  mehrdeutig: number
  keinTreffer: number
  geloeschteKopien: number
  dryRun: boolean
  details?: string[]
}

export async function matchPropertyReviews(dryRun = false): Promise<MatchReport> {
  const report: MatchReport = {
    gruppen: 0, dubletten: 0, reservierungen: 0,
    eindeutig: 0, mehrdeutig: 0, keinTreffer: 0, geloeschteKopien: 0,
    dryRun, details: [],
  }

  // Property-Gruppen = aktive Listings mit identischem Booking-Slug
  const { data: listings } = await supabaseAdmin
    .from('listings').select('id, title, smoobu_id, booking_url').eq('is_active', true)
  const bySlug = new Map<string, { id: string; title: string; smoobu_id: number | null }[]>()
  for (const l of listings ?? []) {
    const slug = bookingSlug(l.booking_url)
    if (!slug) continue
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), l])
  }
  const groups = [...bySlug.values()].filter((g) => g.length > 1)
  report.gruppen = groups.length
  if (!groups.length) return report

  // Dubletten ermitteln: dieselbe Booking-Review an mehreren Gruppen-Listings
  type Rev = { id: string; listing_id: string; source_review_id: string; author_name: string | null; review_date: string | null }
  const groupData: { members: typeof groups[number]; dupes: Map<string, Rev[]> }[] = []
  for (const members of groups) {
    const ids = members.map((m) => m.id)
    const { data: revs } = await supabaseAdmin
      .from('reviews')
      .select('id, listing_id, source_review_id, author_name, review_date')
      .in('listing_id', ids).eq('source', 'booking').limit(2000)
    const byRid = new Map<string, Rev[]>()
    for (const r of (revs ?? []) as Rev[]) byRid.set(r.source_review_id, [...(byRid.get(r.source_review_id) ?? []), r])
    const dupes = new Map([...byRid.entries()].filter(([, rows]) => rows.length > 1))
    report.dubletten += dupes.size
    if (dupes.size) groupData.push({ members, dupes })
  }
  if (!report.dubletten) return report

  // Komplette Smoobu-Reservierungshistorie (Gast + Apartment + Abreise)
  const smoobuToListing = new Map<number, string>()
  for (const l of listings ?? []) if (l.smoobu_id) smoobuToListing.set(Number(l.smoobu_id), l.id)
  const today = new Date().toISOString().slice(0, 10)
  type Res = { listingId: string; first: string; departure: string }
  const history: Res[] = []
  for (let page = 1; page <= 150; page++) {
    const { reservations, hasMore } = await listReservations('2019-01-01', today, page)
    for (const r of reservations) {
      if (r.cancelled || r.blocked || !r.departure || !r.apartmentId) continue
      const listingId = smoobuToListing.get(Number(r.apartmentId))
      if (!listingId) continue
      const first = firstToken(r.guestName)
      if (!first) continue
      history.push({ listingId, first, departure: r.departure })
    }
    if (!hasMore) break
  }
  report.reservierungen = history.length
  if (!history.length) return report

  // Matching je Dublette: Vorname + Abreise-Fenster → eindeutiges Apartment
  for (const { members, dupes } of groupData) {
    const memberIds = new Set(members.map((m) => m.id))
    const titleOf = new Map(members.map((m) => [m.id, m.title]))
    for (const [rid, rows] of dupes) {
      const sample = rows[0]
      const first = firstToken(sample.author_name)
      if (!first || !sample.review_date) { report.keinTreffer++; continue }
      const rd = new Date(sample.review_date + 'T00:00:00Z').getTime()
      const cands = history.filter((h) => {
        if (!memberIds.has(h.listingId) || h.first !== first) return false
        const diff = (rd - new Date(h.departure + 'T00:00:00Z').getTime()) / 86400_000
        return diff >= -WINDOW_BEFORE && diff <= WINDOW_AFTER
      })
      const apartments = [...new Set(cands.map((c) => c.listingId))]
      if (apartments.length === 1) {
        report.eindeutig++
        const target = apartments[0]
        const toDelete = rows.filter((r) => r.listing_id !== target)
        if (report.details && report.details.length < 25) {
          report.details.push(`${sample.author_name} (${sample.review_date}) → ${titleOf.get(target) ?? target}`)
        }
        if (!dryRun && toDelete.length) {
          const { error } = await supabaseAdmin
            .from('reviews').delete().in('id', toDelete.map((r) => r.id))
          if (!error) report.geloeschteKopien += toDelete.length
        } else {
          report.geloeschteKopien += toDelete.length
        }
        void rid
      } else if (apartments.length > 1) {
        report.mehrdeutig++
      } else {
        report.keinTreffer++
      }
    }
  }
  return report
}
