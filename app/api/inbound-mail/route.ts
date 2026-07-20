import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { askClaude } from '@/lib/ai'
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

  // Nur Portal-Buchungsmails an die KI geben
  const relevant = /fewo-direkt|homeaway|vrbo|booking\.com|airbnb/i.test(from + ' ' + subject)
  if (!relevant) return NextResponse.json({ ok: true, skipped: 'kein Portal-Absender' })

  const rawText = String(data.text ?? '') || stripHtml(String(data.html ?? ''))
  if (rawText.trim().length < 80) {
    console.error('[inbound-mail] Mail-Body leer/zu kurz — Payload-Keys:', Object.keys(data))
    return NextResponse.json({ ok: true, skipped: 'kein Mail-Text im Webhook' })
  }

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
  const checkin = String(parsed.checkin ?? '')
  const checkout = String(parsed.checkout ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkin) || !/^\d{4}-\d{2}-\d{2}$/.test(checkout)) {
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

  console.log('[inbound-mail] verarbeitet:', {
    booking: booking.id, felder: Object.keys(upd), smoobu: smoobu ?? 'ok',
    portal: parsed.portal, preis,
  })
  return NextResponse.json({ ok: true, bookingId: booking.id, ergaenzt: Object.keys(upd), smoobu: smoobu ?? 'ok' })
}
