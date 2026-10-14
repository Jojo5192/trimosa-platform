import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkRateLimit } from '@/lib/rate-limit'
import { erstelleVerlaengerungCheckout, verlaengerungAngebot } from '@/lib/zahlungen'

/**
 * 🌙 Aufenthalt verlängern in der Gästemappe (Pascal 6.10.2026) — token-basiert wie die Mappe selbst.
 *  GET  ?token=…&naechte=2      → { angebot }  (Live-Verfügbarkeit + Preis aus Smoobu)
 *  POST { token, naechte }      → { url }      (Stripe Checkout; Angebot wird serverseitig neu berechnet)
 * Nach der Zahlung legt der Stripe-Webhook die Zusatznächte als eigene Direktbuchung an (lib/zahlungen.ts).
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function buchungZumToken(token: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null
  const { data: b } = await supabaseAdmin
    .from('bookings').select('id, status, check_out').eq('portal_token', token).maybeSingle()
  if (!b || b.status !== 'confirmed') return null
  return String(b.id)
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? ''
  if (!(await checkRateLimit(`mappe-verl:${token.slice(0, 12)}`, 60, 3600))) {
    return NextResponse.json({ error: 'Zu viele Anfragen — bitte später erneut versuchen.' }, { status: 429 })
  }
  const bookingId = await buchungZumToken(token)
  if (!bookingId) return NextResponse.json({ error: 'Nicht gefunden.' }, { status: 404 })
  const angebot = await verlaengerungAngebot(bookingId, Number(req.nextUrl.searchParams.get('naechte') ?? 1))
  return NextResponse.json({ angebot }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { token?: unknown; naechte?: unknown }
  const token = typeof body.token === 'string' ? body.token : ''
  if (!(await checkRateLimit(`mappe-verl-pay:${token.slice(0, 12)}`, 12, 3600))) {
    return NextResponse.json({ error: 'Zu viele Versuche — bitte später erneut versuchen.' }, { status: 429 })
  }
  const bookingId = await buchungZumToken(token)
  if (!bookingId) return NextResponse.json({ error: 'Nicht gefunden.' }, { status: 404 })
  try {
    const r = await erstelleVerlaengerungCheckout(bookingId, Number(body.naechte ?? 1))
    if ('fehler' in r) return NextResponse.json({ error: r.fehler }, { status: 409 })
    return NextResponse.json({ url: r.url })
  } catch (e) {
    console.error('[mappe/verlaengerung]', e)
    return NextResponse.json({ error: 'Die Zahlung konnte nicht gestartet werden — bitte erneut versuchen.' }, { status: 502 })
  }
}
