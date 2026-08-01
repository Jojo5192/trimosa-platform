import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  runPayoutSync, listAllCheckAccounts, findBankAccounts, bookMoneyTransit,
  listBankTransactions, getPayoutState, setPayoutAuto,
} from '@/lib/sevdesk-payouts'

/**
 * 💸 Phase C (§236) — Finom-Payouts → Verrechnungskonten:
 *  GET  → Vercel-Cron (Bearer CRON_SECRET): bucht NUR, wenn der
 *         Auto-Schalter an ist (Kalibrierung zuerst, §127).
 *  POST → Admin: { action: 'accounts' | 'scan' | 'book' | 'probe' | 'auto' }
 *         scan  = dryRun-Report (erkannte Payouts, unerkannte Eingänge)
 *         book  = { days, dryRun:false } bucht die erkannten Payouts
 *         probe = { txId } EINE Transaktion als Geldtransit (Kalibrierung)
 *         auto  = { on: true|false } schaltet den Cron scharf/aus
 */
export const maxDuration = 120
export const dynamic = 'force-dynamic'
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 401 })
  }
  try {
    const state = await getPayoutState()
    if (!state.auto) return NextResponse.json({ skipped: 'Auto-Buchung ist aus (erst probe/book kalibrieren, dann action auto).' })
    return NextResponse.json(await runPayoutSync({ days: 14, dryRun: false }))
  } catch (err) {
    console.error('[sevdesk-payouts] cron:', err)
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
    if (b.action === 'accounts') {
      const all = await listAllCheckAccounts()
      const banks = await findBankAccounts()
      return NextResponse.json({ konten: all, erkannteBankkonten: banks, auto: (await getPayoutState()).auto }, NO_STORE)
    }
    if (b.action === 'probe') {
      // Kalibrierung: EINE benannte Transaktion als Geldtransit buchen
      const banks = await findBankAccounts()
      if (!banks.length) return NextResponse.json({ error: 'Kein Bankkonto erkannt.' }, { status: 400 })
      let tx = null as Awaited<ReturnType<typeof listBankTransactions>>[number] | null
      for (const bank of banks) {
        tx = (await listBankTransactions(bank.id, 120)).find((t) => String(t.id) === String(b.txId)) ?? null
        if (tx) break
      }
      if (!tx) return NextResponse.json({ error: `Transaktion ${b.txId} nicht gefunden.` }, { status: 404 })
      const label = typeof b.clearingLabel === 'string' && b.clearingLabel.startsWith('Verrechnung ')
        ? b.clearingLabel : null
      if (!label) return NextResponse.json({ error: 'clearingLabel fehlt (z. B. "Verrechnung Booking.com").' }, { status: 400 })
      return NextResponse.json({ tx, ergebnis: await bookMoneyTransit(tx, label) }, NO_STORE)
    }
    if (b.action === 'auto') {
      await setPayoutAuto(b.on === true)
      return NextResponse.json({ auto: b.on === true }, NO_STORE)
    }
    if (b.action === 'voucher-probe') {
      // §236 C2-Kalibrierung: uploadTempFile + saveVoucher mit einem
      // Mini-Test-PDF beweisen, ohne auf die erste echte Booking-Mail zu
      // warten (der Entwurf ist in der sevdesk-UI löschbar)
      const { PDFDocument, StandardFonts } = await import('pdf-lib')
      const doc = await PDFDocument.create()
      const page = doc.addPage([300, 120])
      const font = await doc.embedFont(StandardFonts.Helvetica)
      page.drawText('TRIMOSA Kalibrier-Test (loeschen)', { x: 20, y: 60, size: 12, font })
      const pdf = Buffer.from(await doc.save())
      const { uploadSevVoucherFile, createSevVoucherDraft } = await import('@/lib/sevdesk')
      const up = await uploadSevVoucherFile(pdf, 'trimosa-kalibrier-test.pdf')
      if (!up.ok || !up.internalFilename) return NextResponse.json({ upload: up }, NO_STORE)
      const voucher = await createSevVoucherDraft({
        internalFilename: up.internalFilename,
        supplierName: 'TRIMOSA Kalibrier-Test',
        description: 'Kalibrier-Test §236 — bitte löschen',
      })
      return NextResponse.json({ upload: up, voucher }, NO_STORE)
    }
    if (b.action === 'book') {
      return NextResponse.json(await runPayoutSync({
        days: typeof b.days === 'number' ? b.days : 14,
        dryRun: b.dryRun !== false,
      }), NO_STORE)
    }
    // Default: scan (dryRun)
    return NextResponse.json(await runPayoutSync({
      days: typeof b.days === 'number' ? b.days : 30, dryRun: true,
    }), NO_STORE)
  } catch (err) {
    console.error('[sevdesk-payouts] manual:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
