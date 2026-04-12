import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createSupabaseServerClient as createServerClient } from '@/lib/supabase-server'

/* GET /api/reviews?listingId=xxx&limit=10&offset=0&source=airbnb */
export async function GET(req: NextRequest) {
  const listingId = req.nextUrl.searchParams.get('listingId')
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '10'), 50)
  const offset = parseInt(req.nextUrl.searchParams.get('offset') ?? '0')
  const source = req.nextUrl.searchParams.get('source') // optional filter

  let query = supabaseAdmin
    .from('reviews')
    .select('*', { count: 'exact' })
    .eq('listing_id', listingId)
    .order('review_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (source) query = query.eq('source', source)

  const { data: reviews, count, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Aggregate stats
  const { data: stats } = await supabaseAdmin
    .from('reviews')
    .select('source, rating')
    .eq('listing_id', listingId)

  const sources: Record<string, { count: number; total: number }> = {}
  let totalRating = 0
  let totalCount = 0

  for (const r of stats ?? []) {
    if (!sources[r.source]) sources[r.source] = { count: 0, total: 0 }
    sources[r.source].count++
    sources[r.source].total += Number(r.rating)
    totalRating += Number(r.rating)
    totalCount++
  }

  const aggregated: Record<string, { avg: number; count: number }> = {}
  for (const [src, { count: c, total }] of Object.entries(sources)) {
    aggregated[src] = { avg: Math.round((total / c) * 100) / 100, count: c }
  }

  return NextResponse.json({
    reviews: reviews ?? [],
    total: count ?? 0,
    overall: totalCount > 0 ? {
      avg: Math.round((totalRating / totalCount) * 100) / 100,
      count: totalCount,
    } : null,
    sources: aggregated,
  })
}

/* POST /api/reviews — add a review (host importing or guest reviewing) */
export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json()
  const { listingId, source, authorName, rating, reviewText, reviewDate, sourceReviewId } = body

  if (!listingId || !authorName || !rating || !reviewDate) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Check if user is host of this listing OR a guest leaving a TRIMOSA review
  const { data: listing } = await supabaseAdmin
    .from('listings')
    .select('host_id')
    .eq('id', listingId)
    .single()

  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })

  const isHost = listing.host_id === user.id
  const isGuestReview = source === 'trimosa'

  if (!isHost && !isGuestReview) {
    return NextResponse.json({ error: 'Only hosts can import external reviews' }, { status: 403 })
  }

  // For guest reviews, verify they had a completed booking
  if (isGuestReview && !isHost) {
    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('id')
      .eq('listing_id', listingId)
      .eq('guest_id', user.id)
      .eq('status', 'confirmed')
      .lt('check_out', new Date().toISOString().split('T')[0])
      .limit(1)
      .maybeSingle()

    if (!booking) {
      return NextResponse.json({ error: 'You must have a completed stay to leave a review' }, { status: 403 })
    }

    // Check for existing review from this guest
    const { data: existing } = await supabaseAdmin
      .from('reviews')
      .select('id')
      .eq('listing_id', listingId)
      .eq('guest_id', user.id)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ error: 'You have already reviewed this listing' }, { status: 409 })
    }
  }

  const { data: review, error } = await supabaseAdmin
    .from('reviews')
    .insert({
      listing_id: listingId,
      source: source || 'trimosa',
      source_review_id: sourceReviewId || null,
      author_name: authorName,
      rating: Math.min(5, Math.max(1, Number(rating))),
      review_text: reviewText || null,
      review_date: reviewDate,
      verified: isGuestReview,
      guest_id: isGuestReview ? user.id : null,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Review already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ review })
}

/* DELETE /api/reviews?id=xxx — host can delete imported reviews */
export async function DELETE(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Verify ownership
  const { data: review } = await supabaseAdmin
    .from('reviews')
    .select('listing_id, source')
    .eq('id', id)
    .single()

  if (!review) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: listing } = await supabaseAdmin
    .from('listings')
    .select('host_id')
    .eq('id', review.listing_id)
    .single()

  if (listing?.host_id !== user.id) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  if (review.source === 'trimosa') {
    return NextResponse.json({ error: 'Cannot delete guest reviews' }, { status: 403 })
  }

  await supabaseAdmin.from('reviews').delete().eq('id', id)
  return NextResponse.json({ ok: true })
}
