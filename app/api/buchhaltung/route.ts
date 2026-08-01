import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  listSevVouchers, getReceiptGuidance, updateSevVoucherCostCentre, bookSevVoucher,
} from '@/lib/sevdesk'
import { findBankAccounts, listBankTransactions, bookMoneyTransit, payoutClearingFor } from '@/lib/sevdesk-payouts'
import { askClaude, FAST_MODEL } from '@/lib/ai'

/**
 * 💶 BUCHHALTUNGSMODUL (§239) — Admin/Gastgeber: sevdesk komplett aus der
 * App bedienen. GET liefert den Gesamt-Zustand (Belege + offene Zahlungen +
 * Kategorien + Kostenstellen); POST führt Aktionen aus:
 *  kostenstelle  { voucherId, name|null }
 *  ki-vorschlag  { voucherId } → Kategorie/Steuersatz/Betrag-Vorschlag
 *  verbuchen     { voucherId, accountDatevId, taxRate, amountGross,
 *                  kostenstelle?, txId?, txAccountId?, txDate? }
 *  geldtransit   { txId, clearingLabel } — Eingang aufs Verrechnungskonto
 *  tx-ignorieren { txId, on } — „kein Beleg nötig" (nur App-Merker)
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 120
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

async function requireFinance() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host').eq('id', user.id).maybeSingle()
  return (me?.is_admin || me?.is_host) ? user : null
}

async function getIgnored(): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('app_settings').select('value').eq('key', 'buchhaltung').maybeSingle()
  const v = (data?.value ?? {}) as { ignoredTx?: string[] }
  return Array.isArray(v.ignoredTx) ? v.ignoredTx.map(String) : []
}

export async function GET(req: NextRequest) {
  const user = await requireFinance()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  if (req.nextUrl.searchParams.get('probe') === '1') return NextResponse.json({ ok: true }, NO_STORE)
  // §241: Zeitraum wählbar (Zahlungen-Reiter 45/90/180/365 Tage)
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days')) || 45, 7), 400)

  try {
    const [vouchers, guidance, ignored, banks] = await Promise.all([
      listSevVouchers([50, 100]),
      getReceiptGuidance(),
      getIgnored(),
      findBankAccounts(),
    ])

    const openTx: {
      id: string; bankAccountId: string; bankkonto: string; datum: string
      betrag: number; von: string; zweck: string; vorschlag: string | null
    }[] = []
    for (const bank of banks) {
      const txs = await listBankTransactions(bank.id, days)
      for (const tx of txs) {
        if (Number(tx.status) !== 100) continue
        if (ignored.includes(String(tx.id))) continue
        openTx.push({
          id: String(tx.id), bankAccountId: bank.id, bankkonto: bank.name,
          datum: String(tx.valueDate ?? tx.entryDate ?? '').slice(0, 10),
          betrag: Number(tx.amount),
          von: (tx.payeePayerName ?? '').slice(0, 60),
          zweck: (tx.paymtPurpose ?? '').slice(0, 90),
          vorschlag: payoutClearingFor(`${tx.payeePayerName ?? ''} ${tx.paymtPurpose ?? ''}`),
        })
      }
    }
    openTx.sort((a, b) => b.datum.localeCompare(a.datum))

    const { data: listings } = await supabaseAdmin
      .from('listings').select('title, location_group').eq('is_active', true).order('title')
    // §240-Doktrin: KSt = Standorte; Wohnungen nur ohne Gruppe (River) —
    // wohnungsgenau wertet die App aus
    const titles = (listings ?? []).filter((l) => !l.location_group).map((l) => String(l.title))
    const groups = [...new Set((listings ?? []).map((l) => l.location_group).filter(Boolean).map(String))]

    // Beleg-Inbox-Zähler (die Karten selbst liefert /api/belege)
    const { count: inboxCount } = await supabaseAdmin
      .from('beleg_inbox').select('id', { count: 'exact', head: true }).eq('status', 'offen')

    return NextResponse.json({
      vouchers,
      openTx,
      kategorien: guidance.map((g) => ({ id: g.accountDatevId, nr: g.accountNumber, name: g.accountName })),
      kostenstellen: ['Allgemein', ...groups, ...titles],
      clearingLabels: ['Verrechnung Booking.com', 'Verrechnung Airbnb', 'Verrechnung FeWo-direkt', 'Verrechnung Direkt/Website', 'Verrechnung HomeToGo'],
      inboxCount: inboxCount ?? 0,
      zeitraumTage: days,
    }, NO_STORE)
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e).slice(0, 300) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireFinance()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const b = await req.json().catch(() => ({}))

  try {
    if (b.action === 'kostenstelle') {
      const r = await updateSevVoucherCostCentre(String(b.voucherId), typeof b.name === 'string' && b.name && b.name !== 'Allgemein' ? b.name : null)
      return NextResponse.json(r, r.ok ? NO_STORE : { status: 502 })
    }

    if (b.action === 'ki-vorschlag') {
      const vouchers = await listSevVouchers([50, 100])
      const v = vouchers.find((x) => x.id === String(b.voucherId))
      if (!v) return NextResponse.json({ error: 'Beleg nicht gefunden.' }, { status: 404 })
      const guidance = await getReceiptGuidance()
      const katalog = guidance.map((g) => `${g.accountDatevId}|${g.accountNumber}|${g.accountName}`).join('\n')
      const raw = await askClaude(
        'Du bist Buchhaltungs-Assistent einer deutschen Ferienwohnungs-Vermietung (eGbR). Ordne den Beleg der passenden Buchungskategorie zu. Antworte NUR mit JSON: {"accountDatevId": <ID aus dem Katalog>, "kategorie": "<Name>", "taxRate": 19|7|0, "betrag_brutto": <Zahl oder null>, "begruendung": "<max 1 Satz>"} — accountDatevId MUSS aus dem Katalog stammen. Steuersatz: Standard 19; 7 nur bei ermäßigten Leistungen; 0 bei steuerfreien/Reverse-Charge. Betrag aus der Beschreibung, wenn erkennbar.',
        `BELEG:\nLieferant: ${v.supplierName ?? '—'}\nBeschreibung: ${v.description ?? '—'}\nDatum: ${v.voucherDate ?? '—'}\n\nKATALOG (id|nr|name):\n${katalog.slice(0, 18000)}`,
        700, FAST_MODEL)
      const j = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim())
      const hit = guidance.find((g) => g.accountDatevId === Number(j.accountDatevId))
      if (!hit) return NextResponse.json({ error: 'KI lieferte keine gültige Kategorie — bitte manuell wählen.' }, { status: 502 })
      return NextResponse.json({
        accountDatevId: hit.accountDatevId, kategorie: hit.accountName, nr: hit.accountNumber,
        taxRate: [19, 7, 0].includes(Number(j.taxRate)) ? Number(j.taxRate) : 19,
        betrag: typeof j.betrag_brutto === 'number' && j.betrag_brutto > 0 ? Math.round(j.betrag_brutto * 100) / 100 : null,
        begruendung: String(j.begruendung ?? '').slice(0, 200),
      }, NO_STORE)
    }

    if (b.action === 'verbuchen') {
      const amountGross = Number(b.amountGross)
      const accountDatevId = Number(b.accountDatevId)
      const taxRate = Number(b.taxRate)
      if (!b.voucherId || !Number.isFinite(amountGross) || amountGross <= 0 || !Number.isFinite(accountDatevId)) {
        return NextResponse.json({ error: 'voucherId, accountDatevId und amountGross (>0) nötig.' }, { status: 400 })
      }
      const r = await bookSevVoucher(String(b.voucherId), {
        accountDatevId,
        taxRate: [19, 7, 0].includes(taxRate) ? taxRate : 19,
        amountGross,
        costCentreName: typeof b.kostenstelle === 'string' && b.kostenstelle && b.kostenstelle !== 'Allgemein' ? b.kostenstelle : null,
        ...(b.txId ? { txId: String(b.txId), txAccountId: String(b.txAccountId ?? ''), txDate: typeof b.txDate === 'string' ? b.txDate : undefined } : {}),
      })
      return NextResponse.json(r, r.ok ? NO_STORE : { status: 502 })
    }

    if (b.action === 'geldtransit') {
      const banks = await findBankAccounts()
      let tx = null as Awaited<ReturnType<typeof listBankTransactions>>[number] | null
      for (const bank of banks) {
        tx = (await listBankTransactions(bank.id, 90)).find((t) => String(t.id) === String(b.txId)) ?? null
        if (tx) break
      }
      if (!tx) return NextResponse.json({ error: 'Transaktion nicht gefunden.' }, { status: 404 })
      const label = typeof b.clearingLabel === 'string' && b.clearingLabel.startsWith('Verrechnung')
        ? b.clearingLabel : null
      if (!label) return NextResponse.json({ error: 'clearingLabel nötig.' }, { status: 400 })
      const r = await bookMoneyTransit(tx, label)
      return NextResponse.json(r, r.ok ? NO_STORE : { status: 502 })
    }

    if (b.action === 'tx-ignorieren') {
      const ignored = await getIgnored()
      const id = String(b.txId ?? '')
      if (!id) return NextResponse.json({ error: 'txId nötig.' }, { status: 400 })
      const next = b.on === false ? ignored.filter((x) => x !== id) : [...new Set([...ignored, id])].slice(-500)
      await supabaseAdmin.from('app_settings').upsert(
        { key: 'buchhaltung', value: { ignoredTx: next } }, { onConflict: 'key' })
      return NextResponse.json({ ok: true, ignoriert: b.on !== false }, NO_STORE)
    }

    return NextResponse.json({ error: 'Unbekannte action.' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e).slice(0, 300) }, { status: 500 })
  }
}
