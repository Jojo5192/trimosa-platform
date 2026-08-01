import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  listSevVouchers, getReceiptGuidance, updateSevVoucherCostCentre, bookSevVoucher,
} from '@/lib/sevdesk'
import { findBankAccounts, listBankTransactions, bookMoneyTransit, payoutClearingFor } from '@/lib/sevdesk-payouts'
import { askClaude, askClaudeWithFile, FAST_MODEL } from '@/lib/ai'
import { bucheEigenbeleg, resolveTilgungKonto } from '@/lib/eigenbeleg'

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

/** §242b: Die App LERNT aus jeder Verbuchung — je Lieferant die zuletzt
 *  gewählte Kategorie/Steuer/KSt/Zuordnung (app_settings 'buchhaltung'). */
type Gelernt = { accountDatevId: number; taxRate: number; anlagegut: boolean; at: string }
async function getBuchhaltungSettings(): Promise<{ ignoredTx?: string[]; gelernt?: Record<string, Gelernt> }> {
  const { data } = await supabaseAdmin
    .from('app_settings').select('value').eq('key', 'buchhaltung').maybeSingle()
  return (data?.value ?? {}) as { ignoredTx?: string[]; gelernt?: Record<string, Gelernt> }
}
async function saveGelernt(lieferant: string, g: Gelernt): Promise<void> {
  try {
    const cur = await getBuchhaltungSettings()
    const gelernt = { ...(cur.gelernt ?? {}), [lieferant.trim()]: g }
    // Deckel: älteste raus ab 300 Lieferanten
    const keys = Object.keys(gelernt)
    if (keys.length > 300) {
      keys.sort((a, b) => String(gelernt[a].at).localeCompare(String(gelernt[b].at)))
      for (const k of keys.slice(0, keys.length - 300)) delete gelernt[k]
    }
    await supabaseAdmin.from('app_settings').upsert(
      { key: 'buchhaltung', value: { ...cur, gelernt } }, { onConflict: 'key' })
  } catch { /* best effort */ }
}

/** §242c: PDF-Kopie eines sevdesk-Belegs aus dem Storage holen (base64) —
 *  Grundlage für die Vision-Analyse (echter Rechnungsinhalt statt Betreff). */
async function pdfForVoucher(voucherId: string): Promise<{ base64: string } | null> {
  try {
    const { data: row } = await supabaseAdmin
      .from('beleg_inbox').select('files').eq('sevdesk_voucher_id', voucherId).maybeSingle()
    const files = (row?.files ?? []) as { path: string; name: string }[]
    if (files.length) {
      const { data: file } = await supabaseAdmin.storage.from('belege').download(files[0].path)
      if (file) {
        const buf = Buffer.from(await file.arrayBuffer())
        if (buf.length <= 8_000_000) return { base64: buf.toString('base64') }
      }
    }
  } catch { /* weiter zum sevdesk-Fallback */ }
  // §243b: FALLBACK — das Original-PDF liegt bei ALLEN Belegen in sevdesk
  // (Bestands-Belege ohne Storage-Kopie, Provisionsrechnungen). Der
  // /Document/{id}/download-Endpoint ist nicht in der Public-Spec, existiert
  // aber (§233-Muster undokumentierte /api/v1-Endpoints) — defensiv geparst.
  try {
    const { sevJson, sevFetch } = await import('@/lib/sevdesk')
    const vRaw = await sevJson<{ document?: { id?: unknown } }[] | { document?: { id?: unknown } }>(`/Voucher/${voucherId}?embed=document`)
    const vObj = Array.isArray(vRaw) ? vRaw[0] : vRaw
    const docId = Number(vObj?.document?.id)
    if (!Number.isFinite(docId) || docId <= 0) return null
    const res = await sevFetch(`/Document/${docId}/download`)
    if (!res.ok) { console.warn(`[buchhaltung] Document-Download HTTP ${res.status} (Voucher ${voucherId})`); return null }
    const ct = res.headers.get('content-type') ?? ''
    if (ct.includes('json')) {
      // {objects: {content: <base64>, ...}} — Form defensiv
      const j = await res.json() as { objects?: { content?: string } | { content?: string }[] }
      const obj = Array.isArray(j.objects) ? j.objects[0] : j.objects
      const content = obj?.content
      if (typeof content === 'string' && content.length > 100) {
        const buf = Buffer.from(content, 'base64')
        if (buf.length > 200 && buf.length <= 8_000_000) return { base64: content }
      }
      return null
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 200 && buf.length <= 8_000_000) return { base64: buf.toString('base64') }
    return null
  } catch { return null }
}

