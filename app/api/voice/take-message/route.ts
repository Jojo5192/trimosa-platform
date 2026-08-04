import { requireVoiceAuth, findBookingByPhone, findBookingByDetails, pushOncall } from '@/lib/voice'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * ☎️ Anrufbot-Tool (§175): POST { caller_name, caller_number, message,
 * urgent } — nimmt eine Nachricht aus dem Telefonat auf. Gehört die
 * Rufnummer zu einer Buchung, landet sie als Gast-Nachricht im
 * Buchungs-Thread (→ Team-Inbox, „unbeantwortet"-Logik greift), sonst
 * als Team-Aufgabe. In beiden Fällen geht ein Push raus (§135: awaited).
 */
export async function POST(request: Request) {
  const denied = requireVoiceAuth(request)
  if (denied) return denied

  let body: {
    caller_name?: string; caller_number?: string; message?: string; urgent?: boolean
    apartment_name?: string; arrival_date?: string; departure_date?: string
    callback_number?: string
  }
  try { body = await request.json() } catch { body = {} }
  const name = String(body.caller_name ?? '').trim() || 'Unbekannt'
  // §224: Bei unterdrückter/fehlender Anrufer-ID fragt der Bot nach einer
  // Rückrufnummer (callback_number) — die gewinnt für den Rückruf.
  const callerId = String(body.caller_number ?? '').trim()
  const spoken = String(body.callback_number ?? '').replace(/[^+\d\s()/-]/g, '').trim()
  const number = spoken || callerId || 'unterdrückt'
  const message = String(body.message ?? '').trim()
  const urgent = body.urgent === true
  if (!message) return Response.json({ error: 'message fehlt' }, { status: 400 })

  // Buchung zuordnen: erst Anrufer-Nummer, dann Gesprächsdaten (§182 —
  // „Frank, Magnolia Flat, 18.–20.7." reicht, auch ohne bekannte Nummer)
  let booking = callerId ? await findBookingByPhone(callerId) : (spoken ? await findBookingByPhone(spoken) : null)
  if (!booking) {
    booking = await findBookingByDetails({
      name: name !== 'Unbekannt' ? name : '',
      apartment: body.apartment_name,
      arrival: body.arrival_date,
      departure: body.departure_date,
    })
  }
  const icon = urgent ? '🚨' : '☎️'

  if (booking) {
    const content = [
      `☎️ Telefonnachricht (vom Telefon-Assistenten aufgenommen):`,
      `„${message}"`,
      '',
      `Anrufer: ${name} · Rückruf: ${number}`,
    ].join('\n')
    const { error } = await supabaseAdmin.from('messages').insert({
      booking_id: booking.id,
      sender_type: 'guest',
      content,
      lang: 'de',
    })
    if (error) {
      console.error('[voice] take-message Insert:', error.message)
      return Response.json({ error: 'Speichern fehlgeschlagen' }, { status: 500 })
    }
    await pushOncall(
      `${icon} Anruf: ${booking.guestName.split(/\s+/)[0] ?? name} · ${booking.listingTitle}`,
      message.replace(/\s+/g, ' ').slice(0, 120),
      '/team?conv=' + booking.id,
    ).catch(() => {})

    // §246f: Bei DRINGENDEN Anliegen reicht die Chat-Nachricht NICHT — der
    // Gast wartet auf einen Rückruf, und die Rückruf-Werkstatt (📞-Anrufen,
    // 🤖 KI-Rückruf, ✨-Vorschläge) hängt an einer echten ☎️-Aufgabe.
    // Ohne sie sah das Team am 4.8. nur eine Chat-Zeile und hatte KEINEN
    // Weg, aus der App heraus zurückzurufen.
    let taskId: string | null = null
    if (urgent) {
      const { data: t, error: tErr } = await supabaseAdmin.from('tasks').insert({
        title: `🚨 Notfall-Anruf: ${booking.guestName.split(/\s+/)[0] || name} · ${booking.listingTitle}`.slice(0, 120),
        description: [
          message,
          '',
          `Anrufer: ${name}`,
          `Rückrufnummer: ${number}`,
          `Gast: ${booking.guestName} · ${booking.listingTitle} · ${booking.checkIn} bis ${booking.checkOut}`,
          `Aufgenommen vom Telefon-Assistenten am ${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} — der Verlauf steht im Gast-Chat.`,
        ].join('\n').slice(0, 2000),
        source: 'anruf',
        source_ref: number !== 'unterdrückt' ? number : null,
        listing_id: booking.listingId,
        is_general: !booking.listingId,
        prio: 'hoch',
        status: 'offen',
        visibility: 'team',
      }).select('id').maybeSingle()
      if (tErr) console.error('[voice] take-message Notfall-Task:', tErr.message)
      else taskId = (t?.id as string | null) ?? null
    }
    return Response.json({
      ok: true,
      delivered: 'chat',
      task_created: !!taskId,
      note: urgent
        ? 'Nachricht liegt im Gast-Thread, eine dringende Aufgabe mit Rückrufnummer wurde angelegt und das Team benachrichtigt.'
        : 'Nachricht liegt im Gast-Thread, das Team wurde benachrichtigt.',
    })
  }

  // Keine Buchung eindeutig? Dann wenigstens die WOHNUNG der Aufgabe
  // zuordnen (statt „Allgemein") — Titel-Match gegen apartment_name + Text.
  let listingId: string | null = null
  try {
    const { data: listings } = await supabaseAdmin
      .from('listings').select('id, title').eq('is_active', true)
    const hay = `${String(body.apartment_name ?? '')} ${message}`.toLowerCase()
    const hits = (listings ?? []).filter((l) => {
      const t = String(l.title ?? '').toLowerCase()
      const first = t.split(/\s+/)[0] ?? ''
      return (t.length >= 3 && hay.includes(t)) || (first.length >= 4 && hay.includes(first))
    })
    if (hits.length === 1) listingId = String(hits[0].id)
  } catch { /* best effort */ }

  const { error } = await supabaseAdmin.from('tasks').insert({
    title: `${urgent ? '🚨 Notfall-Anruf' : '☎️ Anruf'}: ${name}`.slice(0, 120),
    description: [
      message,
      '',
      `Anrufer: ${name}`,
      `Rückrufnummer: ${number}`,
      `Aufgenommen vom Telefon-Assistenten am ${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}`,
    ].join('\n').slice(0, 2000),
    source: 'anruf',
    // Rückrufnummer strukturiert fürs tel:-Link der Anruf-Sektion (§175)
    source_ref: number !== 'unterdrückt' ? number : null,
    listing_id: listingId,
    is_general: !listingId,
    // Telefonische Meldungen sind IMMER dringlich — ein Gast wartet auf Rückmeldung
    prio: 'hoch',
    status: 'offen',
    visibility: 'team',
  })
  if (error) {
    console.error('[voice] take-message Task:', error.message)
    return Response.json({ error: 'Speichern fehlgeschlagen' }, { status: 500 })
  }
  await pushOncall(
    `${icon} Neue Anruf-Nachricht: ${name}`,
    message.replace(/\s+/g, ' ').slice(0, 120),
    '/team?tab=aufgaben',
  ).catch(() => {})
  return Response.json({ ok: true, delivered: 'task', note: 'Als Aufgabe fürs Team hinterlegt, Push ist raus.' })
}
