import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTaskAuth } from '@/lib/tasks'
import { getRawReservation } from '@/lib/smoobu'

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
  const raw = await getRawReservation(smoobuId)
  if (!raw) return NextResponse.json({ error: 'Smoobu liefert nichts.', ours, smoobuId }, { status: 502, ...NO_STORE })
  // Nur die für die Diagnose relevanten Felder — keine Volltexte/Notizen an den Client
  const pick = (k: string) => raw[k]
  const summary = {
    id: pick('id'), arrival: pick('arrival'), departure: pick('departure'), adults: pick('adults'), children: pick('children'),
    guestName: pick('guest-name'), firstName: pick('firstname'), lastName: pick('lastname'), email: pick('email'), phone: pick('phone'),
    channel: (raw.channel as Record<string, unknown> | undefined)?.name ?? null, type: pick('type'), price: pick('price'),
    notice: typeof raw.notice === 'string' ? (raw.notice as string).slice(0, 300) : null,
    keys: Object.keys(raw),
  }
  return NextResponse.json({ ours, smoobu: summary }, NO_STORE)
}
