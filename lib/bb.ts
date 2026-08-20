import { supabaseAdmin } from '@/lib/supabase-admin'
import { askClaudeWithFile } from '@/lib/ai'
import { parseJsonLoose, sniffMediaType } from '@/lib/beleg-ki'

/**
 * 🏢 §271 BuchhaltungsButler-Anbindung (TRIMOSA Immobilien UG).
 * Belege aus der Beleg-Inbox, die der UG zugeordnet werden (firma='ug'),
 * wandern automatisch nach BuchhaltungsButler: nur wenn dort eine passende
 * ZAHLUNG existiert (Betrag exakt, Datum ±N Tage, Aussteller-Keyword als
 * Plausibilitäts-Anker) wird der Beleg hochgeladen, der Zahlung zugeordnet
 * und mit Sachkonto + Kostenstelle gebucht. Kein Treffer → 'wartet'
 * (täglicher Cron probiert erneut — Kartenzahlungen hinken dem Bon-Datum
 * nach), nach 21 Tagen → 'pruefen' + Buchhaltungs-Push.
 *
 * Review-Härtungen (§271): per-Tx-Persistenz SOFORT nach jedem assign/
 * posting (Teilfehler-Retry bucht nie doppelt), Nachbuchungs-Pfad für
 * 'zugeordnet' (Setup nachgetragen → Buchung wird nachgeholt, NIE neu
 * gematcht), Plausibilitäts-Pflicht beim Match (Keyword ODER beide Daten
 * im Fenster), Richtungsfilter gegen Gutschriften, robuster Betrags-
 * Parser (Tausendertrenner), Lauf-Lock, Pagination-Dedupe.
 *
 * API (Spec v1.9.1, INTEGRATION_BRIEF 20.08.): Basic Auth
 * api_client:api_secret + api_key im JSON-Body, alle Endpunkte POST.
 * ⚠️ Antwort-SHAPES defensiv geparst — Action 'tx-debug' kalibriert (§127).
 */

const BB_BASE = 'https://webapp.buchhaltungsbutler.de/api/v1'

export function bbConfigured(): boolean {
  return !!(process.env.BB_API_CLIENT && process.env.BB_API_SECRET && process.env.BB_API_KEY)
}

export async function bbCall(path: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  if (!bbConfigured()) throw new Error('BB-Envs fehlen (BB_API_CLIENT/SECRET/KEY)')
  const auth = Buffer.from(`${process.env.BB_API_CLIENT}:${process.env.BB_API_SECRET}`).toString('base64')
  const res = await fetch(BB_BASE + path, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: process.env.BB_API_KEY, ...body }),
  })
  const text = await res.text()
  let j: Record<string, unknown> = {}
  try { j = JSON.parse(text) } catch { /* Rohtext unten im Fehler */ }
  if (!res.ok || j.success === false) {
    throw new Error(`BB ${path} HTTP ${res.status}: ${String(j.message ?? text).slice(0, 200)}`)
  }
  return j
}

// ── Settings (app_settings 'bb_settings' — eigener Key, §243o-Wipe-Schutz) ──

export interface BbSettings {
  /** STANDARD-Kostenstelle (Fallback) — die eigentliche Wahl trifft je
   *  Beleg die KI aus den VORHANDENEN BB-Kostenstellen (Inhaber-Wunsch
   *  20.8.): Liefer-/Leistungsadresse/Objektname im Beleg entscheidet. */
  kostenstelleCode: string
  sachkonto: string
  zeitraumAb: string
  tolTage: number
  /** Vorzeichen-Konvention der BB-Abbuchungen (per tx-debug kalibrieren):
   *  'negativ' (Default) matcht nur Txs < 0 — verhindert, dass ein
   *  Ausgabenbeleg an einer GUTSCHRIFT (+38,68 Globus …) landet. */
  txRichtung: 'negativ' | 'positiv' | 'beide'
}

const BB_DEFAULTS: BbSettings = {
  kostenstelleCode: '', sachkonto: '', zeitraumAb: '2026-04-21', tolTage: 5, txRichtung: 'negativ',
}

