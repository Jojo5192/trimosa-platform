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
    .select('host_id, airbnb_url, booking_url, google_place_id, google_api_key')
    .eq('id', listingId)
    .single()

  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })
  if (listing.host_id !== user.id) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const results: { source: string; fetched: number; errors?: string }[] = []

  // ── 1. Google Places API ──
  if (listing.google_place_id) {
    try {
      const googleResult = await fetchGoogleReviews(listingId, listing.google_place_id, listing.google_api_key)
      results.push(googleResult)
    } catch (e) {
      results.push({ source: 'google', fetched: 0, errors: String(e) })
    }
  }

  // ── 2. Airbnb ──
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
async function fetchGoogleReviews(listingId: string, placeId: string, apiKey?: string) {
  const key = apiKey || process.env.GOOGLE_PLACES_API_KEY
  if (!key) return { source: 'google', fetched: 0, errors: 'Kein Google API Key hinterlegt. Bitte im Feld "Google Places API Key" eintragen.' }

  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=reviews&language=de&key=${key}`
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

/* ── Airbnb (StaysPdpReviewsQuery GraphQL API) ─────────────── */
async function fetchAirbnbReviews(listingId: string, airbnbUrl: string) {
  const match = airbnbUrl.match(/rooms\/(\d+)/)
  if (!match) return { source: 'airbnb', fetched: 0, errors: 'Ungültige Airbnb-URL. Erwartetes Format: https://airbnb.com/rooms/12345' }

  const airbnbId = match[1]

  // Strategy 1: Airbnb's internal GraphQL reviews endpoint
  // This is the same API the Airbnb frontend uses
  const apiKey = 'd306zoyjsyarp7ifhu67rjxn52tv0t20' // Airbnb's public API key (embedded in their frontend)

  const variables = {
    request: {
      fieldSelector: 'for_p3_translation_only',
      forPreview: false,
      limit: 50,
      listingId: airbnbId,
      numberOfAdults: '1',
      numberOfChildren: '0',
      numberOfInfants: '0',
    }
  }

  const extensions = {
    persistedQuery: {
      version: 1,
      sha256Hash: 'bdc7dba5de42ac9a8e40e498bb84e498537fba1b6a1dcb73cc478dd520cee657',
    }
  }

  try {
    const graphqlUrl = `https://www.airbnb.com/api/v3/StaysPdpReviewsQuery/dec1c8061483e6e05ff498246e7ca5701e589dc1138fa53a26a5f08f6e26a13e?operationName=StaysPdpReviewsQuery&locale=de&currency=EUR&variables=${encodeURIComponent(JSON.stringify(variables))}&extensions=${encodeURIComponent(JSON.stringify(extensions))}`

    const apiRes = await fetch(graphqlUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'X-Airbnb-Api-Key': apiKey,
        'X-Airbnb-GraphQL-Platform': 'web',
        'X-Airbnb-GraphQL-Platform-Client': 'minimalist-niobe',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        'Referer': `https://www.airbnb.com/rooms/${airbnbId}`,
        'Origin': 'https://www.airbnb.com',
      },
    })

    if (apiRes.ok) {
      const data = await apiRes.json()
      const reviews = findReviewsInObject(data)
      if (reviews && reviews.length > 0) {
        return await insertAirbnbReviews(listingId, reviews)
      }
    }
  } catch {
    // Fall through to strategy 2
  }

  // Strategy 2: Fetch the listing page HTML and parse embedded data
  try {
    const pageRes = await fetch(`https://www.airbnb.de/rooms/${airbnbId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'de-DE,de;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
    })

    if (!pageRes.ok) return { source: 'airbnb', fetched: 0, errors: `Airbnb nicht erreichbar (Status ${pageRes.status}). Airbnb blockiert möglicherweise automatische Abfragen.` }

    const html = await pageRes.text()

    // Try multiple script tag patterns
    const scriptPatterns = [
      /<script id="data-deferred-state-0"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/,
      /<script id="data-deferred-state"[^>]*>([\s\S]*?)<\/script>/,
      /<script data-hypernova-key="spaspabundlejs"[^>]*>([\s\S]*?)<\/script>/,
      /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
    ]

    for (const pattern of scriptPatterns) {
      const match = html.match(pattern)
      if (match) {
        try {
          const data = JSON.parse(match[1])
          const reviews = findReviewsInObject(data)
          if (reviews && reviews.length > 0) {
            return await insertAirbnbReviews(listingId, reviews)
          }
        } catch { /* try next pattern */ }
      }
    }

    // Strategy 3: Look for review data in any inline JSON
    const reviewsJsonPatterns = [
      /"reviews"\s*:\s*(\[[\s\S]{10,}?\])\s*[,}]/,
      /"pdpReviews"\s*:\s*(\[[\s\S]{10,}?\])\s*[,}]/,
      /"mergedReviews"\s*:\s*(\[[\s\S]{10,}?\])\s*[,}]/,
    ]

    for (const pat of reviewsJsonPatterns) {
      const m = html.match(pat)
      if (m) {
        try {
          const reviews = JSON.parse(m[1])
          if (Array.isArray(reviews) && reviews.length > 0) {
            return await insertAirbnbReviews(listingId, reviews)
          }
        } catch { /* try next */ }
      }
    }

    return { source: 'airbnb', fetched: 0, errors: 'Airbnb blockiert die automatische Abfrage. Bewertungen können manuell über "Bewertung hinzufügen" eingetragen werden.' }
  } catch (e) {
    return { source: 'airbnb', fetched: 0, errors: `Fehler beim Abrufen: ${e}` }
  }
}

/* Recursively find review arrays in nested objects */
function findReviewsInObject(obj: unknown, depth = 0): Array<Record<string, unknown>> | null {
  if (depth > 20 || !obj || typeof obj !== 'object') return null

  if (Array.isArray(obj)) {
    // Check if this array looks like reviews
    if (obj.length > 0 && obj[0] && typeof obj[0] === 'object') {
      const first = obj[0] as Record<string, unknown>
      // Different field name patterns from Airbnb's data
      if (
        ('rating' in first && ('comments' in first || 'reviewText' in first || 'comment' in first || 'review' in first)) ||
        ('reviewRating' in first && 'reviewee' in first) ||
        ('value' in first && 'reviewer' in first) ||
        ('localizedReview' in first && 'reviewee' in first)
      ) {
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

  // Direct key check — keys used in various Airbnb data formats
  for (const key of ['reviews', 'mergedReviews', 'pdpReviews', 'reviewsList', 'visibleReviewGroups', 'allReviews']) {
    if (key in record) {
      const val = record[key]
      if (Array.isArray(val) && val.length > 0) {
        // Some Airbnb structures nest reviews inside group objects
        if (typeof val[0] === 'object' && val[0] !== null && 'reviews' in (val[0] as Record<string, unknown>)) {
          const nested = (val[0] as Record<string, unknown>).reviews
          if (Array.isArray(nested) && nested.length > 0) return nested as Array<Record<string, unknown>>
        }
        return val as Array<Record<string, unknown>>
      }
    }
  }

  // Recurse
  for (const val of Object.values(record)) {
    const found = findReviewsInObject(val, depth + 1)
    if (found) return found
  }
  return null
}

async function insertAirbnbReviews(listingId: string, reviews: Array<Record<string, unknown>>) {
  let inserted = 0

  for (const review of reviews) {
    const reviewer = (review.reviewer ?? review.reviewee ?? {}) as Record<string, unknown>
    const localizedReview = (review.localizedReview ?? review) as Record<string, unknown>

    const id = String(review.id ?? review.reviewId ?? review.trackingKey ?? Date.now() + inserted)
    const author = String(
      review.reviewerName ?? review.authorName ??
      reviewer.firstName ?? reviewer.name ?? reviewer.smartName ??
      localizedReview.reviewerName ?? 'Airbnb-Gast'
    )
    const avatar = String(
      review.reviewerAvatar ?? reviewer.pictureUrl ?? reviewer.avatar ??
      reviewer.profilePictureUrl ?? reviewer.thumbnailUrl ?? ''
    ) || null

    // Rating: Airbnb uses different scales/field names
    let rating = Number(review.rating ?? review.reviewRating ?? (review as Record<string, unknown>).value ?? 5)
    if (rating > 5) rating = Math.round(rating / 2) // Some formats use 0-10

    const text = String(
      review.comments ?? review.reviewText ?? review.comment ?? review.review ??
      localizedReview.comments ?? localizedReview.reviewText ?? ''
    )

    const dateStr = review.createdAt ?? review.localizedDate ?? review.date ?? review.createdAtLocal
    let reviewDate: string
    if (typeof dateStr === 'string' && dateStr.match(/^\d{4}-\d{2}/)) {
      reviewDate = dateStr.split('T')[0]
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

/* ── Booking.com ───────────────────────────────────────────── */
async function fetchBookingReviews(listingId: string, bookingUrl: string) {
  // Extract the hotel slug/ID from the URL for the reviews page
  const slugMatch = bookingUrl.match(/hotel\/[a-z]{2}\/([\w-]+)/)
  const pageName = slugMatch ? slugMatch[1] : null

  // Booking.com has a separate reviews page — try that too
  const urlsToTry = [bookingUrl]
  if (pageName) {
    // The reviews tab URL pattern
    urlsToTry.push(`${bookingUrl.split('?')[0]}#tab-reviews`)
  }

  try {
    const pageRes = await fetch(bookingUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'de-DE,de;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })

    if (!pageRes.ok) return { source: 'booking', fetched: 0, errors: `Booking-Seite nicht erreichbar (${pageRes.status})` }

    const html = await pageRes.text()

    // Strategy 1: JSON-LD structured data
    const jsonLdBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)
    let reviews: Array<{ author: string; rating: number; text: string; date: string }> = []

    if (jsonLdBlocks) {
      for (const block of jsonLdBlocks) {
        try {
          const json = JSON.parse(block.replace(/<script[^>]*>/, '').replace(/<\/script>/, ''))
          if (json.review && Array.isArray(json.review)) {
            reviews = json.review.map((r: Record<string, unknown>) => ({
              author: String((r.author as Record<string, unknown>)?.name ?? 'Booking-Gast'),
              rating: Number((r.reviewRating as Record<string, unknown>)?.ratingValue ?? 0) / 2,
              text: String(r.reviewBody ?? r.description ?? ''),
              date: String(r.datePublished ?? new Date().toISOString().split('T')[0]),
            }))
            break
          }
          // Also check for aggregateRating with nested reviews
          if (json['@type'] === 'Hotel' || json['@type'] === 'LodgingBusiness' || json['@type'] === 'VacationRental') {
            if (json.review) {
              const revArr = Array.isArray(json.review) ? json.review : [json.review]
              reviews = revArr.map((r: Record<string, unknown>) => ({
                author: String((r.author as Record<string, unknown>)?.name ?? 'Booking-Gast'),
                rating: Number((r.reviewRating as Record<string, unknown>)?.ratingValue ?? ((r.reviewRating as Record<string, unknown>)?.bestRating ? Number((r.reviewRating as Record<string, unknown>).ratingValue) / Number((r.reviewRating as Record<string, unknown>).bestRating) * 5 : 4)),
                text: String(r.reviewBody ?? ''),
                date: String(r.datePublished ?? new Date().toISOString().split('T')[0]),
              }))
              break
            }
          }
        } catch { /* skip */ }
      }
    }

    // Strategy 2: Parse review blocks from HTML
    if (reviews.length === 0) {
      // Booking uses various test-id patterns for review cards
      const reviewPatterns = [
        /data-testid="review-card"([\s\S]*?)(?=data-testid="review-card"|$)/g,
        /class="[^"]*review_item[^"]*"([\s\S]*?)(?=class="[^"]*review_item|$)/g,
      ]

      for (const pattern of reviewPatterns) {
        const blocks = [...html.matchAll(pattern)]
        if (blocks.length > 0) {
          for (const block of blocks.slice(0, 30)) {
            const content = block[1] || block[0]
            const nameMatch = content.match(/(?:data-testid="review-avatar"|class="[^"]*reviewer[^"]*")[\s\S]*?>([\w\sÄÖÜäöüß]+?)</)
            const scoreMatch = content.match(/(?:data-testid="review-score"|class="[^"]*review-score[^"]*")[\s\S]*?>([\d.,]+)/)
            const textMatch = content.match(/(?:data-testid="review-positive-text"|class="[^"]*review_pos[^"]*")[\s\S]*?>([\s\S]*?)</)
            const negMatch = content.match(/(?:data-testid="review-negative-text"|class="[^"]*review_neg[^"]*")[\s\S]*?>([\s\S]*?)</)

            if (nameMatch || textMatch) {
              const posText = textMatch ? textMatch[1].trim().replace(/<[^>]+>/g, '') : ''
              const negText = negMatch ? negMatch[1].trim().replace(/<[^>]+>/g, '') : ''
              const combinedText = [posText, negText].filter(Boolean).join(' | ')

              reviews.push({
                author: nameMatch ? nameMatch[1].trim() : 'Booking-Gast',
                rating: scoreMatch ? Math.min(5, Number(scoreMatch[1].replace(',', '.')) / 2) : 4,
                text: combinedText,
                date: new Date().toISOString().split('T')[0],
              })
            }
          }
          if (reviews.length > 0) break
        }
      }
    }

    if (reviews.length === 0) {
      return { source: 'booking', fetched: 0, errors: 'Booking.com blockiert die automatische Abfrage. Bewertungen können manuell über "Bewertung hinzufügen" eingetragen werden.' }
    }

    let inserted = 0
    for (const review of reviews) {
      const { error } = await supabaseAdmin.from('reviews').upsert({
        listing_id: listingId,
        source: 'booking',
        source_review_id: `booking_${review.author}_${review.date}_${inserted}`,
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
