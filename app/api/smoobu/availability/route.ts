import { NextResponse } from 'next/server'
import { getApartmentRates, checkAvailability } from '@/lib/smoobu'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * GET /api/smoobu/availability?listingId=<uuid>&from=2025-06-01&to=2025-09-30
 *
 * Returns per-day availability + pricing for a listing.
 * No authentication required — uses server-side SMOOBU_API_KEY.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const listingId = searchParams.get('listingId')
  const from = searchParams.get('from') ?? new Date().toISOString().split('T')[0]
  const to = searchParams.get('to') ?? addDays(new Date(), 180)

  if (!listingId) {
    return NextResponse.json({ error: 'listingId fehlt' }, { status: 400 })
  }

  // Look up smoobu_id for this listing
  const { data: listing } = await supabaseAdmin
    .from('listings')
    .select('smoobu_id')
    .eq('id', listingId)
    .single()

  if (!listing?.smoobu_id) {
    return NextResponse.json({ error: 'Keine Smoobu-ID für diese Unterkunft' }, { status: 404 })
  }

  const rates = await getApartmentRates(listing.smoobu_id, from, to)
  return NextResponse.json({ rates, smoobuId: listing.smoobu_id })
}

/**
 * POST /api/smoobu/availability
 * Body: { listingId, checkIn, checkOut }
 *
 * Checks availability + calculates total price for a specific stay.
 */
export async function POST(request: Request) {
  const { listingId, checkIn, checkOut } = await request.json()

  if (!listingId || !checkIn || !checkOut) {
    return NextResponse.json({ error: 'listingId, checkIn und checkOut erforderlich' }, { status: 400 })
  }

  const { data: listing } = await supabaseAdmin
    .from('listings')
    .select('smoobu_id, price_per_night')
    .eq('id', listingId)
    .single()

  if (!listing?.smoobu_id) {
    // No Smoobu ID — fall back to static price, assume available
    const nights = daysBetween(checkIn, checkOut)
    return NextResponse.json({
      available: true,
      totalPrice: (listing?.price_per_night ?? 0) * nights,
      nights,
      minStayViolation: false,
      source: 'static',
    })
  }

  const result = await checkAvailability(listing.smoobu_id, checkIn, checkOut)
  return NextResponse.json({ ...result, source: 'smoobu' })
}

function addDays(date: Date, days: number): string {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
}
