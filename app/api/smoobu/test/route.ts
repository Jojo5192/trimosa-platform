import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  const apiKey = process.env.SMOOBU_API_KEY
  const results: Record<string, unknown> = {}

  const { data: listings } = await supabaseAdmin
    .from('listings')
    .select('id, title, smoobu_id')
    .not('smoobu_id', 'is', null)
    .limit(1)
  if (!listings?.length) return NextResponse.json({ error: 'No listings' })
  const apartmentId = parseInt(listings[0].smoobu_id)

  const base = {
    channelId: 1602674,
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
    notice: 'TEST bitte loeschen',
    country: 'DE',
  }

  const attempts: Record<string, Record<string, unknown>> = {
    'address-obj-with-street': { address: { street: 'Musterstr. 1', postalCode: '10115', city: 'Berlin' } },
    'address-obj-location': { address: { location: 'Musterstr. 1, 10115 Berlin' } },
    'guest-address-kebab': { 'guest-address': 'Musterstr. 1, 10115 Berlin' },
    'street-only': { street: 'Musterstr. 1, 10115 Berlin' },
    'address-full-line': { address: 'Musterstr. 1, 10115 Berlin, Germany' },
    'address-country-name': { address: 'Musterstr. 1', country: 'Germany' },
  }

  for (const [label, extra] of Object.entries(attempts)) {
    const payload = { ...base, ...extra }
    try {
      const res = await fetch('https://login.smoobu.com/api/reservations', {
        method: 'POST',
        headers: { 'Api-Key': apiKey ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      results[label] = { status: res.status, ok: res.ok, msg: data.validation_messages ?? data.detail ?? data }
      if (res.ok) { results.WINNER = label; results.createdId = data.id; break }
    } catch (err) {
      results[label] = { error: String(err) }
    }
  }

  return NextResponse.json(results)
}
