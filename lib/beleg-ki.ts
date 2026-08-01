import { supabaseAdmin } from '@/lib/supabase-admin'
import { askClaude, askClaudeWithFile, FAST_MODEL } from '@/lib/ai'
import { getReceiptGuidance, bookSevVoucher } from '@/lib/sevdesk'

/**
 * 🧠 BELEG-KI (§243f) — der Analyse-Kern der Buchhaltung als lib, damit ihn
 * die /api/buchhaltung-Route UND der Mail-Scan (Voll-Automatik: neuer Beleg
 * → analysieren → Zahlung suchen → verbuchen) teilen.
 *
 * Confidence-Doktrin (§217 „Auto nur bei Sicherheit"): automatisch verbucht
 * wird NUR, wenn der Betrag aus dem PDF gelesen wurde UND die Kategorie
 * deterministisch ist (Portal-Provisionen) oder aus einer BESTÄTIGTEN
 * früheren Buchung stammt (Gelernt + kategorie_passt). Der ERSTE Beleg
 * eines Lieferanten bleibt Entwurf → ein Klick des Inhabers, ab dann Auto.
 */

/** KI-JSON robust extrahieren — Modelle haengen gern Erklaertext ans JSON. */
export function parseJsonLoose(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try { return JSON.parse(cleaned) } catch { /* Text um das JSON herum → balanced scan */ }
  const start = cleaned.indexOf('{')
  if (start >= 0) {
    let depth = 0, inStr = false, esc = false
    for (let i = start; i < cleaned.length; i++) {
      const c = cleaned[i]
      if (esc) { esc = false; continue }
      if (c === '\\' && inStr) { esc = true; continue }
      if (c === '"') { inStr = !inStr; continue }
      if (!inStr) {
        if (c === '{') depth++
        else if (c === '}') { depth--; if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1)) }
      }
    }
  }
  throw new Error('Kein JSON in der KI-Antwort')
}

/** §242b: Die App LERNT je Lieferant die zuletzt bestätigte Kategorie. */
export type Gelernt = { accountDatevId: number; taxRate: number; anlagegut: boolean; at: string }
export async function getBuchhaltungSettings(): Promise<{ ignoredTx?: string[]; gelernt?: Record<string, Gelernt> }> {
  const { data } = await supabaseAdmin
    .from('app_settings').select('value').eq('key', 'buchhaltung').maybeSingle()
  return (data?.value ?? {}) as { ignoredTx?: string[]; gelernt?: Record<string, Gelernt> }
}
export async function saveGelernt(lieferant: string, g: Gelernt): Promise<void> {
  try {
    const cur = await getBuchhaltungSettings()
    const gelernt = { ...(cur.gelernt ?? {}), [lieferant.trim()]: g }
    const keys = Object.keys(gelernt)
    if (keys.length > 300) {
      keys.sort((a, b) => String(gelernt[a].at).localeCompare(String(gelernt[b].at)))
      for (const k of keys.slice(0, keys.length - 300)) delete gelernt[k]
    }
    await supabaseAdmin.from('app_settings').upsert(
      { key: 'buchhaltung', value: { ...cur, gelernt } }, { onConflict: 'key' })
  } catch { /* best effort */ }
}

/** §242c: PDF eines sevdesk-Belegs — Storage-Kopie, sonst Original aus
 *  sevdesk (/Document/{id}/download, §243b — undokumentiert, defensiv). */
/** MIME per Magic-Bytes — lexoffice-Importe sind teils JPG/PNG-Scans;
 *  die KI braucht Bilder als image-Block, PDFs als document-Block (§116). */
export function sniffMediaType(buf: Buffer): 'application/pdf' | 'image/jpeg' | 'image/png' | null {
  if (buf.length < 8) return null
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf'
  if (buf[0] === 0xFF && buf[1] === 0xD8) return 'image/jpeg'
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png'
  return null
}

