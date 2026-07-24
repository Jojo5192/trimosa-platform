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
    arrival_date?: string; departure_date?: string; apartment_name?: string; request?: string
  }
  try { body = await request.json() } catch { body = {} }

  const caller = String(body.caller_number ?? '').trim()
  const codeIn = String(body.door_code ?? '').replace(/\D/g, '')
  const lastName = String(body.last_name ?? '').trim().toLowerCase()
  const arrival = String(body.arrival_date ?? '').trim()
  const departure = String(body.departure_date ?? '').trim()
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

  // Website-Buchungen tragen den Namen oft nur im PROFIL (guest_name null).
  // Zwei getrennte Queries statt or() — Sonderzeichen/Umlaute im or()-String
  // sind eine bekannte PostgREST-Falle (§134-Lektion).
  if (!booking && lastName && /^\d{4}-\d{2}-\d{2}$/.test(arrival)) {
    try {
      const [byDisplay, byLast] = await Promise.all([
        supabaseAdmin.from('profiles').select('id').ilike('display_name', `%${lastName}%`).limit(10),
        supabaseAdmin.from('profiles').select('id').ilike('guest_last_name', `%${lastName}%`).limit(10),
      ])
      const ids = [...new Set([...(byDisplay.data ?? []), ...(byLast.data ?? [])].map((p) => String(p.id)))]
      if (ids.length) {
        const { data } = await supabaseAdmin
          .from('bookings')
          .select('id, guest_name, guest_id, check_in, check_out, door_code, portal_token, listings(title)')
          .eq('status', 'confirmed')
          .eq('check_in', arrival)
          .in('guest_id', ids)
          .limit(3)
        const rows = (data ?? []) as unknown as (BRow & { guest_id: string | null })[]
        const filtered = apartment
          ? rows.filter((r) => String(r.listings?.title ?? '').toLowerCase().includes(apartment))
          : rows
        // Profil-Treffer = Name bereits geprüft → guest_name-Lücke überbrücken
        if (filtered.length === 1) booking = { ...filtered[0], guest_name: filtered[0].guest_name ?? lastName }
      }
    } catch { /* best effort */ }
  }

  if (!booking) {
    return Response.json({
      verified: false,
      hint: 'Keine passende Buchung gefunden. Nachname, Anreisedatum und ggf. Wohnung erfragen — oder das Anliegen per nachricht_aufnehmen ans Team geben.',
    })
  }

  // ── Verifizieren (§180, Inhaber: „nicht so streng — wie ein Mensch") ──
  // Wege: (a) Zugangscode · (b) Name (Vor- ODER Nachname reicht) + Anreise-
  // UND Abreisedatum · (c) per Rufnummer gefundene Buchung + Anreisedatum
  // (die bekannte Nummer ist selbst ein Identitätsfaktor).
  const codeOk = !!booking.door_code && codeIn.length >= 5 && codeIn === booking.door_code
  const guestFull = (booking.guest_name ?? '').trim().toLowerCase()
  let nameOk = !!lastName && guestFull.includes(lastName)
  // Website-Buchungen tragen den Namen oft nur im Profil
  if (!nameOk && lastName) {
    try {
      const { data: b2 } = await supabaseAdmin
        .from('bookings').select('guest_id').eq('id', booking.id).maybeSingle()
      if (b2?.guest_id) {
        const { data: prof } = await supabaseAdmin
          .from('profiles').select('display_name, guest_last_name').eq('id', b2.guest_id).maybeSingle()
        const profNames = `${prof?.display_name ?? ''} ${prof?.guest_last_name ?? ''}`.toLowerCase()
        if (profNames.includes(lastName)) nameOk = true
      }
    } catch { /* best effort */ }
  }
  const arrivalOk = /^\d{4}-\d{2}-\d{2}$/.test(arrival) && arrival === booking.check_in
  const departureOk = /^\d{4}-\d{2}-\d{2}$/.test(departure) && departure === booking.check_out
  const dataOk = (nameOk && arrivalOk && departureOk) || (arrivalOk && !!byPhone)

  if (!codeOk && !dataOk) {
    return Response.json({
      verified: false,
      hint: 'Angaben passen nicht zur Buchung. EINE beiläufige Rückfrage (fehlt Abreisedatum oder Name?) oder die andere Methode anbieten (Zugangscode). Danach: Team-Rückruf via nachricht_aufnehmen.',
    })
  }

  const firstName = (booking.guest_name ?? '').split(/\s+/)[0] ?? ''
  const title = booking.listings?.title ?? 'deiner Wohnung'

  // ── Türcode-Anfrage (§180, Inhaber-Policy): Ab ANREISETAG bis Ende
  //    Abreisetag wird der Code ganz normal am Telefon genannt (Gast ist
  //    vor Ort). VOR der Anreise: nicht nennen — Gästemappen-Link in den
  //    Chat senden, Code erscheint dort automatisch im Reveal-Fenster.
  if (wants === 'tuercode') {
    const staying = booking.check_in <= today && booking.check_out >= today
    const mappe = booking.portal_token ? `https://trimosa.de/mappe/${booking.portal_token}` : null

    if (booking.check_out < today) {
      return Response.json({
        verified: true, guest_first_name: firstName, apartment: title,
        hint: 'Der Aufenthalt ist bereits beendet — Codes sind abgelaufen. Anliegen ggf. per nachricht_aufnehmen ans Team.',
      })
    }

    if (!staying) {
      // Vor der Anreise: Mappe-Link in den Chat, Code kommt automatisch
      let chatSent = false
      try {
        const content = [
          `📖 Wie eben am Telefon besprochen: Hier nochmal der Link zu deiner Gästemappe${mappe ? ` — ${mappe}` : ' (der Link kam mit deiner Buchung)'}.`,
          'Dein Türcode erscheint dort automatisch wenige Tage vor der Anreise.',
        ].join('\n')
        const { error } = await supabaseAdmin.from('messages').insert({
          booking_id: booking.id, sender_type: 'host', content, lang: 'de',
        })
        chatSent = !error
      } catch { /* best effort */ }
      return Response.json({
        verified: true, guest_first_name: firstName, apartment: title,
        mappe_link_sent: chatSent,
        hint: 'Code jetzt noch NICHT nennen (Anreise liegt in der Zukunft). Dem Gast sagen: Der Code erscheint automatisch wenige Tage vor der Anreise in der Gästemappe' + (chatSent ? ' — den Mappen-Link haben wir ihm gerade nochmal in den Chat geschickt.' : ' (Link kam mit der Buchung).'),
      })
    }

    // Aufenthalt läuft (Anreisetag bis Abreisetag): Code nennen
    let code = booking.door_code
    if (!code) {
      try {
        const { ensureDoorCode } = await import('@/lib/locks')
        code = await ensureDoorCode(booking.id)
      } catch (e) { console.error('[voice-verify] ensureDoorCode:', e) }
    }
    if (!code) {
      return Response.json({
        verified: true, guest_first_name: firstName, apartment: title,
        hint: 'Kein Code verfügbar (technisches Problem) — per nachricht_aufnehmen mit urgent=true SOFORT ans Team, der Gast wartet vermutlich vor der Tür.',
      })
    }

    let chatSent = false
    try {
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
      hint: 'Code langsam und deutlich Ziffer für Ziffer nennen' + (chatSent ? ' — und erwähnen, dass er zusätzlich im Chat und in der Gästemappe steht.' : '.'),
    })
  }

  return Response.json({
    verified: true,
    guest_first_name: firstName,
    apartment: title,
    hint: 'Verifiziert — buchungsbezogene Fragen dürfen jetzt beantwortet werden. Türcodes nur über request=tuercode.',
  })
}
