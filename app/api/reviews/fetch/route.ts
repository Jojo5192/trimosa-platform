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

  // Verify ownership
  const { data: listing } = await supabaseAdmin
    .from('listings')
    .select('host_id, airbnb_url, booking_url, google_place_id')
    .eq('id', listingId)
    .single()

  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })
  if (listing.host_id !== user.id) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const results: { source: string; fetched: number; errors?: string }[] = []

  // ── 1. Google Places API ──
  if (listing.google_place_id) {
    try {
      const googleResult = await fetchGoogleReviews(listingId, listing.google_place_id)
      results.push(googleResult)
    } catch (e) {
      results.push({ source: 'google', fetched: 0, errors: String(e) })
    }
  }

  // ── 2. Airbnb (page scraping via __NEXT_DATA__) ──
  if (listing.airbnb_url) {
    try {
      const airbnbResult = await fetchAirbnbReviews(listingId, listing.airbnb_url)
      results.push(airbnbResult)
    } catch (e) {
      results.push({ source: 'airbnb', fetched: 0, errors: String(e) })
    }
  }

  // ── 3. Booking.com ──
  if (listing.booking_url) {
    try {
      const bookingResult = await fetchBookingReviews(listingId, listing.booking_url)
      results.push(bookingResult)
    } catch (e) {
      results.push({ source: 'booking', fetched: 0, errors: String(e) })
    }
  }

  return NextResponse.json({ results })
}

