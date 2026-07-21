import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { askClaude, FAST_MODEL } from '@/lib/ai'
import { updateReservation } from '@/lib/smoobu'

/**
 * 📬 Inbound-Mail-Pipeline (§127): Buchungs-Bestätigungsmails der Portale
 * (v. a. FeWo-direkt/Vrbo — Smoobu bekommt dort weder Preis noch Gästezahl)
 * werden per Postfach-Weiterleitung an eine Resend-Receiving-Adresse
 * geschickt. Resend parst die Mail und ruft diesen Webhook. Claude
 * extrahiert die Buchungsdaten, wir verknüpfen sie mit der passenden
 * Buchung, füllen LEERE Felder in unserer DB und schreiben Preis/Gäste
 * per PUT auch nach Smoobu zurück — kein Handeintrag mehr.
 *
 * Setup (Inhaber): Resend → Inbound-Adresse anlegen → Webhook
 * `email.received` auf https://trimosa.de/api/inbound-mail → Signing
 * Secret als RESEND_WEBHOOK_SECRET in Vercel → Outlook-Regel: Mails von
 * fewo-direkt/vrbo/homeaway an die Inbound-Adresse weiterleiten.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** Svix-Signatur (Resend-Webhooks): HMAC-SHA256 über "id.timestamp.payload". */