/** §242c: erkannten Standort/Wohnungs-Hinweis auf KSt + interne Zuordnung
 *  mappen (KSt = Standort-Doktrin §240; Wohnung ohne Gruppe = eigener Standort). */
function standortZuKst(
  wohnung: string | null, standort: string | null,
  wohnungen: { id: string; title: string; group: string | null }[],
): { kst: string; zuordnung: Record<string, unknown> } | null {
  if (wohnung) {
    const w = wohnungen.find((x) => x.title.toLowerCase() === wohnung.toLowerCase().trim())
    if (w) return { kst: w.group ?? w.title, zuordnung: { modus: 'wohnung', listingIds: [w.id] } }
  }
  if (standort) {
    const groups = new Set(wohnungen.map((w) => w.group).filter(Boolean) as string[])
    const g = [...groups].find((x) => x.toLowerCase() === standort.toLowerCase().trim())
    if (g) return { kst: g, zuordnung: { modus: 'standort', standort: g } }
  }
  return null
}

async function getIgnored(): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('app_settings').select('value').eq('key', 'buchhaltung').maybeSingle()
  const v = (data?.value ?? {}) as { ignoredTx?: string[] }
  return Array.isArray(v.ignoredTx) ? v.ignoredTx.map(String) : []
}

/** §242: interne Wohnungs-Zuordnung ({modus, standort?, listingIds?}) auf
 *  der Protokollzeile speichern — via voucherId ODER inboxId; existiert zum
 *  Voucher noch keine Zeile, wird eine minimale angelegt. */
async function saveZuordnung(voucherId: string | null, inboxId: string | null, z: Record<string, unknown>): Promise<boolean> {
  const clean = {
    modus: ['allgemein', 'standort', 'wohnung', 'split'].includes(String(z.modus)) ? String(z.modus) : 'allgemein',
    ...(typeof z.standort === 'string' && z.standort ? { standort: z.standort.slice(0, 60) } : {}),
    ...(Array.isArray(z.listingIds) ? { listingIds: z.listingIds.map(String).slice(0, 10) } : {}),
    // §242c: optionale GEWICHTE (%) parallel zu listingIds — z. B. Heizkosten
    // nach Wohnungsgröße statt gleichmäßig
    ...(Array.isArray(z.anteile) && Array.isArray(z.listingIds) && z.anteile.length === z.listingIds.length
      ? { anteile: z.anteile.map((a) => Math.max(0, Math.min(100, Math.round(Number(a) * 10) / 10))).slice(0, 10) }
      : {}),
  }
  try {
    if (inboxId) {
      const { error } = await supabaseAdmin.from('beleg_inbox').update({ zuordnung: clean }).eq('id', inboxId)
      return !error
    }
    if (voucherId) {
      const { data: row, error: selErr } = await supabaseAdmin
        .from('beleg_inbox').select('id').eq('sevdesk_voucher_id', voucherId).maybeSingle()
      if (selErr) return false
      if (row) {
        const { error } = await supabaseAdmin.from('beleg_inbox').update({ zuordnung: clean }).eq('id', row.id)
        return !error
      }
      const { error } = await supabaseAdmin.from('beleg_inbox').insert({
        source: 'app', status: 'sevdesk', files: [], sevdesk_voucher_id: voucherId, zuordnung: clean,
      })
      return !error
    }
  } catch { /* fail-soft */ }
  return false
}

