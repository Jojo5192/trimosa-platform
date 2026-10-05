/**
 * Review sync — pulls guest reviews from external platforms into the local
 * `reviews` table and refreshes the per-platform score columns on `listings`.
 *
 * Sources:
 *  - Airbnb / Booking.com / Vrbo (= Fewo-Direkt): via Apify scraper actors
 *    (no official APIs exist for hosts; Apify runs the scraping on their
 *    infrastructure, not from our account/IPs).
 *  - Google: official Places API (New) — authoritative rating + review count,
 *    plus the up-to-5 review texts Google exposes.
 *
 * Env vars:
 *  - APIFY_API_TOKEN            (required for airbnb/booking/vrbo)
 *  - GOOGLE_PLACES_API_KEY      (required for google)
 *  - APIFY_ACTOR_AIRBNB_REVIEWS / _BOOKING_REVIEWS / _VRBO_REVIEWS
 *    (optional actor-id overrides, format "user~actor-name")
 *  - FEWO_REVIEWS_QUERY_HASH u. a. (optional, FeWo-direkt-Abfrage — siehe lib/fewo-reviews.ts)
 * Missing env vars simply skip that source (reported in diagnostics).
 */
import { supabaseAdmin } from '@/lib/supabase-admin'
import { revalidatePath } from 'next/cache'
import { askClaude } from '@/lib/ai'
import { createHash } from 'crypto'
import { writeSyncLog } from '@/lib/reviews-sync-log'
import { auswerteFewoLauf, buildFewoActorInput, planFewoAbloesung, type FewoAuswertung, type FewoBestandZeile } from '@/lib/fewo-reviews'

/* ── Types ──────────────────────────────────────────────── */

export interface SyncSourceResult {
  source: string
  status: 'ok' | 'skipped' | 'error'
  fetched: number      // items returned by the source
  upserted: number     // rows written (new or refreshed)
  score?: number       // per-platform score written to the listing
  count?: number       // per-platform review count written to the listing
  detail?: string      // skip reason / error message
  /* §314 Protokoll: was der Lauf wirklich gebracht hat (lib/reviews-sync-log.ts) */
  neu?: number         // davon bisher unbekannte Bewertungen (vor dem Upsert gezählt)
  newest?: string | null // jüngstes ECHTES Bewertungsdatum im Abruf (geratene Daten zählen nicht)
  ohneDatum?: number   // Bewertungen ohne lesbares Datum (Heute-Rückfall) — Warnzeichen für ein geändertes Actor-Format
  partial?: boolean    // Google: Score ok, Volltext-Actor gescheitert
  errorKind?: SyncErrorKind
}

/** Fehlerart fürs Protokoll und die Ampel — bewusst grob, damit die Karte Klartext zeigen kann. */
export type SyncErrorKind = 'kontingent' | 'eingabe' | 'token' | 'actor' | 'timeout' | 'leer' | 'sonst'

export interface SyncOptions {
  origin?: 'cron' | 'manuell'
  /** Wartezeit je Actor-Lauf. Der Cron verkürzt sie, damit mehrere Wohnungen in 300 s passen. */
  timeoutMs?: number
}

interface NormalizedReview {
  source_review_id: string
  author_name: string
  author_avatar: string | null
  rating: number          // normalized to 1–5
  review_text: string | null
  review_date: string     // YYYY-MM-DD
  language: string | null
  /** nicht persistiert: Datum fehlte im Actor-Ergebnis, review_date ist der Heute-Rückfall */
  dateGuessed?: boolean
}

interface ListingRow {
  id: string
  airbnb_url: string | null
  booking_url: string | null
  vrbo_url: string | null
  google_place_id: string | null
}

/* ── Small helpers ──────────────────────────────────────── */

function stableId(...parts: (string | number | null | undefined)[]): string {
  return createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 24)
}

function toIsoDate(value: unknown): string | null {
  if (!value) return null
  const d = new Date(String(value))
  if (isNaN(d.getTime())) return null
  const iso = d.toISOString().split('T')[0]
  // Guard against obviously bogus dates the scrapers sometimes emit
  return iso >= '2000-01-01' && iso <= new Date().toISOString().split('T')[0] ? iso : null
}

