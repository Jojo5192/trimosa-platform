import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * GET /api/smoobu/debug?listingId=<uuid>
 * Zeigt smoobu_id + rohe Smoobu-Rates für ein Listing — nur für Debugging.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const listingId = searchParams.get('listingId')

  // Alle Listings mit smoobu_id Status
  const { data: listings } = await supabaseAdmin
    .from('listings')
    .select('id, title, smoobu_id, is_active')
    .order('created_at', { ascending: false })

  if (!listingId) {
    return NextResponse.json({ listings })
  }

  const listing = listings?.find(l => l.id === listingId)
  if (!listing?.smoobu_id) {
    return NextResponse.json({
      listing,
      error: 'Kein smoobu_id für dieses Listing gesetzt',
      allListings: listings,
    })
  }

  const from = new Date().toISOString().split('T')[0]
  const to = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
  const id = listing.smoobu_id
  const headers = { 'Api-Key': process.env.SMOOBU_API_KEY!, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }

  // Test different endpoints and approaches
  const tests: Record<string, () => Promise<Response>> = {
    // Different endpoint paths
    'GET_rates_encoded':    () => fetch(`https://login.smoobu.com/api/rates?${new URLSearchParams([['apartments[]',id],['startDate',from],['endDate',to]])}`, { headers }),
    'GET_apartment_rates':  () => fetch(`https://login.smoobu.com/api/apartments/${id}/rates?startDate=${from}&endDate=${to}`, { headers }),
    'GET_calendar':         () => fetch(`https://login.smoobu.com/api/apartments/${id}/calendar?startDate=${from}&endDate=${to}`, { headers }),
    // POST with JSON body
    'POST_rates':           () => fetch(`https://login.smoobu.com/api/rates`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ apartments: [parseInt(id)], startDate: from, endDate: to }),
    }),
    // Underscore date params
    'GET_underscore_dates': () => fetch(`https://login.smoobu.com/api/rates?${new URLSearchParams([['apartments[]',id],['start_date',from],['end_date',to]])}`, { headers }),
  }

  const results: Record<string, unknown> = {}
  for (const [key, fn] of Object.entries(tests)) {
    try {
      const res = await fn()
      const body = await res.text()
      results[key] = { status: res.status, body: body.substring(0, 300) }
    } catch (e) {
      results[key] = { error: String(e) }
    }
  }

  return NextResponse.json({ listing, from, to, tests: results })
}
