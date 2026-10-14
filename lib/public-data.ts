// server-only (Kommentar-Konvention §243)
import { unstable_cache, revalidateTag } from 'next/cache'
import { supabaseAdmin, supabaseAdminOhneVorschau } from '@/lib/supabase-admin'
import { getEmpfehlungen, type EmpfehlungenMap } from '@/lib/empfehlungen'

/**
 * 🚀 Gecachte Lader für die öffentlichen Seiten (Audit 14.10.2026, Hoch-Punkt 5 — HANDOFF §346).
 *
 * Alle öffentlichen Seiten sind dynamisch (Root-Layout liest Cookie/Header für html-lang, Seiten lesen das
 * Sprach-Cookie), deshalb war `export const revalidate` wirkungslos und jede Anfrage lief komplett gegen
 * Supabase: Inseratsseite 5 serielle Roundtrips (1,0–2,5 s), Region/Erlebnis 2 (0,5–1 s). Die reine
 * Auslieferung kostet nur ~0,22 s (/faq, /impressum).
 *
 * Lösung ohne Modellwechsel: nutzerUNABHÄNGIGE Abfragen in `unstable_cache` (Next Data Cache, auf Vercel
 * instanz- und deploy-übergreifend) mit Tags; Schreibstellen rufen revalidateListings()/… auf. Sprache,
 * Cookies und Suchparameter werden NIE in den Cache-Funktionen gelesen (dort wirft cookies()).
 * Geheimspalten (cleaning_token, locks, guide, google_api_key) werden vor dem Cachen entfernt — die
 * öffentlichen Seiten brauchen sie nicht.
 */

// Supabase-Zeilen sind im Projekt untypisiert (any) — hier bewusst beibehalten, damit die Seiten unverändert bleiben
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Zeile = any

export const TAG_LISTINGS = 'listings'
export const TAG_REVIEWS = 'reviews'
export const TAG_PROFILES = 'profiles'
export const TAG_EMPFEHLUNGEN = 'empfehlungen'

const GEHEIM = ['cleaning_token', 'locks', 'guide', 'google_api_key']
function ohneGeheimnisse(l: Zeile): Zeile {
  if (!l || typeof l !== 'object') return l
  const c = { ...l }
  for (const k of GEHEIM) delete c[k]
  return c
}

/** Alle aktiven Inserate (neueste zuerst) — Startseite, Regionen, Erlebnisse, Über uns, Landingpages. */
export const getActiveListings = unstable_cache(
  async (): Promise<Zeile[]> => {
    const { data, error } = await supabaseAdmin
      .from('listings').select('*').eq('is_active', true).order('created_at', { ascending: false })
    // Fehler WERFEN: unstable_cache speichert Exceptions nicht — sonst läge 10 Min ein leeres Array im Cache
    if (error) throw new Error('[public-data] listings: ' + error.message)
    const rows = (data ?? []).map(ohneGeheimnisse)
    const bytes = JSON.stringify(rows).length
    if (bytes > 1_500_000) console.warn('[public-data] listings-Cache-Eintrag', Math.round(bytes / 1024), 'KB — Vercel-Data-Cache-Limit 2 MB, Spaltenliste verkleinern')
    return rows
  },
  ['listings-active'],
  { revalidate: 600, tags: [TAG_LISTINGS] },
)

/** Aktive Inserate einer Region (Filter wie das frühere .ilike('location', '%match%')). */
export async function getRegionListings(locationMatch: string): Promise<Zeile[]> {
  const m = locationMatch.toLowerCase()
  return (await getActiveListings()).filter((l) => String(l.location ?? '').toLowerCase().includes(m))
}

/** Ein Inserat per slug oder id — Inseratsseite + ihre Metadaten teilen sich diesen Eintrag. */
export const getListingByLookup = unstable_cache(
  async (column: 'id' | 'slug', value: string): Promise<Zeile | null> => {
    const { data, error } = await supabaseAdmin.from('listings').select('*').eq(column, value).maybeSingle()
    if (error) throw new Error('[public-data] listing ' + column + ': ' + error.message)
    // Fehltreffer NICHT cachen (jeder gescannte Zufallspfad erzeugte sonst einen Cache-Eintrag): werfen, Seite fängt → notFound
    if (!data) throw new Error('nicht gefunden: ' + column + '=' + value)
    return ohneGeheimnisse(data)
  },
  ['listing-by-lookup'],
  { revalidate: 600, tags: [TAG_LISTINGS] },
)

/** Öffentliche Gastgeber-Felder (HostBadge). OhneVorschau: der Rollen-Vorschau-Proxy liest Cookies — im Cache tabu. */
export const getHostProfilePublic = unstable_cache(
  async (hostId: string): Promise<Zeile | null> => {
    const { data, error } = await supabaseAdminOhneVorschau
      .from('profiles')
      .select('id, display_name, avatar_url, bio, location, member_since, languages')
      .eq('id', hostId)
      .maybeSingle()
    if (error) throw new Error('[public-data] host-profile: ' + error.message)
    return data ?? null
  },
  ['host-profile-public'],
  { revalidate: 600, tags: [TAG_PROFILES] },
)

/** Erste Bewertungen einer Wohnung (+ Gesamtzahl) für HTML/JSON-LD der Inseratsseite. */
export const getReviewsPage = unstable_cache(
  async (listingId: string, limit: number): Promise<{ reviews: Zeile[]; total: number }> => {
    const { data, count, error } = await supabaseAdmin
      .from('reviews')
      .select('*', { count: 'exact' })
      .eq('listing_id', listingId)
      .order('review_date', { ascending: false })
      .range(0, limit - 1)
    if (error) throw new Error('[public-data] reviews ' + listingId.slice(0, 8) + ': ' + error.message)
    return { reviews: data ?? [], total: count ?? (data?.length ?? 0) }
  },
  ['reviews-page'],
  { revalidate: 600, tags: [TAG_REVIEWS] },
)

/** Persönliche Empfehlungen der Gastgeber (Region/Erlebnis). */
export const getEmpfehlungenCached = unstable_cache(
  async (): Promise<EmpfehlungenMap> => getEmpfehlungen({ strict: true }), // strict: Fehler werfen statt leere Map cachen
  ['empfehlungen'],
  { revalidate: 600, tags: [TAG_EMPFEHLUNGEN, TAG_PROFILES] }, // Avatare/Namen der Gastgeber hängen am Profil
)

/** Tag-Invalidierung, fail-soft (außerhalb von Request/Action-Kontext, z. B. Cron, darf nichts werfen). */
function invalidiere(tag: string) {
  // { expire: 0 } = sofortiger Verfall (nächste Anfrage holt frisch) — 'max' hieße stale-while-revalidate, d. h. der
  // Inhaber sähe nach dem Speichern im Editor beim ersten Aufruf noch den alten Stand
  try { revalidateTag(tag, { expire: 0 }) } catch (e) { console.warn('[public-data] revalidateTag', tag, 'nicht möglich:', e instanceof Error ? e.message : e) }
}
export function revalidateListings() { invalidiere(TAG_LISTINGS) }
export function revalidateReviews() { invalidiere(TAG_REVIEWS); invalidiere(TAG_LISTINGS) /* Score-Spalten liegen auf listings */ }
export function revalidateProfiles() { invalidiere(TAG_PROFILES) }
export function revalidateEmpfehlungen() { invalidiere(TAG_EMPFEHLUNGEN) }
