import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  const apiKey = process.env.SMOOBU_API_KEY
  const channelId = parseInt(process.env.SMOOBU_CHANNEL_ID ?? '23')
  const results: Record<string, unknown> = { channelId }

  const { data: listings } = await supabaseAdmin
    .from('listings')
    .select('id, title, smoobu_id')
    .not('smoobu_id', 'is', null)
    .limit(1)

  if (!listings?.length) return NextResponse.json({ error: 'No listings' })
  const apartmentId = parseInt(listings[0].smoobu_id)

  const attempts = [
    { label: 'real-address-string', extra: { address: 'Musterstr. 1, 10115 Berlin', country: 'DE', phone: '+4900000000' } },
    { label: 'address-with-street-number', extra: { address: 'Hauptstrasse 10', city: 'Berlin', postalCode: '10115', country: 'DE', phone: '+4900000000' } },
    { label: 'address-json-nested', extra: { 'guest-address': 'Musterstr. 1', 'guest-city': 'Berlin', 'guest-postal-code': '10115', 'guest-country': 'DE', phone: '+4900000000' } },
  ]

  for (const attempt of attempts) {
    const payload = {
      channelId, apartmentId,
      arrivalDate: '2026-12-20', departureDate: '2026-12-22',
      firstName: 'Test', lastName: 'Trimosa',
      email: 'test@trimosa.de',
      adults: 1, children: 0, price: 100,
      notice: 'TEST bitte loeschen',
      ...attempt.extra,
    }
    try {
      const res = await fetch('https://login.smoobu.com/api/reservations', {
        method: 'POST',
        headers: { 'Api-Key': apiKey ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      results[attempt.label] = { status: res.status, success: res.ok, response: data }
      if (res.ok) {
        results.WINNER = attempt.label
        results.createdId = data.id
        break
      }
    } catch (err) {
      results[attempt.label] = { error: String(err) }
    }
  }

  return NextResponse.json(results)
}
