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
    // Two steps, both on endpoints proven to work with this key (the review
    // sync uses the same place-details call): 1) resolve the place id via
    // text search with the minimal id-only field mask, 2) fetch the rating
    // via GET place details.
    const searchRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.id',
      },
      body: JSON.stringify({ textQuery: query, languageCode: 'de' }),
      cache: 'no-store',
    })
    if (!searchRes.ok) {
      failed = true
      console.error('[kulinarik-ratings] searchText failed:', searchRes.status, query, (await searchRes.text().catch(() => '')).slice(0, 300))
    } else {
      const placeId: string | undefined = (await searchRes.json())?.places?.[0]?.id
      if (placeId) {
        const detailRes = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=de`, {
          headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'rating,userRatingCount' },
          cache: 'no-store',
        })
        if (!detailRes.ok) {
          failed = true
          console.error('[kulinarik-ratings] details failed:', detailRes.status, query, (await detailRes.text().catch(() => '')).slice(0, 300))
        } else {
          const place = await detailRes.json()
          if (typeof place?.rating === 'number' && typeof place?.userRatingCount === 'number' && place.userRatingCount > 0) {
            value = { rating: place.rating, count: place.userRatingCount }
          }
        }
      }
    }
  } catch (err) {
    failed = true
    console.error('[kulinarik-ratings] lookup error:', query, err)
  }

  // Successes AND genuine "no match" results cache for 24 h; transient API
  // failures only briefly (5 min) so one hiccup can't hide all badges for a day.
  cache.set(query, { value, expires: Date.now() + (failed ? 5 * 60 * 1000 : TTL_MS) })
  return value
}

/** Ratings keyed by tip name. Empty when no API key is configured. */
export async function getKulinarikRatings(tipps: KulinarikTipp[]): Promise<Record<string, KulinarikRating>> {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) {
    console.error('[kulinarik-ratings] GOOGLE_PLACES_API_KEY fehlt in dieser Umgebung')
    return {}
  }

  const withQuery = tipps.filter((t): t is KulinarikTipp & { googleQuery: string } => !!t.googleQuery)
  const results = await Promise.all(
    withQuery.map(async (t) => [t.name, await lookupRating(t.googleQuery, key)] as const)
  )

  const map: Record<string, KulinarikRating> = {}
  for (const [name, rating] of results) {
    if (rating) map[name] = rating
  }
  console.log(`[kulinarik-ratings] ${Object.keys(map).length}/${withQuery.length} Ratings aufgelöst`)
  return map
}