export async function pdfForVoucher(voucherId: string): Promise<{ base64: string; mediaType: 'application/pdf' | 'image/jpeg' | 'image/png' } | null> {
  try {
    const { data: row } = await supabaseAdmin
      .from('beleg_inbox').select('files').eq('sevdesk_voucher_id', voucherId).maybeSingle()
    const files = (row?.files ?? []) as { path: string; name: string }[]
    if (files.length) {
      const { data: file } = await supabaseAdmin.storage.from('belege').download(files[0].path)
      if (file) {
        const buf = Buffer.from(await file.arrayBuffer())
        const mt = sniffMediaType(buf)
        if (mt && buf.length <= 8_000_000) return { base64: buf.toString('base64'), mediaType: mt }
      }
    }
  } catch { /* weiter zum sevdesk-Fallback */ }
  try {
    const { sevJson, sevFetch } = await import('@/lib/sevdesk')
    const vRaw = await sevJson<{ document?: { id?: unknown } }[] | { document?: { id?: unknown } }>(`/Voucher/${voucherId}?embed=document`)
    const vObj = Array.isArray(vRaw) ? vRaw[0] : vRaw
    const docId = Number(vObj?.document?.id)
    if (!Number.isFinite(docId) || docId <= 0) return null
    const res = await sevFetch(`/Document/${docId}/download`)
    if (!res.ok) { console.warn(`[beleg-ki] Document-Download HTTP ${res.status} (Voucher ${voucherId})`); return null }
    const ct = res.headers.get('content-type') ?? ''
    if (ct.includes('json')) {
      const j = await res.json() as { objects?: { content?: string } | { content?: string }[] }
      const obj = Array.isArray(j.objects) ? j.objects[0] : j.objects
      const content = obj?.content
      if (typeof content === 'string' && content.length > 100) {
        const buf = Buffer.from(content, 'base64')
        const mt = sniffMediaType(buf)
        if (mt && buf.length > 200 && buf.length <= 8_000_000) return { base64: content, mediaType: mt }
      }
      return null
    }
    const buf = Buffer.from(await res.arrayBuffer())
    const mt = sniffMediaType(buf)
    if (mt && buf.length > 200 && buf.length <= 8_000_000) return { base64: buf.toString('base64'), mediaType: mt }
    return null
  } catch { return null }
}

