import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * GET /api/smoobu/test
 * Tests Smoobu reservation creation with different address field formats.
 */
export async function GET() {
  const apiKey = process.env.SMOOBU_API_KEY
  const channelId = parseInt(process.env.SMOOBU_CHANNEL_ID ?? '23')
  const results: Record<string, unknown> = { channelId }

  const { data: listings } = await supabaseAdmin
    .from('listings')
    .select('id, title, smoobu_id')
    .not('smoobu_id', 'is', null)
    .limit(1)

  if (!listings?.length) {
    return NextResponse.json({ error: 'No listings with smoobu_id' })
  }
  const apartmentId = parseInt(listings[0].smoobu_id)

  // Try 3 different address formats
  const attempts = [
    {
      label: 'street (not address)',
      extra: { street: 'Musterstr. 1', city: 'Berlin', postalCode: '10115', country: 'DE' },
    },
    {
      label: 'address as object',
      extra: { address: { street: 'Musterstr. 1', postalCode: '10115', location: 'Berlin', country: 'DE' } },
    },
    {
      label: 'flat street + location',
      extra: { street: 'Musterstr. 1', location: 'Berlin', zip: '10115', country: 'DE' },
    },
  ]

  for (const attempt of attempts) {
    const payload = {
      channelId,
      apartmentId,
      arrivalDate: '2026-12-20',
      departureDate: '2026-12-22',
      firstName: 'Test',
      lastName: 'Trimosa',
      email: 'test@trimosa.de',
      phone: '+4900000000',
      adults: 1,
      children: 0,
      price: 100,
      notice: 'TEST — bitte loeschen',
      ...attempt.extra,
    }
    try {
      const res = await fetch('https://login.smoobu.com/api/reservations', {
        method: 'POST',
        headers: { 'Api-Key': apiKey ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      results[attempt.label] = {
        status: res.status,
        success: res.ok,
        response: data,
        payload: attempt.extra,
      }
      // If one succeeds, mark it
      if (res.ok) {
        results.WINNER = attempt.label
        results.winnerExtra = attempt.extra
        results.createdId = data.id
        break // Don't create more test bookings
      }
    } catch (err) {
      results[attempt.label] = { error: String(err) }
    }
  }

  return NextResponse.json(results, { status: 200 })
}
