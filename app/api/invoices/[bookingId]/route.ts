import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createInvoiceForBooking } from '@/lib/lexoffice'

/**
 * 🧾 Rechnungs-Status je Buchung (Team, §158) — Basis für die 🧾-Aktion in
 * Chat + Offen:
 *  GET  → { status: 'bereit'|'zu_frueh'|'keine'|'fehler', url?, voucherNumber?, checkIn }
 *  POST → Rechnung JETZT erstellen (frühestens ab Anreisetag) → { url }
 * Die Gast-URL ist der token-geschützte PDF-Download (/api/rechnung/<token>).
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

async function requireTeam() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host, is_staff').eq('id', user.id).maybeSingle()
  return (me?.is_admin || me?.is_host || me?.is_staff) ? user : null
}

function berlinToday(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 10)
}

async function loadState(bookingId: string) {
  const { data: b } = await supabaseAdmin
    .from('bookings').select('id, check_in, portal_token, status').eq('id', bookingId).maybeSingle()
  if (!b) return null
  const { data: inv } = await supabaseAdmin
    .from('lexoffice_invoices').select('lexoffice_id, voucher_number, status, error').eq('booking_id', bookingId).maybeSingle()
  const url = b.portal_token ? `/api/rechnung/${b.portal_token}` : null
  if (inv?.lexoffice_id) return { status: 'bereit' as const, url, voucherNumber: inv.voucher_number, checkIn: b.check_in }
  if (String(b.check_in) > berlinToday()) return { status: 'zu_frueh' as const, url: null, checkIn: b.check_in }
  if (inv?.status === 'fehler') return { status: 'fehler' as const, url: null, error: inv.error, checkIn: b.check_in }
  return { status: 'keine' as const, url: null, checkIn: b.check_in }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params
  if (!(await requireTeam())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const state = await loadState(bookingId)
  if (!state) return NextResponse.json({ error: 'Buchung nicht gefunden.' }, { status: 404 })
  return NextResponse.json(state, NO_STORE)
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params
  if (!(await requireTeam())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const state = await loadState(bookingId)
  if (!state) return NextResponse.json({ error: 'Buchung nicht gefunden.' }, { status: 404 })
  if (state.status === 'bereit') return NextResponse.json(state, NO_STORE)
  if (state.status === 'zu_frueh') {
    return NextResponse.json({
      error: `Rechnungen entstehen erst am Anreisetag (${state.checkIn}) — vorher den Hinweis-Text senden.`,
    }, { status: 400 })
  }
  const r = await createInvoiceForBooking(bookingId)
  if (!r.ok && !r.skipped) return NextResponse.json({ error: r.error ?? 'Erstellung fehlgeschlagen.' }, { status: 500 })
  const fresh = await loadState(bookingId)
  return NextResponse.json(fresh, NO_STORE)
}
