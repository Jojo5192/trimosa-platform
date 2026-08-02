import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  listSevVouchers, getReceiptGuidance, updateSevVoucherCostCentre, bookSevVoucher,
  markTransactionPrivate, deleteSevVoucher,
} from '@/lib/sevdesk'
import { findBankAccounts, listBankTransactions, bookMoneyTransit, payoutClearingFor } from '@/lib/sevdesk-payouts'
import { askClaudeWithFile } from '@/lib/ai'
import { bucheEigenbeleg, resolveTilgungKonto, saveEigenRegel } from '@/lib/eigenbeleg'
import { analysiereBeleg, pdfForVoucher, parseJsonLoose, saveGelernt, saveZuordnung } from '@/lib/beleg-ki'

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
  // §242: strikt NUR Admins (wie die /buchhaltung-Seite selbst)
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  return me?.is_admin ? user : null
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

  // §243ad: „Gebucht"-Ansicht lädt auch bezahlte Belege (Status 1000)
  const mitBezahlten = req.nextUrl.searchParams.get('bezahlt') === '1'

  try {
    const [vouchersRaw, guidance, ignored, banks] = await Promise.all([
      listSevVouchers(mitBezahlten ? [50, 100, 750, 1000] : [50, 100, 750]),
      getReceiptGuidance(),
      getIgnored(),
      findBankAccounts(),
    ])
    // §243ac-Lektion: sevdesks Status-Filter liefert Belege teils in zwei
    // Status-Schleifen doppelt → nach id deduplizieren
    const seen = new Set<string>()
    const vouchers = vouchersRaw.filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true))).slice(0, 400)

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

    // §242: Protokollzeilen zu den offenen Belegen (Beleg-Viewer + interne
    // Wohnungs-Zuordnung) — verknüpft über sevdesk_voucher_id
    const viewer: Record<string, { links: { name: string; url: string }[]; zuordnung: unknown; rowId: string }> = {}
    // §243ad: VORAB gespeicherte KI-Analysen (Instant-Anzeige beim Öffnen)
    const kiAnalysen: Record<string, unknown> = {}
    try {
      const vIds = vouchers.map((v) => v.id)
      if (vIds.length) {
        const { data: prot } = await supabaseAdmin
          .from('beleg_inbox').select('id, sevdesk_voucher_id, files, zuordnung, ki_analyse')
          .in('sevdesk_voucher_id', vIds)
        for (const r of (prot ?? []) as { id: string; sevdesk_voucher_id: string; files: { path: string; name: string }[]; zuordnung: unknown; ki_analyse?: unknown }[]) {
          const links: { name: string; url: string }[] = []
          for (const f of r.files ?? []) {
            const { data: signed } = await supabaseAdmin.storage.from('belege').createSignedUrl(f.path, 3600)
            if (signed?.signedUrl) links.push({ name: f.name, url: signed.signedUrl })
          }
          viewer[r.sevdesk_voucher_id] = { links, zuordnung: r.zuordnung ?? null, rowId: r.id }
          // nur brauchbare Analysen (Fehlschlag-Cache trägt kein accountDatevId)
          const ka = r.ki_analyse as Record<string, unknown> | null | undefined
          if (ka && ka.accountDatevId) kiAnalysen[r.sevdesk_voucher_id] = ka
        }
      }
    } catch {
      // Migration fehlt noch (ki_analyse-Spalte) — Retry ohne die Spalte
      try {
        const vIds = vouchers.map((v) => v.id)
        const { data: prot } = await supabaseAdmin
          .from('beleg_inbox').select('id, sevdesk_voucher_id, files, zuordnung')
          .in('sevdesk_voucher_id', vIds)
        for (const r of (prot ?? []) as { id: string; sevdesk_voucher_id: string; files: { path: string; name: string }[]; zuordnung: unknown }[]) {
          const links: { name: string; url: string }[] = []
          for (const f of r.files ?? []) {
            const { data: signed } = await supabaseAdmin.storage.from('belege').createSignedUrl(f.path, 3600)
            if (signed?.signedUrl) links.push({ name: f.name, url: signed.signedUrl })
          }
          viewer[r.sevdesk_voucher_id] = { links, zuordnung: r.zuordnung ?? null, rowId: r.id }
        }
      } catch { /* fail-soft */ }
    }

    const { data: listings } = await supabaseAdmin
      .from('listings').select('id, title, location_group').eq('is_active', true).order('title')
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
      // §243p: Kanzem = angemietetes UG-Objekt MIT Mietvertrag (noch ohne
      // Listings) — eigene Kostenstelle, bis die Kanzem-Wohnungen live sind
      kostenstellen: ['Allgemein', ...groups, 'Kanzem', ...titles],
      clearingLabels: ['Verrechnung Booking.com', 'Verrechnung Airbnb', 'Verrechnung FeWo-direkt', 'Verrechnung Direkt/Website', 'Verrechnung HomeToGo'],
      inboxCount: inboxCount ?? 0,
      zeitraumTage: days,
      viewer,
      kiAnalysen,
      wohnungen: (listings ?? []).map((l) => ({ id: String(l.id), title: String(l.title), group: l.location_group ? String(l.location_group) : null })),
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
      // §243f: Analyse-Kern lebt jetzt in lib/beleg-ki (geteilt mit der
      // Voll-Automatik im Mail-Scan) — Antwort-Shape unveraendert.
      // §243ad CACHE-FIRST: vorab gespeicherte Analyse (Eingang/Upload)
      // instant zurueckgeben; { force: true } erzwingt eine frische Analyse.
      const vid = String(b.voucherId)
      if (b.force !== true) {
        try {
          const { data: row } = await supabaseAdmin
            .from('beleg_inbox').select('ki_analyse').eq('sevdesk_voucher_id', vid).maybeSingle()
          const cached = row?.ki_analyse as Record<string, unknown> | null
          if (cached && cached.accountDatevId) {
            const { ok: _o, weg: _w, error: _e, ...shape } = cached as { ok?: unknown; weg?: unknown; error?: unknown }
            return NextResponse.json(shape, NO_STORE)
          }
        } catch { /* Spalte fehlt noch — frisch analysieren */ }
      }
      const ki = await analysiereBeleg(vid)
      if (!ki.ok) return NextResponse.json({ error: ki.error ?? 'Analyse fehlgeschlagen.' }, { status: ki.error === 'Beleg nicht gefunden.' ? 404 : 502 })
      const { speichereKiAnalyse } = await import('@/lib/beleg-ki')
      await speichereKiAnalyse(vid, ki)
      const { ok: _ok, weg: _weg, error: _err, ...shape } = ki
      return NextResponse.json(shape, NO_STORE)
    }

    // §243h: BELEGDATUM-Reparatur — Mail-Scan-Belege tragen das SCAN-Datum
    // statt des Rechnungsdatums (UStVA-Periode!). Vision liest das echte
    // Datum, Partial-PUT korrigiert. dryRun = Report ohne Aenderung.
    if (b.action === 'datum-fix') {
      const dryRun = b.dryRun !== false
      const scanTag = typeof b.scanDatum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.scanDatum) ? b.scanDatum : '2026-08-01'
      const limit = Math.min(Math.max(Number(b.limit) || 10, 1), 15)
      const { sevJson, sevFetch } = await import('@/lib/sevdesk')
      const verdacht: { id: string; status: number; lieferant: string; datum: string; sumGross: number }[] = []
      for (const st of [50, 100, 1000]) {
        for (let offset = 0; offset < 500; offset += 100) {
          const list = await sevJson<Record<string, unknown>[]>(`/Voucher?status=${st}&limit=100&offset=${offset}`)
          for (const v of list ?? []) {
            const d = v.voucherDate ? String(v.voucherDate).slice(0, 10) : ''
            if (d === scanTag) verdacht.push({ id: String(v.id), status: Number(v.status), lieferant: String(v.supplierName ?? '?'), datum: d, sumGross: Number(v.sumGross ?? 0) })
          }
          if (!list || list.length < 100) break
        }
      }
      const report: string[] = []
      let fixed = 0
      const t0 = Date.now()
      // §243h-Kalibrierung: PUT geht NUR auf Entwuerfe ("only update draft
      // documents") — gebuchte Belege brauchen den Reset-Zyklus; bezahlte
      // verlieren dabei die Zahlung → Phase B verknuepft neu
      const neuVerknuepfen: { id: string; sumGross: number; datum: string; lieferant: string }[] = []
      for (const v of verdacht.slice(0, limit)) {
        if (Date.now() - t0 > 80_000) { report.push('Zeitbudget — Rest im naechsten Lauf'); break }
        const pdf = await pdfForVoucher(v.id)
        if (!pdf) { report.push(`${v.lieferant} ${v.id}: kein Dokument`); continue }
        try {
          const raw = await askClaudeWithFile(
            'Lies NUR das RECHNUNGS-/BELEGDATUM dieses Dokuments. Antworte NUR mit JSON: {"datum": "<JJJJ-MM-TT oder null>"}',
            'Belegdatum lesen.', { mediaType: pdf.mediaType, base64: pdf.base64 }, 800)
          const oj = parseJsonLoose(raw)
          const echt = typeof oj.datum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(oj.datum) ? oj.datum : null
          if (!echt) { report.push(`${v.lieferant} ${v.id}: Datum nicht lesbar`); continue }
          if (echt === v.datum) { report.push(`${v.lieferant} ${v.id}: Datum stimmt (${echt})`); continue }
          if (dryRun) { report.push(`${v.lieferant} ${v.id}: ${v.datum} → ${echt} (dryRun, St ${v.status})`); continue }
          if (v.status === 1000) await sevFetch(`/Voucher/${v.id}/resetToOpen`, { method: 'PUT', body: '{}' })
          if (v.status >= 100) await sevFetch(`/Voucher/${v.id}/resetToDraft`, { method: 'PUT', body: '{}' })
          await sevJson(`/Voucher/${v.id}`, { method: 'PUT', body: JSON.stringify({ voucherDate: echt }) })
          if (v.status >= 100) {
            // zurueck auf "offen" — Positionen bleiben erhalten (kein posSave)
            await sevJson('/Voucher/Factory/saveVoucher', {
              method: 'POST',
              body: JSON.stringify({ voucher: { id: Number(v.id), objectName: 'Voucher', mapAll: true, status: 100 }, voucherPosSave: null, voucherPosDelete: null }),
            })
          }
          if (v.status === 1000 && v.sumGross > 0) neuVerknuepfen.push({ id: v.id, sumGross: v.sumGross, datum: echt, lieferant: v.lieferant })
          fixed++
          report.push(`${v.lieferant} ${v.id}: ${v.datum} → ${echt} ✓ (St ${v.status})`)
        } catch (e) {
          report.push(`${v.lieferant} ${v.id}: FEHLER ${String(e instanceof Error ? e.message : e).slice(0, 140)}`)
        }
      }
      // Phase B: die eben geloesten Zahlungen der Ex-1000er neu verknuepfen
      // (Transaktionen NACH den Resets laden — vorher waren sie verknuepft)
      let neuVerknuepft = 0
      if (neuVerknuepfen.length) {
        try {
          const banks = await findBankAccounts()
          const frei: { id: string; accountId: string; datum: string; betrag: number }[] = []
          for (const bank of banks) {
            for (const t of await listBankTransactions(bank.id, 400)) {
              if (Number(t.status) !== 100 || Number(t.amount) >= 0) continue
              frei.push({ id: String(t.id), accountId: bank.id, datum: String(t.valueDate ?? t.entryDate ?? '').slice(0, 10), betrag: Number(t.amount) })
            }
          }
          const used = new Set<string>()
          for (const nv of neuVerknuepfen) {
            const kand = frei.filter((t) => !used.has(t.id) && Math.abs(Math.abs(t.betrag) - nv.sumGross) < 0.005)
            kand.sort((x, y) => Math.abs(Date.parse(x.datum) - Date.parse(nv.datum)) - Math.abs(Date.parse(y.datum) - Date.parse(nv.datum)))
            const tx = kand[0]
            if (!tx) { report.push(`${nv.lieferant} ${nv.id}: Zahlung nicht re-matchbar (Bankabgleich)`); continue }
            await sevJson(`/Voucher/${nv.id}/bookAmount`, {
              method: 'PUT',
              body: JSON.stringify({
                amount: -nv.sumGross,
                date: Math.floor(Date.parse(tx.datum + 'T12:00:00Z') / 1000),
                type: 'FULL_PAYMENT',
                checkAccount: { id: Number(tx.accountId), objectName: 'CheckAccount' },
                checkAccountTransaction: { id: Number(tx.id), objectName: 'CheckAccountTransaction' },
              }),
            })
            used.add(tx.id)
            neuVerknuepft++
          }
        } catch (e) { report.push(`Phase B: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`) }
      }
      return NextResponse.json({ verdacht: verdacht.length, geprueft: Math.min(limit, verdacht.length), korrigiert: fixed, zahlungNeu: neuVerknuepft, report }, NO_STORE)
    }

    // §243c: Alle Belege EINES Lieferanten (offen 100 + bezahlt 1000) —
    // Grundlage fuer den Leistungsart-Audit (VP Glanzteam)
    if (b.action === 'lieferant-belege') {
      const lief = String(b.lieferant ?? '').trim()
      if (!lief) return NextResponse.json({ error: 'lieferant noetig.' }, { status: 400 })
      const { sevJson } = await import('@/lib/sevdesk')
      const found: { id: string; status: number; datum: string | null; sumGross: number | null; beschreibung: string | null }[] = []
      for (const st of [50, 100, 1000]) {
        for (let offset = 0; offset < 300; offset += 100) {
          const list = await sevJson<Record<string, unknown>[]>(`/Voucher?status=${st}&limit=100&offset=${offset}&supplierName=${encodeURIComponent(lief)}`)
          for (const v of list ?? []) {
            found.push({
              id: String(v.id), status: Number(v.status),
              datum: v.voucherDate ? String(v.voucherDate).slice(0, 10) : null,
              sumGross: v.sumGross != null ? Number(v.sumGross) : null,
              beschreibung: (v.description as string | null) ?? null,
            })
          }
          if (!list || list.length < 100) break
        }
      }
      return NextResponse.json({ anzahl: found.length, belege: found }, NO_STORE)
    }

    // §243c: Leistungsart eines Belegs klassifizieren (Vision) — fuer den
    // Audit gemischter Lieferanten
    if (b.action === 'beleg-klassifizieren') {
      const pdf = await pdfForVoucher(String(b.voucherId))
      if (!pdf) return NextResponse.json({ leistung: 'KEIN_PDF' }, NO_STORE)
      const raw = await askClaudeWithFile(
        'Klassifiziere die abgerechnete LEISTUNG dieser Rechnung einer Ferienwohnungs-Vermietung. Antworte NUR mit JSON: {"leistung": "reinigung"|"gaestemanagement"|"gemischt"|"anderes", "betrag_brutto": <Zahl oder null>, "hinweis": "<1 kurzer Satz: was wird abgerechnet>"}',
        'Beleg klassifizieren.',
        { mediaType: pdf.mediaType, base64: pdf.base64 }, 1200)
      const oj = parseJsonLoose(raw)
      return NextResponse.json({
        leistung: typeof oj.leistung === 'string' ? oj.leistung : 'unklar',
        betrag: typeof oj.betrag_brutto === 'number' ? Math.round(oj.betrag_brutto * 100) / 100 : null,
        hinweis: String(oj.hinweis ?? '').slice(0, 200),
      }, NO_STORE)
    }

    // §243j: Merkregel DIREKT anlegen (fuer Bestands-Faelle, deren
    // Buchungen vor dem Regel-Feature liefen — z. B. die 21 Entnahmen)
    if (b.action === 'eigen-regel') {
      const typ = String(b.typ ?? '')
      const betrag = Math.round(Number(b.betrag) * 100) / 100
      if (!['miete', 'privat', 'sonstiges'].includes(typ) || !Number.isFinite(betrag) || betrag <= 0) {
        return NextResponse.json({ error: 'typ (miete|privat|sonstiges) + betrag noetig.' }, { status: 400 })
      }
      const accountDatevId = Number(b.accountDatevId)
      const gdx = await getReceiptGuidance()
      const hit = gdx.find((x) => x.accountDatevId === accountDatevId)
      if (!hit) return NextResponse.json({ error: 'accountDatevId aus dem Katalog noetig.' }, { status: 400 })
      await saveEigenRegel({
        typ: typ as 'miete' | 'privat' | 'sonstiges',
        empfaenger: String(b.empfaenger ?? '').trim().slice(0, 120),
        betrag,
        zweck: String(b.zweck ?? '').trim().slice(0, 160),
        position: { accountDatevId, taxRate: [19, 7, 0].includes(Number(b.taxRate)) ? Number(b.taxRate) : 0, amountGross: betrag, name: String(b.posName ?? b.zweck ?? '').slice(0, 120) },
        grundlage: String(b.grundlage ?? 'Wiederkehrende Zahlung (Merkregel).').slice(0, 300),
        kostenstelle: typeof b.kostenstelle === 'string' && b.kostenstelle && b.kostenstelle !== 'Allgemein' ? b.kostenstelle : null,
        zuordnung: b.zuordnung && typeof b.zuordnung === 'object' ? b.zuordnung as Record<string, unknown> : null,
        // §243o: Zweck-Bedingung — Regel greift nur bei passendem Verwendungszweck
        zweckMuss: typeof b.zweckMuss === 'string' && b.zweckMuss.trim() ? b.zweckMuss.trim().slice(0, 60) : null,
      })
      return NextResponse.json({ ok: true }, NO_STORE)
    }

    // §243: Zahlung OHNE Fremdbeleg buchen — App generiert einen Eigenbeleg
    // (PDF), legt ihn als sevdesk-Beleg an, bucht die Positionen und
    // verknuepft die Bank-Transaktion. Typen: miete | kredit | privat | sonstiges
    if (b.action === 'eigenbeleg') {
      const typ = String(b.typ ?? '')
      const betrag = Math.round(Number(b.betrag) * 100) / 100
      const empfaenger = String(b.empfaenger ?? '').trim().slice(0, 120)
      const zweck = String(b.zweck ?? '').trim().slice(0, 160)
      const datum = typeof b.txDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(b.txDate) ? b.txDate.slice(0, 10) : new Date().toISOString().slice(0, 10)
      // §243s: fuer Clearing-Eigenbelege darf das Belegdatum direkt kommen
      const belegDatumDirekt = typeof b.belegDatum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.belegDatum) ? b.belegDatum : null
      // §243o: EINGANGS-Eigenbeleg (Erstattung/Privateinlage/Auslagenausgleich)
      const richtung: 'ausgabe' | 'eingang' = b.richtung === 'eingang' ? 'eingang' : 'ausgabe'
      if (richtung === 'eingang' && !['privat', 'sonstiges'].includes(typ)) {
        return NextResponse.json({ error: 'Bei Eingaengen nur typ privat (Einlage) oder sonstiges.' }, { status: 400 })
      }
      if (!['miete', 'kredit', 'privat', 'sonstiges'].includes(typ)) return NextResponse.json({ error: 'typ (miete|kredit|privat|sonstiges) noetig.' }, { status: 400 })
      if (!Number.isFinite(betrag) || betrag <= 0) return NextResponse.json({ error: 'betrag (>0) noetig.' }, { status: 400 })
      if (!empfaenger || !zweck) return NextResponse.json({ error: 'empfaenger und zweck noetig.' }, { status: 400 })
      const eigenClearing = typeof b.clearingLabel === 'string' && b.clearingLabel.startsWith('Verrechnung') ? b.clearingLabel : null
      if (!eigenClearing && (!b.txId || !b.txAccountId)) return NextResponse.json({ error: 'txId+txAccountId oder clearingLabel noetig.' }, { status: 400 })

      const guidance = await getReceiptGuidance()
      const byNr = (nr: string) => {
        const hit = guidance.find((x) => x.accountNumber === nr)
        if (!hit) throw new Error(`Konto ${nr} nicht im Katalog.`)
        return hit
      }
      const positionen: { accountDatevId: number; taxRate: number; amountGross: number; name: string }[] = []
      let grundlage = ''
      if (typ === 'miete') {
        const tax = Number(b.taxRate) === 19 ? 19 : 0
        positionen.push({ accountDatevId: byNr('6310').accountDatevId, taxRate: tax, amountGross: betrag, name: `Miete/Pacht \u2014 ${zweck}` })
        grundlage = 'Dauerschuldverhaeltnis (Mietvertrag). Miete/Pacht fuer unbewegliche Wirtschaftsgueter, Konto 6310' + (tax === 0 ? ', ohne USt-Ausweis (Vermietung durch Privatperson/ohne Option).' : '.')
      } else if (typ === 'kredit') {
        const zins = Math.round(Number(b.zinsAnteil) * 100) / 100
        if (!Number.isFinite(zins) || zins < 0 || zins > betrag) return NextResponse.json({ error: 'zinsAnteil (0 bis betrag) noetig.' }, { status: 400 })
        const tilgung = Math.round((betrag - zins) * 100) / 100
        if (zins > 0) positionen.push({ accountDatevId: byNr('7300').accountDatevId, taxRate: 0, amountGross: zins, name: 'Zinsanteil (Betriebsausgabe, Konto 7300)' })
        if (tilgung > 0) {
          const tk = await resolveTilgungKonto()
          positionen.push({ accountDatevId: tk.accountDatevId, taxRate: 0, amountGross: tilgung, name: `Tilgungsanteil (erfolgsneutral, Konto ${tk.kontoNr})` })
        }
        grundlage = 'Darlehensrate gemaess Darlehensvertrag/Tilgungsplan. NUR der Zinsanteil ist Betriebsausgabe; die Tilgung ist erfolgsneutral (keine Betriebsausgabe). Nachweis Zinsanteil: Zinsbescheinigung/Kontoauszug der Bank.'
      } else if (typ === 'privat') {
        if (richtung === 'eingang') {
          // Privateinlage: 2180 falls im Katalog, sonst 2100 (Kapitalkonto)
          const einlage = guidance.find((x) => x.accountNumber === '2180') ?? byNr('2100')
          positionen.push({ accountDatevId: einlage.accountDatevId, taxRate: 0, amountGross: betrag, name: `Privateinlage (Konto ${einlage.accountNumber})` })
          grundlage = 'Privateinlage \u2014 keine Betriebseinnahme, reine Kapitalkonten-Bewegung.'
        } else {
          positionen.push({ accountDatevId: byNr('2100').accountDatevId, taxRate: 0, amountGross: betrag, name: 'Privatentnahme (Konto 2100)' })
          grundlage = 'Privatentnahme \u2014 keine Betriebsausgabe, reine Kapitalkonten-Bewegung.'
        }
      } else {
        const katId = Number(b.accountDatevId)
        const hit = guidance.find((x) => x.accountDatevId === katId)
        if (!hit) return NextResponse.json({ error: 'accountDatevId aus dem Katalog noetig.' }, { status: 400 })
        const tax = [19, 7, 0].includes(Number(b.taxRate)) ? Number(b.taxRate) : 0
        positionen.push({ accountDatevId: hit.accountDatevId, taxRate: tax, amountGross: betrag, name: `${hit.accountName} (Konto ${hit.accountNumber})` })
        grundlage = richtung === 'eingang'
          ? 'Eigenbeleg fuer Zahlungseingang ohne Fremdbeleg (z. B. Erstattung/Auslagenausgleich).'
          : 'Eigenbeleg fuer Zahlung ohne Fremdbeleg.'
      }

      const r = await bucheEigenbeleg({
        empfaenger, datum: belegDatumDirekt ?? datum, zweck, positionen, grundlage,
        kostenstelle: typeof b.kostenstelle === 'string' && b.kostenstelle && b.kostenstelle !== 'Allgemein' ? b.kostenstelle : null,
        zuordnung: b.zuordnung && typeof b.zuordnung === 'object' ? b.zuordnung as Record<string, unknown> : null,
        ...(eigenClearing
          ? { clearingLabel: eigenClearing, txDate: belegDatumDirekt ?? datum }
          : { txId: String(b.txId), txAccountId: String(b.txAccountId), txDate: datum }),
        richtung,
      })
      // §243j MERKREGEL: dieselbe wiederkehrende Zahlung (Empfaenger +
      // exakter Betrag) bucht der taegliche Lauf kuenftig automatisch —
      // Privatentnahmen/Mieten/Abos fasst der Inhaber nie wieder an
      // §243o: keineRegel unterdrueckt das Merken (Batch-Buchungen mit
      // wechselnder Zuordnung wie MONTANA — Regeln kommen dort explizit
      // via eigen-regel mit zweckMuss); Eingaenge merkt der Lauf nie
      if (r.ok && positionen.length === 1 && typ !== 'kredit' && b.keineRegel !== true && richtung !== 'eingang') {
        await saveEigenRegel({
          typ: typ as 'miete' | 'privat' | 'sonstiges',
          empfaenger, betrag, zweck, position: positionen[0], grundlage,
          kostenstelle: typeof b.kostenstelle === 'string' && b.kostenstelle && b.kostenstelle !== 'Allgemein' ? b.kostenstelle : null,
          zuordnung: b.zuordnung && typeof b.zuordnung === 'object' ? b.zuordnung as Record<string, unknown> : null,
        })
      }
      return NextResponse.json(r, r.ok ? NO_STORE : { status: 502 })
    }

    if (b.action === 'verbuchen') {
      const amountGross = Number(b.amountGross)
      const accountDatevId = Number(b.accountDatevId)
      const taxRate = Number(b.taxRate)
      // §243y: MEHRERE Positionen (gemischte Belege wie Hotel-Klausur:
      // betrieblicher Anteil + Privatanteil mit verschiedenen Konten/
      // Steuersätzen) — gewinnen über die Einzel-Felder; bookAmount läuft
      // über die Brutto-Summe
      const posRaw = Array.isArray(b.positionen) ? (b.positionen as Record<string, unknown>[]) : null
      const positionen = posRaw
        ? posRaw
            .map((p) => ({
              accountDatevId: Number(p?.accountDatevId),
              taxRate: [19, 7, 0].includes(Number(p?.taxRate)) ? Number(p?.taxRate) : 0,
              amountGross: Math.round(Number(p?.amountGross) * 100) / 100,
              isAsset: p?.isAsset === true,
            }))
            .filter((p) => Number.isFinite(p.accountDatevId) && Number.isFinite(p.amountGross) && p.amountGross > 0)
        : null
      if (!b.voucherId || (!positionen?.length && (!Number.isFinite(amountGross) || amountGross <= 0 || !Number.isFinite(accountDatevId)))) {
        return NextResponse.json({ error: 'voucherId und (accountDatevId + amountGross > 0) ODER positionen[] nötig.' }, { status: 400 })
      }
      // §243b: Konto 5923 (EU-Portal-Provisionen) braucht taxRule 14
      // (REV_CHARGE_13B_EU_0) — Regel 5 lehnt sevdesk fuer 5923 mit 422 ab
      // (Kalibrierung 1.8.: "Allowed tax rules: TaxRule(id=14,
      // code=REV_CHARGE_13B_EU_0)"; die Spec-Regelliste 1-17 ist
      // unvollstaendig). Sonst falsche UStVA-Kennziffern.
      const gd = await getReceiptGuidance()
      const kontoNr = positionen?.length ? undefined : gd.find((x) => x.accountDatevId === accountDatevId)?.accountNumber
      const r = await bookSevVoucher(String(b.voucherId), {
        accountDatevId: positionen?.length ? positionen[0].accountDatevId : accountDatevId,
        taxRate: positionen?.length ? positionen[0].taxRate : ([19, 7, 0].includes(taxRate) ? taxRate : 19),
        amountGross: positionen?.length ? positionen[0].amountGross : amountGross,
        ...(positionen?.length ? { positions: positionen } : {}),
        ...(kontoNr === '5923' ? { taxRuleId: 14 } : {}),
        // 'Allgemein' loescht eine vorhandene KSt explizit ('' — §243c),
        // fehlende Angabe laesst sie unangetastet (null)
        costCentreName: typeof b.kostenstelle === 'string' && b.kostenstelle
          ? (b.kostenstelle === 'Allgemein' ? '' : b.kostenstelle) : null,
        isAsset: b.anlagegut === true,
        // §243q: Gutschrift/Erstattung — Beleg wird EINNAHME (creditDebit D,
        // bookAmount positiv gegen einen Bank-EINGANG)
        ...(b.einnahme === true ? { einnahme: true } : {}),
        // §243h: echtes Rechnungsdatum aus der KI-Analyse durchreichen
        ...(typeof b.belegDatum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.belegDatum) ? { voucherDate: b.belegDatum } : {}),
        ...(b.txId ? { txId: String(b.txId), txAccountId: String(b.txAccountId ?? ''), txDate: typeof b.txDate === 'string' ? b.txDate : undefined } : {}),
        // §243s: Portal-Netting — Zahlung gegen das Verrechnungskonto
        ...(typeof b.clearingLabel === 'string' && b.clearingLabel.startsWith('Verrechnung')
          ? { clearingLabel: b.clearingLabel, txDate: typeof b.txDate === 'string' ? b.txDate : undefined } : {}),
      })
      // interne Wohnungs-Zuordnung mitschreiben (fail-soft)
      if (r.ok && b.zuordnung && typeof b.zuordnung === 'object') {
        await saveZuordnung(String(b.voucherId), null, b.zuordnung as Record<string, unknown>)
      }
      // §242b: aus der Entscheidung LERNEN (nächster Beleg desselben
      // Lieferanten bekommt sie als Vorschlag) — NICHT bei Mehrfach-
      // Positionen (Split ist einzelfallspezifisch, §243y)
      if (r.ok && !positionen?.length && typeof b.lieferant === 'string' && b.lieferant.trim()) {
        await saveGelernt(b.lieferant, {
          accountDatevId, taxRate: [19, 7, 0].includes(taxRate) ? taxRate : 19,
          anlagegut: b.anlagegut === true,
          at: new Date().toISOString(),
        })
      }
      return NextResponse.json(r, r.ok ? NO_STORE : { status: 502 })
    }

    // §243s: NETTING-Zahlung fuer einen FERTIG gebuchten Beleg — bookAmount
    // gegen das Verrechnungskonto, OHNE den Beleg anzufassen (Portale, die
    // Provisionen mit den Auszahlungen verrechnen: Booking/FeWo/Airbnb)
    if (b.action === 'clearing-zahlung') {
      const label = typeof b.clearingLabel === 'string' && b.clearingLabel.startsWith('Verrechnung') ? b.clearingLabel : null
      if (!label || !/^\d{3,15}$/.test(String(b.voucherId ?? ''))) {
        return NextResponse.json({ error: 'voucherId + clearingLabel noetig.' }, { status: 400 })
      }
      const { sevJson, ensureClearingAccount } = await import('@/lib/sevdesk')
      const vRaw = await sevJson<{ sumGross?: unknown; voucherDate?: unknown; status?: unknown; creditDebit?: unknown }[] | { sumGross?: unknown; voucherDate?: unknown; status?: unknown; creditDebit?: unknown }>(`/Voucher/${b.voucherId}`)
      const vv = Array.isArray(vRaw) ? vRaw[0] : vRaw
      if (!vv) return NextResponse.json({ error: 'Beleg nicht gefunden.' }, { status: 404 })
      if (Number(vv.status) >= 1000) return NextResponse.json({ ok: true, hinweis: 'Beleg ist schon bezahlt.' }, NO_STORE)
      const gross = Math.round(Number(vv.sumGross) * 100) / 100
      if (!Number.isFinite(gross) || gross <= 0) return NextResponse.json({ error: 'Beleg ohne Betrag.' }, { status: 400 })
      const einnahme = String(vv.creditDebit) === 'D'
      const clearingId = await ensureClearingAccount(label)
      const datum = String(vv.voucherDate ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10)
      await sevJson(`/Voucher/${b.voucherId}/bookAmount`, {
        method: 'PUT',
        body: JSON.stringify({
          amount: einnahme ? gross : -gross,
          date: Math.floor(Date.parse(datum + 'T12:00:00Z') / 1000),
          type: 'FULL_PAYMENT',
          checkAccount: { id: Number(clearingId), objectName: 'CheckAccount' },
        }),
      })
      return NextResponse.json({ ok: true, betrag: einnahme ? gross : -gross, label }, NO_STORE)
    }

    // §242: interne Wohnungs-Zuordnung separat speichern
    if (b.action === 'zuordnung') {
      if (!b.zuordnung || typeof b.zuordnung !== 'object') return NextResponse.json({ error: 'zuordnung fehlt.' }, { status: 400 })
      const ok = await saveZuordnung(
        typeof b.voucherId === 'string' ? b.voucherId : null,
        typeof b.inboxId === 'string' ? b.inboxId : null,
        b.zuordnung as Record<string, unknown>)
      return NextResponse.json(ok ? { ok: true } : { error: 'Zuordnung nicht speicherbar (Migration 20260801_buchhaltung_v2 fehlt?).' }, ok ? NO_STORE : { status: 500 })
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
      const id = String(b.txId ?? '')
      if (!id) return NextResponse.json({ error: 'txId nötig.' }, { status: 400 })
      // ⚠️ §243o-BUGFIX: vorher wurde das GANZE buchhaltung-Settings-Objekt
      // ueberschrieben — ein „Kein Beleg noetig"-Klick haette eigenRegeln +
      // Gelerntes geloescht! Jetzt: vollstaendiger Merge.
      const { data: cur } = await supabaseAdmin
        .from('app_settings').select('value').eq('key', 'buchhaltung').maybeSingle()
      const val = (cur?.value ?? {}) as Record<string, unknown>
      const ignored = Array.isArray(val.ignoredTx) ? (val.ignoredTx as unknown[]).map(String) : []
      const next = b.on === false ? ignored.filter((x) => x !== id) : [...new Set([...ignored, id])].slice(-500)
      await supabaseAdmin.from('app_settings').upsert(
        { key: 'buchhaltung', value: { ...val, ignoredTx: next } }, { onConflict: 'key' })
      // §243o: Spiegel nach sevdesk — Transaktion als PRIVAT (300) markieren,
      // damit sie auch dort aus dem offenen Bankabgleich verschwindet;
      // Ruecknahme setzt sie zurueck auf offen (100). Best effort.
      const priv = await markTransactionPrivate(id, b.on !== false)
      return NextResponse.json({ ok: true, ignoriert: b.on !== false, sevdeskPrivat: priv.ok, ...(priv.error ? { sevdeskHinweis: priv.error } : {}) }, NO_STORE)
    }

    // §243o: BESTAND nachziehen — alle bisher nur in der App ignorierten
    // Transaktionen auch in sevdesk als PRIVAT markieren
    if (b.action === 'tx-privat-sync') {
      const ignored = await getIgnored()
      let okCount = 0
      const fehler: string[] = []
      for (const id of ignored) {
        const r = await markTransactionPrivate(id, true)
        if (r.ok) okCount++
        else fehler.push(`${id}: ${r.error ?? '?'}`)
        await new Promise((res) => setTimeout(res, 250))
      }
      return NextResponse.json({ ok: true, gesamt: ignored.length, privat: okCount, fehler: fehler.slice(0, 10) }, NO_STORE)
    }

    // §243o: Beleg loeschen (Import-Duplikate) — Kalibrier-Versuch, die
    // Spec kennt kein DELETE /Voucher; Fallback bleibt die sevdesk-UI
    if (b.action === 'voucher-delete') {
      if (b.confirm !== 'DELETE') return NextResponse.json({ error: "confirm: 'DELETE' noetig." }, { status: 400 })
      if (!/^\d{3,15}$/.test(String(b.voucherId ?? ''))) return NextResponse.json({ error: 'voucherId noetig.' }, { status: 400 })
      const r = await deleteSevVoucher(String(b.voucherId))
      return NextResponse.json(r, r.ok ? NO_STORE : { status: 502 })
    }

    // §243o: Settings-Integritaet (nach dem tx-ignorieren-Bug): Zaehler +
    // Regel-Keys — read-only Diagnose
    if (b.action === 'settings-check') {
      const { data: cur } = await supabaseAdmin
        .from('app_settings').select('value').eq('key', 'buchhaltung').maybeSingle()
      const val = (cur?.value ?? {}) as Record<string, unknown>
      const regeln = (val.eigenRegeln ?? {}) as Record<string, unknown>
      const gelernt = (val.gelernt ?? {}) as Record<string, unknown>
      const ign = Array.isArray(val.ignoredTx) ? val.ignoredTx.length : 0
      return NextResponse.json({
        eigenRegeln: Object.keys(regeln).length,
        regelKeys: Object.keys(regeln),
        gelernt: Object.keys(gelernt).length,
        ignoredTx: ign,
        topLevelKeys: Object.keys(val),
      }, NO_STORE)
    }

    return NextResponse.json({ error: 'Unbekannte action.' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e).slice(0, 300) }, { status: 500 })
  }
}
