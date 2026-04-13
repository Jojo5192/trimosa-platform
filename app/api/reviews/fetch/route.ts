import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'

/* POST /api/reviews/fetch — pull reviews from external platforms */
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { listingId } = await req.json()
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })

  const { data: listing } = await supabaseAdmin
    .from('listings')
    .select('host_id, airbnb_url, booking_url, google_place_id')
    .eq('id', listingId)
    .single()

  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })
  if (listing.host_id !== user.id) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const results: { source: string; fetched: number; score?: number; count?: number; errors?: string }[] = []

  // ── 1. Airbnb — try v2 REST API, then HTML meta tags ──
  if (listing.airbnb_url) {
    try {
      results.push(await fetchAirbnb(listingId, listing.airbnb_url))
    } catch (e) {
      results.push({ source: 'airbnb', fetched: 0, errors: String(e) })
    }
  }

  // ── 2. Booking.com — JSON-LD + HTML parsing ──
  if (listing.booking_url) {
    try {
      results.push(await fetchBooking(listingId, listing.booking_url))
    } catch (e) {
      results.push({ source: 'booking', fetched: 0, errors: String(e) })
    }
  }

  // ── 3. Google Maps — free, no API key ──
  if (listing.google_place_id) {
    try {
      results.push(await fetchGoogle(listingId, listing.google_place_id))
    } catch (e) {
      results.push({ source: 'google', fetched: 0, errors: String(e) })
    }
  }

  // Save aggregate scores to listing for quick access
  const scoreUpdate: Record<string, unknown> = {}
  for (const r of results) {
    if (r.score !== undefined) {
      scoreUpdate[`${r.source}_score`] = r.score
      scoreUpdate[`${r.source}_review_count`] = r.count ?? 0
    }
  }
  if (Object.keys(scoreUpdate).length > 0) {
    await supabaseAdmin.from('listings').update(scoreUpdate).eq('id', listingId)
  }

  return NextResponse.json({ results })
}

