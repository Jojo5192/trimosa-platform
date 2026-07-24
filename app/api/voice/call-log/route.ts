import { createHmac, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { findBookingByPhone, findBookingByDetails } from '@/lib/voice'
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
    zusammenfassung?: string; gast_anfrage?: boolean
    wohnung?: string | null; anreise?: string | null; abreise?: string | null; vorname?: string | null
  } = {}
  try {
    const rawOut = await askClaude(
      'Du analysierst das Transkript eines Telefonats der TRIMOSA-Ferienwohnungs-Assistentin. Antworte NUR mit einem JSON-Objekt: {"zusammenfassung": "2-4 Sätze auf Deutsch, was der Anrufer wollte und was vereinbart/beantwortet wurde", "gast_anfrage": true|false (true = Anliegen eines Gasts zu Buchung/Aufenthalt; false = Vertrieb, Verwählt, allgemeine Verfügbarkeitsanfrage ohne bestehende Buchung, Test), "wohnung": "genannter Wohnungsname oder null", "anreise": "JJJJ-MM-TT oder null (Jahr aus Kontext, aktuell 2026)", "abreise": "JJJJ-MM-TT oder null", "vorname": "Name des Anrufers oder null"}. KEINE weiteren Texte.',
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

  console.log('[call-log] verarbeitet:', convId, 'booking:', booking?.id ?? '—', 'gast_anfrage:', guestInquiry, 'notiz:', noteAdded)
  return Response.json({ ok: true, booking: booking?.id ?? null, note: noteAdded })
}
