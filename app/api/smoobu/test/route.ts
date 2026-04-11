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

  // The existing booking shows channel: { id: 1602674, channel_id: 23 }
  // Try using the account-specific channel id (1602674) instead of global (23)
  const channelIds = [1602674, 1601672, 1602446] // FeWo-direkt, Airbnb, Booking.com (account IDs)
  const labels = ['FeWo-direkt (1602674)', 'Airbnb (1601672)', 'Booking.com (1602446)']

  for (let i = 0; i < channelIds.length; i++) {
    const payload = {
      channelId: channelIds[i],
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
    }
    try {
      const res = await fetch('https://login.smoobu.com/api/reservations', {
        method: 'POST',
        headers: { 'Api-Key': apiKey ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      results[labels[i]] = { status: res.status, success: res.ok, response: data }
      if (res.ok) {
        results.WINNER = labels[i]
        results.winnerChannelId = channelIds[i]
        results.createdId = data.id
        break
      }
    } catch (err) {
      results[labels[i]] = { error: String(err) }
    }
  }

  return NextResponse.json(results)
}
