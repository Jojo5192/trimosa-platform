import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { runInvoiceRun, q2Check, q2Backfill, q2PaymentReport, deleteInvoice, priceFix, findVoucherByNumber, invoiceAudit, listExpenseVouchers, getExpenseVoucherPdf } from '@/lib/lexoffice'

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
    // §221: Rechnungen mit falschem (gerundetem) Betrag finden — und die
    // noch OFFENEN neu ausstellen. dryRun ist Default.
    // §221: Beleg-ID zu einer Rechnungsnummer (Vorstufe zu lex-link)
    // §222: Bilanz-Prüfung — wird jede Buchung nur EINMAL fakturiert?
    // §243e: AUSGABEN-Belege aus lexoffice nach sevdesk migrieren.
    // 'expense-audit' = Liste + Dedupe-Vorschau (nichts wird angelegt);
    // 'expense-import' {limit, dryRun:false} = PDFs als sevdesk-Entwuerfe.
    if (b.action === 'expense-audit' || b.action === 'expense-import') {
      const from = typeof b.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.from) ? b.from : '2026-01-01'
      const { vouchers, errors } = await listExpenseVouchers(from)
      const { listSevVouchers, uploadSevVoucherFile, createSevVoucherDraft } = await import('@/lib/sevdesk')
      // Dedupe-Basis: ALLE sevdesk-Belege (Entwurf/offen/teilbezahlt/bezahlt)
      const sev = await listSevVouchers([50, 100, 750, 1000])
      const tok = (x: string | null | undefined) => String(x ?? '').toLowerCase().split(/[^a-zäöüß0-9]+/).filter((w) => w.length > 3)
      const schon: { kontakt: string; betrag: number; datum: string; grund: string }[] = []
      const neu: typeof vouchers = []
      // §243e-Haertung: jeder sevdesk-Beleg deckt max. EIN lexoffice-Pendant
      // (used-Set — sonst verschluckt ein 25-€-Monatsabo alle Monate)
      const used = new Set<string>()
      for (const v of vouchers) {
        if (v.voucherStatus === 'voided' || !Number.isFinite(v.totalAmount)) continue
        // 1) Import-Marker  2) BELEGNUMMER in der sevdesk-Description (die
        // Mail-gefischten Booking-Provisionen tragen die Invoice-Nr!)
        // 3) Betrag exakt + Datum ±45 Tage (Mail-Scan-Belege tragen das
        // SCAN-Datum, nicht das Belegdatum) + gemeinsames Namens-Token
        const nr = String(v.voucherNumber ?? '').trim()
        const marker = sev.find((x) => !used.has(x.id) && (x.description ?? '').includes(`lexoffice ${nr}`))
        const perNr = !marker && nr.length >= 6 && nr !== '-'
          ? sev.find((x) => !used.has(x.id) && (x.description ?? '').includes(nr))
          : null
        const inhalt = (marker || perNr) ? null : sev.find((x) => {
          if (used.has(x.id)) return false
          if (x.sumGross == null || Math.abs(x.sumGross - v.totalAmount) > 0.01) {
            // Entwuerfe haben sumGross 0 → Betrag steckt in der Description
            if (!(x.status === 50 && (x.description ?? '').includes(v.totalAmount.toFixed(2)))) return false
          }
          if (!x.voucherDate || Math.abs(Date.parse(x.voucherDate) - Date.parse(v.voucherDate)) > 45 * 864e5) return false
          const a = tok(x.supplierName)
          return tok(v.contactName).some((w) => a.includes(w))
        })
        const hit = marker ?? perNr ?? inhalt
        if (hit) {
          used.add(hit.id)
          schon.push({ kontakt: v.contactName.slice(0, 50), betrag: v.totalAmount, datum: v.voucherDate, grund: marker ? 'Marker' : perNr ? 'Belegnummer' : 'Betrag+Datum+Name' })
        } else neu.push(v)
      }
      if (b.action === 'expense-audit' || b.dryRun !== false) {
        return NextResponse.json({
          zeitraum: from, geladen: vouchers.length, schonInSevdesk: schon.length, neuZuImportieren: neu.length,
          neu: neu.slice(0, 80).map((v) => ({ id: v.id, nr: v.voucherNumber, kontakt: v.contactName.slice(0, 50), betrag: v.totalAmount, datum: v.voucherDate, status: v.voucherStatus })),
          errors,
        })
      }
      // scharfer Import
      const limit = Math.min(Math.max(Number(b.limit) || 30, 1), 40)
      let importiert = 0
      const fehler: string[] = []
      // Fehlgeschlagene (kaputte Dateien) blockieren NICHT den Lauf — die
      // Schleife geht weiter durch die Liste, bis limit ERFOLGE erreicht sind
      const t0 = Date.now()
      for (const v of neu) {
        if (importiert >= limit) break
        // Zeitbudget: vor der 300s-maxDuration sauber mit Teilergebnis raus
        if (Date.now() - t0 > 235_000) break
        // Pacing VOR jedem Versuch — continue-Pfade uebersprangen das alte
        // sleep am Erfolgs-Ende → 429-Kaskade (lexoffice 2 req/s)
        await new Promise((ok) => setTimeout(ok, 650))
        try {
          const pdf = await getExpenseVoucherPdf(v.id)
          if (!pdf.ok || !pdf.pdf) { fehler.push(`${v.voucherNumber}: ${pdf.error}`); continue }
          const up = await uploadSevVoucherFile(pdf.pdf, pdf.filename ?? `lexoffice-${v.id}.pdf`, pdf.mime ?? 'application/pdf')
          if (!up.ok || !up.internalFilename) { fehler.push(`${v.voucherNumber}: ${up.error}`); continue }
          const d = await createSevVoucherDraft({
            internalFilename: up.internalFilename,
            supplierName: (v.contactName || 'Unbekannt').slice(0, 80),
            description: `Beleg (aus lexoffice ${v.voucherNumber}): ${v.contactName}`.slice(0, 160) + ` \u00B7 ${v.totalAmount.toFixed(2)} \u20AC`,
            voucherDate: v.voucherDate,
          })
          if (!d.ok) { fehler.push(`${v.voucherNumber}: ${d.error}`); continue }
          importiert++
        } catch (e) { fehler.push(`${v.voucherNumber}: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`) }
      }
      return NextResponse.json({ importiert, verbleibend: Math.max(0, neu.length - importiert - fehler.length), uebersprungen: fehler.length, fehler: fehler.slice(0, 15) })
    }

    if (b.action === 'invoice-audit') {
      return NextResponse.json(await invoiceAudit(typeof b.from === 'string' ? b.from : undefined))
    }
    if (b.action === 'lex-find' && typeof b.voucherNumber === 'string') {
      return NextResponse.json(await findVoucherByNumber(b.voucherNumber))
    }
    if (b.action === 'price-fix') {
      const r = await priceFix({
        dryRun: b.dryRun !== false,
        ...(typeof b.limit === 'number' ? { limit: b.limit } : {}),
      })
      return NextResponse.json(r)
    }
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