function verifySvix(req: NextRequest, payload: string): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) return false
  const id = req.headers.get('svix-id')
  const ts = req.headers.get('svix-timestamp')
  const sigHeader = req.headers.get('svix-signature')
  if (!id || !ts || !sigHeader) return false
  // Replay-Schutz: Timestamp max. 5 Minuten alt
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${payload}`).digest('base64')
  return sigHeader.split(' ').some((part) => {
    const sig = part.split(',')[1] ?? ''
    try {
      const a = Buffer.from(sig, 'base64')
      const b = Buffer.from(expected, 'base64')
      return a.length === b.length && timingSafeEqual(a, b)
    } catch { return false }
  })
}

/** Gast-Nachricht aus einer Portal-Mail in den Chat-Thread der Buchung
 *  einsortieren (Dedupe über identischen Inhalt — dieselbe Nachricht kann
 *  auch über den Smoobu-Sync ankommen) + Team-Push. §129 */
async function saveGuestMessage(bookingId: string, guestName: string | null, text: string): Promise<boolean> {
  const { data: dupe } = await supabaseAdmin
    .from('messages').select('id')
    .eq('booking_id', bookingId).eq('sender_type', 'guest').eq('content', text).limit(1)
  if (dupe?.length) return false
  const { error } = await supabaseAdmin.from('messages')
    .insert({ booking_id: bookingId, sender_type: 'guest', content: text })
  if (error) { console.error('[inbound-mail] Nachricht-Insert:', error.message); return false }
  try {
    const { sendPushToTeam } = await import('@/lib/push')
    await sendPushToTeam(
      `💬 ${guestName ?? 'Gast'} · FeWo-Mail`,
      text.replace(/\s+/g, ' ').slice(0, 120),
      '/team?conv=' + bookingId,
      { guestChat: true },
    )
  } catch { /* Push best effort */ }
  return true
}

/**
 * §134: Antwort-Mail eines WEBSITE-Gasts (privater Absender, kein Portal) —
 * über die Absender-Adresse dem Gast-Konto bzw. der Buchung zuordnen und
 * als Chat-Nachricht einsortieren (Direkt-Chat wenn eine Konversation
 * existiert, sonst Buchungs-Thread). Nicht zuordenbare Mails werden nur
 * geloggt — das ist zugleich der Spam-Filter für das umgeleitete Postfach.
 */
async function handleWebsiteGuestReply(fromRaw: string, rawText: string): Promise<NextResponse> {
  const email = ((fromRaw.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/) || [])[0] ?? '').toLowerCase()
  if (!email || /no-?reply|mailer-daemon|postmaster|notification|newsletter/i.test(email)) {
    return NextResponse.json({ ok: true, skipped: 'kein Portal, kein Gast-Absender' })
  }

  // Gast-Konto über die Login-Mail finden (kleine Nutzerbasis → Seiten-Scan)
  let guestId: string | null = null
  try {
    for (let page = 1; page <= 5; page++) {
      const { data: pageData } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 })
      const hit = pageData?.users?.find((u) => (u.email ?? '').toLowerCase() === email)
      if (hit) { guestId = hit.id; break }
      if (!pageData || pageData.users.length < 200) break
    }
  } catch { /* fail-soft — guest_email-Match unten bleibt */ }

  // Passende Buchung: aktive laufend/kommend bevorzugt, sonst jüngste (Abreise
  // ≤30 Tage her). Stornierte Buchungen sind LETZTER Fallback — Gäste schreiben
  // auch nach einem Storno (Erstattungsfragen), die Mail soll nicht verschwinden.
  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
  const baseSelect = 'id, guest_id, guest_name, status, check_in, check_out, conversations(id, guest_id)'
  const [byId, byEmail] = await Promise.all([
    guestId
      ? supabaseAdmin.from('bookings').select(baseSelect).gte('check_out', since).eq('guest_id', guestId).order('check_in', { ascending: true }).limit(10)
      : Promise.resolve({ data: [] as never[] }),
    supabaseAdmin.from('bookings').select(baseSelect).gte('check_out', since).eq('guest_email', email).order('check_in', { ascending: true }).limit(10),
  ])
  type BRow = { id: string; guest_id: string | null; guest_name: string | null; status: string; check_in: string; check_out: string; conversations: unknown }
  const seen = new Set<string>()
  const cands = ([...(byId.data ?? []), ...(byEmail.data ?? [])] as BRow[]).filter((b) => !seen.has(b.id) && seen.add(b.id))
  const today = new Date().toISOString().slice(0, 10)
  const pick = (list: BRow[]) => list.find((b) => b.check_out >= today) ?? list[list.length - 1] ?? null
  const booking = pick(cands.filter((b) => b.status !== 'cancelled')) ?? pick(cands)
  if (!booking) {
    console.log('[inbound-mail] Gast-Mail ohne zuordenbare Buchung:', email)
    return NextResponse.json({ ok: true, skipped: 'Absender keiner Buchung zuordenbar' })
  }

  // Nur den NEUEN Text des Gasts extrahieren (ohne zitierte Mail/Signatur)
  let text = ''
  try {
    const raw = await askClaude(
      'Du bekommst die E-Mail-ANTWORT eines Feriengasts an seinen Gastgeber. Extrahiere NUR den neuen Nachrichtentext des Gasts — OHNE zitierte Vorgängermail, OHNE Signatur-Blöcke und Fußzeilen (eine Grußformel des Gasts darf bleiben). Gib AUSSCHLIESSLICH diesen Text zurück. Enthält die Mail keine echte persönliche Nachricht (Abwesenheitsnotiz, leere Mail, Werbung), antworte exakt: LEER',
      rawText.slice(0, 8000), 1200, FAST_MODEL,
    )
    text = raw.trim()
  } catch (e) {
    console.error('[inbound-mail] Gast-Mail-Extraktion:', e)
    return NextResponse.json({ ok: true, skipped: 'Extraktion fehlgeschlagen' })
  }
  if (!text || /^LEER\.?$/i.test(text)) {
    return NextResponse.json({ ok: true, skipped: 'kein Nachrichtentext (Auto-Reply o. ä.)' })
  }

  const convRaw = booking.conversations
  const conv = (Array.isArray(convRaw) ? convRaw[0] : convRaw) as { id: string; guest_id: string | null } | null
  if (conv?.id && (conv.guest_id ?? guestId)) {
    // Direkt-Chat-Welt (Website-Gast mit Konversation)
    const { data: dupe } = await supabaseAdmin
      .from('messages').select('id').eq('conversation_id', conv.id).eq('content', text).limit(1)
    if (dupe?.length) return NextResponse.json({ ok: true, skipped: 'Duplikat' })
    const { data: inserted, error } = await supabaseAdmin.from('messages')
      .insert({ conversation_id: conv.id, sender_id: conv.guest_id ?? guestId, content: text })
      .select('id').single()
    if (error) return NextResponse.json({ ok: false, error: error.message })
    await supabaseAdmin.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conv.id)
    try {
      const { translateIncoming } = await import('@/lib/translate')
      if (inserted) await translateIncoming([{ id: inserted.id, text }])
    } catch { /* best effort */ }
    try {
      const { sendPushToTeam } = await import('@/lib/push')
      await sendPushToTeam(`💬 ${booking.guest_name ?? 'Gast'} · E-Mail`, text.replace(/\s+/g, ' ').slice(0, 120), '/team?conv=' + conv.id, { guestChat: true })
    } catch { /* best effort */ }
    console.log('[inbound-mail] Website-Gast-Mail → Direkt-Chat:', { conv: conv.id, email })
    return NextResponse.json({ ok: true, conversationId: conv.id })
  }

  // Ohne Konversation: booking-Welt — der Thread erscheint in der Team-Inbox
  const saved = await saveGuestMessage(booking.id, booking.guest_name, text)
  console.log('[inbound-mail] Website-Gast-Mail → Buchungs-Thread:', { booking: booking.id, email, neu: saved })
  return NextResponse.json({ ok: true, bookingId: booking.id, nachricht: saved })
}

const stripHtml = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s{3,}/g, '\n')

export async function POST(req: NextRequest) {
  const payload = await req.text()
  if (!process.env.RESEND_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'RESEND_WEBHOOK_SECRET fehlt (Vercel-Env).' }, { status: 503 })
  }
  if (!verifySvix(req, payload)) {
    return NextResponse.json({ error: 'Ungültige Signatur.' }, { status: 401 })
  }

  let body: Record<string, unknown> = {}
  try { body = JSON.parse(payload) } catch { return NextResponse.json({ error: 'Kein JSON.' }, { status: 400 }) }
  if (body.type !== 'email.received') return NextResponse.json({ ok: true, skipped: 'kein email.received' })

  const data = (body.data ?? {}) as Record<string, unknown>
  const from = String(data.from ?? '')
  const subject = String(data.subject ?? '')
  // Payload-Form beim ersten Live-Fall kalibrieren — Struktur mitloggen
  console.log('[inbound-mail] received:', { from: from.slice(0, 80), subject: subject.slice(0, 120), keys: Object.keys(data) })

  // Resend-Webhooks enthalten NUR Metadaten — der Mail-Body wird über die
  // Received-Emails-API nachgeladen (GET /emails/receiving/:email_id)
  let rawText = String(data.text ?? '') || stripHtml(String(data.html ?? ''))
  // Gast-RELAY-Adresse (FeWo/Vrbo-Mail-Bridge, §128): Bei „Umleiten"-Regeln
  // bleiben die Original-Header erhalten — Reply-To trägt die buchungs-
  // spezifische Adresse, über die Smoobu den Gast anschreiben kann
  let relayEmail = ''
  const emailId = String(data.email_id ?? '')
  if (emailId && process.env.RESEND_API_KEY) {
    try {
      const r = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      })
      if (r.ok) {
        const full = await r.json() as Record<string, unknown>
        if (rawText.trim().length < 80) {
          rawText = String(full.text ?? '') || stripHtml(String(full.html ?? ''))
          if (!rawText.trim()) console.error('[inbound-mail] Body-Nachladen leer — Keys:', Object.keys(full))
        }
        // Reply-To aus allen plausiblen Feldern einsammeln (Schema defensiv)
        const headers = (full.headers ?? {}) as Record<string, unknown>
        const replyRaw = [full.reply_to, full.replyTo, headers['reply-to'], headers['Reply-To'], full.from, data.from]
          .flat().filter(Boolean).map(String).join(' ')
        const m = replyRaw.match(/[\w.+-]+@messages\.homeaway\.com/i)
        if (m && !/^(sender|no-?reply)@/i.test(m[0])) relayEmail = m[0]
        console.log('[inbound-mail] reply-to-ernte:', { replyRaw: replyRaw.slice(0, 160), relayEmail: relayEmail || '—' })
      } else {
        console.error('[inbound-mail] Body-Nachladen HTTP', r.status)
      }
    } catch (e) {
      console.error('[inbound-mail] Body-Nachladen fehlgeschlagen:', e)
    }
  }
  if (rawText.trim().length < 80) {
    console.error('[inbound-mail] Mail-Body leer/zu kurz — Payload-Keys:', Object.keys(data))
    return NextResponse.json({ ok: true, skipped: 'kein Mail-Text verfügbar' })
  }

  // Kein Portal-Absender → Antwort-Mail eines WEBSITE-Gasts? (§134 — der
  // Gast antwortet einfach auf unsere Bestätigungs-Mail von buchung@)
  const relevant = /fewo-direkt|homeaway|vrbo|booking\.com|airbnb/i.test(from + ' ' + subject)
  if (!relevant) return handleWebsiteGuestReply(from, rawText)

  // ── Claude extrahiert die Buchungsdaten ──
  const system = `Du extrahierst Buchungsdaten aus der Bestätigungs-E-Mail eines
