import { requireVoiceAuth, findBookingByPhone, normalizePhone } from '@/lib/voice'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * ☎️🔐 Anrufer-Verifizierung (§175, Inhaber-Entscheid 24.7.):
 * Der TÜRCODE dient als Ausweis für kritische Auskünfte — außer der Anrufer
 * fragt den Türcode selbst an (zirkulär), dann Nachname + Anreisedatum.
 * Max. wenige Abfragen, Fehlversuche rate-limitiert.
 *
 * POST { caller_number?, door_code?, last_name?, arrival_date?,
 *        apartment_name?, request: 'tuercode' | 'info' }
 * → { verified, guest_first_name?, apartment?, door_code?, chat_sent?, hint }
 */

type BRow = {
  id: string
  guest_name: string | null
  check_in: string
  check_out: string
  door_code: string | null
  portal_token: string | null
  listings: { title: string | null } | null
}

async function loadBooking(id: string): Promise<BRow | null> {
  const { data } = await supabaseAdmin
    .from('bookings')
    .select('id, guest_name, check_in, check_out, door_code, portal_token, listings(title)')
    .eq('id', id)
    .maybeSingle()
  return (data as unknown as BRow) ?? null
}

export async function POST(request: Request) {
  const denied = requireVoiceAuth(request)
  if (denied) return denied

  let body: {
    caller_number?: string; door_code?: string; last_name?: string
    arrival_date?: string; apartment_name?: string; request?: string
  }
  try { body = await request.json() } catch { body = {} }

  const caller = String(body.caller_number ?? '').trim()
  const codeIn = String(body.door_code ?? '').replace(/\D/g, '')
  const lastName = String(body.last_name ?? '').trim().toLowerCase()
  const arrival = String(body.arrival_date ?? '').trim()
  const apartment = String(body.apartment_name ?? '').trim().toLowerCase()
  const wants = body.request === 'tuercode' ? 'tuercode' : 'info'

  // Fehlversuchs-Bremse je Rufnummer (Anrufer-ID-Spoofing bleibt Restrisiko,
  // aber Brute-Force über wiederholte Anrufe wird teuer)
  const rlKey = `voice-verify:${normalizePhone(caller) || 'anon'}`
  const allowed = await checkRateLimit(rlKey, 6, 3600)
  if (!allowed) {
    return Response.json({ verified: false, hint: 'Zu viele Versuche — der Anrufer soll es später erneut versuchen oder das Team ruft zurück.' })
  }

  const today = new Date().toISOString().slice(0, 10)
  const cutoff = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)

  // ── Buchung finden: Anrufer-Nummer → Türcode → Namens-Daten ──
  let booking: BRow | null = null
  const byPhone = caller ? await findBookingByPhone(caller) : null
  if (byPhone) booking = await loadBooking(byPhone.id)

  if (!booking && codeIn.length >= 5) {
    const { data } = await supabaseAdmin
      .from('bookings')
      .select('id, guest_name, check_in, check_out, door_code, portal_token, listings(title)')
      .eq('status', 'confirmed')
      .eq('door_code', codeIn)
      .gte('check_out', cutoff)
      .order('check_in', { ascending: true })
      .limit(2)
    const rows = (data ?? []) as unknown as BRow[]
    if (rows.length === 1) booking = rows[0]
  }

  if (!booking && lastName && /^\d{4}-\d{2}-\d{2}$/.test(arrival)) {
    const { data } = await supabaseAdmin
      .from('bookings')
      .select('id, guest_name, check_in, check_out, door_code, portal_token, listings(title)')
      .eq('status', 'confirmed')
      .eq('check_in', arrival)
      .ilike('guest_name', `%${lastName}%`)
      .limit(3)
    const rows = (data ?? []) as unknown as BRow[]
    const filtered = apartment
      ? rows.filter((r) => String(r.listings?.title ?? '').toLowerCase().includes(apartment))
      : rows
    if (filtered.length === 1) booking = filtered[0]
  }

  if (!booking) {
    return Response.json({
      verified: false,
      hint: 'Keine passende Buchung gefunden. Nachname, Anreisedatum und ggf. Wohnung erfragen — oder das Anliegen per nachricht_aufnehmen ans Team geben.',
    })
  }

  // ── Verifizieren ──
  const codeOk = !!booking.door_code && codeIn.length >= 5 && codeIn === booking.door_code
  const guestLast = (booking.guest_name ?? '').trim().toLowerCase()
  const nameOk = !!lastName && guestLast.includes(lastName)
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(arrival) && arrival === booking.check_in
  const dataOk = nameOk && dateOk

  if (!codeOk && !dataOk) {
    return Response.json({
      verified: false,
      hint: 'Angaben passen nicht zur Buchung. EINE weitere Rückfrage stellen oder die andere Methode anbieten (Zugangscode ODER Nachname + Anreisedatum). Danach: Team-Rückruf via nachricht_aufnehmen.',
    })
  }

  const firstName = (booking.guest_name ?? '').split(/\s+/)[0] ?? ''
  const title = booking.listings?.title ?? 'deiner Wohnung'

  // ── Türcode-Ausgabe (nur nach Daten-Verifizierung sinnvoll — wer den Code
  //    nennt, kennt ihn ja schon) ──
  if (wants === 'tuercode') {
    let code = booking.door_code
    if (!code) {
      // Kurz vor/bei Anreise darf der Code frisch erzeugt werden (gleiche
      // Guards wie die Gästemappe — ensureDoorCode prüft selbst)
      try {
        const { ensureDoorCode, getRevealDays } = await import('@/lib/locks')
        const reveal = await getRevealDays()
        const daysToArrival = Math.ceil((new Date(booking.check_in).getTime() - Date.now()) / 86400000)
        if (daysToArrival <= reveal) code = await ensureDoorCode(booking.id)
      } catch (e) { console.error('[voice-verify] ensureDoorCode:', e) }
    }
    if (!code || booking.check_out < today) {
      return Response.json({
        verified: true,
        guest_first_name: firstName,
        apartment: title,
        door_code: null,
        hint: 'Verifiziert, aber der Code ist noch nicht freigeschaltet — er erscheint wenige Tage vor der Anreise automatisch in der Gästemappe. Das dem Gast freundlich erklären.',
      })
    }

    // Code zusätzlich in den Chat-Thread legen (Gast kann nachlesen)
    let chatSent = false
    try {
      const mappe = booking.portal_token ? `https://trimosa.de/mappe/${booking.portal_token}` : null
      const content = [
        `🔐 Wie eben am Telefon besprochen: Dein Türcode für ${title} ist ${code}.`,
        mappe ? `Du findest ihn jederzeit auch in deiner Gästemappe: ${mappe}` : '',
      ].filter(Boolean).join('\n')
      const { error } = await supabaseAdmin.from('messages').insert({
        booking_id: booking.id, sender_type: 'host', content, lang: 'de',
      })
      chatSent = !error
    } catch { /* best effort */ }

    return Response.json({
      verified: true,
      guest_first_name: firstName,
      apartment: title,
      door_code: code,
      chat_sent: chatSent,
      hint: 'Code langsam und deutlich Ziffer für Ziffer nennen' + (chatSent ? ' und erwähnen, dass er zusätzlich im Chat/der Gästemappe steht.' : '.'),
    })
  }

  return Response.json({
    verified: true,
    guest_first_name: firstName,
    apartment: title,
    hint: 'Verifiziert — buchungsbezogene Fragen dürfen jetzt beantwortet werden. Türcodes nur über request=tuercode.',
  })
}