export async function getBbSettings(): Promise<BbSettings> {
  const { data, error } = await supabaseAdmin
    .from('app_settings').select('value').eq('key', 'bb_settings').maybeSingle()
  if (error) throw new Error('bb_settings read failed: ' + error.message)
  return { ...BB_DEFAULTS, ...((data?.value as Partial<BbSettings>) ?? {}) }
}

export async function saveBbSettings(patch: Partial<BbSettings>): Promise<BbSettings> {
  const cur = await getBbSettings()
  const next = { ...cur, ...patch }
  const { error } = await supabaseAdmin
    .from('app_settings').upsert({ key: 'bb_settings', value: next }, { onConflict: 'key' })
  if (error) throw new Error('bb_settings save failed: ' + error.message)
  return next
}

// ── Stammdaten (Setup-Lauf) ──

function unwrapList(j: Record<string, unknown>): Record<string, unknown>[] {
  for (const k of ['data', 'cost_locations', 'postingaccounts', 'transactions', 'receipts']) {
    const v = j[k]
    if (Array.isArray(v)) return v as Record<string, unknown>[]
  }
  return []
}

export async function listBbCostLocations(): Promise<Record<string, unknown>[]> {
  return unwrapList(await bbCall('/cost-locations/get'))
}

export interface BbKst { code: string; name: string }

/** BB-Kostenstellen defensiv auf {code, name} normalisieren */
export function normKostenstellen(raw: Record<string, unknown>[]): BbKst[] {
  return raw
    .map((o) => ({
      code: String(o.code ?? o.cost_location ?? o.number ?? o.id ?? '').trim(),
      name: String(o.name ?? o.description ?? o.text ?? '').trim(),
    }))
    .filter((k) => k.code)
}

export async function listBbPostingAccounts(): Promise<Record<string, unknown>[]> {
  return unwrapList(await bbCall('/settings/get/postingaccounts'))
}

// ── Zahlungen ──

export interface BbTx {
  id: string
  betrag: number
  datum: string | null // JJJJ-MM-TT
  text: string
  raw: Record<string, unknown>
}

/** deutsche + ISO-Daten defensiv nach JJJJ-MM-TT */
function parseDateAny(v: unknown): string | null {
  const s = String(v ?? '').trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

/** Beträge robust: „25.000,00" · „1,234.56" · „-193.61" · 25000.
 *  Review §271: das naive replace(',', '.') machte deutsche Tausender-
 *  Beträge zu NaN — genau die Endres-25.000 wäre still verloren gegangen. */
export function parseAmount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = String(v ?? '').trim().replace(/[€\s]/g, '')
  if (!s) return null
  const hasComma = s.includes(',')
  const hasDot = s.includes('.')
  if (hasComma && hasDot) {
    // letztes Trennzeichen = Dezimaltrenner, alle anderen strippen
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/,/g, '')
  } else if (hasComma) {
    s = s.replace(/,/g, (m, i) => (i === s.lastIndexOf(',') ? '.' : ''))
  } else if (hasDot && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '') // reine Tausender-Punkte („25.000")
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function mapTx(t: Record<string, unknown>): BbTx | null {
  const id = String(t.transaction_id_by_customer ?? t.id_by_customer ?? t.id ?? '').trim()
  const betrag = parseAmount(t.amount ?? t.betrag)
  if (!id || betrag == null) return null
  const datum = parseDateAny(t.booking_date ?? t.date ?? t.valuta_date ?? t.transaction_date)
  const text = ['to_from', 'counterparty', 'purpose', 'payment_reference', 'reference', 'text']
    .map((k) => String(t[k] ?? '')).join(' ').replace(/\s+/g, ' ').trim()
  return { id, betrag, datum, text, raw: t }
}

export async function listBbTransactions(dateFrom: string, dateTo: string): Promise<BbTx[]> {
  const out: BbTx[] = []
  const seen = new Set<string>()
  const limit = 400
  for (let offset = 0; offset < 20000; offset += limit) {
    const j = await bbCall('/transactions/get', { date_from: dateFrom, date_to: dateTo, limit, offset })
    const rows = unwrapList(j)
    let neu = 0
    for (const r of rows) {
      const tx = mapTx(r)
      if (tx && !seen.has(tx.id)) { seen.add(tx.id); out.push(tx); neu++ }
    }
    // Review §271: ignoriert BB den offset, liefert jede Seite dasselbe —
    // ohne diesen Abbruch liefe die Schleife bis zum Cap und das Duplikat-
    // Set würde… eben NICHT entstehen, dank seen-Dedupe + neu-Abbruch.
    if (rows.length < limit || neu === 0) break
  }
  return out
}