/** §242c: Standort-/Wohnungs-Hinweis → KSt + interne Zuordnung (§240). */
export function standortZuKst(
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

/** §242: interne Wohnungs-Zuordnung auf der Protokollzeile speichern. */
export async function saveZuordnung(voucherId: string | null, inboxId: string | null, z: Record<string, unknown>): Promise<boolean> {
  const clean = {
    modus: ['allgemein', 'standort', 'wohnung', 'split'].includes(String(z.modus)) ? String(z.modus) : 'allgemein',
    ...(typeof z.standort === 'string' && z.standort ? { standort: z.standort.slice(0, 60) } : {}),
    ...(Array.isArray(z.listingIds) ? { listingIds: z.listingIds.map(String).slice(0, 10) } : {}),
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

export interface KiErgebnis {
  ok: boolean
  error?: string
  weg?: 'provision' | 'gelernt' | 'vision' | 'text'
  gelernt?: boolean
  accountDatevId?: number
  kategorie?: string
  nr?: string
  taxRate?: number
  betrag?: number | null
  /** echtes RECHNUNGSDATUM aus dem Beleg (Mail-Scan-Belege trugen sonst das Scan-Datum — UStVA-Periode!) */
  datum?: string | null
  begruendung?: string
  steuerHinweis?: string
  anlagegut?: boolean
  nutzungsdauer?: number | null
  kst?: string
  zuordnung?: Record<string, unknown>
}

/** Der komplette Analyse-Kern (vormals ki-vorschlag-Action, §242–§243c):
 *  Provisions-Determinismus → Gelernt (mit kategorie_passt-Check) →
 *  Voll-Vision → Text-Fallback. */
export async function analysiereBeleg(voucherId: string): Promise<KiErgebnis> {
  const { sevJson } = await import('@/lib/sevdesk')
  const [vRaw, guidance, listResp, pdf] = await Promise.all([
    sevJson<{ supplierName?: string; description?: string; voucherDate?: string }[] | { supplierName?: string; description?: string; voucherDate?: string }>(`/Voucher/${voucherId}`),
    getReceiptGuidance(),
    supabaseAdmin.from('listings').select('id, title, location_group').eq('is_active', true),
    pdfForVoucher(voucherId),
  ])
  const vObj = Array.isArray(vRaw) ? vRaw[0] : vRaw
  if (!vObj) return { ok: false, error: 'Beleg nicht gefunden.' }
  const v = { supplierName: vObj.supplierName ?? null, description: vObj.description ?? null, voucherDate: vObj.voucherDate ?? null }
  const wohnungenListe = (listResp.data ?? []).map((l) => ({ id: String(l.id), title: String(l.title), group: l.location_group ? String(l.location_group) : null }))
  const wohnNamen = wohnungenListe.map((w) => `${w.title}${w.group ? ` (Standort ${w.group})` : ''}`).join(', ')
  const standorte = [...new Set(wohnungenListe.map((w) => w.group).filter(Boolean))].join(', ')

  // §242d: Portal-Provisionen DETERMINISTISCH (5923, §13b MIT Vorsteuerabzug)
  const provSupplier = /booking\.com|airbnb|expedia|hometogo/i.test(v.supplierName ?? '')
  const provText = /provisionsrechnung|invoice|commission/i.test(`${v.supplierName ?? ''} ${v.description ?? ''}`)
  if (provSupplier && provText) {
    const k5923 = guidance.find((x) => x.accountNumber === '5923')
    if (k5923) {
      let provBetrag: number | null = null
      let provDatum: string | null = null
      if (pdf) {
        try {
          const raw = await askClaudeWithFile(
            'Lies GESAMTBETRAG und RECHNUNGSDATUM dieser Provisionsrechnung (Reverse-Charge, ohne USt ausgewiesen = Nettobetrag). Antworte NUR mit JSON: {"betrag": <Zahl>, "datum": "<JJJJ-MM-TT oder null>"}',
            `Lieferant: ${v.supplierName ?? '?'}`,
            { mediaType: pdf.mediaType, base64: pdf.base64 }, 1200)
          const oj = parseJsonLoose(raw)
          if (typeof oj.betrag === 'number' && oj.betrag > 0) provBetrag = Math.round(oj.betrag * 100) / 100
          if (typeof oj.datum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(oj.datum)) provDatum = oj.datum
        } catch { /* best effort */ }
      }
      return {
        ok: true, weg: 'provision',
        accountDatevId: k5923.accountDatevId, kategorie: k5923.accountName, nr: k5923.accountNumber,
        taxRate: 0, betrag: provBetrag, datum: provDatum,
        begruendung: 'Portal-Provisionsrechnung (EU-Anbieter) — feste Regel, keine KI-Wahl.',
        steuerHinweis: 'Reverse-Charge §13b UStG: TRIMOSA schuldet die USt und zieht sie ZUGLEICH als Vorsteuer (Konto 5923 — Nullsumme). Betrag = NETTOBETRAG der Rechnung.',
        anlagegut: false, nutzungsdauer: null,
      }
    }
  }

  // §242b/c: GELERNT — mit kategorie_passt-Check (§243c: VP Glanzteam
  // rechnet Reinigung UND Gästemanagement ab!)
  const { gelernt } = await getBuchhaltungSettings()
  const g = v.supplierName ? gelernt?.[v.supplierName.trim()] : undefined
  const hitG = g ? guidance.find((x) => x.accountDatevId === Number(g.accountDatevId)) : null
  if (g && hitG) {
    let ort: { kst: string; zuordnung: Record<string, unknown> } | null = null
    let ortText = ''
    let gBetrag: number | null = null
    let gDatum: string | null = null
    let kategoriePasst = true
    if (pdf) {
      try {
        const raw = await askClaudeWithFile(
          `Du prüfst einen Buchhaltungsbeleg einer Ferienwohnungs-Vermietung. 1) BETRAG + DATUM: Lies Rechnungs-GESAMTBETRAG (brutto) und RECHNUNGSDATUM. 2) KATEGORIE-CHECK: Die bisher für diesen Lieferanten gelernte Buchungskategorie ist „${hitG.accountName}" (Konto ${hitG.accountNumber}) — passt sie zur tatsächlich abgerechneten LEISTUNG dieser Rechnung? 3) STANDORT-Indizien: Für welches Objekt sind die Kosten? Achte auf Leistungs-/Lieferadresse, Objekt-/Wohnungsnamen, Ortsnamen. Bekannte Wohnungen: ${wohnNamen}. Bekannte Standorte: ${standorte}. Antworte NUR mit JSON: {"betrag_brutto": <Zahl oder null>, "datum": "<JJJJ-MM-TT oder null>", "kategorie_passt": true|false, "wohnung": "<exakter Wohnungsname oder null>", "standort": "<exakter Standortname oder null>", "indiz": "<kurzes Zitat/Begründung oder null>"} — Standort NUR bei echten Indizien setzen, sonst null.`,
          `Lieferant: ${v.supplierName ?? '?'} · Beschreibung: ${(v.description ?? '').slice(0, 200)}`,
          { mediaType: pdf.mediaType, base64: pdf.base64 }, 1800)
        const oj = parseJsonLoose(raw)
        if (typeof oj.betrag_brutto === 'number' && oj.betrag_brutto > 0) gBetrag = Math.round(oj.betrag_brutto * 100) / 100
        if (typeof oj.datum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(oj.datum)) gDatum = oj.datum
        if (oj.kategorie_passt === false) kategoriePasst = false
        ort = standortZuKst(typeof oj.wohnung === 'string' ? oj.wohnung : null, typeof oj.standort === 'string' ? oj.standort : null, wohnungenListe)
        if (ort && typeof oj.indiz === 'string') ortText = ` · Standort erkannt: ${String(oj.indiz).slice(0, 100)}`
      } catch { /* Vision best effort */ }
    }
    if (kategoriePasst) return {
      ok: true, weg: 'gelernt', gelernt: true,
      accountDatevId: hitG.accountDatevId, kategorie: hitG.accountName, nr: hitG.accountNumber,
      taxRate: [19, 7, 0].includes(Number(g.taxRate)) ? Number(g.taxRate) : 19,
      betrag: gBetrag, datum: gDatum,
      begruendung: '\u{1F9E0} Kategorie aus deiner letzten Buchung für diesen Lieferanten' + ortText,
      steuerHinweis: '',
      anlagegut: g.anlagegut === true, nutzungsdauer: null,
      ...(ort ? { kst: ort.kst, zuordnung: ort.zuordnung } : {}),
    }
  }

  const katalog = guidance.map((gg) => `${gg.accountDatevId}|${gg.accountNumber}|${gg.accountName}`).join('\n')
  const system = `Du bist Buchhaltungs-Assistent einer deutschen Ferienwohnungs-Vermietung (eGbR, EÜR, umsatzsteuerpflichtig, SKR-Kontenrahmen). Ordne den Beleg der passenden Buchungskategorie zu und gib eine kurze STEUERLICHE Einschätzung. Antworte NUR mit JSON:
{"accountDatevId": <ID aus dem Katalog>, "kategorie": "<Name>", "taxRate": 19|7|0, "betrag_brutto": <Zahl oder null>, "belegdatum": "<Rechnungsdatum JJJJ-MM-TT oder null>", "begruendung": "<max 1 Satz>", "steuer_hinweis": "<1-2 Sätze: wie hier steuerlich schlau gebucht wird — z. B. Vorsteuerabzug, Reverse-Charge Paragraf 13b bei EU-Portalen (taxRate 0), GWG-Sofortabzug, Bewirtung 70 Prozent>", "anlagegut": true|false, "nutzungsdauer_jahre": <Zahl oder null>, "wohnung": "<exakter Wohnungsname bei ECHTEN Standort-Indizien im Beleg (Adresse/Objektname), sonst null>", "standort": "<exakter Standortname oder null>"}
Regeln: Es ist IMMER ein EINGANGSBELEG (Ausgabe an TRIMOSA) — NIEMALS Erlös-/Umsatzkonten (4xxx) wählen, nur Aufwands-/Wareneingangs-Konten. Provisionsrechnungen von Booking.com/Airbnb (EU-Anbieter, Reverse-Charge Paragraf 13b): Kategorie 5923 (Sonstige Leistungen eines im anderen EU-Land ansässigen Unternehmers), taxRate 0, Betrag = Nettobetrag der Rechnung; im steuer_hinweis Paragraf 13b erwähnen. accountDatevId MUSS aus dem Katalog stammen. Steuersatz sonst: Standard 19; 7 nur ermäßigt; 0 bei steuerfrei/Reverse-Charge. ANLAGEGUT nur bei abnutzbaren Wirtschaftsgütern über 800 Euro netto je Einzelgut (Nutzungsdauer nach amtlicher AfA-Tabelle: Möbel 13 J., IT 3 J., Küchengeräte 5-10 J.); bis 800 Euro netto = GWG-Sofortabzug (im steuer_hinweis erwähnen). Bei anlagegut=true wähle als Kategorie IMMER 6220 Abschreibungen auf Sachanlagen (sevdesk-Konvention: die Position wird als Anlagegut markiert, sevdesk aktiviert das Gut im Anlagenmodul) — nie ein Betriebsbedarf-Konto für Anlagegüter. Bekannte Wohnungen: ${wohnNamen}. Bekannte Standorte: ${standorte}. Betrag aus dem Beleg.`
  const userMsg = `BELEG:\nLieferant: ${v.supplierName ?? '—'}\nBeschreibung: ${v.description ?? '—'}\nDatum: ${v.voucherDate ?? '—'}\n\nKATALOG (id|nr|name):\n${katalog.slice(0, 18000)}`
  const raw = pdf
    ? await askClaudeWithFile(system, userMsg, { mediaType: pdf.mediaType, base64: pdf.base64 }, 4000)
    : await askClaude(system, userMsg, 900, FAST_MODEL)
  const j = parseJsonLoose(raw)
  const hit = guidance.find((gg) => gg.accountDatevId === Number(j.accountDatevId))
  if (!hit) return { ok: false, error: 'KI lieferte keine gültige Kategorie — bitte manuell wählen.' }
  const ort = standortZuKst(typeof j.wohnung === 'string' ? j.wohnung : null, typeof j.standort === 'string' ? j.standort : null, wohnungenListe)
  return {
    ok: true, weg: pdf ? 'vision' : 'text',
    accountDatevId: hit.accountDatevId, kategorie: hit.accountName, nr: hit.accountNumber,
    taxRate: [19, 7, 0].includes(Number(j.taxRate)) ? Number(j.taxRate) : 19,
    betrag: typeof j.betrag_brutto === 'number' && j.betrag_brutto > 0 ? Math.round(j.betrag_brutto * 100) / 100 : null,
    datum: typeof j.belegdatum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.belegdatum) ? j.belegdatum : null,
    begruendung: String(j.begruendung ?? '').slice(0, 200),
    steuerHinweis: String(j.steuer_hinweis ?? '').slice(0, 400),
    anlagegut: j.anlagegut === true,
    nutzungsdauer: typeof j.nutzungsdauer_jahre === 'number' ? j.nutzungsdauer_jahre : null,
    ...(ort ? { kst: ort.kst, zuordnung: ort.zuordnung } : {}),
  }
}

/**
 * §243f VOLL-AUTOMATIK: Neuen Beleg direkt nach dem Mail-Scan analysieren,
 * passende Zahlung suchen und — NUR bei sicherer Kategorie — verbuchen.
 * Konservativ: 'provision' (deterministisch) und 'gelernt' (vom Inhaber
 * bestätigte Kategorie + kategorie_passt) buchen automatisch; neue
 * Lieferanten ('vision'/'text') bleiben Entwurf zur Prüfung.
 */
export async function autoVerbucheBeleg(voucherId: string): Promise<{ auto: boolean; text: string }> {
  try {
    const ki = await analysiereBeleg(voucherId)
    if (!ki.ok || !ki.accountDatevId) return { auto: false, text: `zur Prüfung (${ki.error ?? 'keine Kategorie'})` }
    if (ki.anlagegut) return { auto: false, text: 'zur Prüfung (Anlagegut — AfA bestätigen)' }
    if (ki.weg !== 'provision' && ki.weg !== 'gelernt') return { auto: false, text: `zur Prüfung (neuer Lieferant — Vorschlag: ${ki.nr} ${ki.kategorie ?? ''})` }
    const betrag = typeof ki.betrag === 'number' && ki.betrag > 0 ? ki.betrag : null
    if (!betrag) return { auto: false, text: 'zur Prüfung (Betrag nicht sicher lesbar)' }
    if (betrag > 5000) return { auto: false, text: `zur Prüfung (${betrag.toFixed(2)} € über der Auto-Grenze)` }

    // passende offene Abbuchung suchen (exakter Betrag, ±45 Tage)
    let tx: { id: string; accountId: string; datum: string } | null = null
    try {
      const { findBankAccounts, listBankTransactions } = await import('@/lib/sevdesk-payouts')
      const banks = await findBankAccounts()
      const kand: { id: string; accountId: string; datum: string }[] = []
      for (const bank of banks) {
        for (const t of await listBankTransactions(bank.id, 90)) {
          if (Number(t.status) !== 100) continue
          const amt = Number(t.amount)
          if (amt >= 0 || Math.abs(Math.abs(amt) - betrag) > 0.005) continue
          kand.push({ id: String(t.id), accountId: bank.id, datum: String(t.valueDate ?? t.entryDate ?? '').slice(0, 10) })
        }
      }
      kand.sort((a, b) => b.datum.localeCompare(a.datum))
      tx = kand[0] ?? null
    } catch { /* ohne Zahlung buchen */ }

    const r = await bookSevVoucher(voucherId, {
      accountDatevId: ki.accountDatevId,
      taxRate: [19, 7, 0].includes(Number(ki.taxRate)) ? Number(ki.taxRate) : 19,
      amountGross: betrag,
      costCentreName: ki.kst ?? null,
      ...(ki.datum ? { voucherDate: ki.datum } : {}),
      ...(ki.nr === '5923' ? { taxRuleId: 14 } : {}),
      ...(tx ? { txId: tx.id, txAccountId: tx.accountId, txDate: tx.datum } : {}),
    })
    if (!r.ok) return { auto: false, text: `zur Prüfung (Buchung fehlgeschlagen: ${(r.error ?? '').slice(0, 80)})` }
    await saveZuordnung(voucherId, null, ki.zuordnung ?? { modus: 'allgemein' })
    return {
      auto: true,
      text: `automatisch verbucht: ${ki.nr} ${ki.kategorie ?? ''} · ${betrag.toFixed(2).replace('.', ',')} €`
        + (ki.kst ? ` · KSt ${ki.kst}` : '') + (tx ? ' · Zahlung verknüpft' : ''),
    }
  } catch (e) {
    return { auto: false, text: `zur Prüfung (${String(e instanceof Error ? e.message : e).slice(0, 80)})` }
  }
}
