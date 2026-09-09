import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTaskAuth } from '@/lib/tasks'
import { getRawReservation, updateReservationRaw } from '@/lib/smoobu'

/**
 * 🔎 §291 Diagnose (Admin/Gastgeber): Roh-Reservierung aus Smoobu neben unserer Buchung —
 * GET ?booking=<bookings.id> ODER ?id=<smoobu_reservation_id>. Zeigt, was Smoobu wirklich
 * liefert (adults/children/email …), um „Übertragungsfehler" (Pascal 9.9., FeWo-direkt) zu belegen.
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

export async function GET(req: NextRequest) {
  const auth = await getTaskAuth()
  if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Nur für Admins/Gastgeber.' }, { status: 403, ...NO_STORE })
  const bookingId = req.nextUrl.searchParams.get('booking')
  let smoobuId = Number(req.nextUrl.searchParams.get('id') ?? 0) || null
  let ours: Record<string, unknown> | null = null
  if (bookingId) {
    const { data } = await supabaseAdmin
      .from('bookings')
      .select('id, guest_name, guest_email, adults, children, check_in, check_out, channel, source, smoobu_reservation_id, listing_id')
      .eq('id', bookingId).maybeSingle()
    ours = (data as Record<string, unknown> | null) ?? null
    if (ours?.smoobu_reservation_id) smoobuId = Number(ours.smoobu_reservation_id)
  }
  if (!smoobuId) return NextResponse.json({ error: 'booking oder id fehlt / keine Smoobu-Reservierung.', ours }, { status: 400, ...NO_STORE })
  // Paragraph 304: Migrations-Check (Inhaber 9.9.: „hab ich die Migration gemacht?") - existiert die Spalte
  // bookings.smoobu_push_claimed_at (20260907_smoobu_push_claim.sql)? PostgREST meldet sonst „column ... does not exist"
  const { error: colErr } = await supabaseAdmin.from('bookings').select('smoobu_push_claimed_at').limit(1)
  const migrationSmoobuPushClaim = colErr ? `FEHLT: ${colErr.message.slice(0, 120)}` : 'ok (Spalte vorhanden)'
  const raw = await getRawReservation(smoobuId)
  if (!raw) return NextResponse.json({ error: 'Smoobu liefert nichts.', ours, smoobuId, migrationSmoobuPushClaim }, { status: 502, ...NO_STORE })
  // Nur die für die Diagnose relevanten Felder — keine Volltexte/Notizen an den Client
  const pick = (k: string) => raw[k]
  const summary = {
    id: pick('id'), arrival: pick('arrival'), departure: pick('departure'), adults: pick('adults'), children: pick('children'),
    guestName: pick('guest-name'), firstName: pick('firstname'), lastName: pick('lastname'), email: pick('email'), phone: pick('phone'),
    channel: (raw.channel as Record<string, unknown> | undefined)?.name ?? null, type: pick('type'), price: pick('price'),
    notice: typeof raw.notice === 'string' ? (raw.notice as string).slice(0, 300) : null,
    keys: Object.keys(raw),
  }
  return NextResponse.json({ ours, smoobu: summary, migrationSmoobuPushClaim }, NO_STORE)
}

/**
 * Paragraph 296: Feld-Update in Smoobu gezielt testen (Admin) - POST { booking | id, fields } schickt NUR
 * die erlaubten Felder per PUT und liefert Smoobus Antwort plus den Stand danach. Nutzen: belegen, welche
 * Felder Smoobu bei Kanal-Buchungen wirklich uebernimmt (E-Mail?).
 */
const ALLOWED = new Set(['firstname', 'lastname', 'firstName', 'lastName', 'email', 'phone', 'adults', 'children', 'price', 'notice'])
export async function POST(req: NextRequest) {
  const auth = await getTaskAuth()
  if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Nur für Admins/Gastgeber.' }, { status: 403, ...NO_STORE })
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  const fields: Record<string, unknown> = {}
  if (b.fields && typeof b.fields === 'object') {
    for (const [k, v] of Object.entries(b.fields as Record<string, unknown>)) if (ALLOWED.has(k)) fields[k] = v
  }
  let smoobuId = Number(b.id ?? 0) || null
  if (typeof b.booking === 'string' && b.booking) {
    const { data } = await supabaseAdmin.from('bookings').select('smoobu_reservation_id').eq('id', b.booking).maybeSingle()
    if (data?.smoobu_reservation_id) smoobuId = Number(data.smoobu_reservation_id)
  }
  if (!smoobuId || !Object.keys(fields).length) {
    return NextResponse.json({ error: 'booking/id oder erlaubte fields fehlen.', erlaubt: [...ALLOWED] }, { status: 400, ...NO_STORE })
  }
  const antwort = await updateReservationRaw(smoobuId, fields)
  const raw = await getRawReservation(smoobuId)
  const danach = raw ? { firstName: raw.firstname, lastName: raw.lastname, email: raw.email, phone: raw.phone, adults: raw.adults, children: raw.children } : null
  return NextResponse.json({ smoobuId, gesendet: fields, antwort, danach }, NO_STORE)
}