// ── Matching ──

const KEYWORDS = ['GLOBUS', 'BAUHAUS', 'HORNBACH', 'ENDRES', 'JUNK', 'SAAR', 'KWR', 'TRIERER',
  'RAIFFEISEN', 'SANITINO', 'HAGEBAU', 'WEDI', 'LAMPENWELT', 'LEISTE24', 'CASANDO', 'IKEA', 'HERMES']

function keywordsFor(lieferant: string): string[] {
  const up = lieferant.toUpperCase()
  const hits = KEYWORDS.filter((k) => up.includes(k))
  for (const tok of up.split(/[^A-ZÄÖÜ0-9]+/)) {
    if (tok.length >= 5 && !hits.includes(tok)) hits.push(tok)
  }
  return hits
}

function hatKeyword(tx: BbTx, lieferant: string): boolean {
  const kws = keywordsFor(lieferant)
  const up = tx.text.toUpperCase()
  return kws.some((k) => up.includes(k))
}

function dayDiff(a: string, b: string): number {
  return Math.abs((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000)
}

export type BbMatch =
  | { ok: true; tx: BbTx }
  | { ok: false; grund: string }

/** Eine Zahlung für einen Beleg-Betrag finden. Review-Doktrin §271:
 *  ein Match braucht IMMER einen Plausibilitäts-Anker — Aussteller-Keyword
 *  im Zahlungstext ODER beide Daten vorhanden und im Fenster. Ein Beleg
 *  ohne Datum matcht also NUR über das Keyword. Bei Mehrdeutigkeit, die
 *  weder Keyword noch eindeutige Datums-Nähe auflöst, KEIN Match —
 *  2 Bons gleichen Betrags am selben Tag enden bewusst als 'pruefen'
 *  (konservativ; Zuordnung wäre austauschbar, aber nie automatisch). */
export function findBbMatch(
  txs: BbTx[], betrag: number, datum: string | null, lieferant: string,
  used: Set<string>, s: BbSettings, datumBis?: string | null,
): BbMatch {
  const richtungOk = (t: BbTx) =>
    s.txRichtung === 'beide' ? true : s.txRichtung === 'negativ' ? t.betrag < 0 : t.betrag > 0
  const imFenster = (t: BbTx) => {
    if (!datum || !t.datum) return false
    if (datumBis) return t.datum >= datum && t.datum <= datumBis
      ? true : dayDiff(t.datum, datum) <= s.tolTage
    return dayDiff(t.datum, datum) <= s.tolTage
  }
  const kandidaten = txs.filter((t) =>
    !used.has(t.id)
    && richtungOk(t)
    && Math.abs(Math.abs(t.betrag) - Math.abs(betrag)) < 0.005
    && (hatKeyword(t, lieferant) || imFenster(t)))
  if (!kandidaten.length) return { ok: false, grund: `keine Zahlung über ${betrag.toFixed(2)} € (Fenster/Keyword)` }
  if (kandidaten.length === 1) return { ok: true, tx: kandidaten[0] }
  const mitKeyword = kandidaten.filter((t) => hatKeyword(t, lieferant))
  if (mitKeyword.length === 1) return { ok: true, tx: mitKeyword[0] }
  const pool = mitKeyword.length ? mitKeyword : kandidaten
  if (datum) {
    const sorted = pool.filter((t) => t.datum).sort((a, b) => dayDiff(a.datum!, datum) - dayDiff(b.datum!, datum))
    if (sorted.length >= 2 && dayDiff(sorted[0].datum!, datum) < dayDiff(sorted[1].datum!, datum)) {
      return { ok: true, tx: sorted[0] }
    }
  }
  return { ok: false, grund: `${pool.length} Zahlungen über ${betrag.toFixed(2)} € — mehrdeutig` }
}

// ── Sync eines Inbox-Belegs ──

export interface BbRow {
  id: string
  lieferant: string | null
  betrag: number | string | null
  beleg_datum: string | null
  belegnummer: string | null
  subject: string | null
  files: { path: string; name: string }[] | null
  ki_analyse: Record<string, unknown> | null
  bb_status: string | null
  bb_receipt_id: string | null
  bb_transaction_ids: string | null
  bb_posted_ids: string | null
  bb_kostenstelle: string | null
  bb_detail: string | null
  bb_match_betraege: number[] | null
  created_at: string
}

/** §271b: KI liest die RICHTIGE Kostenstelle aus dem Beleg — Wahl NUR aus
 *  den vorhandenen BB-Kostenstellen, nur bei echtem Objekt-Indiz (Liefer-/
 *  Leistungsadresse, Objekt-/Ortsname). Kein Indiz / Fehler → null, der
 *  Aufrufer fällt auf die Standard-Kostenstelle zurück. */
async function bbKostenstelleAusBeleg(row: BbRow, kostenstellen: BbKst[]): Promise<{ code: string; indiz: string } | null> {
  const file = (row.files ?? [])[0]
  if (!file || kostenstellen.length < 2) return null
  try {
    const { data: blob, error } = await supabaseAdmin.storage.from('belege').download(file.path)
    if (error || !blob) return null
    const buf = Buffer.from(await blob.arrayBuffer())
    const mediaType = sniffMediaType(buf)
    if (!mediaType || buf.length > 8 * 1024 * 1024) return null
    const liste = kostenstellen.map((k) => `${k.code} — ${k.name || '(ohne Name)'}`).join('\n')
    const raw = await askClaudeWithFile(
      'Du ordnest einen Eingangsbeleg der TRIMOSA Immobilien UG einer Kostenstelle in BuchhaltungsButler zu. Antworte NUR mit JSON.',
      `Vorhandene Kostenstellen:\n${liste}\n\nLies den Beleg: Gibt es ECHTE Indizien, zu welchem Objekt/Projekt er gehört (Liefer-/Leistungsadresse, Objektname, Baustellen-/Ortsangabe, Projektbezeichnung)? Antworte NUR: {"kostenstelle_code": "<Code exakt aus der Liste oder null>", "indiz": "<kurzes Zitat/Begründung oder null>"} — Code AUSSCHLIESSLICH bei echtem Indiz, im Zweifel null. Lieferanten-SITZ (z. B. Baumarkt-Filialadresse) ist KEIN Objekt-Indiz.`,
      { mediaType, base64: buf.toString('base64') },
      600,
    )
    const j = parseJsonLoose(raw)
    const code = String(j.kostenstelle_code ?? '').trim()
    if (code && kostenstellen.some((k) => k.code === code)) {
      return { code, indiz: String(j.indiz ?? '').slice(0, 120) }
    }
    return null
  } catch (e) {
    console.error('[bb] kostenstellen-ki:', e)
    return null
  }
}

function vatFor(row: BbRow): number {
  const t = row.ki_analyse?.taxRate
  if (typeof t === 'number' && [0, 7, 17, 19].includes(t)) return t
  return 19
}

function csvSet(v: string | null): Set<string> {
  return new Set(String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean))
}

