import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * GET /api/smoobu/test
 * Tests creating a Smoobu reservation with the correct channelId.
 * Remove this in production!
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const dryRun = searchParams.get('create') !== 'true'
  const apiKey = process.env.SMOOBU_API_KEY
  const channelId = parseInt(process.env.SMOOBU_CHANNEL_ID ?? '23')

  const results: Record<string, unknown> = {
    channelId,
    dryRun,
    hint: dryRun ? 'Add ?create=true to actually create a test reservation' : 'Creating test reservation...',
  }

  // Get first listing with smoobu_id
  const { data: listings } = await supabaseAdmin
    .from('listings')
    .select('id, title, smoobu_id')
    .not('smoobu_id', 'is', null)
    .limit(1)

  if (!listings?.length) {
    results.error = 'No listings with smoobu_id found'
    return NextResponse.json(results)
  }

  const listing = listings[0]
  results.listing = { title: listing.title, smoobu_id: listing.smoobu_id }

  if (!dryRun) {
    // Actually create a test reservation
    const payload = {
      channelId,
      apartmentId: parseInt(listing.smoobu_id),
      arrivalDate: '2026-12-20',
      departureDate: '2026-12-22',
      firstName: 'Test',
      lastName: 'Trimosa',
      email: 'test@trimosa.de',
      phone: 'Nicht angegeben',
      address: 'TRIMOSA Vermittlung',
      city: 'Berlin',
      postalCode: '10115',
      country: 'DE',
      adults: 1,
      children: 0,
      price: 100,
      notice: 'TEST-Buchung über TRIMOSA — bitte löschen',
    }
    results.payload = payload

    try {
      const res = await fetch('https://login.smoobu.com/api/reservations', {
        method: 'POST',
        headers: {
          'Api-Key': apiKey ?? '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      results.status = res.status
      results.response = data
      results.success = res.ok
    } catch (err) {
      results.error = String(err)
    }
  }

  return NextResponse.json(results, { status: 200 })
}
