import { requireVoiceAuth, findBookingByPhone, findBookingByDetails, normalizePhone } from '@/lib/voice'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * ☎️📚 Chat-Verlauf fürs Telefonat (§183): Sobald die Buchung zugeordnet
 * ist (Anrufer-Nummer oder Gesprächsdaten), bekommt der Bot die letzten
 * Nachrichten des Gast-Threads als Hintergrund — „was wurde schon
 * besprochen/zugesagt?". DATENSPARSAM: 5–8-stellige Ziffernfolgen werden
 * geschwärzt (Türcodes!) — Codes gibt es NUR über gast_verifizieren (§181).
 */

// Türcodes & Co. schwärzen; Einzeltext kappen (Smoobu-Bestätigungs-Mauern)
function redact(s: string): string {
  return String(s ?? '').replace(/\b\d{5,8}\b/g, '•••••').replace(/\s+/g, ' ').trim().slice(0, 400)
}

export async function POST(request: Request) {
  const denied = requireVoiceAuth(request)
  if (denied) return denied

  let body: {
    caller_number?: string; guest_name?: string
    apartment_name?: string; arrival_date?: string; departure_date?: string
  }
  try { body = await request.json() } catch { body = {} }

  const caller = String(body.caller_number ?? '').trim()
  const rlKey = `voice-chat-context:${normalizePhone(caller) || 'anon'}`
  if (!(await checkRateLimit(rlKey, 30, 3600))) {
    return Response.json({ found: false, hint: 'Zu viele Anfragen — später erneut versuchen.' })
  }

  let booking = caller ? await findBookingByPhone(caller) : null
  if (!booking) {
    booking = await findBookingByDetails({
      name: body.guest_name,
      apartment: body.apartment_name,
      arrival: body.arrival_date,
      departure: body.departure_date,
    })
  }
  if (!booking) {
    return Response.json({
      found: false,
      hint: 'Keine Buchung zuordenbar — Wohnung, Name und Anreisedatum erfragen und erneut aufrufen.',
    })
  }

  type Item = { von: 'gast' | 'team'; wann: string; text: string }
  let items: Item[] = []

  // booking-Welt (Portal-Gäste + Website-Direktbuchungen)
  const { data: bmsgs } = await supabaseAdmin
    .from('messages')
    .select('sender_type, content, content_de, created_at')
    .eq('booking_id', booking.id)
    .order('created_at', { ascending: false })
    .limit(12)
  items = (bmsgs ?? [])
    .map((m) => ({
      von: (m.sender_type === 'guest' ? 'gast' : 'team') as Item['von'],
      wann: String(m.created_at ?? '').slice(0, 16).replace('T', ' '),
      text: redact(String(m.content_de ?? m.content ?? '')),
    }))
    .filter((m) => m.text)

  // Website-Gäste mit Direkt-Chat (conversations-Welt)
  if (!items.length) {
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('id, guest_id')
      .eq('booking_id', booking.id)
      .maybeSingle()
    if (conv?.id) {
      const { data: dmsgs } = await supabaseAdmin
        .from('messages')
        .select('sender_id, content, content_de, created_at')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(12)
      items = (dmsgs ?? [])
        .map((m) => ({
          von: (m.sender_id != null && m.sender_id === conv.guest_id ? 'gast' : 'team') as Item['von'],
          wann: String(m.created_at ?? '').slice(0, 16).replace('T', ' '),
          text: redact(String(m.content_de ?? m.content ?? '')),
        }))
        .filter((m) => m.text)
    }
  }

  items.reverse() // chronologisch fürs LLM

  return Response.json({
    found: true,
    guest_first_name: booking.guestName.split(/\s+/)[0] ?? '',
    apartment: booking.listingTitle,
    check_in: booking.checkIn,
    check_out: booking.checkOut,
    stay_status: booking.stayStatus,
    nachrichten: items,
    hint: items.length
      ? 'Verlauf nur als Hintergrund nutzen (nicht vorlesen). Türcodes/Passwörter NIEMALS aus dem Verlauf nennen — Codes ausschließlich über gast_verifizieren.'
      : 'Noch kein Chat-Verlauf zu dieser Buchung vorhanden.',
  })
}