/** Pick the first present, non-empty value among several possible field names. */
function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    // supports one level of nesting via "a.b"
    const v = k.includes('.')
      ? k.split('.').reduce<unknown>((acc, part) => (acc as Record<string, unknown> | null)?.[part], obj)
      : obj[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

/** Normalize any platform rating to the 1–5 scale used in the DB. */
function normalizeRating(raw: unknown): number | null {
  const n = parseFloat(String(raw))
  if (isNaN(n) || n <= 0) return null
  const scaled = n > 5 ? n / 2 : n   // Booking/Vrbo use a 1–10 scale
  return Math.min(5, Math.max(1, Math.round(scaled * 10) / 10))
}

/** Vrbo has no review date — approximate from "Stayed 4 nights in Sep 2025". */
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
function dateFromStayedText(t: unknown): string | null {
  const m = String(t ?? '').match(/in ([A-Za-z]{3})[a-z]*\.? (\d{4})/i)
  if (!m) return null
  const mon = MONTHS[m[1].toLowerCase()]
  if (!mon) return null
  return `${m[2]}-${String(mon).padStart(2, '0')}-01`
}

/**
 * Cleans a stored source URL for the scraper: ensures a protocol and strips
 * tracking query params for vrbo/fewo-direkt. Fewo-Direkt URLs are passed
 * as-is (canonical, without query): the property IDs do NOT resolve on
 * vrbo.com (tested: redirects to the homepage), but both storefronts share
 * the same Expedia page structure, so the scraper may parse them directly.
 */
function normalizeSourceUrl(source: string, raw: string): string {
  let url = raw.trim()
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  if (source === 'vrbo') return url.split('?')[0]
  return url
}

/* ── Apify ──────────────────────────────────────────────── */

const APIFY_ACTORS: Record<string, string> = {
  airbnb: process.env.APIFY_ACTOR_AIRBNB_REVIEWS ?? 'tri_angle~airbnb-reviews-scraper',
  booking: process.env.APIFY_ACTOR_BOOKING_REVIEWS ?? 'voyager~booking-reviews-scraper',
  vrbo: process.env.APIFY_ACTOR_VRBO_REVIEWS ?? 'powerai~vrbo-reviews-scraper',
}

/* Diese Actors rechnen PRO BEWERTUNG ab — ein Lauf über 200 kostet je
 * Wohnung ~0,50 $, und das für Zeilen, die längst in unserer DB liegen
 * (upsert, nichts geht verloren). Pro Woche kommen je Wohnung eine Handvoll
 * neue dazu; 40 neueste sind reichlich Puffer und senken die Kosten auf
 * ~0,25 $. Für einen ERSTBESTAND (neue Wohnung, leere DB) lässt sich das
 * über die Env hochsetzen, ohne den Alltag teuer zu machen. */
const MAX_REVIEWS_PER_RUN = Number(process.env.REVIEWS_MAX_PER_RUN) || 40
const SCRAPER_SOURCES = ['airbnb', 'booking', 'vrbo']

/** Apify-Antwort mit HTTP-Status und Apify-Fehlertyp — Grundlage für classifySyncError. */
class ApifyError extends Error {
  status: number
  apifyType: string | null
  constructor(label: string, status: number, body: string) {
    let type: string | null = null
    try { type = (JSON.parse(body) as { error?: { type?: string } }).error?.type ?? null } catch { /* kein JSON */ }
    super(`${label} → HTTP ${status}: ${body.slice(0, 300)}`)
    this.name = 'ApifyError'
    this.status = status
    this.apifyType = type
  }
}

/** Ordnet einen Abruf-Fehler grob ein. Erst Status + Apify-Typ, dann Text (Zeitüberschreitung). */
export function classifySyncError(e: unknown): SyncErrorKind {
  const s = String(e)
  if (/(APIFY_API_TOKEN|GOOGLE_PLACES_API_KEY) fehlt/.test(s)) return 'token'
  if (e instanceof ApifyError) {
    const t = e.apifyType ?? ''
    if (e.status === 401) return 'token'
    if (e.status === 402 || (e.status === 403 && /platform-feature-disabled|limit/i.test(t)) || /hard limit|usage limit/i.test(s)) return 'kontingent'
    if (e.status === 400 && /invalid-input/i.test(t)) return 'eingabe'
    if (e.status === 404 || e.status === 403) return 'actor'
    if (e.status === 408) return 'timeout'
  }
  // „TIMED-OUT": so meldet Apify einen Lauf, der sein Zeitlimit gerissen hat (HTTP 400 run-failed)
  if (/TimeoutError|timed?[ -]?out|aborted/i.test(s)) return 'timeout'
  return 'sonst'
}

/** Fehlertext fürs Ergebnis: gekürzt und OHNE Zugangsschlüssel (der Token steckt in der Aufruf-URL). */
function errText(e: unknown, max = 300): string {
  let s = String(e)
  const token = process.env.APIFY_API_TOKEN
  if (token) s = s.split(token).join('***')
  return s.slice(0, max)
}

/** Apify-Guthaben des laufenden Abrechnungszyklus (für die Status-Karte). Jeder Fehler → null. */
export async function getApifyBudget(): Promise<{ usedUsd: number; maxUsd: number; zyklusEnde: string | null } | null> {
  const token = process.env.APIFY_API_TOKEN
  if (!token) return null
  try {
    const res = await fetch('https://api.apify.com/v2/users/me/limits', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(6_000),
    })
    if (!res.ok) return null
    const d = (await res.json()) as { data?: { monthlyUsageCycle?: { endAt?: string }; limits?: { maxMonthlyUsageUsd?: number }; current?: { monthlyUsageUsd?: number } } }
    const usedUsd = Number(d.data?.current?.monthlyUsageUsd)
    const maxUsd = Number(d.data?.limits?.maxMonthlyUsageUsd)
    if (!Number.isFinite(usedUsd) || !Number.isFinite(maxUsd) || maxUsd <= 0) return null
    return { usedUsd: Math.round(usedUsd * 100) / 100, maxUsd, zyklusEnde: d.data?.monthlyUsageCycle?.endAt ?? null }
  } catch {
    return null
  }
}

/**
 * Runs an Apify actor synchronously and returns its dataset items.
 * Inputs cover the common field names across review-scraper actors; actors
 * ignore fields they don't know.
 */
