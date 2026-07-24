import { requireVoiceAuth, findBookingByPhone } from '@/lib/voice'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * ☎️ Anrufbot-Tool (§175): POST { caller_number } — findet die Buchung
 * des Anrufers über seine Rufnummer. Antwort bewusst DATENSPARSAM
 * (Vorname, Wohnung, Zeitraum — nie Adressen, Codes oder Beträge).
 */
export async function POST(request: Request) {
  const denied = requireVoiceAuth(request)
  if (denied) return denied

  let body: { caller_number?: string }
  try { body = await request.json() } catch { body = {} }
  const caller = String(body.caller_number ?? '').trim()
  if (!caller) {
    return Response.json({ found: false, hint: 'Keine Rufnummer übermittelt (z. B. unterdrückt oder Browser-Test).' })
  }

  const booking = await findBookingByPhone(caller)
  if (!booking) {
    return Response.json({
      found: false,
      hint: 'Keine Buchung zu dieser Nummer gefunden. Freundlich nach Name und Wohnung fragen.',
    })
  }

  const persons = (booking.adults ?? 0) + (booking.children ?? 0)
  return Response.json({
    found: true,
    guest_first_name: booking.guestName.split(/\s+/)[0] ?? '',
    apartment: booking.listingTitle,
    check_in: booking.checkIn,
    check_out: booking.checkOut,
    persons: persons > 0 ? persons : null,
    stay_status: booking.stayStatus,
    hint: 'Den Anrufer mit Vornamen ansprechen und auf diese Buchung Bezug nehmen. Türcodes trotzdem NIE nennen.',
  })
}
