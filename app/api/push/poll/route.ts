import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { syncBookingMessages } from '@/lib/message-sync'

/**
 * Cron (every 10 min): polls Smoobu messages for RELEVANT bookings, stores
 * new ones and pushes a notification for new GUEST messages. Seit §131 ist
 * das nur noch das SICHERHEITSNETZ — die Sofort-Zustellung übernimmt der
 * Smoobu-newMessage-Webhook (app/api/smoobu/webhook); der Poll fängt
 * verpasste Events ab (Webhook-Ausfall, Deploy-Lücken).
 */
export const maxDuration = 300

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 401 })
  }

  // Zwei Fenster (§130 — ERZ-Vorfall: Nachricht 3+ Tage nach Abreise wurde
  // nie gepollt): Das SCHMALE Fenster (Anreise ≤14 Tg. / Abreise vor ≤3 Tg.)
  // läuft bei jedem 10-Min-Lauf; zweimal pro Stunde (Minute 0 + 30) weitet
  // sich das Fenster auf Anreise ≤60 / Abreise vor ≤21 Tagen — deckt frühe
  // Vorfreude-Fragen und späte Nachfragen (Rechnung, Fundsachen) mit max.
  // 30 Min Verzögerung ab, ohne die Smoobu-API-Last zu vervielfachen.
  const today = new Date()
  const wide = today.getUTCMinutes() < 10 || (today.getUTCMinutes() >= 30 && today.getUTCMinutes() < 40)

  // 🛟 Buchungs-Sicherheitsnetz (§137, 2×/Std.): fängt Reservierungen ab,
  // die der Smoobu-Webhook verpasst hat (Ausfall 21.7. — 10 fehlende
  // Buchungen inkl. Same-Day-Anreise), inkl. nachgeholtem Buchungs-Push
  let bookingImport: { imported: number; skipped: number; failed: number; cancelled: number } | null = null
  if (wide) {
    try {
      const { importMissingReservations } = await import('@/lib/booking-import')
      bookingImport = await importMissingReservations()
    } catch (err) {
      console.error('[push-poll] booking-import:', err)
    }
  }

  const soon = new Date(today.getTime() + (wide ? 60 : 14) * 86400_000).toISOString().slice(0, 10)
  const recent = new Date(today.getTime() - (wide ? 21 : 3) * 86400_000).toISOString().slice(0, 10)

  const { data: bookings } = await supabaseAdmin
    .from('bookings')
    .select('id, guest_name, smoobu_reservation_id, listings(title)')
    .not('smoobu_reservation_id', 'is', null)
    .neq('status', 'cancelled')
    .lte('check_in', soon)
    .gte('check_out', recent)
    .order('check_in', { ascending: true })
    .limit(wide ? 120 : 60)

  let newMessages = 0
  let pushes = 0
  for (const b of bookings ?? []) {
    try {
      const listing = (Array.isArray(b.listings) ? b.listings[0] : b.listings) as { title: string } | null
      const r = await syncBookingMessages({
        id: b.id,
        guest_name: b.guest_name,
        smoobu_reservation_id: Number(b.smoobu_reservation_id),
        listingTitle: listing?.title ?? null,
      })
      newMessages += r.newMessages
      pushes += r.pushes
    } catch (err) {
      console.error('[push-poll]', b.smoobu_reservation_id, err)
    }
  }

  return NextResponse.json({ checked: (bookings ?? []).length, newMessages, pushes, bookingImport })
}
