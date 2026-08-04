import { createHmac, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { findBookingByPhone, findBookingByDetails, pushOncall } from '@/lib/voice'
import { askClaude, FAST_MODEL } from '@/lib/ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * ☎️🧾 ElevenLabs Post-Call-Webhook (§183): Nach jedem Telefonat schickt
 * ElevenLabs das Transkript hierher. Wir (a) archivieren es in voice_calls
 * (Futter fürs Transkript-Lernen, Phase 2b) und (b) legen bei GAST-Anliegen
 * eine kompakte Telefonnotiz in den Buchungs-Thread — das Team sieht beim
 * nächsten Blick in den Chat, dass (und worüber) telefoniert wurde.
 * Auth: HMAC-Signatur (Env ELEVENLABS_WEBHOOK_SECRET, im ElevenLabs-
 * Webhook-Dialog erzeugt). Ohne Env → 503 (Webhook-Retry greift später).
 */

function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]))
  const t = parts['t']
  const v0 = parts['v0']
  if (!t || !v0) return false
  // Replay-Schutz 30 Min
  if (Math.abs(Date.now() / 1000 - Number(t)) > 1800) return false
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(v0))
  } catch { return false }
}

type Turn = { role?: string; message?: string | null }

export async function POST(request: Request) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET
  if (!secret) return Response.json({ error: 'ELEVENLABS_WEBHOOK_SECRET nicht konfiguriert' }, { status: 503 })

  const raw = await request.text()
  const sig = request.headers.get('elevenlabs-signature')
  if (!verifySignature(raw, sig, secret)) {
    return Response.json({ error: 'Ungültige Signatur' }, { status: 401 })
  }

  let payload: { type?: string; data?: Record<string, unknown> }
  try { payload = JSON.parse(raw) } catch { return Response.json({ ok: true, skipped: 'kein JSON' }) }
  if (payload.type !== 'post_call_transcription' || !payload.data) {
    return Response.json({ ok: true, skipped: `Event-Typ ${payload.type ?? 'unbekannt'}` })
  }

  const d = payload.data as {
    conversation_id?: string
    transcript?: Turn[]
    conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> }
  }
  const convId = String(d.conversation_id ?? '')
  if (!convId) return Response.json({ ok: true, skipped: 'keine conversation_id' })

  // Idempotenz — ElevenLabs wiederholt Webhooks bei Fehlern
  const { data: existing } = await supabaseAdmin
    .from('voice_calls').select('id').eq('conversation_id', convId).maybeSingle()
  if (existing) return Response.json({ ok: true, skipped: 'bereits verarbeitet' })

  const turns = (d.transcript ?? []).filter((t) => String(t.message ?? '').trim())
  const userTurns = turns.filter((t) => t.role === 'user').length
  const transcript = turns
    .map((t) => `${t.role === 'user' ? 'ANRUFER' : 'ASSISTENTIN'}: ${String(t.message).replace(/\s+/g, ' ').trim()}`)
    .join('\n')
    .slice(0, 12000)
  const caller = String(d.conversation_initiation_client_data?.dynamic_variables?.['system__caller_id'] ?? '').trim()

  // Auflege-ohne-Gespräch-Fälle nur archivieren, nicht analysieren
  if (userTurns < 2) {
    await supabaseAdmin.from('voice_calls').insert({
      conversation_id: convId, caller_number: caller || null,
      summary: 'Kein nennenswertes Gespräch (aufgelegt/Test).', transcript, guest_inquiry: false,
    })
    return Response.json({ ok: true, note: 'archiviert (zu kurz)' })
  }

  // Haiku: Zusammenfassung + Klassifikation + Zuordnungs-Daten in EINEM Call
  let info: {
    zusammenfassung?: string; gast_anfrage?: boolean; notfall?: boolean
    wohnung?: string | null; anreise?: string | null; abreise?: string | null; vorname?: string | null
  } = {}
  try {
    const rawOut = await askClaude(
      'Du analysierst das Transkript eines Telefonats der TRIMOSA-Ferienwohnungs-Assistentin. Antworte NUR mit einem JSON-Objekt: {"zusammenfassung": "2-4 Sätze auf Deutsch, was der Anrufer wollte und was vereinbart/beantwortet wurde", "gast_anfrage": true|false (true = Anliegen eines Gasts zu Buchung/Aufenthalt; false = Vertrieb, Verwählt, allgemeine Verfügbarkeitsanfrage ohne bestehende Buchung, Test), "notfall": true|false (true = Gast steht vor der Tür und kommt nicht in die Wohnung, Code funktioniert nicht, Wasserschaden/Strom/Verletzung, ODER die Assistentin hat versprochen, das Team sofort zu informieren, ODER das Problem war am Gesprächsende ersichtlich NICHT gelöst), "wohnung": "genannter Wohnungsname oder null", "anreise": "JJJJ-MM-TT oder null (Jahr aus Kontext, aktuell 2026)", "abreise": "JJJJ-MM-TT oder null", "vorname": "Name des Anrufers oder null"}. KEINE weiteren Texte.',
      transcript,
      1000,
      FAST_MODEL,
    )
    const m = rawOut.match(/\{[\s\S]*\}/)
    if (m) info = JSON.parse(m[0])
  } catch (e) { console.error('[call-log] analyse:', e) }

  // Buchung zuordnen: Nummer → Gesprächsdaten (gleiche Kette wie take-message)
  let booking = caller ? await findBookingByPhone(caller).catch(() => null) : null
  if (!booking && (info.wohnung || info.anreise)) {
    booking = await findBookingByDetails({
      name: info.vorname ?? '',
      apartment: info.wohnung ?? '',
      arrival: info.anreise ?? '',
      departure: info.abreise ?? '',
    }).catch(() => null)
  }

  const summary = String(info.zusammenfassung ?? '').trim() || 'Telefonat ohne auswertbare Zusammenfassung.'
  const guestInquiry = info.gast_anfrage === true

  // Buchungs-Details einmal zentral: door_code für den Code-Wächter,
  // listing_id für die Wohnungs-Zuordnung der Vorfall-Aufgabe (§246).
  let bookingDoorCode: string | null = null
  let bookingListingId: string | null = null
  if (booking) {
    const { data: b } = await supabaseAdmin
      .from('bookings').select('door_code, listing_id').eq('id', booking.id).maybeSingle()
    bookingDoorCode = (b?.door_code as string | null) ?? null
    bookingListingId = (b?.listing_id as string | null) ?? null
  }

  await supabaseAdmin.from('voice_calls').insert({
    conversation_id: convId,
    booking_id: booking?.id ?? null,
    caller_number: caller || null,
    summary,
    transcript,
    guest_inquiry: guestInquiry,
  })

  // 📝 Telefonnotiz in den Gast-Thread — nur bei Gast-Anliegen mit Buchung.
  // Wenn take-message im selben Anruf schon eine Nachricht abgelegt hat
  // (letzte 45 Min), reicht die — keine Dublette.
  let noteAdded = false
  if (booking && guestInquiry) {
    const since = new Date(Date.now() - 45 * 60000).toISOString()
    const { data: recent } = await supabaseAdmin
      .from('messages')
      .select('id')
      .eq('booking_id', booking.id)
      .gte('created_at', since)
      .ilike('content', '%Telefon%')
      .limit(1)
    if (!recent?.length) {
      const when = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })
      const { error } = await supabaseAdmin.from('messages').insert({
        booking_id: booking.id,
        sender_type: 'host',
        content: `☎️ Telefonnotiz (KI-Assistentin, ${when} Uhr):\n${summary}`,
        lang: 'de',
      })
      noteAdded = !error
    }
  }

  // 🔢 §227 CODE-WÄCHTER: Der Bot hat am 31.7. einen ERFUNDENEN Türcode
  // („842915") angesagt. Verhindern kann das nur das LLM — aber ERKENNEN
  // können wir es: Jede von der ASSISTENTIN gesprochene 6er-Ziffernfolge
  // wird gegen den echten door_code der zugeordneten Buchung geprüft.
  // Abweichung → sofortiger Bereitschafts-Push mit dem RICHTIGEN Code.
  // §246: Jeder Vorfall wandert zusätzlich in `vorfaelle` → echte ☎️-Aufgabe.
  const vorfaelle: string[] = []
  try {
    const spoken = new Set<string>()
    for (const t of turns) {
      if (t.role === 'user') continue
      for (const m of String(t.message ?? '').matchAll(/\d(?:[\s.,\-–…]{0,4}\d){5,}/g)) {
        const digits = m[0].replace(/\D/g, '')
        if (digits.length === 6) spoken.add(digits)
      }
    }
    if (spoken.size) {
      const realCode = bookingDoorCode
      const falsche = [...spoken].filter((c) => c !== realCode)
      if (falsche.length) {
        console.error('[call-log] 🚨 Bot nannte Code(s) ohne Deckung:', falsche.join(', '), 'echt:', realCode ?? '—', convId)
        vorfaelle.push(`🚨 FALSCHER TÜRCODE am Telefon genannt: ${falsche.join(', ')} — ${realCode ? `richtig ist ${realCode}` : 'zur Buchung ist KEIN Code hinterlegt'}. Gast sofort kontaktieren!`)
        await pushOncall(
          '🚨 Bot nannte FALSCHEN Türcode!',
          `Am Telefon genannt: ${falsche.join(', ')} — ${realCode ? `richtig wäre ${realCode}` : 'zur Buchung ist KEIN Code hinterlegt'}. Gast sofort kontaktieren!${caller ? ` Rückruf: ${caller}` : ''}`,
          booking ? `/team?conv=${booking.id}` : '/team?tab=aufgaben',
        ).catch((e) => console.error('[call-log] code push:', e))
      }
    }
  } catch (e) { console.error('[call-log] code check:', e) }

  // 🚨 §227 NOTFALL-SICHERHEITSNETZ (Fall Kerklingh 31.7.): Der Bot
  // BEHAUPTETE „Team ist mit höchster Priorität informiert", rief
  // nachricht_aufnehmen aber NIE auf — niemand wurde alarmiert. Erkennt
  // die Nachbereitung einen Notfall und gab es im Anruf-Zeitraum KEINE
  // take-message-Spur (Thread-Nachricht oder ☎️-Task), alarmiert der
  // SERVER die Bereitschaft — unabhängig davon, was das LLM getan hat.
  let safetyNet = false
  if (info.notfall === true) {
    const since = new Date(Date.now() - 45 * 60000).toISOString()
    let escalated = false
    if (booking) {
      const { data: m } = await supabaseAdmin
        .from('messages').select('id')
        .eq('booking_id', booking.id).gte('created_at', since)
        .ilike('content', '%Telefonnachricht%').limit(1)
      escalated = !!m?.length
    }
    if (!escalated) {
      const { data: t } = await supabaseAdmin
        .from('tasks').select('id')
        .eq('source', 'anruf').gte('created_at', since).limit(1)
      escalated = !!t?.length
    }
    if (!escalated) {
      safetyNet = true
      console.warn('[call-log] 🚨 Notfall OHNE take-message — Sicherheitsnetz-Push:', convId)
      vorfaelle.push('🚨 NOTFALL im Gespräch erkannt, aber der Bot hat KEINE Meldung ans Team ausgelöst — Anrufer wartet vermutlich noch auf Hilfe.')
      await pushOncall(
        '🚨 NOTFALL-Anruf — Bot hat NICHT eskaliert!',
        `${summary.slice(0, 150)}${caller ? ` — Rückruf: ${caller}` : ''}`,
        booking ? `/team?conv=${booking.id}` : '/team?tab=aufgaben',
      ).catch((e) => console.error('[call-log] notfall push:', e))
    }
  }

  // 📋 §246 Schicht 2: Jeder Vorfall wird zusätzlich zum flüchtigen Push als
  // ECHTE ☎️-Aufgabe angelegt (source 'anruf') — erst dadurch erscheint die
  // Anruf-Karte mit 📞 Rückruf / 🤖 KI-Rückruf / ✨-Lösungsvorschlägen im
  // Aufgaben-Tab. Beim Grünsfelder-Vorfall (4.8.) gab es nur Pushes und
  // damit keine Rückruf-Werkstatt in der App.
  let taskCreated = false
  if (vorfaelle.length) {
    const wer = [info.vorname, booking?.listingTitle].filter(Boolean).join(' · ')
    const { error: taskErr } = await supabaseAdmin.from('tasks').insert({
      title: `🚨 Anruf-Vorfall: ${wer || caller || 'unbekannter Anrufer'}`.slice(0, 120),
      description: [
        ...vorfaelle,
        '',
        `Zusammenfassung: ${summary}`,
        caller ? `Rückrufnummer: ${caller}` : 'Rückrufnummer unbekannt (unterdrückt/Browser-Test)',
        `Erkannt vom Anruf-Sicherheitsnetz am ${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} — Transkript unter Mehr → Telefonate.`,
      ].join('\n').slice(0, 2000),
      source: 'anruf',
      source_ref: caller || null,
      listing_id: bookingListingId,
      is_general: !bookingListingId,
      prio: 'hoch',
      status: 'offen',
      visibility: 'team',
    })
    taskCreated = !taskErr
    if (taskErr) console.error('[call-log] vorfall-task:', taskErr.message)
  }

  console.log('[call-log] verarbeitet:', convId, 'booking:', booking?.id ?? '—', 'gast_anfrage:', guestInquiry, 'notiz:', noteAdded, 'sicherheitsnetz:', safetyNet, 'vorfall-task:', taskCreated)
  return Response.json({ ok: true, booking: booking?.id ?? null, note: noteAdded, safetyNet, taskCreated })
}
