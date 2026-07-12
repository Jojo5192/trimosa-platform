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
 * Missing env vars simply skip that source (reported in diagnostics).
 */
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createHash } from 'crypto'

/* ── Types ──────────────────────────────────────────────── */

export interface SyncSourceResult {
  source: string
  status: 'ok' | 'skipped' | 'error'
  fetched: number      // items returned by the source
  upserted: number     // rows written (new or refreshed)
  score?: number       // per-platform score written to the listing
  count?: number       // per-platform review count written to the listing
  detail?: string      // skip reason / error message
}

interface NormalizedReview {
  source_review_id: string
  author_name: string
  author_avatar: string | null
  rating: number          // normalized to 1–5
  review_text: string | null
  review_date: string     // YYYY-MM-DD
  language: string | null
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
 * Cleans a stored source URL for the scraper: ensures a protocol, and maps
 * Fewo-Direkt property URLs to their vrbo.com equivalent (Fewo-Direkt is
 * Vrbo's German storefront; the scraper only accepts vrbo.com).
 */
function normalizeSourceUrl(source: string, raw: string): string {
  let url = raw.trim()
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  if (source === 'vrbo') {
    const fewo = url.match(/fewo-direkt\.de\/[^?]*\/p(\d+)/i)
    if (fewo) return `https://www.vrbo.com/${fewo[1]}`
    return url.split('?')[0]
  }
  return url
}

/* ── Apify ──────────────────────────────────────────────── */

const APIFY_ACTORS: Record<string, string> = {
  airbnb: process.env.APIFY_ACTOR_AIRBNB_REVIEWS ?? 'tri_angle~airbnb-reviews-scraper',
  booking: process.env.APIFY_ACTOR_BOOKING_REVIEWS ?? 'voyager~booking-reviews-scraper',
  vrbo: process.env.APIFY_ACTOR_VRBO_REVIEWS ?? 'powerai~vrbo-reviews-scraper',
}

const MAX_REVIEWS_PER_RUN = 200

/**
 * Runs an Apify actor synchronously and returns its dataset items.
 * Inputs cover the common field names across review-scraper actors; actors
 * ignore fields they don't know.
 */
async function runApifyActor(actorId: string, url: string, timeoutMs: number): Promise<Record<string, unknown>[]> {
  const token = process.env.APIFY_API_TOKEN
  if (!token) throw new Error('APIFY_API_TOKEN fehlt')

  const input = {
    startUrls: [{ url }],   // airbnb (tri_angle), booking (voyager)
    searchUrl: url,         // vrbo (powerai)
    propertyUrls: [url],
    url,
    maxReviews: MAX_REVIEWS_PER_RUN,
    maxItems: MAX_REVIEWS_PER_RUN,
    maxReviewsPerListing: MAX_REVIEWS_PER_RUN,
  }

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
    throw new Error(`Apify ${actorId} → HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  const data = await res.json()
  return Array.isArray(data) ? data : []
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

  const date =
    toIsoDate(pick(item, 'createdAt', 'created_at', 'date', 'reviewDate', 'publishedAt', 'postedAt', 'submissionTime', 'stayDate', 'localizedDate')) ??
    dateFromStayedText(item.stayedText) ??
    new Date().toISOString().split('T')[0]

  const rawId = pick(item, 'id', 'reviewId', 'review_id', 'reviewUrl')
  const avatar = pick(item, 'reviewer.pictureUrl', 'author.pictureUrl', 'author.avatar', 'avatar', 'profilePicture', 'userAvatar', 'authorAvatar')

  return {
    source_review_id: rawId ? `${source}_${String(rawId)}` : `${source}_${stableId(author, date, String(text ?? '').slice(0, 80))}`,
    author_name: author,
    author_avatar: avatar ? String(avatar) : null,
    rating,
    review_text: text ? String(text).slice(0, 5000) : null,
    review_date: date,
    language: (pick(item, 'language', 'locale') as string | undefined)?.slice(0, 8) ?? null,
  }
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

async function upsertReviews(listingId: string, source: string, reviews: NormalizedReview[]): Promise<number> {
  if (reviews.length === 0) return 0
  const rows = reviews.map(r => ({
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

/* ── Main entry point ───────────────────────────────────── */

export async function syncListingReviews(listing: ListingRow): Promise<SyncSourceResult[]> {
  const results: SyncSourceResult[] = []

  const scraperSources: Array<{ source: 'airbnb' | 'booking' | 'vrbo'; url: string | null }> = [
    { source: 'airbnb', url: listing.airbnb_url },
    { source: 'booking', url: listing.booking_url },
    { source: 'vrbo', url: listing.vrbo_url },
  ]

  // Run the three scrapers in parallel (each can take 1–2 minutes)
  const scraperPromises = scraperSources.map(async ({ source, url }): Promise<SyncSourceResult> => {
    if (!url) return { source, status: 'skipped', fetched: 0, upserted: 0, detail: 'keine URL hinterlegt' }
    if (!process.env.APIFY_API_TOKEN) return { source, status: 'skipped', fetched: 0, upserted: 0, detail: 'APIFY_API_TOKEN fehlt' }
    try {
      const items = await runApifyActor(APIFY_ACTORS[source], normalizeSourceUrl(source, url), 150_000)
      const normalized = items
        .map(i => normalizeScraperItem(i, source))
        .filter((r): r is NormalizedReview => r !== null)
      const upserted = await upsertReviews(listing.id, source, normalized)
      const stats = await refreshScoreFromRows(listing.id, source)
      return { source, status: 'ok', fetched: items.length, upserted, score: stats?.score, count: stats?.count }
    } catch (e) {
      return { source, status: 'error', fetched: 0, upserted: 0, detail: String(e).slice(0, 300) }
    }
  })

  // Google in parallel too (fast, official API)
  const googlePromise = (async (): Promise<SyncSourceResult> => {
    if (!listing.google_place_id) return { source: 'google', status: 'skipped', fetched: 0, upserted: 0, detail: 'keine Place-ID hinterlegt' }
    if (!process.env.GOOGLE_PLACES_API_KEY) return { source: 'google', status: 'skipped', fetched: 0, upserted: 0, detail: 'GOOGLE_PLACES_API_KEY fehlt' }
    try {
      const { rating, count, reviews } = await fetchGooglePlace(listing.google_place_id)
      const upserted = await upsertReviews(listing.id, 'google', reviews)
      // Google's own rating/count are authoritative (we only get ~5 review texts)
      if (rating !== null && count !== null) {
        await supabaseAdmin
          .from('listings')
          .update({ google_score: rating, google_review_count: count })
          .eq('id', listing.id)
      }
      return { source: 'google', status: 'ok', fetched: reviews.length, upserted, score: rating ?? undefined, count: count ?? undefined }
    } catch (e) {
      return { source: 'google', status: 'error', fetched: 0, upserted: 0, detail: String(e).slice(0, 300) }
    }
  })()

  results.push(...(await Promise.all([...scraperPromises, googlePromise])))

  await supabaseAdmin
    .from('listings')
    .update({ reviews_synced_at: new Date().toISOString() })
    .eq('id', listing.id)

  return results
}
