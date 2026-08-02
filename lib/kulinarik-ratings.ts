/**
 * Live Google ratings for the curated Kulinarik places (region pages).
 *
 * Server-only: called from the region page's server component, so the
 * GOOGLE_PLACES_API_KEY never leaves Vercel. Uses Places API (New) Text
 * Search with a minimal field mask.
 *
 * Cost control (§243af): ZWEI Cache-Ebenen — L1 in-process (überlebt, solange
 * die Lambda warm bleibt) + L2 in der DB (app_settings 'kulinarik_ratings',
 * überlebt Instanz-übergreifend). Vorher holte JEDE kalte Vercel-Instanz die
 * ~26 Details-Calls neu (auch für Crawler!) → „Place Details Enterprise"
 * ~32 €/Monat. Mit dem DB-Cache läuft die Places-API nur noch ~1×/24 h
 * insgesamt → zurück unters Freikontingent. Failures degrade gracefully.
 */
import type { KulinarikTipp } from '@/lib/regions'
import { supabaseAdmin } from '@/lib/supabase-admin'

export interface KulinarikRating {
  rating: number
  count: number
}

type CacheEntry = { value: KulinarikRating | null; expires: number }

const TTL_MS = 24 * 60 * 60 * 1000

const g = globalThis as typeof globalThis & { __kulinarikRatingCache?: Map<string, CacheEntry> }
const cache = (g.__kulinarikRatingCache ??= new Map<string, CacheEntry>())

async function fetchDetails(placeId: string, key: string): Promise<{ value: KulinarikRating | null; failTtl: number }> {
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=de`, {
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'rating,userRatingCount' },
    cache: 'no-store',
  })
  if (!res.ok) {
    console.error('[kulinarik-ratings] details failed:', res.status, placeId, (await res.text().catch(() => '')).slice(0, 200))
    // Quota exhaustion (429) resets at midnight PT — retrying sooner only burns
    // more quota. Other errors: retry after 5 min.
    return { value: null, failTtl: res.status === 429 ? 6 * 60 * 60 * 1000 : 5 * 60 * 1000 }
  }
  const place = await res.json()
  if (typeof place?.rating === 'number' && typeof place?.userRatingCount === 'number' && place.userRatingCount > 0) {
    return { value: { rating: place.rating, count: place.userRatingCount }, failTtl: 0 }
  }
  return { value: null, failTtl: 0 }
}

async function lookupRating(query: string, placeId: string | undefined, key: string): Promise<KulinarikRating | null> {
  const cacheKey = placeId ?? query
  const hit = cache.get(cacheKey)
  if (hit && hit.expires > Date.now()) return hit.value

  let value: KulinarikRating | null = null
  let failTtl = 0
  try {
    let id = placeId
    if (!id) {
      // Fallback only (entries without a curated place id): one text search.
      const searchRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id' },
        body: JSON.stringify({ textQuery: query, languageCode: 'de' }),
        cache: 'no-store',
      })
      if (!searchRes.ok) {
        console.error('[kulinarik-ratings] searchText failed:', searchRes.status, query, (await searchRes.text().catch(() => '')).slice(0, 200))
        failTtl = searchRes.status === 429 ? 6 * 60 * 60 * 1000 : 5 * 60 * 1000
      } else {
        id = (await searchRes.json())?.places?.[0]?.id
      }
    }
    if (id) {
      const res = await fetchDetails(id, key)
      value = res.value
      failTtl = res.failTtl
    }
  } catch (err) {
    failTtl = 5 * 60 * 1000
    console.error('[kulinarik-ratings] lookup error:', query, err)
  }

  cache.set(cacheKey, { value, expires: Date.now() + (failTtl || TTL_MS) })
  return value
}

const DB_KEY = 'kulinarik_ratings'

/** L2: DB-Cache in L1 mergen (nur noch gültige Einträge). */
async function ladeDbCache(): Promise<void> {
  try {
    const { data: row } = await supabaseAdmin
      .from('app_settings').select('value').eq('key', DB_KEY).maybeSingle()
    const obj = (row?.value ?? {}) as Record<string, CacheEntry>
    const now = Date.now()
    for (const [k, e] of Object.entries(obj)) {
      if (e && typeof e.expires === 'number' && e.expires > now && !cache.has(k)) cache.set(k, e)
    }
  } catch { /* fail-soft — dann eben nur L1 */ }
}

async function speichereDbCache(keys: string[]): Promise<void> {
  try {
    const { data: row } = await supabaseAdmin
      .from('app_settings').select('value').eq('key', DB_KEY).maybeSingle()
    const obj = (row?.value ?? {}) as Record<string, CacheEntry>
    const now = Date.now()
    for (const [k, e] of Object.entries(obj)) if (!e || e.expires <= now) delete obj[k]
    for (const k of keys) {
      const e = cache.get(k)
      if (e) obj[k] = e
    }
    await supabaseAdmin.from('app_settings').upsert({ key: DB_KEY, value: obj }, { onConflict: 'key' })
  } catch { /* fail-soft */ }
}

/** Ratings keyed by tip name. Empty when no API key is configured. */
export async function getKulinarikRatings(tipps: KulinarikTipp[]): Promise<Record<string, KulinarikRating>> {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) {
    console.error('[kulinarik-ratings] GOOGLE_PLACES_API_KEY fehlt in dieser Umgebung')
    return {}
  }

  const withQuery = tipps.filter((t): t is KulinarikTipp & { googleQuery: string } => !!t.googleQuery)
  const cacheKeys = withQuery.map((t) => t.googlePlaceId ?? t.googleQuery)
  const now = Date.now()

  // §243af: Erst L2 laden, wenn L1 nicht alles frisch hat — dann treffen
  // kalte Instanzen den DB-Cache statt der teuren Places-API
  const l1Frisch = cacheKeys.every((k) => (cache.get(k)?.expires ?? 0) > now)
  if (!l1Frisch) await ladeDbCache()
  const fehltDanach = cacheKeys.some((k) => (cache.get(k)?.expires ?? 0) <= now)

  const results = await Promise.all(
    withQuery.map(async (t) => [t.name, await lookupRating(t.googleQuery, t.googlePlaceId, key)] as const)
  )
  // nur wenn wirklich neu gegen die API aufgelöst wurde, zurückschreiben
  if (fehltDanach) await speichereDbCache(cacheKeys)

  const map: Record<string, KulinarikRating> = {}
  for (const [name, rating] of results) {
    if (rating) map[name] = rating
  }
  console.log(`[kulinarik-ratings] ${Object.keys(map).length}/${withQuery.length} Ratings aufgelöst${fehltDanach ? ' (API-Lauf, DB-Cache aktualisiert)' : ' (aus Cache)'}`)
  return map
}
