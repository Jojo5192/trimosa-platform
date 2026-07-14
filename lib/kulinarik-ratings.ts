/**
 * Live Google ratings for the curated Kulinarik places (region pages).
 *
 * Server-only: called from the region page's server component, so the
 * GOOGLE_PLACES_API_KEY never leaves Vercel. Uses Places API (New) Text
 * Search with a minimal field mask.
 *
 * Cost control: results are cached in-process for 24 h (globalThis survives
 * across invocations while the lambda stays warm) AND the region page itself
 * is ISR-cached (revalidate 3600), so lookups only run when a page actually
 * regenerates on a cold instance. Failures degrade gracefully — no rating
 * badge, page renders normally.
 */
import type { KulinarikTipp } from '@/lib/regions'

export interface KulinarikRating {
  rating: number
  count: number
}

type CacheEntry = { value: KulinarikRating | null; expires: number }

const TTL_MS = 24 * 60 * 60 * 1000

const g = globalThis as typeof globalThis & { __kulinarikRatingCache?: Map<string, CacheEntry> }
const cache = (g.__kulinarikRatingCache ??= new Map<string, CacheEntry>())

async function lookupRating(query: string, key: string): Promise<KulinarikRating | null> {
  const hit = cache.get(query)
  if (hit && hit.expires > Date.now()) return hit.value

  let value: KulinarikRating | null = null
  let failed = false
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.rating,places.userRatingCount',
      },
      body: JSON.stringify({ textQuery: query, languageCode: 'de', maxResultCount: 1 }),
      cache: 'no-store',
    })
    if (res.ok) {
      const data = await res.json()
      const place = data?.places?.[0]
      if (typeof place?.rating === 'number' && typeof place?.userRatingCount === 'number' && place.userRatingCount > 0) {
        value = { rating: place.rating, count: place.userRatingCount }
      }
    } else {
      failed = true
      console.error('[kulinarik-ratings] Places search failed:', res.status, query, (await res.text().catch(() => '')).slice(0, 200))
    }
  } catch (err) {
    failed = true
    console.error('[kulinarik-ratings] Places search error:', query, err)
  }

  // Successes AND genuine "no match" results cache for 24 h; transient API
  // failures only briefly (5 min) so one hiccup can't hide all badges for a day.
  cache.set(query, { value, expires: Date.now() + (failed ? 5 * 60 * 1000 : TTL_MS) })
  return value
}

/** Ratings keyed by tip name. Empty when no API key is configured. */
export async function getKulinarikRatings(tipps: KulinarikTipp[]): Promise<Record<string, KulinarikRating>> {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) return {}

  const withQuery = tipps.filter((t): t is KulinarikTipp & { googleQuery: string } => !!t.googleQuery)
  const results = await Promise.all(
    withQuery.map(async (t) => [t.name, await lookupRating(t.googleQuery, key)] as const)
  )

  const map: Record<string, KulinarikRating> = {}
  for (const [name, rating] of results) {
    if (rating) map[name] = rating
  }
  return map
}