async function runApifyActor(actorId: string, url: string, timeoutMs: number, source?: 'airbnb' | 'booking' | 'vrbo'): Promise<Record<string, unknown>[]> {
  const token = process.env.APIFY_API_TOKEN
  if (!token) throw new Error('APIFY_API_TOKEN fehlt')

  /* Paragraph 314 (1.10.2026): Die Actors validieren ihre Eingabe inzwischen STRENG. Die fruehere Sammel-Eingabe
   * (sortBy/sortOption/sort/reviewsSort/sortReviewsBy = 'newest' fuer alle) wurde mit HTTP 400 abgelehnt
   * ("sortBy must be equal to one of the allowed values: most-recent ..." bzw. "sortReviewsBy ... f_recent_desc") -
   * seit dem 12.8. (Commit 6508168, bis 12.9. zusaetzlich von der Kontingent-Sperre verdeckt) kam deshalb fuer
   * Airbnb und Booking NICHTS mehr an, ohne dass es jemand sah.
   * Jetzt je Quelle nur die Felder und Werte, die der jeweilige Actor kennt. NEUESTE ZUERST bleibt kritisch,
   * weil wir nur einen Ausschnitt (MAX_REVIEWS_PER_RUN) holen. Das Limit-Feld heisst je Actor anders:
   * Airbnb kennt NUR maxReviewsPerListing, Booking NUR maxReviewsPerHotel - fehlt es, holt (und berechnet)
   * der Actor ALLE Bewertungen. */
  const base = {
    startUrls: [{ url }],   // airbnb (tri_angle), booking (voyager)
    maxReviews: MAX_REVIEWS_PER_RUN,
    maxItems: MAX_REVIEWS_PER_RUN,
  }
  const input: Record<string, unknown> =
    source === 'airbnb' ? { ...base, maxReviewsPerListing: MAX_REVIEWS_PER_RUN, sortBy: 'most-recent' }
    : source === 'booking' ? { ...base, maxReviewsPerHotel: MAX_REVIEWS_PER_RUN, sortReviewsBy: 'f_recent_desc' }
    : { ...base, searchUrl: url, propertyUrls: [url], url, maxReviewsPerListing: MAX_REVIEWS_PER_RUN }

  const res = await fetch(
    `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${token}&timeout=${Math.floor(timeoutMs / 1000)}&format=json&clean=true`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs + 15_000),
    },
  )
  if (!res.ok) {
    const text = await res.text()
    throw new ApifyError(`Apify ${actorId}`, res.status, text)
  }
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

/**
 * Fewo-Direkt (Vrbo's German storefront): no dedicated actor exists, vrbo.com
 * actors can't parse it, and Expedia's bot protection blocks headless
 * browsers. Bis 5.10.2026 standen die Bewertungen im Seiten-HTML; seither
 * rendert Expedia sie erst im Browser per POST /graphql. Deshalb zwei Schritte
 * in EINEM Lauf von Apify's cheerio-scraper (browser-like TLS/headers +
 * residential proxy, no browser fingerprint): Seite (Note, Anzahl,
 * Property-ID) und danach die GraphQL-Abfrage. pageFunction, Eingabe und
 * Auswertung stehen testbar in lib/fewo-reviews.ts.
 *
 * Wirft nur, wenn Apify selbst scheitert. Ein gescheiterter Schritt steht in
 * `fehler` — Note und Anzahl aus Schritt 1 bleiben dann trotzdem nutzbar.
 */
async function runFewoScraper(url: string, timeoutMs: number): Promise<FewoAuswertung> {
  const token = process.env.APIFY_API_TOKEN
  if (!token) throw new Error('APIFY_API_TOKEN fehlt')

  // Bewusst OHNE clean=true: ein nach allen Wiederholungen blockierter Request (HTTP 429/403) hinterlässt
  // nur ein Item aus '#error'/'#debug' — clean würde es entfernen und die Ursache wäre unsichtbar.
  const res = await fetch(
    `https://api.apify.com/v2/acts/apify~cheerio-scraper/run-sync-get-dataset-items?token=${token}&timeout=${Math.floor(timeoutMs / 1000)}&format=json`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildFewoActorInput(url, MAX_REVIEWS_PER_RUN)),
      signal: AbortSignal.timeout(timeoutMs + 15_000),
    },
  )
  if (!res.ok) {
    const text = await res.text()
    throw new ApifyError('Apify cheerio-scraper (fewo)', res.status, text)
  }
  const data = await res.json()
  return auswerteFewoLauf((Array.isArray(data) ? data : []) as Record<string, unknown>[], MAX_REVIEWS_PER_RUN)
}

/**
 * Hängt Alt-Zeilen des früheren HTML-Parsers auf die stabile Portal-ID um (Plan: planFewoAbloesung) und
 * liefert den Bestand der Wohnung. Wirft bei jedem Datenbank-Fehler — dann wird NICHTS geschrieben: lieber
 * ein sichtbarer Fehler als Dubletten (z. B. Unique-Konflikt, wenn ein Parallel-Lauf schneller war).
 */
