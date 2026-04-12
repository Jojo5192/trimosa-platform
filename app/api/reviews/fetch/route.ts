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

  const results: { source: string; fetched: number; errors?: string }[] = []

  // ── 1. Airbnb (v2 REST API — no hash needed) ──
  if (listing.airbnb_url) {
    try {
      results.push(await fetchAirbnbReviews(listingId, listing.airbnb_url))
    } catch (e) {
      results.push({ source: 'airbnb', fetched: 0, errors: String(e) })
    }
  }

  // ── 2. Booking.com ──
  if (listing.booking_url) {
    try {
      results.push(await fetchBookingReviews(listingId, listing.booking_url))
    } catch (e) {
      results.push({ source: 'booking', fetched: 0, errors: String(e) })
    }
  }

  // ── 3. Google Maps (free, no API key) ──
  if (listing.google_place_id) {
    try {
      results.push(await fetchGoogleReviews(listingId, listing.google_place_id))
    } catch (e) {
      results.push({ source: 'google', fetched: 0, errors: String(e) })
    }
  }

  return NextResponse.json({ results })
}

/* ── Airbnb v2 REST API (public, no GraphQL hash needed) ───── */
async function fetchAirbnbReviews(listingId: string, airbnbUrl: string) {
  const match = airbnbUrl.match(/rooms\/(\d+)/)
  if (!match) return { source: 'airbnb', fetched: 0, errors: 'Ungültige Airbnb-URL. Format: https://airbnb.com/rooms/12345' }

  const airbnbId = match[1]
  const API_KEY = 'd306zoyjsyarp7ifhu67rjxn52tv0t20' // Airbnb public frontend key

  // Strategy 1: v2 REST API — the old mobile-format endpoint that is still active
  const urls = [
    `https://www.airbnb.com/api/v2/reviews?key=${API_KEY}&listing_id=${airbnbId}&role=all&_format=for_mobile_client&_limit=50&_offset=0&_order=language_country`,
    `https://www.airbnb.com/api/v2/reviews?key=${API_KEY}&listing_id=${airbnbId}&role=guest&_format=for_p3&_limit=50&_offset=0`,
  ]

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Airbnb/24.4 iPhone/17.0 Type/Phone',
          'Accept': 'application/json',
          'X-Airbnb-API-Key': API_KEY,
          'Accept-Language': 'de',
        },
      })

      if (!res.ok) continue

      const data = await res.json()
      const reviewsArr = data.reviews ?? data.pdp_listing_reviews ?? data.data?.reviews

      if (Array.isArray(reviewsArr) && reviewsArr.length > 0) {
        return await insertAirbnbReviews(listingId, reviewsArr)
      }
    } catch {
      // try next URL
    }
  }

  // Strategy 2: Fetch the listing page HTML and parse embedded review data
  try {
    const pageRes = await fetch(`https://www.airbnb.de/rooms/${airbnbId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept-Language': 'de-DE,de;q=0.9',
        'Accept': 'text/html',
      },
      redirect: 'follow',
    })

    if (pageRes.ok) {
      const html = await pageRes.text()

      // Try script tags with embedded JSON data
      const scriptPatterns = [
        /<script id="data-deferred-state-0"[^>]*>([\s\S]*?)<\/script>/,
        /<script id="data-deferred-state"[^>]*>([\s\S]*?)<\/script>/,
        /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
      ]

      for (const pattern of scriptPatterns) {
        const m = html.match(pattern)
        if (m) {
          try {
            const reviews = findReviewsInObject(JSON.parse(m[1]))
            if (reviews && reviews.length > 0) {
              return await insertAirbnbReviews(listingId, reviews)
            }
          } catch { /* next pattern */ }
        }
      }
    }
  } catch {
    // fall through
  }

  return { source: 'airbnb', fetched: 0, errors: 'Airbnb blockiert die Abfrage vom Server. Nutze "Bewertung hinzufügen" oder "Einfügen aus Zwischenablage" für manuellen Import.' }
}

/* Recursively find review arrays in nested objects */
function findReviewsInObject(obj: unknown, depth = 0): Array<Record<string, unknown>> | null {
  if (depth > 20 || !obj || typeof obj !== 'object') return null

  if (Array.isArray(obj)) {
    if (obj.length > 0 && obj[0] && typeof obj[0] === 'object') {
      const first = obj[0] as Record<string, unknown>
      if (
        ('rating' in first && ('comments' in first || 'reviewText' in first || 'comment' in first)) ||
        ('reviewRating' in first) ||
        ('localizedReview' in first)
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
  for (const key of ['reviews', 'mergedReviews', 'pdpReviews', 'reviewsList', 'visibleReviewGroups', 'allReviews']) {
    if (key in record) {
      const val = record[key]
      if (Array.isArray(val) && val.length > 0) {
        // Check for nested review groups
        if (typeof val[0] === 'object' && val[0] !== null && 'reviews' in (val[0] as Record<string, unknown>)) {
          const nested = (val[0] as Record<string, unknown>).reviews
          if (Array.isArray(nested) && nested.length > 0) return nested as Array<Record<string, unknown>>
        }
        return val as Array<Record<string, unknown>>
      }
    }
  }

  for (const val of Object.values(record)) {
    const found = findReviewsInObject(val, depth + 1)
    if (found) return found
  }
  return null
}

async function insertAirbnbReviews(listingId: string, reviews: Array<Record<string, unknown>>) {
  let inserted = 0
  for (const review of reviews) {
    const reviewer = (review.reviewer ?? {}) as Record<string, unknown>
    const localizedReview = (review.localizedReview ?? review) as Record<string, unknown>

    const id = String(review.id ?? review.reviewId ?? review.trackingKey ?? Date.now() + inserted)
    const author = String(
      review.reviewerName ?? review.reviewer_name ?? review.authorName ??
      reviewer.firstName ?? reviewer.first_name ?? reviewer.name ?? reviewer.smartName ??
      localizedReview.reviewerName ?? 'Airbnb-Gast'
    )
    const avatar = String(
      review.reviewerAvatar ?? review.reviewer_image_url ??
      reviewer.pictureUrl ?? reviewer.picture_url ?? reviewer.avatar ??
      reviewer.profilePictureUrl ?? reviewer.thumbnail_url ?? ''
    ) || null

    let rating = Number(review.rating ?? review.reviewRating ?? review.review_rating ?? 5)
    if (rating > 5) rating = Math.round(rating / 2)

    const text = String(
      review.comments ?? review.reviewText ?? review.comment ?? review.review ??
      localizedReview.comments ?? localizedReview.reviewText ?? ''
    )

    const dateStr = review.created_at ?? review.createdAt ?? review.localizedDate ?? review.date ?? review.created_at_local
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
  // Extract hotel ID or pagename from URL
  const hotelIdMatch = bookingUrl.match(/(?:hotel\/[a-z]{2}\/[\w-]+|(?:[\?&]|\.html\?).*(?:hotel_id|dest_id)=(\d+))/)

  try {
    // Strategy 1: Fetch main hotel page
    const pageRes = await fetch(bookingUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept-Language': 'de-DE,de;q=0.9',
        'Accept': 'text/html',
      },
    })

    if (!pageRes.ok) return { source: 'booking', fetched: 0, errors: `Booking-Seite nicht erreichbar (${pageRes.status})` }

    const html = await pageRes.text()
    let reviews: Array<{ author: string; rating: number; text: string; date: string }> = []

    // Try JSON-LD
    const jsonLdBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)
    if (jsonLdBlocks) {
      for (const block of jsonLdBlocks) {
        try {
          const json = JSON.parse(block.replace(/<script[^>]*>/, '').replace(/<\/script>/, ''))
          const revArr = json.review ?? json.reviews
          if (Array.isArray(revArr) && revArr.length > 0) {
            reviews = revArr.map((r: Record<string, unknown>) => {
              const authorObj = r.author as Record<string, unknown> | undefined
              const ratingObj = r.reviewRating as Record<string, unknown> | undefined
              let ratingVal = Number(ratingObj?.ratingValue ?? ratingObj?.bestRating ?? 0)
              // Booking uses 0-10 scale, convert to 0-5
              if (ratingVal > 5) ratingVal = ratingVal / 2
              return {
                author: String(authorObj?.name ?? 'Booking-Gast'),
                rating: ratingVal || 4,
                text: String(r.reviewBody ?? r.description ?? ''),
                date: String(r.datePublished ?? new Date().toISOString().split('T')[0]),
              }
            })
            break
          }
        } catch { /* skip */ }
      }
    }

    // Strategy 2: Parse review HTML blocks
    if (reviews.length === 0) {
      // Look for review score and text in common Booking.com patterns
      const reviewBlockRegex = /(?:data-testid="review-card"|class="[^"]*review_item[^"]*")([\s\S]*?)(?=(?:data-testid="review-card"|class="[^"]*review_item)|<\/section)/g
      const blocks = [...html.matchAll(reviewBlockRegex)]

      for (const block of blocks.slice(0, 30)) {
        const content = block[1]
        const nameMatch = content.match(/(?:reviewer[_-]?name|review-avatar|bui-avatar)[^>]*>[\s]*([^<]{2,40})/)
        const scoreMatch = content.match(/(?:review-score-badge|review_item_review_score)[^>]*>[\s]*([\d.,]+)/)
        const posMatch = content.match(/(?:review-positive|review_pos)[^>]*>[\s]*([\s\S]*?)</)
        const negMatch = content.match(/(?:review-negative|review_neg)[^>]*>[\s]*([\s\S]*?)</)
        const dateMatch = content.match(/(?:review-date|review_item_date)[^>]*>[\s]*([\s\S]*?)</)

        if (nameMatch || posMatch) {
          const text = [posMatch?.[1]?.trim(), negMatch?.[1]?.trim()].filter(Boolean).join(' | ').replace(/<[^>]+>/g, '')
          let score = scoreMatch ? Number(scoreMatch[1].replace(',', '.')) : 8
          if (score > 5) score = score / 2

          reviews.push({
            author: nameMatch?.[1]?.trim() || 'Booking-Gast',
            rating: Math.min(5, score),
            text,
            date: dateMatch?.[1]?.trim() || new Date().toISOString().split('T')[0],
          })
        }
      }
    }

    if (reviews.length === 0) {
      return { source: 'booking', fetched: 0, errors: 'Booking.com blockiert die Abfrage vom Server. Nutze "Einfügen aus Zwischenablage" für manuellen Import.' }
    }

    let inserted = 0
    for (let i = 0; i < reviews.length; i++) {
      const review = reviews[i]
      const { error } = await supabaseAdmin.from('reviews').upsert({
        listing_id: listingId,
        source: 'booking',
        source_review_id: `booking_${review.author.replace(/\s+/g, '_')}_${review.date}_${i}`,
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

/* ── Google Maps (FREE — no API key needed) ────────────────── */
async function fetchGoogleReviews(listingId: string, placeId: string) {
  // Use Google Maps internal endpoint (same as browser uses)
  // This doesn't require an API key
  try {
    const mapsUrl = `https://www.google.com/maps/place/?q=place_id:${placeId}`
    const res = await fetch(mapsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept-Language': 'de-DE,de;q=0.9',
        'Accept': 'text/html',
      },
      redirect: 'follow',
    })

    if (!res.ok) {
      return { source: 'google', fetched: 0, errors: `Google Maps nicht erreichbar (${res.status})` }
    }

    const html = await res.text()

    // Google Maps embeds review data in the page as a large JSON array
    // Look for review-like patterns in the embedded data
    const reviews: Array<{ author: string; rating: number; text: string; date: string; avatar?: string }> = []

    // Pattern: Google embeds data in script tags or in the page body as encoded arrays
    // Try to find review text blocks with star ratings
    // Google uses a specific pattern: [null,null,RATING_NUMBER] followed by review text
    const reviewTextPattern = /\[null,null,(\d)\][\s\S]{0,200}?"((?:[^"\\]|\\.)*)"/g
    let m
    while ((m = reviewTextPattern.exec(html)) !== null && reviews.length < 50) {
      const rating = parseInt(m[1])
      const text = m[2].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      if (rating >= 1 && rating <= 5 && text.length > 10) {
        reviews.push({
          author: 'Google-Nutzer',
          rating,
          text,
          date: new Date().toISOString().split('T')[0],
        })
      }
    }

    // Alternative: Try to find structured review data
    // Google Maps often includes arrays like [author_name, profile_url, null, rating, [null, text]]
    const authorRatingPattern = /"([^"]{2,40})"[\s\S]{0,100}?(?:src|(?:photos|photo)\/[^"]*)"[\s\S]{0,300}?\[null,null,(\d)\][\s\S]{0,500}?"((?:[^"\\]|\\.)*)"/g
    while ((m = authorRatingPattern.exec(html)) !== null && reviews.length < 50) {
      const author = m[1]
      const rating = parseInt(m[2])
      const text = m[3].replace(/\\n/g, '\n').replace(/\\"/g, '"')
      if (rating >= 1 && rating <= 5 && text.length > 5 && !author.includes('google') && !author.includes('http')) {
        // Avoid duplicates
        if (!reviews.some(r => r.text === text)) {
          reviews.push({ author, rating, text, date: new Date().toISOString().split('T')[0] })
        }
      }
    }

    if (reviews.length === 0) {
      return { source: 'google', fetched: 0, errors: 'Google Maps blockiert die Abfrage vom Server. Nutze "Einfügen aus Zwischenablage" für manuellen Import.' }
    }

    let inserted = 0
    for (let i = 0; i < reviews.length; i++) {
      const review = reviews[i]
      const { error } = await supabaseAdmin.from('reviews').upsert({
        listing_id: listingId,
        source: 'google',
        source_review_id: `google_${review.author.replace(/\s+/g, '_')}_${i}`,
        author_name: review.author,
        author_avatar: review.avatar ?? null,
        rating: review.rating,
        review_text: review.text,
        review_date: review.date,
      }, { onConflict: 'listing_id,source,source_review_id' })

      if (!error) inserted++
    }

    return { source: 'google', fetched: inserted }
  } catch (e) {
    return { source: 'google', fetched: 0, errors: `Fehler: ${e}` }
  }
}
