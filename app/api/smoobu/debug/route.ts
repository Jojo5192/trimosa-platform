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

  // Smoobu Rates direkt abrufen (URL-encoded brackets)
  const from = new Date().toISOString().split('T')[0]
  const to = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
  const params = new URLSearchParams()
  params.append('apartments[]', listing.smoobu_id)
  params.append('startDate', from)
  params.append('endDate', to)
  const url = `https://login.smoobu.com/api/rates?${params.toString()}`

  let smoobuRaw: unknown = null
  let smoobuError: string | null = null
  try {
    const res = await fetch(url, {
      headers: { 'Api-Key': process.env.SMOOBU_API_KEY!, 'Content-Type': 'application/json' },
    })
    smoobuRaw = await res.json()
  } catch (e) {
    smoobuError = String(e)
  }

  return NextResponse.json({ listing, smoobuRaw, smoobuError, from, to })
}