async function abloeseFewoAltZeilen(listingId: string, reviews: NormalizedReview[], vollstaendig: boolean): Promise<{ anzahl: number; bekannt: Set<string> }> {
  const { data, error } = await supabaseAdmin
    .from('reviews').select('id, source_review_id, author_name, rating, review_date, review_text')
    .eq('listing_id', listingId).eq('source', 'vrbo').limit(2000)
  if (error) throw new Error(`Fewo-Bestand lesen: ${error.message}`)
  const bestand = (data ?? []) as FewoBestandZeile[]
  const bekannt = new Set(bestand.map((z) => String(z.source_review_id ?? '')).filter(Boolean))
  for (const p of planFewoAbloesung(bestand, reviews, { vollstaendig })) {
    const { error: uErr } = await supabaseAdmin.from('reviews').update({ source_review_id: p.auf }).eq('id', p.id)
    if (uErr) throw new Error(`Fewo-Ablösung (${p.von} → ${p.auf}): ${uErr.message}`)
    bekannt.delete(p.von)
    bekannt.add(p.auf)
  }
  return { anzahl: bestand.length, bekannt }
}

/** Maps one raw scraper item to our review shape (tolerant across actors). */
function normalizeScraperItem(item: Record<string, unknown>, source: string): NormalizedReview | null {
  const rating = normalizeRating(pick(item, 'rating', 'stars', 'score', 'reviewScore', 'overallRating', 'rating.value'))
  if (rating === null) return null

  // Author: nested first (airbnb: reviewer.firstName), bare objects last —
  // with a guard so an unexpected object never renders as "[object Object]".
  let authorRaw = pick(item, 'reviewer.firstName', 'author.firstName', 'author.name', 'reviewer.name', 'authorName', 'guestName', 'userName', 'reviewerName', 'user.name', 'name', 'author', 'reviewer')
  if (authorRaw && typeof authorRaw === 'object') {
    const o = authorRaw as Record<string, unknown>
    authorRaw = o.firstName ?? o.name ?? o.displayName
  }
  const author = (typeof authorRaw === 'string' && authorRaw.trim() ? authorRaw.trim() : 'Gast').slice(0, 120)

  // Booking splits reviews into liked/disliked parts
  const liked = pick(item, 'likedText', 'reviewTextParts.Liked', 'positive')
  const disliked = pick(item, 'dislikedText', 'reviewTextParts.Disliked', 'negative')
  let text = pick(item, 'text', 'comments', 'reviewText', 'review', 'comment', 'body', 'description') as string | undefined
  if (!text && (liked || disliked)) {
    text = [liked && `👍 ${liked}`, disliked && `👎 ${disliked}`].filter(Boolean).join('\n')
  }

  const realDate =
    toIsoDate(pick(item, 'createdAt', 'created_at', 'date', 'reviewDate', 'publishedAt', 'publishedAtDate', 'postedAt', 'submissionTime', 'stayDate', 'localizedDate')) ??
    dateFromStayedText(item.stayedText)
  const date = realDate ?? new Date().toISOString().split('T')[0]

  const rawId = pick(item, 'id', 'reviewId', 'review_id', 'reviewUrl')
  const avatar = pick(item, 'reviewer.pictureUrl', 'author.pictureUrl', 'author.avatar', 'reviewerPhotoUrl', 'avatar', 'profilePicture', 'userAvatar', 'authorAvatar')

  return {
    source_review_id: rawId ? `${source}_${String(rawId)}` : `${source}_${stableId(author, date, String(text ?? '').slice(0, 80))}`,
    author_name: author,
    author_avatar: avatar ? String(avatar) : null,
    rating,
    review_text: text ? String(text).slice(0, 5000) : null,
    review_date: date,
    language: (pick(item, 'language', 'locale') as string | undefined)?.slice(0, 8) ?? null,
    ...(realDate ? {} : { dateGuessed: true }),
  }
}

/**
 * Full Google review texts via Apify (compass~google-maps-reviews-scraper).
 * The official Places API caps at ~5 review texts; this actor returns all of
 * them (name, stars, text, date, avatar). The official API remains the
 * authoritative source for the overall score/count.
 */
/** §174: Actor- und Places-API-Reviews haben VERSCHIEDENE ID-Räume — über
 *  mehrere Läufe hinweg entstanden Text-Duplikate derselben Rezension
 *  (gleicher Autor+Text unter zwei source_review_ids, z. B. „Dami- D" 2×).
 *  Kandidaten, deren Autor+Text-Fingerprint schon unter ANDERER ID
 *  existiert, werden übersprungen (textlose Reviews nie — dort wäre der
 *  Fingerprint nicht eindeutig). */
async function dedupeGoogleCandidates(listingId: string, candidates: NormalizedReview[]): Promise<NormalizedReview[]> {
  if (!candidates.length) return candidates
  const fp = (a: string | null | undefined, t: string | null | undefined) =>
    `${(a ?? '').trim().toLowerCase()}|${(t ?? '').trim().slice(0, 60).toLowerCase()}`
  const { data } = await supabaseAdmin
    .from('reviews').select('source_review_id, author_name, review_text')
    .eq('listing_id', listingId).eq('source', 'google').limit(1000)
  const existing = new Map<string, string>()
  for (const r of data ?? []) {
    if (r.review_text && r.review_text.trim()) existing.set(fp(r.author_name, r.review_text), r.source_review_id)
  }
  return candidates.filter((c) => {
    if (!c.review_text || !c.review_text.trim()) return true
    const known = existing.get(fp(c.author_name, c.review_text))
    return !known || known === c.source_review_id // gleiche ID → Upsert aktualisiert nur
  })
}