Ferienwohnungs-Portals (FeWo-direkt/Vrbo, Booking.com, Airbnb …).
Antworte AUSSCHLIESSLICH mit einem JSON-Objekt (kein Markdown):
{
  "portal": "fewo-direkt" | "booking" | "airbnb" | "sonstige",
  "reservierungs_nr": "<z. B. HA-0P0GG8, null wenn nicht da>",
  "objekt_nr": "<Objekt-/Property-Nummer, nur Ziffern, z. B. 5239880, null>",
  "gast_name": "<buchende Person>",
  "urlauber_name": "<reisende Person, falls abweichend, sonst null>",
  "checkin": "YYYY-MM-DD",
  "checkout": "YYYY-MM-DD",
  "erwachsene": <Zahl|null>,
  "kinder": <Zahl|null>,
  "telefon": "<mit Ländervorwahl, null>",
  "email": "<null wenn nicht da>",
  "nachricht": "<NUR wenn die Mail eine persönliche NACHRICHT oder Anfrage des GASTS enthält: deren reiner Text ohne Fußzeilen/Buttons/Systemtext, sonst null>",
  "buchungsbetrag": <Zahl in Euro — der Betrag OHNE Gäste-Servicegebühr, den der Vermieter ansetzt ("Buchungsbetrag"), null>,
  "auszahlung": <geschätzte Auszahlung an den Vermieter, null>,
  "storniert": <true wenn die Mail eine STORNIERUNG bestätigt, sonst false>
}
Regeln: NUR Werte aus der Mail, nichts raten. Jahreszahlen aus dem Kontext
ableiten (Mail-Datum). Deutsche Zahlen ("465,00 €") als 465.0 ausgeben.`

  let parsed: Record<string, unknown> = {}
  try {
    const raw = await askClaude(system, rawText.slice(0, 12000), 2000)
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim())
  } catch (e) {
    console.error('[inbound-mail] KI-Extraktion fehlgeschlagen:', e)
    return NextResponse.json({ ok: false, error: 'Extraktion fehlgeschlagen' })
  }
  // STORNO-Mails komplett ignorieren — Stornierungen laufen wie gehabt
  // über den Smoobu-Webhook (der setzt die Buchung auf cancelled); eine
  // Storno-Bestätigung darf hier nichts anreichern
  if (parsed.storniert === true) {
    return NextResponse.json({ ok: true, skipped: 'Storno-Mail — wird vom Smoobu-Webhook behandelt' })
  }
  // Die Relay-Adresse aus dem Reply-To ist die Adresse, über die der Gast
  // tatsächlich erreichbar ist — sie schlägt eine evtl. im Text gefundene
  if (relayEmail) parsed.email = relayEmail

  const checkin = String(parsed.checkin ?? '')
  const checkout = String(parsed.checkout ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkin) || !/^\d{4}-\d{2}-\d{2}$/.test(checkout)) {
    // Gast-NACHRICHT statt Buchungsbestätigung: kein Zeitraum in der Mail,
    // aber ggf. eine Relay-Adresse im Reply-To und/oder ein Nachrichtentext →
    // Buchung über den Gastnamen zuordnen (nur bei EINDEUTIGEM Treffer unter
    // laufenden/kommenden Buchungen), Relay nach Smoobu, Text in den Chat (§129)
    const msgText = typeof parsed.nachricht === 'string' ? parsed.nachricht.trim() : ''
    if (relayEmail || msgText.length >= 3) {
      const first = String(parsed.gast_name ?? '').trim().toLowerCase().split(/\s+/)[0]
      if (first) {
        const today = new Date().toISOString().slice(0, 10)
        const { data: open } = await supabaseAdmin
          .from('bookings')
          .select('id, guest_name, guest_email, smoobu_reservation_id')
          .gte('check_out', today).neq('status', 'cancelled').limit(200)
        const hits = (open ?? []).filter((b) => (b.guest_name ?? '').toLowerCase().startsWith(first))
        if (hits.length === 1) {
          const b = hits[0]
          if (relayEmail && !b.guest_email) await supabaseAdmin.from('bookings').update({ guest_email: relayEmail }).eq('id', b.id)
          const sm = relayEmail
            ? b.smoobu_reservation_id
              ? await updateReservation(Number(b.smoobu_reservation_id), { email: relayEmail })
              : 'keine smoobu_reservation_id'
            : 'keine relay-adresse'
          const saved = msgText.length >= 3 ? await saveGuestMessage(b.id, b.guest_name, msgText) : false
          console.log('[inbound-mail] Gastnachricht/Relay:', { booking: b.id, relayEmail: relayEmail || '—', nachricht: saved, smoobu: sm ?? 'ok' })
          return NextResponse.json({ ok: true, bookingId: b.id, relay: relayEmail || null, nachricht: saved, smoobu: sm ?? 'ok' })
        }
        console.log('[inbound-mail] Gastnachricht/Relay ohne eindeutige Buchung:', { first, treffer: hits.length, relayEmail })
      }
    }
    return NextResponse.json({ ok: true, skipped: 'kein Zeitraum erkannt', parsed })
  }

  // ── Buchung finden: 1) Listing über Portal-Objektnummer in der URL,
  //    2) Zeitraum (+ Kanal-Heuristik als Fallback) ──
  const { data: listings } = await supabaseAdmin
    .from('listings').select('id, title, vrbo_url, booking_url, airbnb_url, smoobu_id').eq('is_active', true)
  const objektNr = String(parsed.objekt_nr ?? '').replace(/\D/g, '')
  const listing = objektNr
    ? (listings ?? []).find((l) => [l.vrbo_url, l.booking_url, l.airbnb_url].some((u) => (u ?? '').includes(objektNr)))
    : null

  let q = supabaseAdmin
    .from('bookings')
    .select('id, listing_id, smoobu_reservation_id, total_price, adults, children, guest_name, guest_email, channel, status')
    .eq('check_in', checkin).eq('check_out', checkout).neq('status', 'cancelled')
  if (listing) q = q.eq('listing_id', listing.id)
  const { data: cands } = await q.limit(5)
  const candList = cands ?? []
  let booking: (typeof candList)[number] | null = candList[0] ?? null
  if (candList.length > 1) {
    // mehrere Buchungen im Zeitraum → über den Vornamen des Buchenden eingrenzen
    const first = String(parsed.gast_name ?? '').trim().toLowerCase().split(/\s+/)[0]
    booking = candList.find((b) => (b.guest_name ?? '').toLowerCase().startsWith(first)) ?? null
  }
  if (!booking) {
    console.log('[inbound-mail] keine passende Buchung:', { checkin, checkout, objektNr, kandidaten: (cands ?? []).length })
    return NextResponse.json({ ok: true, skipped: 'keine passende Buchung gefunden', parsed })
  }

  // ── Unsere Buchung anreichern (nur LEERE Felder — nie überschreiben) ──
  const upd: Record<string, unknown> = {}
  const preis = typeof parsed.buchungsbetrag === 'number' ? Math.round(parsed.buchungsbetrag) : null
  if (preis && (!booking.total_price || booking.total_price === 0)) upd.total_price = preis
  if (typeof parsed.erwachsene === 'number' && parsed.erwachsene > 0 && (booking.adults == null || booking.adults <= 1)) upd.adults = parsed.erwachsene
  if (typeof parsed.kinder === 'number' && (booking.children == null || booking.children === 0) && parsed.kinder > 0) upd.children = parsed.kinder
  if (typeof parsed.email === 'string' && parsed.email.includes('@') && !booking.guest_email) upd.guest_email = parsed.email
  if (Object.keys(upd).length) {
    await supabaseAdmin.from('bookings').update(upd).eq('id', booking.id)
  }

  // ── Preis/Gäste/Telefon auch in SMOOBU nachtragen ──
  let smoobu: string | null = 'keine smoobu_reservation_id'
  if (booking.smoobu_reservation_id) {
    const fields: Record<string, unknown> = {}
    if (preis) fields.price = preis
    if (typeof parsed.erwachsene === 'number' && parsed.erwachsene > 0) fields.adults = parsed.erwachsene
    if (typeof parsed.kinder === 'number' && parsed.kinder >= 0) fields.children = parsed.kinder
    if (typeof parsed.telefon === 'string' && parsed.telefon.length > 5) fields.phone = parsed.telefon
    if (typeof parsed.email === 'string' && parsed.email.includes('@')) fields.email = parsed.email
    smoobu = Object.keys(fields).length
      ? await updateReservation(Number(booking.smoobu_reservation_id), fields)
      : 'nichts zu übertragen'
  }

  // Persönliche Gast-Nachricht (z. B. Anfrage-Mails MIT Zeitraum) → Chat-Thread
  const mainMsg = typeof parsed.nachricht === 'string' ? parsed.nachricht.trim() : ''
  const savedMsg = mainMsg.length >= 3 ? await saveGuestMessage(booking.id, booking.guest_name, mainMsg) : false

  console.log('[inbound-mail] verarbeitet:', {
    booking: booking.id, felder: Object.keys(upd), smoobu: smoobu ?? 'ok',
    portal: parsed.portal, preis, nachricht: savedMsg,
  })
  return NextResponse.json({ ok: true, bookingId: booking.id, ergaenzt: Object.keys(upd), nachricht: savedMsg, smoobu: smoobu ?? 'ok' })
}
