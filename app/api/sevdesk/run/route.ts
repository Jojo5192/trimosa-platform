import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { runSevInvoiceRun, fewoBruttoFix, type FewoFixRow } from '@/lib/sevdesk-engine'
import { migrateInvoiceCostCentres } from '@/lib/sevdesk'

/**
 * 🧾 sevdesk-Tageslauf (§235) — übernimmt ab dem Stichtag 02.08.2026 den
 * 15:00-Cron der lexoffice-Engine:
 *  GET  → Vercel-Cron 13:00 UTC (= 15:00 CEST) — Rechnungen für die
 *         heutigen (+ gestrigen Nachzügler-) Anreisen (Bearer CRON_SECRET).
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
    return NextResponse.json(await runSevInvoiceRun())
  } catch (err) {
    console.error('[sevdesk-engine] cron:', err)
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
    // §242-Reparatur: falsch-vorzeichige Zahlung lösen + korrekt neu buchen
    if (b.action === 'voucher-repair') {
      const { sevJson, sevFetch } = await import('@/lib/sevdesk')
      const vid = String(b.voucherId)
      const amt = Math.abs(Number(b.amountGross))
      if (!vid || !Number.isFinite(amt) || amt <= 0) return NextResponse.json({ error: 'voucherId + amountGross nötig.' }, { status: 400 })
      // Zahlung lösen (Transaktion wird wieder frei) …
      const r1 = await sevFetch(`/Voucher/${vid}/resetToOpen`, { method: 'PUT', body: '{}' })
      if (!r1.ok) return NextResponse.json({ error: `resetToOpen HTTP ${r1.status}: ${(await r1.text()).slice(0, 200)}` }, { status: 502 })
      // Ohne txId: nur lösen — die freigewordene Transaktion wird danach
      // regulär über 'verbuchen' (mit korrektem Vorzeichen) neu verknüpft
      if (!b.txId) {
        const after0 = await sevJson<{ status?: unknown; paidAmount?: unknown }[]>(`/Voucher/${vid}`)
        const av0 = Array.isArray(after0) ? after0[0] : after0
        return NextResponse.json({ ok: true, nurGeloest: true, status: (av0 as { status?: unknown })?.status, paidAmount: (av0 as { paidAmount?: unknown })?.paidAmount })
      }
      // … und mit korrektem NEGATIVEN Betrag neu verknüpfen
      await sevJson(`/Voucher/${vid}/bookAmount`, {
        method: 'PUT',
        body: JSON.stringify({
          amount: -amt,
          date: Math.floor(Date.parse(String(b.txDate ?? new Date().toISOString().slice(0, 10)) + 'T12:00:00Z') / 1000),
          type: 'FULL_PAYMENT',
          checkAccount: { id: Number(b.txAccountId), objectName: 'CheckAccount' },
          checkAccountTransaction: { id: Number(b.txId), objectName: 'CheckAccountTransaction' },
        }),
      })
      const after = await sevJson<{ status?: unknown; paidAmount?: unknown }[]>(`/Voucher/${vid}`)
      const av = Array.isArray(after) ? after[0] : after
      return NextResponse.json({ ok: true, status: (av as { status?: unknown })?.status, paidAmount: (av as { paidAmount?: unknown })?.paidAmount })
    }

    // §242-Diagnose: einen Beleg samt Positionen roh ansehen
    // §243i: Status-Verteilung der Bank-Transaktionen — Abgleich mit
    // sevdesks "offene Zahlungen"-Zaehlung (100 Created · 200 Linked ·
    // 300 Private · 350 Auto-booked ohne Bestaetigung · 400 Booked)
    // §243ac VOLL-AUDIT: alle Belege + Rechnungen mit Konten/KSt roh auslesen
    // §243aj: FeWo-Buchungen tragen den AUSZAHLUNGS- statt des
    // Brutto-Betrags (händische Smoobu-Eingabe). Korrigiert alle drei
    // Systeme: Smoobu, bookings.total_price und die sevdesk-Rechnung
    // (Storno + Neu). dryRun ist Default.
    if (b.action === 'fewo-brutto-fix') {
      if (!Array.isArray(b.rows) || b.rows.length === 0) {
        return NextResponse.json({ error: 'rows fehlt.' }, { status: 400 })
      }
      const rows = (b.rows as FewoFixRow[]).filter(
        (r) => r && typeof r.checkIn === 'string' && typeof r.checkOut === 'string' && typeof r.brutto === 'number',
      )
      return NextResponse.json(await fewoBruttoFix({
        rows, dryRun: b.dryRun !== false, limit: typeof b.limit === 'number' ? b.limit : undefined,
      }))
    }

    if (b.action === 'voll-audit') {
      const { vollAudit } = await import('@/lib/sevdesk')
      const raw = await vollAudit()
      // interne Wohnungs-Zuordnungen (beleg_inbox) dazulegen
      const zuo: Record<string, unknown> = {}
      for (let fromIdx = 0; ; fromIdx += 1000) {
        const { data } = await supabaseAdmin
          .from('beleg_inbox')
          .select('sevdesk_voucher_id, zuordnung')
          .not('sevdesk_voucher_id', 'is', null)
          .range(fromIdx, fromIdx + 999)
        for (const r of data ?? []) {
          if (r.sevdesk_voucher_id && r.zuordnung) zuo[String(r.sevdesk_voucher_id)] = r.zuordnung
        }
        if (!data || data.length < 1000) break
      }
      return NextResponse.json({ ...raw, zuordnungen: zuo })
    }
    if (b.action === 'tx-status') {
      const days = Math.min(Math.max(Number(b.days) || 400, 7), 400)
      const { findBankAccounts, listBankTransactions } = await import('@/lib/sevdesk-payouts')
      const banks = await findBankAccounts()
      const konten: Record<string, Record<string, number>> = {}
      const probe: string[] = []
      for (const bank of banks) {
        const verteilung: Record<string, number> = {}
        for (const t of await listBankTransactions(bank.id, days)) {
          const st = String(t.status)
          verteilung[st] = (verteilung[st] ?? 0) + 1
          if (st === '100' && probe.length < 12) {
            probe.push(`${bank.name} · ${String(t.valueDate ?? t.entryDate ?? '').slice(0, 10)} · ${Number(t.amount).toFixed(2)} € · ${String(t.payeePayerName ?? t.paymtPurpose ?? '?').slice(0, 40)}`)
          }
        }
        konten[bank.name] = verteilung
      }
      return NextResponse.json({ zeitraumTage: days, konten, statusLegende: { 100: 'offen (Created)', 200: 'Linked', 300: 'Privat', 350: 'AUTO-gebucht ohne Bestaetigung', 400: 'Gebucht' }, probeOffene: probe })
    }

    // §243b: ReceiptGuidance-Sonde — z. B. Asset-Konten finden, die NICHT
    // in forAllAccounts stehen (Anlagegueter: "Must only set isAsset for
    // asset accounts")
    if (b.action === 'guidance-probe') {
      const { sevJson } = await import('@/lib/sevdesk')
      try {
        const raw = await sevJson(`/ReceiptGuidance/forAccountNumber?accountNumber=${Number(b.accountNumber)}`)
        return NextResponse.json({ ok: true, raw })
      } catch (e) {
        return NextResponse.json({ ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 300) })
      }
    }

    if (b.action === 'voucher-info') {
      const { sevJson } = await import('@/lib/sevdesk')
      const voucher = await sevJson(`/Voucher/${String(b.voucherId)}`)
      const positionen = await sevJson(`/VoucherPos?voucher[id]=${String(b.voucherId)}&voucher[objectName]=Voucher&limit=20`)
      return NextResponse.json({ voucher, positionen })
    }
    if (b.action === 'voucher-list') {
      const { sevJson } = await import('@/lib/sevdesk')
      const st = typeof b.status === 'number' ? b.status : 750
      const list = await sevJson(`/Voucher?status=${st}&limit=50&embed=costCentre`)
      return NextResponse.json({ status: st, list })
    }
    // §240: Bestand von Wohnungs- auf Standort-Kostenstellen umziehen
    if (b.action === 'kst-migrate') {
      const { data: listings } = await supabaseAdmin
        .from('listings').select('title, location_group').eq('is_active', true)
      const mapping: Record<string, string> = {}
      for (const l of listings ?? []) {
        if (l.location_group) mapping[String(l.title)] = String(l.location_group)
      }
      return NextResponse.json(await migrateInvoiceCostCentres(mapping, {
        dryRun: b.dryRun !== false,
        ...(typeof b.limit === 'number' ? { limit: b.limit } : {}),
      }))
    }
    return NextResponse.json(await runSevInvoiceRun({ dryRun: b.dryRun !== false }))
  } catch (err) {
    console.error('[sevdesk-engine] manual:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
