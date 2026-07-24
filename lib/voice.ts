import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * ☎️ Anrufbot-Werkzeuge (§175 Phase 2): Diese Lib versorgt die
 * /api/voice/*-Routen, die der ElevenLabs-Agent als Webhook-Tools
 * während eines Telefonats aufruft. Auth über VOICE_TOOL_SECRET
 * (Bearer) — der Wert steht auch in der Tool-Konfiguration des Agenten.
 */

export function requireVoiceAuth(request: Request): Response | null {
  const secret = process.env.VOICE_TOOL_SECRET
  if (!secret) {
    return Response.json({ error: 'VOICE_TOOL_SECRET nicht konfiguriert' }, { status: 503 })
  }
  const auth = request.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'Nicht berechtigt' }, { status: 401 })
  }
  return null
}

/** Ziffern-Normalisierung: "+49 (0)151 234-5678" → "491512345678" */
export function normalizePhone(raw: string): string {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  return d
}

/** Match-Schlüssel = letzte 9 Ziffern (übersteht Vorwahl-/Formatvarianten) */
function phoneKey(raw: string): string {
  return normalizePhone(raw).slice(-9)
}

export interface VoiceBooking {
  id: string
  guestName: string
  listingTitle: string
  checkIn: string
  checkOut: string
  adults: number | null
  children: number | null
  stayStatus: 'laufend' | 'kommend' | 'vergangen'
}

type BRow = {
  id: string
  guest_id: string | null
  guest_name: string | null
  check_in: string
  check_out: string
  adults: number | null
  children: number | null
  listings: { title: string | null } | null
}

/**
 * Buchung über die Anrufer-Nummer finden. Die Telefonnummern liegen NICHT
 * als bookings-Spalte vor, sondern (a) in den Smoobu-Bestätigungs-
 * Nachrichten („Guest Phone Number: +32…") der booking-Threads und
 * (b) bei Website-Gästen in profiles.phone. Durchsucht werden nur
 * relevante Buchungen (confirmed, Abreise ≥ heute−14).
 */
export async function findBookingByPhone(callerNumber: string): Promise<VoiceBooking | null> {
  const key = phoneKey(callerNumber)
  if (key.length < 7) return null

  const today = new Date().toISOString().slice(0, 10)
  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)

  const { data: bookings } = await supabaseAdmin
    .from('bookings')
    .select('id, guest_id, guest_name, check_in, check_out, adults, children, listings(title)')
    .eq('status', 'confirmed')
    .gte('check_out', cutoff)
    .order('check_in', { ascending: true })
    .limit(400)
  const rows = (bookings ?? []) as unknown as BRow[]
  if (!rows.length) return null

  const matchedIds = new Set<string>()

  // (a) Telefonnummern aus den Thread-Nachrichten (Smoobu-Bestätigungen)
  const ids = rows.map((r) => r.id)
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const { data: msgs } = await supabaseAdmin
      .from('messages')
      .select('booking_id, content')
      .in('booking_id', chunk)
      .ilike('content', '%phone%')
      .limit(1000)
    for (const m of msgs ?? []) {
      const content = String(m.content ?? '')
      for (const cand of content.match(/\+?[\d\s\-()/.]{7,}/g) ?? []) {
        const ck = phoneKey(cand)
        if (ck.length >= 7 && (ck === key || key.endsWith(ck) || ck.endsWith(key))) {
          if (m.booking_id) matchedIds.add(String(m.booking_id))
          break
        }
      }
    }
  }

  // (b) Website-Gäste: profiles.phone → guest_id
  try {
    const { data: profs } = await supabaseAdmin
      .from('profiles')
      .select('id, phone')
      .not('phone', 'is', null)
      .limit(1000)
    const guestIds = new Set(
      (profs ?? [])
        .filter((p) => phoneKey(String(p.phone)).length >= 7 && phoneKey(String(p.phone)) === key)
        .map((p) => String(p.id)),
    )
    if (guestIds.size) {
      for (const r of rows) if (r.guest_id && guestIds.has(r.guest_id)) matchedIds.add(r.id)
    }
  } catch { /* best effort */ }

  if (!matchedIds.size) return null

  // Beste Buchung: laufend > nächste kommende > jüngste vergangene
  const matched = rows.filter((r) => matchedIds.has(r.id))
  const running = matched.find((r) => r.check_in <= today && r.check_out >= today)
  const upcoming = matched.find((r) => r.check_in > today)
  const best = running ?? upcoming ?? matched[matched.length - 1]

  return toVoiceBooking(best, today)
}

