import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * GET /api/smoobu/test
 * Diagnostic endpoint — finds the correct channelId for Smoobu reservations.
 * Remove this in production!
 */
export async function GET() {
  const apiKey = process.env.SMOOBU_API_KEY
  const results: Record<string, unknown> = {
    apiKeySet: !!apiKey,
  }

  // 1. Fetch existing reservations to find valid channel IDs
  try {
    const res = await fetch('https://login.smoobu.com/api/reservations?pageSize=5&page=1', {
      headers: {
        'Api-Key': apiKey ?? '',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
    })
    const data = await res.json().catch(() => ({}))
    results.reservationsStatus = res.status
    if (res.ok && data.bookings) {
      results.existingBookings = data.bookings.map((b: Record<string, unknown>) => ({
        id: b.id,
        channel: b.channel,
        type: b.type,
        arrival: b['arrival-date'],
        departure: b['departure-date'],
        guestName: b['guest-name'],
      }))
    } else {
      results.reservationsRaw = data
    }
  } catch (err) {
    results.reservationsError = String(err)
  }

  // 2. Try different channel endpoints
  for (const endpoint of ['/api/channels', '/api/booking-channels', '/api/settings/channels']) {
    try {
      const res = await fetch(`https://login.smoobu.com${endpoint}`, {
        headers: { 'Api-Key': apiKey ?? '', 'Content-Type': 'application/json' },
      })
      const data = await res.json().catch(() => ({}))
      results[`endpoint_${endpoint.replace(/\//g, '_')}`] = { status: res.status, data }
    } catch (err) {
      results[`endpoint_${endpoint.replace(/\//g, '_')}`] = { error: String(err) }
    }
  }

  // 3. Get our listings with smoobu_id
  const { data: listings } = await supabaseAdmin
    .from('listings')
    .select('id, title, smoobu_id')
    .not('smoobu_id', 'is', null)
    .limit(3)
  results.listings = listings?.map(l => ({
    title: l.title,
    smoobu_id: l.smoobu_id,
  }))

  return NextResponse.json(results, { status: 200 })
}
