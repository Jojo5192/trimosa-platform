import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { runSevInvoiceRun } from '@/lib/sevdesk-engine'
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