async function writeBb(rowId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin.from('beleg_inbox').update(patch).eq('id', rowId)
  if (error) throw new Error('beleg_inbox bb-update failed: ' + error.message)
}

export interface BbSyncResult { id: string; status: string; detail: string; pruefNeu?: boolean }

export async function bbSyncOne(
  row: BbRow, txs: BbTx[], used: Set<string>, settings: BbSettings, kostenstellen: BbKst[],
): Promise<BbSyncResult> {
  // Review §271: fertige Belege NIE wieder anfassen (Zweitbuchungs-Risiko)
  if (row.bb_status === 'gebucht') {
    return { id: row.id, status: 'gebucht', detail: 'bereits gebucht — übersprungen' }
  }
  try {
    const gesamt = row.betrag == null ? null : Number(row.betrag)
    const betraege = Array.isArray(row.bb_match_betraege) && row.bb_match_betraege.length
      ? row.bb_match_betraege.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : (gesamt && gesamt > 0 ? [gesamt] : [])
    if (!betraege.length) {
      await writeBb(row.id, { bb_status: 'pruefen', bb_detail: 'Kein Betrag am Beleg — bitte Betrag nachtragen.' })
      return { id: row.id, status: 'pruefen', detail: 'kein Betrag' }
    }

    const assigned = csvSet(row.bb_transaction_ids)
    const posted = csvSet(row.bb_posted_ids)
    const txById = new Map(txs.map((t) => [t.id, t]))

    // 1) Ziel-Zahlungen bestimmen. NACHBUCHUNGS-PFAD (Review §271): sind
    //    schon Txs zugeordnet, wird NIE neu gematcht — nur Fehlendes
    //    (weitere Tranchen / Postings) nachgezogen.
    const zielTxIds: string[] = [...assigned]
    if (zielTxIds.length < betraege.length) {
      // Tranchen (bb_match_betraege): Schlussraten kommen Wochen nach dem
      // Rechnungsdatum → Fenster reicht bis heute (Review-Fund).
      const datumBis = betraege.length > 1 ? new Date().toISOString().slice(0, 10) : null
      for (let i = zielTxIds.length; i < betraege.length; i++) {
        const m = findBbMatch(txs, betraege[i], row.beleg_datum, row.lieferant ?? '', used, settings, datumBis)
        if (!m.ok) {
          const refDatum = row.beleg_datum ?? row.created_at.slice(0, 10)
          const alt = dayDiff(refDatum, new Date().toISOString().slice(0, 10)) > 21
          const status = zielTxIds.length ? 'zugeordnet' : (alt ? 'pruefen' : 'wartet')
          const wasPruefen = row.bb_status === 'pruefen'
          await writeBb(row.id, { bb_status: status, bb_detail: `${m.grund}${zielTxIds.length ? ` (Tranche ${i + 1}/${betraege.length})` : ''}` })
          // Push-Entscheidung liegt beim Aufrufer (bbSyncAlle) — EIN
          // Sammel-Push je Lauf statt einem je Beleg (Erstlauf = 40+ alte
          // Belege → Push-Flut an alle Admins)
          return { id: row.id, status, detail: m.grund, pruefNeu: status === 'pruefen' && !wasPruefen }
        }
        used.add(m.tx.id)
        zielTxIds.push(m.tx.id)
      }
    }

    // 2) Beleg hochladen (einmalig — Idempotenz über bb_receipt_id; vor dem
    //    Upload frisch lesen, falls ein Parallel-Lauf schneller war)
    let receiptId = row.bb_receipt_id
    if (!receiptId) {
      const { data: fresh } = await supabaseAdmin
        .from('beleg_inbox').select('bb_receipt_id').eq('id', row.id).maybeSingle()
      receiptId = (fresh?.bb_receipt_id as string | null) ?? null
    }
    if (!receiptId) {
      const file = (row.files ?? [])[0]
      if (!file) {
        await writeBb(row.id, { bb_status: 'pruefen', bb_detail: 'Keine Datei am Beleg.' })
        return { id: row.id, status: 'pruefen', detail: 'keine Datei' }
      }
      const { data: blob, error: dlErr } = await supabaseAdmin.storage.from('belege').download(file.path)
      if (dlErr || !blob) throw new Error(`Storage-Download: ${dlErr?.message ?? '?'}`)
      const b64 = Buffer.from(await blob.arrayBuffer()).toString('base64')
      const up = await bbCall('/receipts/add', {
        file: b64,
        filename: file.name,
        type: 'inbound',
        list: 'inbound',
        counterparty: row.lieferant ?? 'Unbekannt',
        ...(row.belegnummer ? { invoice_number: row.belegnummer } : {}),
        ...(row.beleg_datum ? { date: row.beleg_datum } : {}),
        amount: betraege.reduce((a, b) => a + b, 0).toFixed(2),
        currency: 'EUR',
        vat_rate: vatFor(row),
        payment_reference: row.subject ?? '',
      })
      const d = (up.data ?? up) as Record<string, unknown>
      receiptId = String(d.receipt_id_by_customer ?? d.id_by_customer ?? d.id ?? '').trim() || null
      if (!receiptId) throw new Error(`receipts/add ohne erkennbare receipt_id — Rohantwort: ${JSON.stringify(up).slice(0, 200)}`)
      await writeBb(row.id, { bb_receipt_id: receiptId })
    }

    // 3) Kostenstelle bestimmen (§271b, Inhaber-Wunsch 20.8.): fixe Vorgabe
    //    (Backfill/frühere Wahl) > KI liest sie aus dem BELEG (nur aus den
    //    vorhandenen BB-Kostenstellen, nur bei echtem Objekt-Indiz) >
    //    Standard-Kostenstelle aus den Settings. Einmal gewählt → persistiert
    //    (alle Tranchen + Retries buchen konsistent dieselbe KSt).
    const setupFehlt = !settings.sachkonto
    let kst = row.bb_kostenstelle
    let kstInfo = ''
    if (!setupFehlt && !kst) {
      // Vision je Beleg nur EINMAL — ein ergebnisloser Versuch hinterlässt
      // „Kostenstelle unklar" im Detail und wird nicht täglich wiederholt
      // (erneut nur nach match-betraege-Reset bzw. via Settings-Fallback)
      const schonVergeblich = (row.bb_detail ?? '').includes('Kostenstelle unklar')
      const ki = schonVergeblich ? null : await bbKostenstelleAusBeleg(row, kostenstellen)
      if (ki) { kst = ki.code; kstInfo = ki.indiz ? ` (KI: ${ki.indiz})` : ' (KI)' }
      else kst = settings.kostenstelleCode || null
      if (kst) await writeBb(row.id, { bb_kostenstelle: kst })
    }

    // 4) je Zahlung zuordnen + buchen — jeder Erfolg wird SOFORT
    //    persistiert (Review §271: Teilfehler-Retry überspringt Erledigtes)
    for (const txId of zielTxIds) {
      if (!assigned.has(txId)) {
        await bbCall('/transactions/assign/receipt', {
          transaction_id_by_customer: txId,
          receipt_id_by_customer: receiptId,
        })
        assigned.add(txId)
        await writeBb(row.id, { bb_transaction_ids: [...assigned].join(',') })
      }
      if (!setupFehlt && kst && !posted.has(txId)) {
        const tx = txById.get(txId)
        const tranche = zielTxIds.length === 1
          ? betraege.reduce((a, b) => a + b, 0)
          : (tx ? Math.abs(tx.betrag) : null)
        if (tranche == null) throw new Error(`Zahlung ${txId} nicht mehr im Abfrage-Zeitraum — Buchungsbetrag unklar (zeitraumAb prüfen).`)
        await bbCall('/postings/add/transaction', {
          transaction_id_by_customer: txId,
          postingaccounts: [settings.sachkonto],
          postingtexts: [`${row.lieferant ?? 'Beleg'} · ${(row.subject ?? '').slice(0, 60)}`.trim()],
          vats: [vatFor(row)],
          amounts: [tranche],
          cost_locations: [kst],
        })
        posted.add(txId)
        await writeBb(row.id, { bb_posted_ids: [...posted].join(',') })
      }
    }

    const gebucht = !setupFehlt && !!kst
    const status = gebucht ? 'gebucht' : 'zugeordnet'
    const detail = gebucht
      ? `Gebucht: ${zielTxIds.map((id) => { const t = txById.get(id); return t ? `${Math.abs(t.betrag).toFixed(2)} € (${t.datum ?? '—'})` : id }).join(' + ')} · KSt ${kst}${kstInfo}`
      : setupFehlt
        ? 'Beleg hochgeladen + Zahlung(en) zugeordnet — Buchung folgt automatisch, sobald das Sachkonto im Setup gesetzt ist.'
        : 'Beleg hochgeladen + Zahlung(en) zugeordnet — Kostenstelle unklar (kein Objekt-Indiz im Beleg, keine Standard-Kostenstelle im Setup).'
    await writeBb(row.id, { bb_status: status, bb_detail: detail })
    return { id: row.id, status, detail }
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e).slice(0, 300)
    await writeBb(row.id, { bb_status: 'fehler', bb_detail: msg }).catch(() => {})
    return { id: row.id, status: 'fehler', detail: msg }
  }
}