export async function GET(req: NextRequest) {
  const user = await requireFinance()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  if (req.nextUrl.searchParams.get('probe') === '1') return NextResponse.json({ ok: true }, NO_STORE)
  // §241: Zeitraum wählbar (Zahlungen-Reiter 45/90/180/365 Tage)
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days')) || 45, 7), 400)

  try {
    const [vouchers, guidance, ignored, banks] = await Promise.all([
      listSevVouchers([50, 100, 750]),
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

    // §242: Protokollzeilen zu den offenen Belegen (Beleg-Viewer + interne
    // Wohnungs-Zuordnung) — verknüpft über sevdesk_voucher_id
    const viewer: Record<string, { links: { name: string; url: string }[]; zuordnung: unknown; rowId: string }> = {}
    try {
      const vIds = vouchers.map((v) => v.id)
      if (vIds.length) {
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
      }
    } catch { /* Migration 20260801_buchhaltung_v2 fehlt noch — fail-soft */ }

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
      kostenstellen: ['Allgemein', ...groups, ...titles],
      clearingLabels: ['Verrechnung Booking.com', 'Verrechnung Airbnb', 'Verrechnung FeWo-direkt', 'Verrechnung Direkt/Website', 'Verrechnung HomeToGo'],
      inboxCount: inboxCount ?? 0,
      zeitraumTage: days,
      viewer,
      wohnungen: (listings ?? []).map((l) => ({ id: String(l.id), title: String(l.title), group: l.location_group ? String(l.location_group) : null })),
    }, NO_STORE)
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e).slice(0, 300) }, { status: 500 })
  }
}