/* ── Google Places API ──────────────────────────────────────── */
async function fetchGoogleReviews(listingId: string, placeId: string) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) return { source: 'google', fetched: 0, errors: 'GOOGLE_PLACES_API_KEY nicht konfiguriert. Bitte in den Umgebungsvariablen hinterlegen.' }

  // Try new Places API (v1) first, fallback to legacy
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=reviews&language=de&key=${apiKey}`
  const res = await fetch(url)
  const data = await res.json()

  if (data.status !== 'OK' || !data.result?.reviews) {
    return { source: 'google', fetched: 0, errors: `Google API: ${data.status} - ${data.error_message || 'Keine Reviews gefunden'}` }
  }

  let inserted = 0
  for (const review of data.result.reviews) {
    const { error } = await supabaseAdmin.from('reviews').upsert({
      listing_id: listingId,
      source: 'google',
      source_review_id: `google_${review.time}`,
      author_name: review.author_name ?? 'Google-Nutzer',
      author_avatar: review.profile_photo_url ?? null,
      rating: review.rating,
      review_text: review.text ?? null,
      language: review.language ?? 'de',
      review_date: new Date(review.time * 1000).toISOString().split('T')[0],
    }, { onConflict: 'listing_id,source,source_review_id' })

    if (!error) inserted++
  }

  return { source: 'google', fetched: inserted }
}

/* ── Airbnb (parse public listing page) ─────────────────────── */
async function fetchAirbnbReviews(listingId: string, airbnbUrl: string) {
  // Extract listing ID from URL
  const match = airbnbUrl.match(/rooms\/(\d+)/)
  if (!match) return { source: 'airbnb', fetched: 0, errors: 'Ungültige Airbnb-URL. Erwartetes Format: https://airbnb.com/rooms/12345' }

  const airbnbId = match[1]

  // Airbnb has a public API endpoint for reviews
  const reviewsUrl = `https://www.airbnb.com/api/v3/PdpReviews/bdc7dba5de42ac9a8e40e498bb84e498537fba1b6a1dcb73cc478dd520cee657?operationName=PdpReviews&locale=de&currency=EUR&variables=%7B%22request%22%3A%7B%22fieldSelector%22%3A%22for_p3_translation_only%22%2C%22forPreview%22%3Afalse%2C%22limit%22%3A50%2C%22listingId%22%3A%22${airbnbId}%22%2C%22numberOfAdults%22%3A%221%22%2C%22numberOfChildren%22%3A%220%22%2C%22numberOfInfants%22%3A%220%22%7D%7D&extensions=%7B%22persistedQuery%22%3A%7B%22version%22%3A1%2C%22sha256Hash%22%3A%22bdc7dba5de42ac9a8e40e498bb84e498537fba1b6a1dcb73cc478dd520cee657%22%7D%7D`

  // Try a simpler approach — fetch the listing page and look for review data
  try {
    const pageRes = await fetch(`https://www.airbnb.com/rooms/${airbnbId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'de-DE,de;q=0.9',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })

    if (!pageRes.ok) return { source: 'airbnb', fetched: 0, errors: `Airbnb-Seite nicht erreichbar (${pageRes.status})` }

    const html = await pageRes.text()

    // Look for __NEXT_DATA__ or embedded JSON with reviews
    const nextDataMatch = html.match(/<script id="data-deferred-state-0"[^>]*>([\s\S]*?)<\/script>/)
      ?? html.match(/<script id="data-deferred-state"[^>]*>([\s\S]*?)<\/script>/)
      ?? html.match(/<!--\s*(\{[\s\S]*?"reviews"[\s\S]*?})\s*-->/)

    if (!nextDataMatch) {
      // Try alternative: look for review data in any script tag
      const reviewJsonMatch = html.match(/"reviews"\s*:\s*(\[[\s\S]*?\])\s*[,}]/)
      if (!reviewJsonMatch) {
        return { source: 'airbnb', fetched: 0, errors: 'Konnte keine Bewertungen aus der Airbnb-Seite extrahieren. Die Seitenstruktur hat sich möglicherweise geändert.' }
      }

      try {
        const reviews = JSON.parse(reviewJsonMatch[1])
        return await insertAirbnbReviews(listingId, reviews)
      } catch {
        return { source: 'airbnb', fetched: 0, errors: 'Konnte Review-Daten nicht parsen.' }
      }
    }

    try {
      const jsonStr = nextDataMatch[1]
      const pageData = JSON.parse(jsonStr)

      // Navigate the data structure to find reviews
      const reviews = findReviewsInObject(pageData)
      if (!reviews || reviews.length === 0) {
        return { source: 'airbnb', fetched: 0, errors: 'Keine Bewertungen auf der Airbnb-Seite gefunden.' }
      }

      return await insertAirbnbReviews(listingId, reviews)
    } catch {
      return { source: 'airbnb', fetched: 0, errors: 'Konnte Airbnb-Daten nicht verarbeiten.' }
    }
  } catch (e) {
    return { source: 'airbnb', fetched: 0, errors: `Fehler beim Abrufen: ${e}` }
  }
}

/* Recursively find review arrays in nested objects */
function findReviewsInObject(obj: unknown, depth = 0): Array<Record<string, unknown>> | null {
  if (depth > 15 || !obj || typeof obj !== 'object') return null

  if (Array.isArray(obj)) {
    // Check if this looks like a reviews array
    if (obj.length > 0 && obj[0] && typeof obj[0] === 'object') {
      const first = obj[0] as Record<string, unknown>
      if ('rating' in first && ('comments' in first || 'reviewText' in first || 'comment' in first || 'review' in first)) {
        return obj as Array<Record<string, unknown>>
      }
    }
    for (const item of obj) {
      const found = findReviewsInObject(item, depth + 1)
      if (found) return found
    }
    return null
  }

  const record = obj as Record<string, unknown>

  // Direct key check
  for (const key of ['reviews', 'mergedReviews', 'pdpReviews', 'reviewsList']) {
    if (key in record && Array.isArray(record[key])) {
      const arr = record[key] as Array<Record<string, unknown>>
      if (arr.length > 0) return arr
    }
  }

  // Recurse into nested objects
  for (const val of Object.values(record)) {
    const found = findReviewsInObject(val, depth + 1)
    if (found) return found
  }
  return null
}

async function insertAirbnbReviews(listingId: string, reviews: Array<Record<string, unknown>>) {
  let inserted = 0

  for (const review of reviews) {
    // Normalize different Airbnb data formats
    const reviewer = (review.reviewer ?? {}) as Record<string, unknown>
    const id = String(review.id ?? review.reviewId ?? review.localizedDate ?? Date.now() + inserted)
    const author = String(
      review.reviewerName ?? reviewer.firstName ?? reviewer.name ??
      reviewer.smartName ?? 'Airbnb-Gast'
    )
    const avatar = String(
      review.reviewerAvatar ?? reviewer.pictureUrl ?? reviewer.avatar ??
      reviewer.profilePictureUrl ?? ''
    ) || null
    const rating = Number(review.rating ?? review.reviewRating ?? 5)
    const text = String(review.comments ?? review.reviewText ?? review.comment ?? review.review ?? '')
    const dateStr = review.createdAt ?? review.localizedDate ?? review.date

    let reviewDate: string
    if (typeof dateStr === 'string' && dateStr.match(/^\d{4}-\d{2}/)) {
      reviewDate = dateStr.split('T')[0]
    } else if (typeof dateStr === 'string') {
      // Try to parse localized date like "März 2026"
      reviewDate = new Date().toISOString().split('T')[0]
    } else {
      reviewDate = new Date().toISOString().split('T')[0]
    }

    const { error } = await supabaseAdmin.from('reviews').upsert({
      listing_id: listingId,
      source: 'airbnb',
      source_review_id: `airbnb_${id}`,
      author_name: author,
      author_avatar: avatar,
      rating: Math.min(5, Math.max(1, rating)),
      review_text: text || null,
      review_date: reviewDate,
    }, { onConflict: 'listing_id,source,source_review_id' })

    if (!error) inserted++
  }

  return { source: 'airbnb', fetched: inserted }
}

/* ── Booking.com (parse public page) ────────────────────────── */
async function fetchBookingReviews(listingId: string, bookingUrl: string) {
  try {
    const pageRes = await fetch(bookingUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'de-DE,de;q=0.9',
        'Accept': 'text/html',
      },
    })

    if (!pageRes.ok) return { source: 'booking', fetched: 0, errors: `Booking-Seite nicht erreichbar (${pageRes.status})` }

    const html = await pageRes.text()

    // Booking.com embeds review data in JSON-LD or script tags
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)
    let reviews: Array<{ author: string; rating: number; text: string; date: string }> = []

    if (jsonLdMatch) {
      for (const block of jsonLdMatch) {
        try {
          const json = JSON.parse(block.replace(/<script[^>]*>/, '').replace(/<\/script>/, ''))
          if (json.review && Array.isArray(json.review)) {
            reviews = json.review.map((r: Record<string, unknown>) => ({
              author: String((r.author as Record<string, unknown>)?.name ?? 'Booking-Gast'),
              rating: Number((r.reviewRating as Record<string, unknown>)?.ratingValue ?? 0) / 2, // Booking uses 0-10 scale
              text: String(r.reviewBody ?? r.description ?? ''),
              date: String(r.datePublished ?? new Date().toISOString().split('T')[0]),
            }))
            break
          }
        } catch { /* skip */ }
      }
    }

    // Alternative: parse review blocks from HTML
    if (reviews.length === 0) {
      const reviewBlocks = html.match(/data-testid="review-card"[\s\S]*?(?=data-testid="review-card"|<\/div>\s*<\/div>\s*<\/div>)/g)
      if (reviewBlocks) {
        for (const block of reviewBlocks.slice(0, 20)) {
          const nameMatch = block.match(/data-testid="review-avatar"[\s\S]*?>([\w\s]+)</)
          const scoreMatch = block.match(/data-testid="review-score"[\s\S]*?>([\d.]+)</)
          const textMatch = block.match(/data-testid="review-positive-text"[\s\S]*?>([\s\S]*?)</)
          const dateMatch = block.match(/data-testid="review-date"[\s\S]*?>([\s\S]*?)</)

          if (nameMatch) {
            reviews.push({
              author: nameMatch[1].trim(),
              rating: scoreMatch ? Number(scoreMatch[1]) / 2 : 4,
              text: textMatch ? textMatch[1].trim() : '',
              date: dateMatch ? dateMatch[1].trim() : new Date().toISOString().split('T')[0],
            })
          }
        }
      }
    }

    if (reviews.length === 0) {
      return { source: 'booking', fetched: 0, errors: 'Konnte keine Bewertungen aus der Booking-Seite extrahieren.' }
    }

    let inserted = 0
    for (const review of reviews) {
      const { error } = await supabaseAdmin.from('reviews').upsert({
        listing_id: listingId,
        source: 'booking',
        source_review_id: `booking_${review.author}_${review.date}`,
        author_name: review.author,
        rating: Math.min(5, Math.max(1, Math.round(review.rating * 10) / 10)),
        review_text: review.text || null,
        review_date: review.date.match(/^\d{4}-\d{2}-\d{2}/) ? review.date : new Date().toISOString().split('T')[0],
      }, { onConflict: 'listing_id,source,source_review_id' })

      if (!error) inserted++
    }

    return { source: 'booking', fetched: inserted }
  } catch (e) {
    return { source: 'booking', fetched: 0, errors: `Fehler: ${e}` }
  }
}
