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
  const headers = { 'Api-Key': process.env.SMOOBU_API_KEY!, 'Content-Type': 'application/json' }

  // Test all possible URL formats in parallel
  const formats: Record<string, string> = {
    'brackets_encoded': `https://login.smoobu.com/api/rates?${new URLSearchParams([['apartments[]', id], ['startDate', from], ['endDate', to]])}`,
    'brackets_raw':     `https://login.smoobu.com/api/rates?apartments[]=${id}&startDate=${from}&endDate=${to}`,
    'no_brackets':      `https://login.smoobu.com/api/rates?apartments=${id}&startDate=${from}&endDate=${to}`,
    'indexed':          `https://login.smoobu.com/api/rates?apartments[0]=${id}&startDate=${from}&endDate=${to}`,
  }

  const results: Record<string, unknown> = {}
  for (const [key, url] of Object.entries(formats)) {
    try {
      const res = await fetch(url, { headers })
      results[key] = { status: res.status, body: await res.json() }
    } catch (e) {
      results[key] = { error: String(e) }
    }
  }

  return NextResponse.json({ listing, from, to, formatTests: results })
}