async function runGoogleReviewsActor(placeId: string, timeoutMs: number): Promise<Record<string, unknown>[]> {
  const token = process.env.APIFY_API_TOKEN
  if (!token) throw new Error('APIFY_API_TOKEN fehlt')

  const input = {
    placeIds: [placeId],
    maxReviews: MAX_REVIEWS_PER_RUN,
    reviewsSort: 'newest',
    language: 'de',
    personalData: true, // reviewer name + avatar (publicly visible on Google)
  }

  const res = await fetch(
    `https://api.apify.com/v2/acts/compass~google-maps-reviews-scraper/run-sync-get-dataset-items?token=${token}&timeout=${Math.floor(timeoutMs / 1000)}&format=json&clean=true`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs + 15_000),
    },
  )
  if (!res.ok) {
    const text = await res.text()
    throw new ApifyError('Apify google-reviews', res.status, text)
  }
  const data = await res.json()
  // The actor may emit place-level items without a rating; the normalizer drops those.
  return Array.isArray(data) ? data : []
}

/* ── Google Places API (New) ────────────────────────────── */

async function fetchGooglePlace(placeId: string): Promise<{
  rating: number | null
  count: number | null
  reviews: NormalizedReview[]
}> {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) throw new Error('GOOGLE_PLACES_API_KEY fehlt')

  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=de`, {
    headers: {
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'rating,userRatingCount,reviews',
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Places → HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  const data = await res.json() as {
    rating?: number
    userRatingCount?: number
    reviews?: Array<{
      name?: string
      rating?: number
      publishTime?: string
      text?: { text?: string; languageCode?: string }
      originalText?: { text?: string }
      authorAttribution?: { displayName?: string; photoUri?: string }
    }>
  }

  const reviews: NormalizedReview[] = []
  for (const r of data.reviews ?? []) {
    const rating = normalizeRating(r.rating)
    if (rating === null) continue
    const author = (r.authorAttribution?.displayName ?? 'Google-Nutzer').slice(0, 120)
    const date = toIsoDate(r.publishTime) ?? new Date().toISOString().split('T')[0]
    reviews.push({
      source_review_id: r.name ? `google_${stableId(r.name)}` : `google_${stableId(author, date)}`,
      author_name: author,
      author_avatar: r.authorAttribution?.photoUri ?? null,
      rating,
      review_text: r.text?.text ?? r.originalText?.text ?? null,
      review_date: date,
      language: r.text?.languageCode?.slice(0, 8) ?? null,
    })
  }

  return { rating: data.rating ?? null, count: data.userRatingCount ?? null, reviews }
}

/* ── Persistence ────────────────────────────────────────── */

async function upsertReviews(
  listingId: string, source: string, reviews: NormalizedReview[],
  /** createdAtAusDatum: created_at = Bewertungsdatum (nur für die Nachholung alter Bewertungen, s. FeWo-Zweig) */
  opts?: { createdAtAusDatum?: boolean },
): Promise<number> {
  if (reviews.length === 0) return 0
  const rows = reviews.map(r => ({
    ...(opts?.createdAtAusDatum ? { created_at: `${r.review_date}T12:00:00.000Z` } : {}),
    listing_id: listingId,
    source,
    source_review_id: r.source_review_id,
    author_name: r.author_name,
    author_avatar: r.author_avatar,
    rating: r.rating,
    review_text: r.review_text,
    review_date: r.review_date,
    language: r.language ?? 'de',
    verified: true, // imported from a platform where only real guests can review
  }))
  const { error, count } = await supabaseAdmin
    .from('reviews')
    .upsert(rows, { onConflict: 'listing_id,source,source_review_id', count: 'exact' })
  if (error) throw new Error(`Upsert (${source}): ${error.message}`)
  return count ?? rows.length
}

/** Recomputes a platform's score from stored rows and writes it to the listing. */
async function refreshScoreFromRows(listingId: string, source: string): Promise<{ score: number; count: number } | null> {
  const { data } = await supabaseAdmin
    .from('reviews')
    .select('rating')
    .eq('listing_id', listingId)
    .eq('source', source)
  if (!data || data.length === 0) {
    // No rows (e.g. after deleting bad imports) → clear stale score columns
    await supabaseAdmin
      .from('listings')
      .update({ [`${source}_score`]: null, [`${source}_review_count`]: 0 })
      .eq('id', listingId)
    return null
  }
  const avg = data.reduce((s, r) => s + Number(r.rating), 0) / data.length
  const score = Math.round(avg * 100) / 100
  await supabaseAdmin
    .from('listings')
    .update({ [`${source}_score`]: score, [`${source}_review_count`]: data.length })
    .eq('id', listingId)
  return { score, count: data.length }
}

/** Wie viele der abgerufenen Bewertungen kennen wir noch NICHT? VOR dem Upsert aufrufen.
 *  Bewusst ohne listing_id-Filter: bei geteilten Booking-Unterkünften löscht der Match-Cron (§124)
 *  die Geschwister-Kopien wieder — die zählten sonst jede Woche als „neu". Fehler → undefined. */
async function countNew(source: string, reviews: NormalizedReview[]): Promise<number | undefined> {
  try {
    const ids = [...new Set(reviews.map((r) => r.source_review_id))]
    const known = new Set<string>()
    for (let i = 0; i < ids.length; i += 40) {
      const { data, error } = await supabaseAdmin
        .from('reviews').select('source_review_id')
        .eq('source', source).in('source_review_id', ids.slice(i, i + 40))
      if (error) return undefined
      for (const r of data ?? []) known.add(r.source_review_id)
    }
    return ids.filter((id) => !known.has(id)).length
  } catch {
    return undefined
  }
}

/** Jüngstes ECHTES Bewertungsdatum + Anzahl der Bewertungen ohne lesbares Datum. */
function dateStats(reviews: NormalizedReview[]): { newest: string | null; ohneDatum: number } {
  let newest: string | null = null
  let ohneDatum = 0
  for (const r of reviews) {
    if (r.dateGuessed) { ohneDatum++; continue }
    if (!newest || r.review_date > newest) newest = r.review_date
  }
  return { newest, ohneDatum }
}

/* ── Main entry point ───────────────────────────────────── */

export async function syncListingReviews(listing: ListingRow, opts: SyncOptions = {}): Promise<SyncSourceResult[]> {
  const results: SyncSourceResult[] = []
  const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? 150_000, 30_000), 150_000)

  const scraperSources: Array<{ source: 'airbnb' | 'booking' | 'vrbo'; url: string | null }> = [
    { source: 'airbnb', url: listing.airbnb_url },
    { source: 'booking', url: listing.booking_url },
    { source: 'vrbo', url: listing.vrbo_url },
  ]

  // Run the three scrapers in parallel (each can take 1–2 minutes)
  const scraperPromises = scraperSources.map(async ({ source, url }): Promise<SyncSourceResult> => {
    if (!url) {
      // No source configured → clear any stale score columns (e.g. leftovers
      // from the old scraper) so aggregate numbers stay truthful.
      await supabaseAdmin
        .from('listings')
        .update({ [`${source}_score`]: null, [`${source}_review_count`]: 0 })
        .eq('id', listing.id)
      return { source, status: 'skipped', fetched: 0, upserted: 0, detail: 'keine URL hinterlegt' }
    }
    if (!process.env.APIFY_API_TOKEN) return { source, status: 'skipped', fetched: 0, upserted: 0, detail: 'APIFY_API_TOKEN fehlt', errorKind: 'token' }
    try {
      const cleanUrl = normalizeSourceUrl(source, url)

      // Fewo-Direkt: Seite (maßgebliche Note/Anzahl) + GraphQL (Texte) in einem Lauf
      if (source === 'vrbo' && /fewo-direkt\.de/i.test(cleanUrl)) {
        const lauf = await runFewoScraper(cleanUrl, timeoutMs)
        const normalized = lauf.items
          .map(i => normalizeScraperItem(i as unknown as Record<string, unknown>, source))
          .filter((r): r is NormalizedReview => r !== null)
        // Alt-Zeilen VOR countNew und Upsert umhängen — sonst zählten sie als „neu" und entstünden doppelt
        const { anzahl: bestand, bekannt } = await abloeseFewoAltZeilen(listing.id, normalized, lauf.vollstaendig)
        const neu = normalized.length ? await countNew(source, normalized) : undefined
        const ds = dateStats(normalized)
        /* Nachholung (Erstimport nach dem 5.10.2026: rund 60 Texte, teils von 2023): NEUE Zeilen, deren
         * Aufenthaltsmonat länger als 60 Tage zurückliegt, bekommen created_at = Bewertungsdatum. Wochenbericht
         * (lib/weekly-digest.ts) und KI-Aufgaben (lib/task-suggest.ts) lesen „neu" über created_at und würden
         * jahrealte Bewertungen sonst als Bewertungen dieser Woche behandeln. */
        const altGrenze = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10)
        const nachholung = normalized.filter((r) => !bekannt.has(r.source_review_id) && !r.dateGuessed && r.review_date < altGrenze)
        const aktuell = normalized.filter((r) => !nachholung.includes(r))
        const upserted = (await upsertReviews(listing.id, source, aktuell))
          + (await upsertReviews(listing.id, source, nachholung, { createdAtAusDatum: true }))

        /* Ehrlicher Status: Ein Lauf ohne Texte ist nur dann in Ordnung, wenn es nachweislich keine gibt.
         * Scheitert ein Schritt (Property-ID fehlt, GraphQL blockiert, Hash veraltet, leere Antwort) oder
         * kommt nichts, obwohl wir Bewertungen gespeichert haben, ist das ein FEHLER — auch wenn Note und
         * Anzahl gelesen wurden (bis 5.10.2026 lief genau das wochenlang als „ok, 0 geholt"). */
        const fehler = lauf.fehler ?? (normalized.length === 0 && bestand > 0
          ? { art: 'leer' as const, text: `FeWo: keine Bewertung geliefert, obwohl ${bestand} gespeichert sind` }
          : null)

        // Note/Anzahl der Portalseite schreiben — auch im Fehlerfall (Schritt 1 bleibt gültig) und auch bei
        // genau 1 Bewertung. Fehlt die Angabe, aus den Zeilen rechnen; im Fehlerfall NICHT (refreshScoreFromRows
        // würde bei 0 Zeilen die Spalten leeren).
        let score: number | undefined
        let count: number | undefined
        if (lauf.seite?.score != null && lauf.portalCount != null) {
          score = Math.round((lauf.seite.score / 2) * 100) / 100
          count = lauf.portalCount
          await supabaseAdmin
            .from('listings')
            .update({ vrbo_score: score, vrbo_review_count: count })
            .eq('id', listing.id)
        } else if (!fehler) {
          const stats = await refreshScoreFromRows(listing.id, source)
          score = stats?.score
          count = stats?.count
        }
        if (fehler) {
          return { source, status: 'error', errorKind: fehler.art, detail: fehler.text.slice(0, 300), fetched: normalized.length, upserted, score, count, ...ds }
        }
        return { source, status: 'ok', fetched: normalized.length, upserted, score, count, neu, ...ds }
      }

      const items = await runApifyActor(APIFY_ACTORS[source], cleanUrl, timeoutMs, source)
      const normalized = items
        .map(i => normalizeScraperItem(i, source))
        .filter((r): r is NormalizedReview => r !== null)
      /* Leer-Wächter (§314): Wir holen „neueste zuerst" — ein gesunder Lauf liefert mindestens die
       * Bewertungen, die wir schon kennen. Kommt NICHTS Verwertbares, obwohl die Wohnung bei dieser
       * Quelle Bewertungen hat, ist der Lauf kaputt (Actor-Ausgabe geändert, Seite blockiert) und darf
       * nicht als „ok, 0 abgerufen" durchgehen. Ohne Bestand ist ein leeres Ergebnis normal. */
      if (normalized.length === 0) {
        const { count: bestand } = await supabaseAdmin
          .from('reviews').select('id', { count: 'exact', head: true })
          .eq('listing_id', listing.id).eq('source', source)
        if ((bestand ?? 0) > 0) {
          const felder = items[0] ? ` · Felder: ${Object.keys(items[0]).slice(0, 8).join(', ')}` : ''
          return {
            source, status: 'error', errorKind: 'leer', fetched: items.length, upserted: 0,
            detail: `Actor lieferte keine verwertbare Bewertung (roh ${items.length}${felder}), obwohl ${bestand} gespeichert sind`.slice(0, 300),
          }
        }
      }
      const neu = await countNew(source, normalized)
      const upserted = await upsertReviews(listing.id, source, normalized)
      const stats = await refreshScoreFromRows(listing.id, source)
      return { source, status: 'ok', fetched: items.length, upserted, score: stats?.score, count: stats?.count, neu, ...dateStats(normalized) }
    } catch (e) {
      return { source, status: 'error', fetched: 0, upserted: 0, detail: errText(e), errorKind: classifySyncError(e) }
    }
  })

  // Google in parallel too (fast, official API)
  const googlePromise = (async (): Promise<SyncSourceResult> => {
    if (!listing.google_place_id) {
      await supabaseAdmin
        .from('listings')
        .update({ google_score: null, google_review_count: 0 })
        .eq('id', listing.id)
      return { source: 'google', status: 'skipped', fetched: 0, upserted: 0, detail: 'keine Place-ID hinterlegt' }
    }
    if (!process.env.GOOGLE_PLACES_API_KEY) return { source: 'google', status: 'skipped', fetched: 0, upserted: 0, detail: 'GOOGLE_PLACES_API_KEY fehlt', errorKind: 'token' }
    try {
      // Official API → authoritative overall score + count
      const { rating, count, reviews: apiReviews } = await fetchGooglePlace(listing.google_place_id)
      if (rating !== null && count !== null) {
        await supabaseAdmin
          .from('listings')
          .update({ google_score: rating, google_review_count: count })
          .eq('id', listing.id)
      }

      // Full review texts via Apify (all reviews, not just the API's ~5).
      // Exclusive per run: the two sources use different review-id spaces, so
      // we only fall back to the API's reviews when the actor fails.
      let fetched = 0
      let upserted = 0
      let detail: string | undefined
      let neu: number | undefined
      let ds: { newest: string | null; ohneDatum: number } | undefined
      // §314: Volltext-Actor gescheitert → Ergebnis bleibt „ok" (Score stimmt), gilt im Protokoll aber als TEILWEISE
      let partial: { errorKind: SyncErrorKind } | null = null
      const store = async (cands: NormalizedReview[]) => {
        const fresh = await dedupeGoogleCandidates(listing.id, cands)
        neu = await countNew('google', fresh)
        ds = dateStats(cands)
        fetched = cands.length
        upserted = await upsertReviews(listing.id, 'google', fresh)
      }
      if (process.env.APIFY_API_TOKEN && count && count > 0) {
        try {
          const items = await runGoogleReviewsActor(listing.google_place_id, timeoutMs)
          const normalized = items
            .map(i => normalizeScraperItem(i, 'google'))
            .filter((r): r is NormalizedReview => r !== null)
          await store(normalized)
        } catch (e) {
          detail = `Volltexte: ${errText(e, 220)}`
          partial = { errorKind: classifySyncError(e) }
          await store(apiReviews)
        }
      } else {
        await store(apiReviews)
      }

      return {
        source: 'google', status: 'ok', fetched, upserted, score: rating ?? undefined, count: count ?? undefined, detail,
        neu, ...(ds ?? {}), ...(partial ? { partial: true, errorKind: partial.errorKind } : {}),
      }
    } catch (e) {
      return { source: 'google', status: 'error', fetched: 0, upserted: 0, detail: errText(e), errorKind: classifySyncError(e) }
    }
  })()

  results.push(...(await Promise.all([...scraperPromises, googlePromise])))

  /* §314: reviews_synced_at steuert die Montags-Rotation (ältester Stand zuerst). Früher wurde es IMMER
   * gesetzt — auch wenn alle Portale scheiterten; die Wohnung galt dann als „frisch" und der Ausfall blieb
   * wochenlang unsichtbar. Jetzt nur noch, wenn mindestens EINE hinterlegte Scraper-Quelle (Airbnb, Booking,
   * FeWo-direkt) geklappt hat oder gar keine hinterlegt ist. Google zählt bewusst nicht mit: die Places-API
   * antwortet praktisch immer und würde den Ausfall wieder verdecken. Der „letzte Versuch" steht im
   * Protokoll (app_settings 'reviews_sync:<listingId>'). */
  const hinterlegt = results.filter((r) => SCRAPER_SOURCES.includes(r.source) && !(r.status === 'skipped' && !r.errorKind))
  const scraperOk = hinterlegt.some((r) => r.status === 'ok')
  if (scraperOk || hinterlegt.length === 0) {
    await supabaseAdmin
      .from('listings')
      .update({ reviews_synced_at: new Date().toISOString() })
      .eq('id', listing.id)
  }
  for (const r of results) {
    if (r.status === 'error') console.error(`[reviews-sync] ${listing.id} ${r.source}: ${r.detail ?? 'Fehler'}`)
  }
  // Protokoll je Wohnung — fail-soft: ein Schreibfehler darf den Sync nie brechen
  try {
    await writeSyncLog(listing, results, opts.origin ?? 'manuell')
  } catch (e) {
    console.error('[reviews-sync] Protokoll konnte nicht geschrieben werden:', e)
  }

  // Refresh the AI guest summary from the (possibly just updated) review
  // texts. Its outcome is reported as an own results row so failures are
  // visible right in the editor (no Vercel log digging) — but never break
  // the sync itself.
  try {
    const summaryStatus = await updateGuestSummary(listing.id)
    results.push({ source: 'zusammenfassung', status: summaryStatus === 'ok' ? 'ok' : 'skipped', fetched: 0, upserted: 0, detail: summaryStatus })
  } catch (err) {
    console.error('[reviews-sync] guest summary failed:', err)
    results.push({ source: 'zusammenfassung', status: 'error', fetched: 0, upserted: 0, detail: err instanceof Error ? err.message : String(err) })
  }

  return results
}

/**
 * "Das sagen unsere Gäste" — 2–3 warm sentences summarising what guests
 * praise, generated ONLY from imported review texts (no invented facts).
 * Written to listings.guest_summary; skipped below 5 usable texts.
 */
export async function updateGuestSummary(listingId: string): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) return 'ANTHROPIC_API_KEY fehlt'

  const { data: reviews, error: loadError } = await supabaseAdmin
    .from('reviews')
    .select('review_text, rating, source')
    .eq('listing_id', listingId)
    .not('review_text', 'is', null)
    .order('review_date', { ascending: false })
    .limit(60)
  if (loadError) throw new Error('Reviews laden: ' + loadError.message)

  const texts = (reviews ?? [])
    .map((r) => (r.review_text ?? '').trim())
    .filter((t) => t.length >= 20)
  if (texts.length < 5) return `zu wenige Texte (${texts.length})`

  const system = `Du fasst Gästebewertungen für eine TRIMOSA-Ferienwohnung zusammen.
Schreibe 2–3 warme, konkrete Sätze auf Deutsch darüber, was Gäste an dieser Wohnung
am häufigsten loben (z. B. Sauberkeit, Lage, Ausstattung, Gastgeber) — NUR aus den
Bewertungstexten, nichts erfinden, keine Übertreibungen, keine Superlative, die nicht
in den Texten stehen. Keine Anführungszeichen, keine Einleitung wie "Die Gäste sagen" —
beginne direkt, z. B. "Gäste loben immer wieder …". Antworte NUR mit der Zusammenfassung.`

  const user = texts.map((t, i) => `${i + 1}. ${t.slice(0, 500)}`).join('\n')
  const summary = await askClaude(system, user, 400)

  const { error: writeError } = await supabaseAdmin
    .from('listings')
    .update({ guest_summary: summary, guest_summary_updated_at: new Date().toISOString() })
    .eq('id', listingId)
  if (writeError) throw new Error('Summary speichern: ' + writeError.message)
  // The listing detail page caches its parameter-less render — refresh it so
  // the new summary shows up immediately.
  try { revalidatePath('/listing/[id]', 'page') } catch { /* outside request scope */ }
  return 'ok'
}
