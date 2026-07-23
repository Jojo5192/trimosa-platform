import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { runInvoiceRun, q2Check, q2Backfill, q2PaymentReport, deleteInvoice } from '@/lib/lexoffice'

/**
 * 🧾 Lexoffice-Tageslauf (§158):
 *  GET  → Vercel-Cron 13:00 UTC (= 15:00 CEST) — Rechnungen für die
 *         heutigen Anreisen (Bearer CRON_SECRET).
 *  POST → Admin/Gastgeber: { dryRun: true } (Default) zeigt, was erstellt
 *         WÜRDE; { dryRun: false } stößt den Lauf manuell an.
 */
export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 401 })
  }
  try {
    return NextResponse.json(await runInvoiceRun())
  } catch (err) {
    console.error('[lexoffice] cron:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host').eq('id', user.id).maybeSingle()
  if (!me?.is_admin && !me?.is_host) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  try {
    const b = await request.json().catch(() => ({}))
    // §160: Q2-Nachschau — reine Abgleich-LISTE, nichts wird erstellt
    if (b.action === 'q2-check') {
      return NextResponse.json(await q2Check(typeof b.from === 'string' ? b.from : '2026-04-01'))
    }
    // §160-Nachtrag: Zahlungsweg-Report (Bankabgleich-Hilfe)
    if (b.action === 'q2-payment-report') {
      return NextResponse.json(await q2PaymentReport(typeof b.from === 'string' ? b.from : '2026-04-01'))
    }
    // §160: Backfill — Entwürfe löschen + Rechnungen mit Belegdatum =
    // Anreisetag nachschießen. dryRun:true (Default) zeigt nur die Vorschau.
    if (b.action === 'q2-backfill') {
      return NextResponse.json(await q2Backfill({
        dryRun: b.dryRun !== false,
        limit: typeof b.limit === 'number' ? b.limit : undefined,
        from: typeof b.from === 'string' ? b.from : undefined,
      }))
    }
    // §160: Einzel-Löschung (z. B. verwaister Test-Entwurf) — dient zugleich
    // als Fähigkeits-Test, ob die API Belege löschen kann
    if (b.action === 'lex-delete' && typeof b.voucherId === 'string') {
      return NextResponse.json(await deleteInvoice(b.voucherId))
    }
    // §160: Buchung mit BESTEHENDER Lexoffice-Rechnung verknüpfen (z. B.
    // Teichert/RE00774 „Philipp") — verhindert Doppel-Fakturierung im
    // Backfill und aktiviert den Gast-Download-Link
    if (b.action === 'lex-link' && typeof b.bookingId === 'string' && typeof b.lexofficeId === 'string') {
      const { error } = await supabaseAdmin.from('lexoffice_invoices').upsert({
        booking_id: b.bookingId, lexoffice_id: b.lexofficeId,
        voucher_number: typeof b.voucherNumber === 'string' ? b.voucherNumber : null,
        amount: typeof b.amount === 'number' ? b.amount : null,
        status: 'erstellt', error: null, updated_at: new Date().toISOString(),
      }, { onConflict: 'booking_id' })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json(await runInvoiceRun({ dryRun: b.dryRun !== false }))
  } catch (err) {
    const detail = String(err instanceof Error ? err.message : err).slice(0, 300)
    return NextResponse.json({ error: `Lauf fehlgeschlagen: ${detail}` }, { status: 500 })
  }
}