/** KI-JSON robust extrahieren — Modelle haengen gern Erklaertext ans JSON. */
function parseJsonLoose(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/^\u0060\u0060\u0060(?:json)?\s*/i, '').replace(/\s*\u0060\u0060\u0060$/, '').trim()
  try { return JSON.parse(cleaned) } catch { /* Text um das JSON herum → balanced scan */ }
  const start = cleaned.indexOf('\u007B')
  if (start >= 0) {
    let depth = 0, inStr = false, esc = false
    for (let i = start; i < cleaned.length; i++) {
      const c = cleaned[i]
      if (esc) { esc = false; continue }
      if (c === '\\' && inStr) { esc = true; continue }
      if (c === '"') { inStr = !inStr; continue }
      if (!inStr) {
        if (c === '\u007B') depth++
        else if (c === '\u007D') { depth--; if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1)) }
      }
    }
  }
  throw new Error('Kein JSON in der KI-Antwort')
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
      const { sevJson } = await import('@/lib/sevdesk')
      const [vRaw, guidance, listResp, pdf0] = await Promise.all([
        sevJson<{ supplierName?: string; description?: string; voucherDate?: string }[] | { supplierName?: string; description?: string; voucherDate?: string }>(`/Voucher/${String(b.voucherId)}`),
        getReceiptGuidance(),
        supabaseAdmin.from('listings').select('id, title, location_group').eq('is_active', true),
        pdfForVoucher(String(b.voucherId)),
      ])
      const vObj = Array.isArray(vRaw) ? vRaw[0] : vRaw
      if (!vObj) return NextResponse.json({ error: 'Beleg nicht gefunden.' }, { status: 404 })
      const v = { supplierName: vObj.supplierName ?? null, description: vObj.description ?? null, voucherDate: vObj.voucherDate ?? null }
      const listRows = listResp.data
      const wohnungenListe = (listRows ?? []).map((l) => ({ id: String(l.id), title: String(l.title), group: l.location_group ? String(l.location_group) : null }))
      const wohnNamen = wohnungenListe.map((w) => `${w.title}${w.group ? ` (Standort ${w.group})` : ''}`).join(', ')
      const standorte = [...new Set(wohnungenListe.map((w) => w.group).filter(Boolean))].join(', ')
      const pdf = pdf0

      // §242d: Portal-PROVISIONSRECHNUNGEN deterministisch — die KI wählte
      // sonst mal 5965 „OHNE Vorsteuerabzug" (echte Steuerlast!) statt 5923
      // (§13b Reverse-Charge MIT Vorsteuerabzug = Nullsumme fuer
      // vorsteuerabzugsberechtigte Vermieter). Steuerlich gibt es hier genau
      // EINE richtige Antwort → kein KI-Wuerfeln.
      const provSupplier = /booking\.com|airbnb|expedia|hometogo/i.test(v.supplierName ?? '')
      const provText = /provisionsrechnung|invoice|commission/i.test(`${v.supplierName ?? ''} ${v.description ?? ''}`)
      if (provSupplier && provText) {
        const k5923 = guidance.find((x) => x.accountNumber === '5923')
        if (k5923) {
          // Betrag (NETTO) aus dem Rechnungs-PDF — Kategorie bleibt fest
          let provBetrag: number | null = null
          if (pdf) {
            try {
              const raw = await askClaudeWithFile(
                'Lies den GESAMTBETRAG dieser Provisionsrechnung (Reverse-Charge, ohne USt ausgewiesen = Nettobetrag). Antworte NUR mit JSON: {"betrag": <Zahl>}',
                `Lieferant: ${v.supplierName ?? '?'}`,
                { mediaType: 'application/pdf', base64: pdf.base64 }, 1200)
              const oj = parseJsonLoose(raw)
              if (typeof oj.betrag === 'number' && oj.betrag > 0) provBetrag = Math.round(oj.betrag * 100) / 100
            } catch { /* best effort */ }
          }
          return NextResponse.json({
            accountDatevId: k5923.accountDatevId, kategorie: k5923.accountName, nr: k5923.accountNumber,
            taxRate: 0,
            betrag: provBetrag,
            begruendung: 'Portal-Provisionsrechnung (EU-Anbieter) — feste Regel, keine KI-Wahl.',
            steuerHinweis: 'Reverse-Charge §13b UStG: TRIMOSA schuldet die USt und zieht sie ZUGLEICH als Vorsteuer (Konto 5923 — Nullsumme). Betrag = NETTOBETRAG der Rechnung.',
            anlagegut: false,
            nutzungsdauer: null,
          }, NO_STORE)
        }
      }

      // §242b/c: GELERNT — Kategorie/Steuer/Anlagegut vom letzten Mal;
      // Standort/KSt aber NUR aus echten Beleg-Indizien (Inhaber: VP
      // Glanzteam reinigt mehrere Standorte — nie blind den letzten nehmen)
      const { gelernt } = await getBuchhaltungSettings()
      const g = v.supplierName ? gelernt?.[v.supplierName.trim()] : undefined
      const hitG = g ? guidance.find((x) => x.accountDatevId === Number(g.accountDatevId)) : null
      if (g && hitG) {
        let ort: { kst: string; zuordnung: Record<string, unknown> } | null = null
        let ortText = ''
        // §243b: Der Mini-Vision-Check liest neben Standort-Indizien auch den
        // BETRAG mit — der Gelernt-Pfad lieferte sonst betrag null und die
        // Verbuchungs-Runde musste Folgebelege ohne Description-Betrag skippen
        let gBetrag: number | null = null
        // §243c: Ein Lieferant kann VERSCHIEDENE Leistungen abrechnen (VP
        // Glanzteam: Reinigung UND Gaestemanagement!) — die Mini-Vision prueft
        // deshalb, ob die GELERNTE Kategorie zur Leistung passt; bei Mismatch
        // faellt der Beleg in die Voll-Analyse statt blind zu uebernehmen
        let kategoriePasst = true
        if (pdf) {
          try {
            const raw = await askClaudeWithFile(
              `Du prüfst einen Buchhaltungsbeleg einer Ferienwohnungs-Vermietung. 1) BETRAG: Lies den Rechnungs-GESAMTBETRAG (brutto). 2) KATEGORIE-CHECK: Die bisher für diesen Lieferanten gelernte Buchungskategorie ist „${hitG.accountName}" (Konto ${hitG.accountNumber}) — passt sie zur tatsächlich abgerechneten LEISTUNG dieser Rechnung? 3) STANDORT-Indizien: Für welches Objekt sind die Kosten? Achte auf Leistungs-/Lieferadresse, Objekt-/Wohnungsnamen, Ortsnamen. Bekannte Wohnungen: ${wohnNamen}. Bekannte Standorte: ${standorte}. Antworte NUR mit JSON: {"betrag_brutto": <Zahl oder null>, "kategorie_passt": true|false, "wohnung": "<exakter Wohnungsname oder null>", "standort": "<exakter Standortname oder null>", "indiz": "<kurzes Zitat/Begründung oder null>"} — Standort NUR bei echten Indizien setzen, sonst null.`,
              `Lieferant: ${v.supplierName ?? '?'} · Beschreibung: ${(v.description ?? '').slice(0, 200)}`,
              { mediaType: 'application/pdf', base64: pdf.base64 }, 1800)
            const oj = parseJsonLoose(raw)
            if (typeof oj.betrag_brutto === 'number' && oj.betrag_brutto > 0) gBetrag = Math.round(oj.betrag_brutto * 100) / 100
            if (oj.kategorie_passt === false) kategoriePasst = false
            ort = standortZuKst(typeof oj.wohnung === 'string' ? oj.wohnung : null, typeof oj.standort === 'string' ? oj.standort : null, wohnungenListe)
            if (ort && typeof oj.indiz === 'string') ortText = ` \u00B7 Standort erkannt: ${String(oj.indiz).slice(0, 100)}`
          } catch { /* Vision best effort */ }
        }
        if (kategoriePasst) return NextResponse.json({
          gelernt: true,
          accountDatevId: hitG.accountDatevId, kategorie: hitG.accountName, nr: hitG.accountNumber,
          taxRate: [19, 7, 0].includes(Number(g.taxRate)) ? Number(g.taxRate) : 19,
          betrag: gBetrag,
          begruendung: '\u{1F9E0} Kategorie aus deiner letzten Buchung f\u00FCr diesen Lieferanten' + ortText,
          steuerHinweis: '',
          anlagegut: g.anlagegut === true,
          nutzungsdauer: null,
          ...(ort ? { kst: ort.kst, zuordnung: ort.zuordnung } : {}),
        }, NO_STORE)
      }

      const katalog = guidance.map((gg) => `${gg.accountDatevId}|${gg.accountNumber}|${gg.accountName}`).join('\n')
      const system = `Du bist Buchhaltungs-Assistent einer deutschen Ferienwohnungs-Vermietung (eGbR, E\u00DCR, umsatzsteuerpflichtig, SKR-Kontenrahmen). Ordne den Beleg der passenden Buchungskategorie zu und gib eine kurze STEUERLICHE Einsch\u00E4tzung. Antworte NUR mit JSON:
{"accountDatevId": <ID aus dem Katalog>, "kategorie": "<Name>", "taxRate": 19|7|0, "betrag_brutto": <Zahl oder null>, "begruendung": "<max 1 Satz>", "steuer_hinweis": "<1-2 S\u00E4tze: wie hier steuerlich schlau gebucht wird — z. B. Vorsteuerabzug, Reverse-Charge Paragraf 13b bei EU-Portalen (taxRate 0), GWG-Sofortabzug, Bewirtung 70 Prozent>", "anlagegut": true|false, "nutzungsdauer_jahre": <Zahl oder null>, "wohnung": "<exakter Wohnungsname bei ECHTEN Standort-Indizien im Beleg (Adresse/Objektname), sonst null>", "standort": "<exakter Standortname oder null>"}
Regeln: Es ist IMMER ein EINGANGSBELEG (Ausgabe an TRIMOSA) \u2014 NIEMALS Erl\u00F6s-/Umsatzkonten (4xxx) w\u00E4hlen, nur Aufwands-/Wareneingangs-Konten. Provisionsrechnungen von Booking.com/Airbnb (EU-Anbieter, Reverse-Charge Paragraf 13b): Kategorie 5923 (Sonstige Leistungen eines im anderen EU-Land ans\u00E4ssigen Unternehmers), taxRate 0, Betrag = Nettobetrag der Rechnung; im steuer_hinweis Paragraf 13b erw\u00E4hnen. accountDatevId MUSS aus dem Katalog stammen. Steuersatz sonst: Standard 19; 7 nur erm\u00E4\u00DFigt; 0 bei steuerfrei/Reverse-Charge. ANLAGEGUT nur bei abnutzbaren Wirtschaftsg\u00FCtern \u00FCber 800 Euro netto je Einzelgut (Nutzungsdauer nach amtlicher AfA-Tabelle: M\u00F6bel 13 J., IT 3 J., K\u00FCchenger\u00E4te 5-10 J.); bis 800 Euro netto = GWG-Sofortabzug (im steuer_hinweis erw\u00E4hnen). Bei anlagegut=true w\u00E4hle als Kategorie IMMER 6220 Abschreibungen auf Sachanlagen (sevdesk-Konvention: die Position wird als Anlagegut markiert, sevdesk aktiviert das Gut im Anlagenmodul) \u2014 nie ein Betriebsbedarf-Konto f\u00FCr Anlageg\u00FCter. Bekannte Wohnungen: ${wohnNamen}. Bekannte Standorte: ${standorte}. Betrag aus dem Beleg.`
      const userMsg = `BELEG:\nLieferant: ${v.supplierName ?? '\u2014'}\nBeschreibung: ${v.description ?? '\u2014'}\nDatum: ${v.voucherDate ?? '\u2014'}\n\nKATALOG (id|nr|name):\n${katalog.slice(0, 18000)}`
      // Mit PDF-Kopie liest die KI den ECHTEN Rechnungsinhalt (Vision)
      const raw = pdf
        ? await askClaudeWithFile(system, userMsg, { mediaType: 'application/pdf', base64: pdf.base64 }, 4000)
        : await askClaude(system, userMsg, 900, FAST_MODEL)
      const j = parseJsonLoose(raw)
      const hit = guidance.find((gg) => gg.accountDatevId === Number(j.accountDatevId))
      if (!hit) return NextResponse.json({ error: 'KI lieferte keine g\u00FCltige Kategorie \u2014 bitte manuell w\u00E4hlen.' }, { status: 502 })
      const ort = standortZuKst(typeof j.wohnung === 'string' ? j.wohnung : null, typeof j.standort === 'string' ? j.standort : null, wohnungenListe)
      return NextResponse.json({
        accountDatevId: hit.accountDatevId, kategorie: hit.accountName, nr: hit.accountNumber,
        taxRate: [19, 7, 0].includes(Number(j.taxRate)) ? Number(j.taxRate) : 19,
        betrag: typeof j.betrag_brutto === 'number' && j.betrag_brutto > 0 ? Math.round(j.betrag_brutto * 100) / 100 : null,
        begruendung: String(j.begruendung ?? '').slice(0, 200),
        steuerHinweis: String(j.steuer_hinweis ?? '').slice(0, 400),
        anlagegut: j.anlagegut === true,
        nutzungsdauer: typeof j.nutzungsdauer_jahre === 'number' ? j.nutzungsdauer_jahre : null,
        ...(ort ? { kst: ort.kst, zuordnung: ort.zuordnung } : {}),
      }, NO_STORE)
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
        { mediaType: 'application/pdf', base64: pdf.base64 }, 1200)
      const oj = parseJsonLoose(raw)
      return NextResponse.json({
        leistung: typeof oj.leistung === 'string' ? oj.leistung : 'unklar',
        betrag: typeof oj.betrag_brutto === 'number' ? Math.round(oj.betrag_brutto * 100) / 100 : null,
        hinweis: String(oj.hinweis ?? '').slice(0, 200),
      }, NO_STORE)
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
      if (!['miete', 'kredit', 'privat', 'sonstiges'].includes(typ)) return NextResponse.json({ error: 'typ (miete|kredit|privat|sonstiges) noetig.' }, { status: 400 })
      if (!Number.isFinite(betrag) || betrag <= 0) return NextResponse.json({ error: 'betrag (>0) noetig.' }, { status: 400 })
      if (!empfaenger || !zweck) return NextResponse.json({ error: 'empfaenger und zweck noetig.' }, { status: 400 })
      if (!b.txId || !b.txAccountId) return NextResponse.json({ error: 'txId und txAccountId noetig.' }, { status: 400 })

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
        positionen.push({ accountDatevId: byNr('2100').accountDatevId, taxRate: 0, amountGross: betrag, name: 'Privatentnahme (Konto 2100)' })
        grundlage = 'Privatentnahme \u2014 keine Betriebsausgabe, reine Kapitalkonten-Bewegung.'
      } else {
        const katId = Number(b.accountDatevId)
        const hit = guidance.find((x) => x.accountDatevId === katId)
        if (!hit) return NextResponse.json({ error: 'accountDatevId aus dem Katalog noetig.' }, { status: 400 })
        const tax = [19, 7, 0].includes(Number(b.taxRate)) ? Number(b.taxRate) : 0
        positionen.push({ accountDatevId: hit.accountDatevId, taxRate: tax, amountGross: betrag, name: `${hit.accountName} (Konto ${hit.accountNumber})` })
        grundlage = 'Eigenbeleg fuer Zahlung ohne Fremdbeleg.'
      }

      const r = await bucheEigenbeleg({
        empfaenger, datum, zweck, positionen, grundlage,
        kostenstelle: typeof b.kostenstelle === 'string' && b.kostenstelle && b.kostenstelle !== 'Allgemein' ? b.kostenstelle : null,
        zuordnung: b.zuordnung && typeof b.zuordnung === 'object' ? b.zuordnung as Record<string, unknown> : null,
        txId: String(b.txId), txAccountId: String(b.txAccountId), txDate: datum,
      })
      return NextResponse.json(r, r.ok ? NO_STORE : { status: 502 })
    }

    if (b.action === 'verbuchen') {
      const amountGross = Number(b.amountGross)
      const accountDatevId = Number(b.accountDatevId)
      const taxRate = Number(b.taxRate)
      if (!b.voucherId || !Number.isFinite(amountGross) || amountGross <= 0 || !Number.isFinite(accountDatevId)) {
        return NextResponse.json({ error: 'voucherId, accountDatevId und amountGross (>0) nötig.' }, { status: 400 })
      }
      // §243b: Konto 5923 (EU-Portal-Provisionen) braucht taxRule 14
      // (REV_CHARGE_13B_EU_0) — Regel 5 lehnt sevdesk fuer 5923 mit 422 ab
      // (Kalibrierung 1.8.: "Allowed tax rules: TaxRule(id=14,
      // code=REV_CHARGE_13B_EU_0)"; die Spec-Regelliste 1-17 ist
      // unvollstaendig). Sonst falsche UStVA-Kennziffern.
      const gd = await getReceiptGuidance()
      const kontoNr = gd.find((x) => x.accountDatevId === accountDatevId)?.accountNumber
      const r = await bookSevVoucher(String(b.voucherId), {
        accountDatevId,
        taxRate: [19, 7, 0].includes(taxRate) ? taxRate : 19,
        amountGross,
        ...(kontoNr === '5923' ? { taxRuleId: 14 } : {}),
        // 'Allgemein' loescht eine vorhandene KSt explizit ('' — §243c),
        // fehlende Angabe laesst sie unangetastet (null)
        costCentreName: typeof b.kostenstelle === 'string' && b.kostenstelle
          ? (b.kostenstelle === 'Allgemein' ? '' : b.kostenstelle) : null,
        isAsset: b.anlagegut === true,
        ...(b.txId ? { txId: String(b.txId), txAccountId: String(b.txAccountId ?? ''), txDate: typeof b.txDate === 'string' ? b.txDate : undefined } : {}),
      })
      // interne Wohnungs-Zuordnung mitschreiben (fail-soft)
      if (r.ok && b.zuordnung && typeof b.zuordnung === 'object') {
        await saveZuordnung(String(b.voucherId), null, b.zuordnung as Record<string, unknown>)
      }
      // §242b: aus der Entscheidung LERNEN (nächster Beleg desselben
      // Lieferanten bekommt sie als Vorschlag)
      if (r.ok && typeof b.lieferant === 'string' && b.lieferant.trim()) {
        await saveGelernt(b.lieferant, {
          accountDatevId, taxRate: [19, 7, 0].includes(taxRate) ? taxRate : 19,
          anlagegut: b.anlagegut === true,
          at: new Date().toISOString(),
        })
      }
      return NextResponse.json(r, r.ok ? NO_STORE : { status: 502 })
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
