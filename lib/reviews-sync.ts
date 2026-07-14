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
import { askClaude } from '@/lib/ai'
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

/**
 * Fewo-Direkt (Vrbo's German storefront): no dedicated actor exists, vrbo.com
 * actors can't parse it, and Expedia's bot protection blocks headless
 * browsers. But the reviews are SERVER-RENDERED into the initial HTML — so a
 * plain HTML fetch via Apify's cheerio-scraper (browser-like TLS/headers +
 * residential proxy, no browser fingerprint) plus regex parsing suffices.
 * The page also carries the authoritative overall score ("9,6 von 10.") and
 * verified review count, which we use for the listing columns directly.
 */
const FEWO_CHEERIO_FUNCTION = `async function pageFunction(context) {
  // Decode the entities we match against — the raw SSR body may encode them.
  const html = (context.body || '')
    .replace(/&#x2013;|&#8211;|&ndash;/g, '\\u2013')
    .replace(/&#xFC;|&#252;|&uuml;/g, '\\u00fc')
    .replace(/&#xE4;|&#228;|&auml;/g, '\\u00e4');
  const debug = {
    __debug: true, len: html.length,
    title: (html.match(/<title>([^<]*)/) || [])[1] || '',
    h3: (html.match(/<h3/g) || []).length,
    para: (html.match(/uitk-paragraph-2/g) || []).length,
  };

  const meta = { __meta: true, score: null, count: null };
  const s = html.match(/(\\d+(?:,\\d+)?) von 10\\./);
  if (s) meta.score = parseFloat(s[1].replace(',', '.'));
  const c = html.match(/Alle (\\d+) Bewertungen anzeigen/) || html.match(/aria-label="(\\d+) gepr\\u00fcfte Bewertung/) || html.match(/(\\d+) gepr\\u00fcfte Bewertung/);
  if (c) meta.count = parseInt(c[1], 10);

  const MONTHS = { januar: 1, februar: 2, m\u00e4rz: 3, april: 4, mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12 };
  const out = [];
  const chunks = html.split(/(?=<h3[^>]*>\\d+\\/10 \\u2013 )/).slice(1);
  for (const chunk of chunks) {
    const rating = parseInt((chunk.match(/^<h3[^>]*>(\\d+)\\/10 \\u2013 /) || [])[1], 10);
    if (!rating) continue;
    const author = (chunk.match(/uitk-text uitk-type-300 uitk-type-medium uitk-text-standard-theme">([^<]+)</) || [])[1];
    const stay = chunk.match(/Aufenthalt von \\d+ (?:Nacht|N\\u00e4chten) im ([A-Za-z\\u00e4\\u00f6\\u00fc\\u00c4\\u00d6\\u00dc]+) (\\d{4})/);
    let reviewDate = null;
    if (stay) { const m = MONTHS[stay[1].toLowerCase()]; if (m) reviewDate = stay[2] + '-' + String(m).padStart(2, '0') + '-01'; }
    const text = (chunk.match(/<p class="uitk-paragraph uitk-paragraph-2">([\\s\\S]*?)<\\/p>/) || [])[1];
    out.push({
      author: author || 'Gast',
      rating,
      reviewText: text ? text.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim() : null,
      reviewDate,
    });
  }
  if (out.length === 0) debug.snippet = html.slice(0, 200);
  return [debug, meta, ...out];
}`

async function runFewoScraper(url: string, timeoutMs: number): Promise<{
  items: Record<string, unknown>[]
  meta: { score: number | null; count: number | null } | null
}> {
  const token = process.env.APIFY_API_TOKEN
  if (!token) throw new Error('APIFY_API_TOKEN fehlt')

  const input = {
    startUrls: [{ url }],
    pageFunction: FEWO_CHEERIO_FUNCTION,
    maxPagesPerCrawl: 1,
    // Expedia's bot protection blocks probabilistically — retry generously
    // with rotating German residential IPs (most natural for fewo-direkt.de).
    maxRequestRetries: 10,
    proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'], apifyProxyCountry: 'DE' },
  }

  const res = await fetch(
    `https://api.apify.com/v2/acts/apify~cheerio-scraper/run-sync-get-dataset-items?token=${token}&timeout=${Math.floor(timeoutMs / 1000)}&format=json&clean=true`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs + 15_000),
    },
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Apify cheerio-scraper (fewo) → HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  const data = await res.json()
  const all = (Array.isArray(data) ? data : []) as Record<string, unknown>[]

  const debug = all.find(i => i.__debug)
  const metaItem = all.find(i => i.__meta) as { score?: number | null; count?: number | null } | undefined
  const items = all.filter(i => !i.__debug && !i.__meta)
  if (items.length === 0 && (!metaItem || metaItem.score == null)) {
    if (!debug) throw new Error('Fewo: Seite wurde nicht geladen (Bot-Schutz/Proxy?)')
    throw new Error(`Fewo: geladen, aber nichts extrahiert — ${JSON.stringify(debug).slice(0, 220)}`)
  }
  return { items, meta: metaItem ? { score: metaItem.score ?? null, count: metaItem.count ?? null } : null }
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
    toIsoDate(pick(item, 'createdAt', 'created_at', 'date', 'reviewDate', 'publishedAt', 'publishedAtDate', 'postedAt', 'submissionTime', 'stayDate', 'localizedDate')) ??
    dateFromStayedText(item.stayedText) ??
    new Date().toISOString().split('T')[0]

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
  }
}