function toVoiceBooking(b: BRow, today: string): VoiceBooking {
  return {
    id: b.id,
    guestName: String(b.guest_name ?? '').trim(),
    listingTitle: b.listings?.title ?? 'unbekannt',
    checkIn: b.check_in,
    checkOut: b.check_out,
    adults: b.adults,
    children: b.children,
    stayStatus: b.check_in <= today && b.check_out >= today ? 'laufend' : b.check_in > today ? 'kommend' : 'vergangen',
  }
}

/**
 * Buchung aus GESPRÄCHSDATEN finden (§182): Der Anrufer nennt Wohnung,
 * Zeitraum und Namen oft selbst — ohne dass seine Nummer bekannt ist
 * (Browser-Test, fremdes Telefon, unterdrückte Nummer). Konservativ:
 * nur bei EINDEUTIGEM Treffer wird zugeordnet. Fenster reicht 90 Tage
 * in die Vergangenheit (Fundsachen-Anrufe kommen nach der Abreise).
 */
export async function findBookingByDetails(opts: {
  name?: string
  apartment?: string
  arrival?: string
  departure?: string
}): Promise<VoiceBooking | null> {
  const name = String(opts.name ?? '').trim().toLowerCase()
  const apartment = String(opts.apartment ?? '').trim().toLowerCase()
  const arrival = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.arrival ?? '')) ? String(opts.arrival) : ''
  const departure = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.departure ?? '')) ? String(opts.departure) : ''
  // Mindest-Anker: ein Datum ODER Wohnung+Name — sonst wäre jedes Match Raterei
  if (!arrival && !departure && !(apartment && name)) return null

  const today = new Date().toISOString().slice(0, 10)
  const pastCutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)

  let q = supabaseAdmin
    .from('bookings')
    .select('id, guest_id, guest_name, check_in, check_out, adults, children, listings(title)')
    .eq('status', 'confirmed')
  if (arrival) q = q.eq('check_in', arrival)
  else if (departure) q = q.eq('check_out', departure)
  else q = q.gte('check_out', pastCutoff)
  const { data } = await q.order('check_in', { ascending: true }).limit(400)
  let rows = (data ?? []) as unknown as BRow[]
  if (arrival && departure) rows = rows.filter((r) => r.check_out === departure)

  if (apartment) {
    rows = rows.filter((r) => {
      const title = String(r.listings?.title ?? '').toLowerCase()
      if (!title) return false
      if (title.includes(apartment) || apartment.includes(title)) return true
      const words = apartment.split(/\s+/).filter((w) => w.length >= 3)
      return words.length > 0 && words.every((w) => title.includes(w))
    })
  }

  const nameMatches = (g: string | null): boolean => {
    const guest = String(g ?? '').toLowerCase()
    if (!guest) return false
    const tokens = name.split(/\s+/).filter((w) => w.length >= 3)
    return tokens.some((w) => guest.includes(w))
  }
  // Ohne Datum ist der Name Pflichtkriterium; mit Datum entschärft er nur Mehrdeutigkeit
  if (!arrival && !departure) rows = rows.filter((r) => nameMatches(r.guest_name))
  else if (rows.length > 1 && name) {
    const byName = rows.filter((r) => nameMatches(r.guest_name))
    if (byName.length) rows = byName
  }

  if (rows.length !== 1) return null
  return toVoiceBooking(rows[0], today)
}
