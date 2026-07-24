import { requireVoiceAuth } from '@/lib/voice'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkAvailability } from '@/lib/smoobu'
import { getMarkupMultiplier } from '@/lib/pricing'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * ☎️ Anrufbot-Tool (§175): POST { apartment_name, check_in, check_out } —
 * Live-Verfügbarkeit + Gesamtpreis aus Smoobu (mit Host-Markup, wie die
 * Website). Der Bot darf damit echte Preise nennen; gebucht wird auf
 * trimosa.de.
 */
export async function POST(request: Request) {
  const denied = requireVoiceAuth(request)
  if (denied) return denied

  let body: { apartment_name?: string; check_in?: string; check_out?: string }
  try { body = await request.json() } catch { body = {} }
  const name = String(body.apartment_name ?? '').trim().toLowerCase()
  const checkIn = String(body.check_in ?? '').trim()
  const checkOut = String(body.check_out ?? '').trim()

  const { data: listings } = await supabaseAdmin
    .from('listings')
    .select('id, title, slug, smoobu_id, host_id, max_guests')
    .eq('is_active', true)
  const all = listings ?? []

  if (!name) {
    return Response.json({ error: 'apartment_name fehlt', apartments: all.map((l) => l.title) }, { status: 400 })
  }
  const listing = all.find((l) => {
    const t = String(l.title ?? '').toLowerCase()
    return t === name || t.includes(name) || name.includes(t)
  })
  if (!listing) {
    return Response.json({
      error: 'Wohnung nicht gefunden',
      apartments: all.map((l) => l.title),
      hint: 'Einen der genannten Wohnungsnamen verwenden.',
    }, { status: 404 })
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut)) {
    return Response.json({ error: 'check_in/check_out im Format JJJJ-MM-TT nötig' }, { status: 400 })
  }
  const nights = Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000)
  if (nights < 1 || nights > 30) {
    return Response.json({ error: 'Zeitraum unplausibel (1–30 Nächte, Abreise nach Anreise)' }, { status: 400 })
  }
  if (!listing.smoobu_id) {
    return Response.json({ error: 'Für diese Wohnung ist keine Live-Abfrage möglich' }, { status: 404 })
  }

  const [result, markup] = await Promise.all([
    checkAvailability(listing.smoobu_id, checkIn, checkOut),
    getMarkupMultiplier(listing.host_id),
  ])
  const total = Math.round(result.totalPrice * markup)

  return Response.json({
    apartment: listing.title,
    check_in: checkIn,
    check_out: checkOut,
    nights,
    available: result.available,
    min_stay_violation: result.minStayViolation ?? false,
    total_price_eur: result.available ? total : null,
    avg_per_night_eur: result.available && nights > 0 ? Math.round(total / nights) : null,
    max_guests: listing.max_guests ?? null,
    booking_url: `https://trimosa.de/listing/${listing.slug ?? listing.id}`,
    hint: result.available
      ? 'Preis nennen (Stand jetzt) und auf die Buchung über trimosa.de verweisen — dort gilt der Bestpreis.'
      : 'Zeitraum ist leider belegt. Alternativ-Zeitraum oder andere Wohnung anbieten.',
  })
}