/**
 * Full Google review texts via Apify (compass~google-maps-reviews-scraper).
 * The official Places API caps at ~5 review texts; this actor returns all of
 * them (name, stars, text, date, avatar). The official API remains the
 * authoritative source for the overall score/count.
 */
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
    throw new Error(`Apify google-reviews → HTTP ${res.status}: ${text.slice(0, 300)}`)
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
    if (!url) {
      // No source configured → clear any stale score columns (e.g. leftovers
      // from the old scraper) so aggregate numbers stay truthful.
      await supabaseAdmin
        .from('listings')
        .update({ [`${source}_score`]: null, [`${source}_review_count`]: 0 })
        .eq('id', listing.id)
      return { source, status: 'skipped', fetched: 0, upserted: 0, detail: 'keine URL hinterlegt' }
    }
    if (!process.env.APIFY_API_TOKEN) return { source, status: 'skipped', fetched: 0, upserted: 0, detail: 'APIFY_API_TOKEN fehlt' }
    try {
      const cleanUrl = normalizeSourceUrl(source, url)

      // Fewo-Direkt: plain-HTML scrape incl. authoritative page score/count
      if (source === 'vrbo' && /fewo-direkt\.de/i.test(cleanUrl)) {
        const { items, meta } = await runFewoScraper(cleanUrl, 120_000)
        const normalized = items
          .map(i => normalizeScraperItem(i, source))
          .filter((r): r is NormalizedReview => r !== null)
        const upserted = await upsertReviews(listing.id, source, normalized)
        if (meta?.score != null && meta?.count != null) {
          const score5 = Math.round((meta.score / 2) * 100) / 100
          await supabaseAdmin
            .from('listings')
            .update({ vrbo_score: score5, vrbo_review_count: meta.count })
            .eq('id', listing.id)
          return { source, status: 'ok', fetched: items.length, upserted, score: score5, count: meta.count }
        }
        const stats = await refreshScoreFromRows(listing.id, source)
        return { source, status: 'ok', fetched: items.length, upserted, score: stats?.score, count: stats?.count }
      }

      const items = await runApifyActor(APIFY_ACTORS[source], cleanUrl, 150_000)
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
    if (!listing.google_place_id) {
      await supabaseAdmin
        .from('listings')
        .update({ google_score: null, google_review_count: 0 })
        .eq('id', listing.id)
      return { source: 'google', status: 'skipped', fetched: 0, upserted: 0, detail: 'keine Place-ID hinterlegt' }
    }
    if (!process.env.GOOGLE_PLACES_API_KEY) return { source: 'google', status: 'skipped', fetched: 0, upserted: 0, detail: 'GOOGLE_PLACES_API_KEY fehlt' }
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
      if (process.env.APIFY_API_TOKEN && count && count > 0) {
        try {
          const items = await runGoogleReviewsActor(listing.google_place_id, 150_000)
          const normalized = items
            .map(i => normalizeScraperItem(i, 'google'))
            .filter((r): r is NormalizedReview => r !== null)
          fetched = normalized.length
          upserted = await upsertReviews(listing.id, 'google', normalized)
        } catch (e) {
          detail = `Volltexte: ${String(e).slice(0, 220)}`
          fetched = apiReviews.length
          upserted = await upsertReviews(listing.id, 'google', apiReviews)
        }
      } else {
        fetched = apiReviews.length
        upserted = await upsertReviews(listing.id, 'google', apiReviews)
      }

      return { source: 'google', status: 'ok', fetched, upserted, score: rating ?? undefined, count: count ?? undefined, detail }
    } catch (e) {
      return { source: 'google', status: 'error', fetched: 0, upserted: 0, detail: String(e).slice(0, 300) }
    }
  })()

  results.push(...(await Promise.all([...scraperPromises, googlePromise])))

  await supabaseAdmin
    .from('listings')
    .update({ reviews_synced_at: new Date().toISOString() })
    .eq('id', listing.id)

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
  return 'ok'
}
