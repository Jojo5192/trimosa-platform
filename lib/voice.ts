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

  return {
    id: best.id,
    guestName: String(best.guest_name ?? '').trim(),
    listingTitle: best.listings?.title ?? 'unbekannt',
    checkIn: best.check_in,
    checkOut: best.check_out,
    adults: best.adults,
    children: best.children,
    stayStatus: running && best.id === running.id ? 'laufend' : best.check_in > today ? 'kommend' : 'vergangen',
  }
}