/** Alle offenen UG-Belege durchsyncen. 'zugeordnet' läuft MIT (Review §271:
 *  nachgetragenes Setup holt die Buchung über den Nachbuchungs-Pfad nach —
 *  dort wird nie neu gematcht). Lauf-Lock gegen Cron+Button-Parallelität. */
export async function bbSyncAlle(nurRowId?: string, maxBelege?: number): Promise<{ report: BbSyncResult[]; txCount: number; offen: number }> {
  // Lock mit Auto-Expire (10 Min): wird die Function mitten im Lauf von
  // Vercel gekillt (Timeout), darf der Lock die warme Instanz nicht
  // dauerhaft blockieren — die per-Schritt-Persistenz macht Wiederholungen
  // ohnehin gefahrlos.
  const g = globalThis as typeof globalThis & { __bbSyncRunAt?: number }
  if (g.__bbSyncRunAt && Date.now() - g.__bbSyncRunAt < 10 * 60000) {
    throw new Error('BB-Sync läuft bereits — bitte kurz warten.')
  }
  g.__bbSyncRunAt = Date.now()
  try {
    const settings = await getBbSettings()
    let q = supabaseAdmin
      .from('beleg_inbox').select('*')
      .eq('firma', 'ug')
      .in('bb_status', ['wartet', 'fehler', 'zugeordnet'])
    if (nurRowId) {
      // Review §271: auch der Einzel-Pfad bleibt auf UG-Belege beschränkt
      q = supabaseAdmin.from('beleg_inbox').select('*').eq('id', nurRowId).eq('firma', 'ug')
    }
    const { data: rows, error } = await q.limit(150)
    if (error) throw new Error('beleg_inbox select failed: ' + error.message)
    const list = (rows ?? []) as BbRow[]
    if (!list.length) return { report: [], txCount: 0, offen: 0 }

    const today = new Date().toISOString().slice(0, 10)
    const txs = await listBbTransactions(settings.zeitraumAb, today)
    // §271b: vorhandene BB-Kostenstellen für die KI-Wahl (fail-soft — ohne
    // Liste greift die Standard-Kostenstelle)
    const kostenstellen = await listBbCostLocations().then(normKostenstellen).catch(() => [] as BbKst[])

    // Tx-Sperre: bereits verknüpfte Zahlungen (DB) + im Lauf vergebene
    const used = new Set<string>()
    const { data: taken } = await supabaseAdmin
      .from('beleg_inbox').select('bb_transaction_ids').not('bb_transaction_ids', 'is', null).limit(1000)
    for (const t of taken ?? []) {
      for (const id of String((t as { bb_transaction_ids: string }).bb_transaction_ids).split(',')) {
        if (id.trim()) used.add(id.trim())
      }
    }

    const report: BbSyncResult[] = []
    // chronologisch alt → neu (frühere Belege greifen zuerst auf die Zahlungen zu)
    list.sort((a, b) => String(a.beleg_datum ?? a.created_at).localeCompare(String(b.beleg_datum ?? b.created_at)))
    // Batch-Limit für große Erst-Läufe (66 Kanzem-Belege × Upload+Assign
    // sprengen sonst die 300s-Function — Häppchen-Aufrufe, Rest im `offen`)
    const batch = maxBelege && maxBelege > 0 ? list.slice(0, maxBelege) : list
    for (const row of batch) {
      report.push(await bbSyncOne(row, txs, used, settings, kostenstellen))
    }
    // EIN Sammel-Push je Lauf für neue Prüffälle (statt je Beleg)
    const pruefNeu = report.filter((r) => r.pruefNeu).length
    if (pruefNeu) {
      const { sendPushToTeam } = await import('@/lib/push')
      await sendPushToTeam(
        '🏢 UG-Belege ohne Zahlungs-Treffer',
        `${pruefNeu} Beleg${pruefNeu === 1 ? '' : 'e'} ohne passende Zahlung in BuchhaltungsButler — Prüfliste in der Buchhaltung (🏢-Karte).`,
        '/buchhaltung', { buchhaltung: true },
      ).catch(() => {})
    }
    return { report, txCount: txs.length, offen: list.length - batch.length }
  } finally {
    g.__bbSyncRunAt = 0
  }
}
