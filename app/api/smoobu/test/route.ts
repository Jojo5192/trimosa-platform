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

  // Use account-specific FeWo-direkt channel ID + address & country
  const payload = {
    channelId: 1602674,
    apartmentId,
    arrivalDate: '2026-12-20',
    departureDate: '2026-12-22',
    firstName: 'Test',
    lastName: 'Trimosa',
    email: 'test@trimosa.de',
    phone: '+4900000000',
    address: 'Musterstr. 1',
    postalCode: '10115',
    city: 'Berlin',
    country: 'DE',
    adults: 1,
    children: 0,
    price: 100,
    notice: 'TEST bitte loeschen',
  }
  results.payload = payload

  try {
    const res = await fetch('https://login.smoobu.com/api/reservations', {
      method: 'POST',
      headers: { 'Api-Key': apiKey ?? '', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    results.status = res.status
    results.success = res.ok
    results.response = data
  } catch (err) {
    results.error = String(err)
  }

  return NextResponse.json(results)
}