/* ── AIRBNB ──────────────────────────────────────────────────── */
async function fetchAirbnb(listingId: string, airbnbUrl: string) {
  const match = airbnbUrl.match(/rooms\/(\d+)/)
  if (!match) return { source: 'airbnb', fetched: 0, errors: 'Ungültige URL. Format: airbnb.com/rooms/12345' }

  const airbnbId = match[1]
  const API_KEY = 'd306zoyjsyarp7ifhu67rjxn52tv0t20'

  // Strategy 1: Airbnb v2 REST API (mobile format)
  for (const endpoint of [
    `https://www.airbnb.com/api/v2/reviews?key=${API_KEY}&listing_id=${airbnbId}&role=all&_format=for_mobile_client&_limit=50&_offset=0`,
    `https://www.airbnb.com/api/v2/reviews?key=${API_KEY}&listing_id=${airbnbId}&role=guest&_format=for_p3&_limit=50&_offset=0`,
  ]) {
    try {
      const res = await fetch(endpoint, {
        headers: {
          'User-Agent': 'Airbnb/24.4 iPhone/17.0 Type/Phone',
          'X-Airbnb-API-Key': API_KEY,
          'Accept': 'application/json',
          'Accept-Language': 'de',
        },
      })
      if (!res.ok) continue
      const data = await res.json()
      const reviews = data.reviews ?? data.pdp_listing_reviews
      if (Array.isArray(reviews) && reviews.length > 0) {
        const inserted = await insertReviews(listingId, 'airbnb', reviews.map((r: Record<string, unknown>) => {
          const reviewer = (r.reviewer ?? {}) as Record<string, unknown>
          return {
            id: `airbnb_${r.id ?? r.review_id ?? Date.now()}`,
            author: String(r.reviewer_name ?? reviewer.first_name ?? reviewer.name ?? 'Airbnb-Gast'),
            avatar: String(r.reviewer_image_url ?? reviewer.picture_url ?? reviewer.thumbnail_url ?? '') || undefined,
            rating: Number(r.rating ?? 5),
            text: String(r.comments ?? r.review ?? ''),
            date: String(r.created_at ?? r.localized_date ?? new Date().toISOString()).split('T')[0],
          }
        }))
        // Get overall score from metadata
        const score = data.metadata?.reviews_count
          ? { score: Number(data.metadata.rating_average ?? 0), count: Number(data.metadata.reviews_count) }
          : { score: reviews.reduce((s: number, r: Record<string, unknown>) => s + Number(r.rating ?? 5), 0) / reviews.length, count: reviews.length }
        return { source: 'airbnb', fetched: inserted, ...score }
      }
    } catch { /* try next */ }
  }

  // Strategy 2: Fetch listing page for meta tags / scores only
  try {
    const pageRes = await fetch(`https://www.airbnb.de/rooms/${airbnbId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html',
        'Accept-Language': 'de',
      },
      redirect: 'follow',
    })

    if (pageRes.ok) {
      const html = await pageRes.text()

      // Try to extract score from meta/OG tags or structured data
      // Airbnb puts rating in JSON-LD or page data
      const ratingMatch = html.match(/"ratingValue"\s*:\s*([\d.]+)/)
        ?? html.match(/"reviewScore"\s*:\s*([\d.]+)/)
        ?? html.match(/"overallRating"\s*:\s*([\d.]+)/)
        ?? html.match(/(\d\.\d{1,2})\s*·\s*\d+\s*Bewertung/)
      const countMatch = html.match(/"reviewCount"\s*:\s*(\d+)/)
        ?? html.match(/"reviewsCount"\s*:\s*(\d+)/)
        ?? html.match(/·\s*(\d+)\s*Bewertung/)

      if (ratingMatch) {
        const score = parseFloat(ratingMatch[1])
        const count = countMatch ? parseInt(countMatch[1]) : 0
        return { source: 'airbnb', fetched: 0, score, count }
      }

      // Try to find and parse embedded review data
      const scriptPatterns = [
        /<script id="data-deferred-state-0"[^>]*>([\s\S]*?)<\/script>/,
        /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
      ]
      for (const pattern of scriptPatterns) {
        const m = html.match(pattern)
        if (m) {
          try {
            const data = JSON.parse(m[1])
            const reviews = findReviewsInObject(data)
            if (reviews && reviews.length > 0) {
              const inserted = await insertReviews(listingId, 'airbnb', reviews.map((r: Record<string, unknown>) => {
                const reviewer = (r.reviewer ?? {}) as Record<string, unknown>
                return {
                  id: `airbnb_${r.id ?? r.reviewId ?? Date.now()}`,
                  author: String(r.reviewerName ?? reviewer.firstName ?? reviewer.name ?? 'Airbnb-Gast'),
                  rating: Number(r.rating ?? r.reviewRating ?? 5),
                  text: String(r.comments ?? r.reviewText ?? r.comment ?? ''),
                  date: String(r.createdAt ?? r.localizedDate ?? new Date().toISOString()).split('T')[0],
                }
              }))
              const avg = reviews.reduce((s: number, r: Record<string, unknown>) => s + Number(r.rating ?? r.reviewRating ?? 5), 0) / reviews.length
              return { source: 'airbnb', fetched: inserted, score: avg, count: reviews.length }
            }
          } catch { /* next */ }
        }
      }
    }
  } catch { /* fall through */ }

  return { source: 'airbnb', fetched: 0, errors: 'Airbnb blockiert die Abfrage. Nutze "Einfügen" für manuellen Import.' }
}

/* ── BOOKING.COM ─────────────────────────────────────────────── */
async function fetchBooking(listingId: string, bookingUrl: string) {
  try {
    const res = await fetch(bookingUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html',
        'Accept-Language': 'de',
      },
    })

    if (!res.ok) return { source: 'booking', fetched: 0, errors: `Status ${res.status}` }
    const html = await res.text()

    // Extract score from JSON-LD
    const jsonLdBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)
    if (jsonLdBlocks) {
      for (const block of jsonLdBlocks) {
        try {
          const json = JSON.parse(block.replace(/<script[^>]*>/, '').replace(/<\/script>/, ''))
          const aggRating = json.aggregateRating
          if (aggRating) {
            const best = Number(aggRating.bestRating ?? 10)
            const val = Number(aggRating.ratingValue ?? 0)
            const score = best > 5 ? (val / best) * 5 : val
            const count = Number(aggRating.reviewCount ?? aggRating.ratingCount ?? 0)

            // Also try to get individual reviews from JSON-LD
            let inserted = 0
            if (json.review && Array.isArray(json.review)) {
              inserted = await insertReviews(listingId, 'booking', json.review.map((r: Record<string, unknown>, i: number) => {
                const authorObj = r.author as Record<string, unknown> | undefined
                const ratingObj = r.reviewRating as Record<string, unknown> | undefined
                let rVal = Number(ratingObj?.ratingValue ?? 0)
                if (rVal > 5) rVal = rVal / 2
                return {
                  id: `booking_${String(authorObj?.name ?? 'gast').replace(/\s+/g, '_')}_${i}`,
                  author: String(authorObj?.name ?? 'Booking-Gast'),
                  rating: rVal || Math.round(score),
                  text: String(r.reviewBody ?? r.description ?? ''),
                  date: String(r.datePublished ?? new Date().toISOString().split('T')[0]),
                }
              }))
            }

            return { source: 'booking', fetched: inserted, score: Math.round(score * 100) / 100, count }
          }
        } catch { /* skip */ }
      }
    }

    // Fallback: look for score in meta tags or known patterns
    const scoreMatch = html.match(/(?:data-testid="review-score-right-component"|class="[^"]*review-score[^"]*")[^>]*>[\s]*([\d.,]+)/)
      ?? html.match(/"ratingValue"\s*:\s*([\d.,]+)/)
      ?? html.match(/Bewertung:\s*([\d.,]+)\s*\//)
    const countMatch = html.match(/(\d[\d.,]*)\s*Bewertung/)
      ?? html.match(/"reviewCount"\s*:\s*"?(\d+)/)

    if (scoreMatch) {
      let score = parseFloat(scoreMatch[1].replace(',', '.'))
      if (score > 5) score = score / 2
      const count = countMatch ? parseInt(countMatch[1].replace(/[.,]/g, '')) : 0
      return { source: 'booking', fetched: 0, score: Math.round(score * 100) / 100, count }
    }

    return { source: 'booking', fetched: 0, errors: 'Konnte keinen Score extrahieren. Nutze "Einfügen" für manuellen Import.' }
  } catch (e) {
    return { source: 'booking', fetched: 0, errors: `Fehler: ${e}` }
  }
}

/* ── GOOGLE ──────────────────────────────────────────────────── */
async function fetchGoogle(listingId: string, placeId: string) {
  try {
    // Fetch Google Maps place page
    const res = await fetch(`https://www.google.com/maps/place/?q=place_id:${placeId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html',
        'Accept-Language': 'de',
      },
      redirect: 'follow',
    })

    if (!res.ok) return { source: 'google', fetched: 0, errors: `Status ${res.status}` }
    const html = await res.text()

    // Google Maps includes rating in various formats
    const ratingMatch = html.match(/"ratingValue"\s*:\s*([\d.]+)/)
      ?? html.match(/(\d\.\d)\s*Sterne/)
      ?? html.match(/"aggregateRating"[\s\S]*?"ratingValue"\s*:\s*"?([\d.]+)/)
    const countMatch = html.match(/"ratingCount"\s*:\s*"?(\d+)/)
      ?? html.match(/"reviewCount"\s*:\s*"?(\d+)/)
      ?? html.match(/(\d+)\s*(?:Rezension|Google-Rezension|Review)/)

    if (ratingMatch) {
      const score = parseFloat(ratingMatch[1])
      const count = countMatch ? parseInt(countMatch[1]) : 0
      return { source: 'google', fetched: 0, score, count }
    }

    return { source: 'google', fetched: 0, errors: 'Konnte keinen Score finden. Nutze "Einfügen" für manuellen Import.' }
  } catch (e) {
    return { source: 'google', fetched: 0, errors: `Fehler: ${e}` }
  }
}

/* ── Helpers ─────────────────────────────────────────────────── */

interface NormalizedReview {
  id: string
  author: string
  avatar?: string
  rating: number
  text: string
  date: string
}

async function insertReviews(listingId: string, source: string, reviews: NormalizedReview[]): Promise<number> {
  let inserted = 0
  for (const r of reviews) {
    const { error } = await supabaseAdmin.from('reviews').upsert({
      listing_id: listingId,
      source,
      source_review_id: r.id,
      author_name: r.author,
      author_avatar: r.avatar ?? null,
      rating: Math.min(5, Math.max(1, r.rating)),
      review_text: r.text || null,
      review_date: r.date.match(/^\d{4}-\d{2}/) ? r.date : new Date().toISOString().split('T')[0],
    }, { onConflict: 'listing_id,source,source_review_id' })
    if (!error) inserted++
  }
  return inserted
}

function findReviewsInObject(obj: unknown, depth = 0): Array<Record<string, unknown>> | null {
  if (depth > 20 || !obj || typeof obj !== 'object') return null
  if (Array.isArray(obj)) {
    if (obj.length > 0 && obj[0] && typeof obj[0] === 'object') {
      const f = obj[0] as Record<string, unknown>
      if (('rating' in f && ('comments' in f || 'reviewText' in f || 'comment' in f)) || 'reviewRating' in f || 'localizedReview' in f) {
        return obj as Array<Record<string, unknown>>
      }
    }
    for (const item of obj) { const r = findReviewsInObject(item, depth + 1); if (r) return r }
    return null
  }
  const rec = obj as Record<string, unknown>
  for (const key of ['reviews', 'mergedReviews', 'pdpReviews', 'reviewsList']) {
    if (key in rec && Array.isArray(rec[key]) && (rec[key] as unknown[]).length > 0) return rec[key] as Array<Record<string, unknown>>
  }
  for (const val of Object.values(rec)) { const r = findReviewsInObject(val, depth + 1); if (r) return r }
  return null
}
