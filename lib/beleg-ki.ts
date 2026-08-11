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

/**
 * v4: Lieferanten-Namen für den Gelernt-Key NORMALISIEREN — „Zapier" und
 * „Zapier Inc." bzw. „Vercel Inc." / „Vercel" müssen denselben Eintrag
 * treffen. lowercase, Satzzeichen raus, Rechtsform-Suffixe gestrippt.
 */
// ⚠️ BEWUSST OHNE die deutschen Personengesellschafts-Suffixe gbr/ug/kg/ohg:
// „TRIMOSA Immobilien GbR" (USt-frei) und „TRIMOSA Immobilien UG" (19 %)
// sind ZWEI echte Lieferanten mit gegensätzlicher USt-Behandlung — das
// Suffix ist dort das einzige Unterscheidungsmerkmal (Review-Befund v4).
const RECHTSFORM = new Set([
  'gmbh', 'ag', 'mbh', 'se', 'co', 'cokg',
  'inc', 'incorporated', 'corp', 'corporation', 'ltd', 'limited', 'llc', 'plc', 'pbc',
  'bv', 'b', 'v', 'nv', 'uc', 'sarl', 'sa', 'srl', 'sro', 'aps', 'oy', 'ab',
])
export function normLieferant(name: string): string {
  const toks = name.toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim().split(/\s+/)
  while (toks.length > 1 && RECHTSFORM.has(toks[toks.length - 1])) toks.pop()
  const out = toks.filter((t) => !RECHTSFORM.has(t) || toks.length === 1).join(' ')
  return out || name.toLowerCase().trim()
}

/**
 * v4: Das Gelernte lebt jetzt in einem EIGENEN app_settings-Key
 * ('buchhaltung_gelernt') — der 2.8.-Wipe entstand, weil tx-ignorieren &
 * Co. das geteilte 'buchhaltung'-Objekt per read-modify-write überschrieben
 * (§243o). Eigener Key = eigene Kollisionsdomäne. Lazy-Migration: liegt im
 * neuen Key nichts, wird der Alt-Bestand einmalig normalisiert übernommen.
 */
/** null = READ-FEHLER (Netz/Timeout) — Schreiber MÜSSEN dann abbrechen,
 *  sonst würde ein transienter Fehler die Map auf einen Eintrag
 *  zusammenschießen (die Wipe-Klasse §243o, diesmal per Fehlerpfad). */
export async function readGelernt(): Promise<Record<string, Gelernt> | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('app_settings').select('value').eq('key', 'buchhaltung_gelernt').maybeSingle()
    if (error) return null
    if (data?.value && Object.keys(data.value as object).length) return data.value as Record<string, Gelernt>
    // leer → einmalige Migration des Alt-Bestands (normalisierte Keys;
    // bei Key-Kollision gewinnt der NEUERE Eintrag)
    const alt = await getBuchhaltungSettings()
    const mig: Record<string, Gelernt> = {}
    for (const [k, g] of Object.entries(alt.gelernt ?? {})) {
      const key = normLieferant(k)
      const prev = mig[key]
      if (!prev || String(g.at) > String(prev.at)) mig[key] = g
    }
    if (Object.keys(mig).length) {
      await supabaseAdmin.from('app_settings').upsert(
        { key: 'buchhaltung_gelernt', value: mig }, { onConflict: 'key' })
    }
    return mig
  } catch { return null }
}
export async function getGelernt(): Promise<Record<string, Gelernt>> {
  return (await readGelernt()) ?? {}
}
export async function saveGelernt(lieferant: string, g: Gelernt): Promise<void> {
  try {
    const cur = await readGelernt()
    if (cur === null) return // Read-Fehler → NICHT schreiben (Wipe-Schutz)
    const gelernt = { ...cur, [normLieferant(lieferant)]: g }
    const keys = Object.keys(gelernt)
    if (keys.length > 300) {
      keys.sort((a, b) => String(gelernt[a].at).localeCompare(String(gelernt[b].at)))
      for (const k of keys.slice(0, keys.length - 300)) delete gelernt[k]
    }
    await supabaseAdmin.from('app_settings').upsert(
      { key: 'buchhaltung_gelernt', value: gelernt }, { onConflict: 'key' })
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
  /** v4: RECHNUNGSWÄHRUNG — USD-Abos (Vercel/Anthropic/PriceLabs) dürfen NIE
   *  mit dem PDF-Betrag als EUR gebucht werden (§243u-Doktrin: Bank-EUR zählt) */
  waehrung?: string | null
  /** echtes RECHNUNGSDATUM aus dem Beleg (Mail-Scan-Belege trugen sonst das Scan-Datum — UStVA-Periode!) */
  datum?: string | null
  /** v4: LEISTUNGSMONAT 'JJJJ-MM' (Reinigungs-/Energierechnungen kommen im
   *  Folgemonat) — die Auswertung periodisiert damit verursachungsgerecht;
   *  die sevdesk-Buchung bleibt beim Rechnungsdatum (UStVA). */
  leistungsmonat?: string | null
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
  // §243q: hometogo RAUS aus dem §13b-Kurzschluss — HomeToGo GmbH ist eine
  // DEUTSCHE Firma (USt-ID DE…, 19 % ausgewiesen) → Voll-Vision waehlt
  // korrekt 6770/19 % MIT Vorsteuerabzug (Gutschrift HTG-202611892 bewiesen)
  const provSupplier = /booking\.com|airbnb|expedia/i.test(v.supplierName ?? '')
  const provText = /provisionsrechnung|invoice|commission/i.test(`${v.supplierName ?? ''} ${v.description ?? ''}`)
  if (provSupplier && provText) {
    const k5923 = guidance.find((x) => x.accountNumber === '5923')
    if (k5923) {
      let provBetrag: number | null = null
      let provDatum: string | null = null
      // §243q: Die Provisionsrechnung nennt die PROPERTY (Hotel-Name/
      // Adresse) — daraus Standort-KSt + interne Zuordnung ableiten
      let provOrt: { kst: string; zuordnung: Record<string, unknown> } | null = null
      if (pdf) {
        try {
          const raw = await askClaudeWithFile(
            'Lies GESAMTBETRAG, RECHNUNGSDATUM und die UNTERKUNFT (Property-Name/Adresse des Hotels/Apartments, an das die Provisionsrechnung gerichtet ist) dieser Provisionsrechnung (Reverse-Charge, ohne USt ausgewiesen = Nettobetrag). '
            + 'Zuordnungs-Hinweise: Trierweiler/Sirzenich/Feldstr./"Sweet Spot" => standort "Sirzenich"; Minden/Sauer/Bergstr. => standort "Minden"; Bitburg/Echternacher => wohnung "City Home"; Ralingen/Edingen/Breitenweg => wohnung "River Retreat"; Kanzem => standort "Kanzem". '
            + 'Antworte NUR mit JSON: {"betrag": <Zahl>, "datum": "<JJJJ-MM-TT oder null>", "wohnung": "<exakter Wohnungsname oder null>", "standort": "<Standortname oder null>"}',
            `Lieferant: ${v.supplierName ?? '?'} · Bekannte Wohnungen: ${wohnNamen} · Bekannte Standorte: ${standorte}`,
            { mediaType: pdf.mediaType, base64: pdf.base64 }, 1500)
          const oj = parseJsonLoose(raw)
          if (typeof oj.betrag === 'number' && oj.betrag > 0) provBetrag = Math.round(oj.betrag * 100) / 100
          if (typeof oj.datum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(oj.datum)) provDatum = oj.datum
          provOrt = standortZuKst(
            typeof oj.wohnung === 'string' ? oj.wohnung : null,
            typeof oj.standort === 'string' ? oj.standort : null,
            wohnungenListe)
        } catch { /* best effort */ }
      }
      return {
        ok: true, weg: 'provision',
        accountDatevId: k5923.accountDatevId, kategorie: k5923.accountName, nr: k5923.accountNumber,
        taxRate: 0, betrag: provBetrag, datum: provDatum,
        begruendung: 'Portal-Provisionsrechnung (EU-Anbieter) — feste Regel, keine KI-Wahl.',
        steuerHinweis: 'Reverse-Charge §13b UStG: TRIMOSA schuldet die USt und zieht sie ZUGLEICH als Vorsteuer (Konto 5923 — Nullsumme). Betrag = NETTOBETRAG der Rechnung.',
        anlagegut: false, nutzungsdauer: null,
        ...(provOrt ? { kst: provOrt.kst, zuordnung: provOrt.zuordnung } : {}),
      }
    }
  }

  // §242b/c: GELERNT — mit kategorie_passt-Check (§243c: VP Glanzteam
  // rechnet Reinigung UND Gästemanagement ab!)
  const gelernt = await getGelernt()
  const g = v.supplierName ? gelernt[normLieferant(v.supplierName)] : undefined
  const hitG = g ? guidance.find((x) => x.accountDatevId === Number(g.accountDatevId)) : null
  if (g && hitG) {
    let ort: { kst: string; zuordnung: Record<string, unknown> } | null = null
    let ortText = ''
    let gBetrag: number | null = null
    let gWaehrung: string | null = null
    let gDatum: string | null = null
    let gLeistung: string | null = null
    let kategoriePasst = true
    if (pdf) {
      try {
        const raw = await askClaudeWithFile(
          `Du prüfst einen Buchhaltungsbeleg einer Ferienwohnungs-Vermietung. 1) BETRAG + DATUM: Lies Rechnungs-GESAMTBETRAG (brutto) und RECHNUNGSDATUM. 2) KATEGORIE-CHECK: Die bisher für diesen Lieferanten gelernte Buchungskategorie ist „${hitG.accountName}" (Konto ${hitG.accountNumber}) — passt sie zur tatsächlich abgerechneten LEISTUNG dieser Rechnung? 3) STANDORT-Indizien: Für welches Objekt sind die Kosten? Achte auf Leistungs-/Lieferadresse, Objekt-/Wohnungsnamen, Ortsnamen. Bekannte Wohnungen: ${wohnNamen}. Bekannte Standorte: ${standorte}. Antworte NUR mit JSON: {"betrag_brutto": <Zahl oder null>, "waehrung": "<ISO-Code der Rechnungswährung, z. B. EUR oder USD>", "datum": "<JJJJ-MM-TT oder null>", "leistungsmonat": "<JJJJ-MM des LEISTUNGSZEITRAUMS, falls die Rechnung einen nennt (z. B. Reinigungen im Juni, Strom-Abrechnungsmonat) — sonst null>", "kategorie_passt": true|false, "wohnung": "<exakter Wohnungsname oder null>", "standort": "<exakter Standortname oder null>", "indiz": "<kurzes Zitat/Begründung oder null>"} — Standort NUR bei echten Indizien setzen, sonst null.`,
          `Lieferant: ${v.supplierName ?? '?'} · Beschreibung: ${(v.description ?? '').slice(0, 200)}`,
          { mediaType: pdf.mediaType, base64: pdf.base64 }, 1800)
        const oj = parseJsonLoose(raw)
        if (typeof oj.betrag_brutto === 'number' && oj.betrag_brutto > 0) gBetrag = Math.round(oj.betrag_brutto * 100) / 100
        if (typeof oj.waehrung === 'string' && /^[A-Z]{3}$/.test(oj.waehrung.toUpperCase())) gWaehrung = oj.waehrung.toUpperCase()
        if (typeof oj.datum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(oj.datum)) gDatum = oj.datum
        if (typeof oj.leistungsmonat === 'string' && /^\d{4}-\d{2}$/.test(oj.leistungsmonat)) gLeistung = oj.leistungsmonat
        if (oj.kategorie_passt === false) kategoriePasst = false
        ort = standortZuKst(typeof oj.wohnung === 'string' ? oj.wohnung : null, typeof oj.standort === 'string' ? oj.standort : null, wohnungenListe)
        if (ort && typeof oj.indiz === 'string') ortText = ` · Standort erkannt: ${String(oj.indiz).slice(0, 100)}`
      } catch { /* Vision best effort */ }
    }
    if (kategoriePasst) return {
      ok: true, weg: 'gelernt', gelernt: true,
      accountDatevId: hitG.accountDatevId, kategorie: hitG.accountName, nr: hitG.accountNumber,
      taxRate: [19, 7, 0].includes(Number(g.taxRate)) ? Number(g.taxRate) : 19,
      betrag: gBetrag, waehrung: gWaehrung, datum: gDatum, leistungsmonat: gLeistung,
      begruendung: '\u{1F9E0} Kategorie aus deiner letzten Buchung für diesen Lieferanten' + ortText,
      steuerHinweis: '',
      anlagegut: g.anlagegut === true, nutzungsdauer: null,
      ...(ort ? { kst: ort.kst, zuordnung: ort.zuordnung } : {}),
    }
  }

  const katalog = guidance.map((gg) => `${gg.accountDatevId}|${gg.accountNumber}|${gg.accountName}`).join('\n')
  const system = `Du bist Buchhaltungs-Assistent einer deutschen Ferienwohnungs-Vermietung (eGbR, EÜR, umsatzsteuerpflichtig, SKR-Kontenrahmen). Ordne den Beleg der passenden Buchungskategorie zu und gib eine kurze STEUERLICHE Einschätzung. Antworte NUR mit JSON:
{"accountDatevId": <ID aus dem Katalog>, "kategorie": "<Name>", "taxRate": 19|7|0, "betrag_brutto": <Zahl oder null>, "waehrung": "<ISO-Code der Rechnungswährung, z. B. EUR oder USD>", "belegdatum": "<Rechnungsdatum JJJJ-MM-TT oder null>", "leistungsmonat": "<JJJJ-MM des LEISTUNGSZEITRAUMS, falls die Rechnung einen nennt (Reinigungen/Strom/Abos werden oft im Folgemonat berechnet) — sonst null>", "begruendung": "<max 1 Satz>", "steuer_hinweis": "<1-2 Sätze: wie hier steuerlich schlau gebucht wird — z. B. Vorsteuerabzug, Reverse-Charge Paragraf 13b bei EU-Portalen (taxRate 0), GWG-Sofortabzug, Bewirtung 70 Prozent>", "anlagegut": true|false, "nutzungsdauer_jahre": <Zahl oder null>, "wohnung": "<exakter Wohnungsname bei ECHTEN Standort-Indizien im Beleg (Adresse/Objektname), sonst null>", "standort": "<exakter Standortname oder null>"}
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
    waehrung: typeof j.waehrung === 'string' && /^[A-Z]{3}$/i.test(j.waehrung) ? j.waehrung.toUpperCase() : null,
    datum: typeof j.belegdatum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.belegdatum) ? j.belegdatum : null,
    leistungsmonat: typeof j.leistungsmonat === 'string' && /^\d{4}-\d{2}$/.test(j.leistungsmonat) ? j.leistungsmonat : null,
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
    // §243ad: Nicht-Auto-Fälle behalten die Analyse als VORAB-Cache — die
    // /buchhaltung-Oberfläche zeigt sie dann instant (ki-vorschlag cache-first)
    const merken = async (text: string): Promise<{ auto: boolean; text: string }> => {
      if (ki.ok) await speichereKiAnalyse(voucherId, ki).catch(() => {})
      return { auto: false, text }
    }
    if (!ki.ok || !ki.accountDatevId) return { auto: false, text: `zur Prüfung (${ki.error ?? 'keine Kategorie'})` }
    if (ki.anlagegut) return merken('zur Prüfung (Anlagegut — AfA bestätigen)')
    const sicherKategorie = ki.weg === 'provision' || ki.weg === 'gelernt'
    // v4: FREMDWÄHRUNG (§243u-Doktrin) — der PDF-Betrag ist dann USD/…, als
    // EUR gebucht wäre er falsch. Gebucht wird NUR der Bank-EUR-Betrag der
    // passenden Abbuchung; ohne die bleibt der Beleg zur Prüfung.
    const fremd = !!ki.waehrung && ki.waehrung !== 'EUR'
    // v4: Betrags-Fallback-Kette — Vision-Betrag, sonst der Mail-KI-Betrag
    // aus der beleg_inbox (nur EUR; und nur mit exaktem Bank-Match buchen =
    // doppelte Bestätigung)
    let betrag = !fremd && typeof ki.betrag === 'number' && ki.betrag > 0 ? ki.betrag : null
    let betragAusMail = false
    if (!betrag && !fremd) {
      try {
        const { data: ib } = await supabaseAdmin
          .from('beleg_inbox').select('betrag').eq('sevdesk_voucher_id', voucherId).maybeSingle()
        const mb = Number(ib?.betrag)
        if (Number.isFinite(mb) && mb > 0) { betrag = Math.round(mb * 100) / 100; betragAusMail = true }
      } catch { /* best effort */ }
    }
    if (!fremd && !betrag) return merken('zur Prüfung (Betrag nicht sicher lesbar)')
    if (betrag && betrag > 5000) return merken(`zur Prüfung (${betrag.toFixed(2)} € über der Auto-Grenze)`)

    // v4: Fremdwährung buchen NUR die sicheren Wege (provision/gelernt) —
    // ein neuer Lieferant + Wechselkurs-Unschärfe ist zu viel Rateanteil
    if (fremd && !sicherKategorie) return merken(`zur Prüfung (${ki.waehrung}-Rechnung von neuem Lieferanten)`)
    // Fremdwährung ohne lesbares Rechnungsdatum: kein Datumsfenster möglich
    // → nie automatisch (Review-Befund: sonst zählen 120 Tage)
    if (fremd && !ki.datum) return merken(`zur Prüfung (${ki.waehrung}-Rechnung ohne lesbares Datum — Bank-Abgleich nötig)`)

    // Passende offene Abbuchung suchen — EUR: exakter Betrag; Fremdwährung:
    // Lieferanten-Token im Bank-Namen + enges Band + Datumsfenster.
    // v4: Kandidaten nach DATUMS-NÄHE zum Rechnungsdatum wählen (die alte
    // Neueste-zuerst-Wahl verheiratete Abo-Ketten mit der falschen Rate).
    let tx: { id: string; accountId: string; datum: string; eur: number; name: string } | null = null
    let txNameOk = false
    let txDatumOk = false
    let txEindeutig = false
    try {
      const { findBankAccounts, listBankTransactions } = await import('@/lib/sevdesk-payouts')
      const banks = await findBankAccounts()
      const kand: { id: string; accountId: string; datum: string; eur: number; name: string }[] = []
      for (const bank of banks) {
        for (const t of await listBankTransactions(bank.id, 120)) {
          if (Number(t.status) !== 100) continue
          const amt = Number(t.amount)
          if (amt >= 0) continue
          kand.push({
            id: String(t.id), accountId: bank.id,
            datum: String(t.valueDate ?? t.entryDate ?? '').slice(0, 10),
            eur: Math.round(Math.abs(amt) * 100) / 100,
            name: String(t.payeePayerName ?? ''),
          })
        }
      }
      // Lieferanten-Tokens für den Namens-Abgleich (WORT-Gleichheit, kein
      // Substring — 'web' darf nicht 'webflow' matchen, Review-Befund):
      // das ERSTE (Markenname) oder das LÄNGSTE Token muss als eigenes Wort
      // im Bank-Empfängernamen vorkommen
      const supName = await kiSupplier(voucherId)
      const supTokens = normLieferant(String(supName ?? '')).split(' ').filter((x) => x.length >= 3)
      const kernTokens = supTokens.length
        ? [...new Set([supTokens[0], [...supTokens].sort((a, b) => b.length - a.length)[0]])]
        : []
      const nameMatch = (bankName: string): boolean => {
        if (!kernTokens.length) return false
        const words = new Set(normLieferant(bankName).split(' '))
        return kernTokens.some((tok) => words.has(tok))
      }
      const tage = (a: string, b: string): number =>
        Math.abs(Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400_000
      const naehe = (datum: string): number => ki.datum
        ? tage(datum, ki.datum)
        : -Date.parse(datum + 'T12:00:00Z') / 86400_000
      if (fremd) {
        // Fremdwährung: Namens-Pflicht + enges Band (±12 % — EUR/USD schwankt
        // real weit weniger als das alte ±25-%-Band, das benachbarte
        // Anthropic-Abbuchungen einfing) + Datum ≤ 21 Tage; MEHRDEUTIG =
        // nicht automatisch (Review-Befund kritisch #1)
        const fw = typeof ki.betrag === 'number' && ki.betrag > 0 ? ki.betrag : null
        if (!fw) return merken(`zur Prüfung (${ki.waehrung}-Betrag nicht lesbar)`)
        const treffer = kand.filter((k) => {
          if (!nameMatch(k.name)) return false
          if (k.eur < fw * 0.88 || k.eur > fw * 1.12) return false
          if (tage(k.datum, ki.datum as string) > 21) return false
          return true
        })
        if (treffer.length !== 1) {
          return merken(`zur Prüfung (${ki.waehrung}-Rechnung — ${treffer.length === 0 ? 'passende Bank-Abbuchung nicht gefunden' : 'mehrere Bank-Abbuchungen möglich'})`)
        }
        tx = treffer[0]
        betrag = tx.eur
        txNameOk = true
        txDatumOk = true
        txEindeutig = true
      } else {
        const exakt = kand.filter((k) => Math.abs(k.eur - (betrag as number)) <= 0.005)
        exakt.sort((a, b) => naehe(a.datum) - naehe(b.datum))
        const mitName = exakt.filter((k) => nameMatch(k.name))
        tx = (mitName[0] ?? exakt[0]) ?? null
        txNameOk = tx ? nameMatch(tx.name) : false
        txDatumOk = tx && ki.datum ? tage(tx.datum, ki.datum) <= 30 : false
        txEindeutig = mitName.length === 1 || exakt.length === 1
      }
    } catch { /* ohne Zahlung buchen (nur EUR-Pfad) */ }
    if (fremd && !tx) return merken(`zur Prüfung (${ki.waehrung}-Rechnung — Bank-Abgleich nötig)`)
    if (!betrag) return merken('zur Prüfung (Betrag nicht sicher lesbar)')
    if (betrag > 5000) return merken(`zur Prüfung (${betrag.toFixed(2)} € über der Auto-Grenze)`)

    // v4 AUTO-GATES (nach Review verschärft): provision/gelernt buchen wie
    // bisher. Der Mail-Betrag und der VISION-Weg (neuer Lieferant!) brauchen
    // einen Bank-Treffer, der WIRKLICH bestätigt — exakter Betrag reicht
    // nicht (Nuki 69,00 ×3, M365 38,98 ×2 …): zusätzlich Lieferanten-Name
    // als Wort im Bank-Empfänger, Datum ≤ 30 Tage und EINDEUTIGKEIT.
    const txBestaetigt = !!tx && txNameOk && txEindeutig
    if (betragAusMail && !txBestaetigt) {
      return merken('zur Prüfung (Betrag nur aus der Mail — keine eindeutig passende Zahlung)')
    }
    if (!sicherKategorie) {
      const visionOk = ki.weg === 'vision' && !fremd && txBestaetigt && txDatumOk && betrag <= 1000
      if (!visionOk) return merken(`zur Prüfung (neuer Lieferant — Vorschlag: ${ki.nr} ${ki.kategorie ?? ''})`)
    }

    // v4-Review: Live-Status-Recheck — hat ein paralleler Lauf (⚡-Batch vs.
    // Cron-Nachlauf) den Beleg inzwischen gebucht, NICHT erneut anfassen
    // (bookSevVoucher würde per resetToOpen dessen frische Zahlung lösen)
    try {
      const { sevJson } = await import('@/lib/sevdesk')
      const curRaw = await sevJson<{ status?: unknown }[] | { status?: unknown }>(`/Voucher/${voucherId}`)
      const curSt = Number(Array.isArray(curRaw) ? curRaw[0]?.status : (curRaw as { status?: unknown })?.status)
      if (Number.isFinite(curSt) && curSt !== 50) {
        return { auto: false, text: 'zur Prüfung (inzwischen anderweitig gebucht)' }
      }
    } catch { /* best effort */ }

    const r = await bookSevVoucher(voucherId, {
      accountDatevId: ki.accountDatevId,
      taxRate: [19, 7, 0].includes(Number(ki.taxRate)) ? Number(ki.taxRate) : 19,
      amountGross: betrag,
      costCentreName: ki.kst ?? null,
      ...(ki.datum ? { voucherDate: ki.datum } : {}),
      ...(ki.nr === '5923' ? { taxRuleId: 14 } : {}),
      ...(tx ? { txId: tx.id, txAccountId: tx.accountId, txDate: tx.datum } : {}),
    })
    if (!r.ok) return merken(`zur Prüfung (Buchung fehlgeschlagen: ${(r.error ?? '').slice(0, 80)})`)
    await saveZuordnung(voucherId, null, ki.zuordnung ?? { modus: 'allgemein' })
    try { const { invalidateAuswertungCache } = await import('@/lib/auswertung'); await invalidateAuswertungCache() } catch { /* best effort */ }
    const wegLabel = ki.weg === 'vision' ? ' (Vision + Bank-Beleg)' : fremd ? ` (${ki.waehrung} → Bank-EUR)` : ''
    return {
      auto: true,
      text: `automatisch verbucht: ${ki.nr} ${ki.kategorie ?? ''} · ${betrag.toFixed(2).replace('.', ',')} €${wegLabel}`
        + (ki.kst ? ` · KSt ${ki.kst}` : '') + (tx ? ' · Zahlung verknüpft' : ''),
    }
  } catch (e) {
    return { auto: false, text: `zur Prüfung (${String(e instanceof Error ? e.message : e).slice(0, 80)})` }
  }
}

/** v4: Lieferantenname für den Fremdwährungs-Bank-Match — aus dem Voucher
 *  (analysiereBeleg hält ihn nicht im Ergebnis; ein kleiner Nach-Read). */
async function kiSupplier(voucherId: string): Promise<string | null> {
  try {
    const { sevJson } = await import('@/lib/sevdesk')
    const vRaw = await sevJson<{ supplierName?: string }[] | { supplierName?: string }>(`/Voucher/${voucherId}`)
    const vObj = Array.isArray(vRaw) ? vRaw[0] : vRaw
    return vObj?.supplierName ?? null
  } catch { return null }
}

/**
 * v4 RETRO-NACHLAUF: Liegengebliebene Entwürfe (St. 50) regelmäßig erneut
 * durch die Voll-Automatik schicken — nach einem Gelernt-Rebuild oder der
 * ersten manuellen Buchung eines Lieferanten werden seine Alt-Entwürfe so
 * von selbst gebucht. 24-h-Dämpfung je Beleg (eigener Settings-Key), damit
 * derselbe kaputte Beleg nicht jeden 10-Min-Lauf Vision-Calls frisst.
 */
export async function autoNachlauf(limit = 2): Promise<{ versucht: number; gebucht: number }> {
  try {
    const { listSevVouchers } = await import('@/lib/sevdesk')
    const drafts = await listSevVouchers([50])
    if (!drafts.length) return { versucht: 0, gebucht: 0 }
    const { data } = await supabaseAdmin
      .from('app_settings').select('value').eq('key', 'buchhaltung_nachlauf').maybeSingle()
    const state = (data?.value ?? {}) as Record<string, string>
    const cutoff = Date.now() - 24 * 3600_000
    const faellig = drafts
      .map((v) => String(v.id))
      .filter((id) => !state[id] || Date.parse(state[id]) < cutoff)
      .slice(0, Math.max(0, limit))
    if (!faellig.length) return { versucht: 0, gebucht: 0 }
    // v4-Review: State VOR der Verarbeitung persistieren — ein paralleler
    // ⚡-Batch (UI) liest denselben Key und überspringt diese Belege
    for (const id of faellig) state[id] = new Date().toISOString()
    await supabaseAdmin.from('app_settings').upsert(
      { key: 'buchhaltung_nachlauf', value: state }, { onConflict: 'key' })
    let gebucht = 0
    for (const id of faellig) {
      const r = await autoVerbucheBeleg(id)
      if (r.auto) {
        gebucht++
        delete state[id]
        try {
          const { sendPushToTeam } = await import('@/lib/push')
          await sendPushToTeam('✅ Beleg automatisch verbucht (Nachlauf)', r.text, '/buchhaltung', { buchhaltung: true })
        } catch { /* best effort */ }
      }
    }
    const keys = Object.keys(state)
    if (keys.length > 200) {
      keys.sort((a, b) => state[a].localeCompare(state[b]))
      for (const k of keys.slice(0, keys.length - 200)) delete state[k]
    }
    await supabaseAdmin.from('app_settings').upsert(
      { key: 'buchhaltung_nachlauf', value: state }, { onConflict: 'key' })
    return { versucht: faellig.length, gebucht }
  } catch {
    return { versucht: 0, gebucht: 0 }
  }
}

/**
 * §243ad: KI-Analyse VORAB in beleg_inbox.ki_analyse cachen — die
 * /buchhaltung-Oberfläche zeigt sie dann instant statt beim Öffnen ~20 s
 * Vision zu warten. Legt die Protokollzeile an, falls sie fehlt.
 * Deploy-sicher: ohne die Migrations-Spalte scheitert das Update still.
 */
export async function speichereKiAnalyse(voucherId: string, ki: KiErgebnis): Promise<void> {
  try {
    const { data: row } = await supabaseAdmin
      .from('beleg_inbox').select('id').eq('sevdesk_voucher_id', voucherId).maybeSingle()
    if (row) {
      await supabaseAdmin.from('beleg_inbox').update({ ki_analyse: ki }).eq('id', row.id)
    } else {
      await supabaseAdmin.from('beleg_inbox').insert({
        source: 'app', status: 'sevdesk', sevdesk_voucher_id: voucherId, ki_analyse: ki,
      })
    }
  } catch { /* fail-soft — Analyse läuft dann eben beim Öffnen */ }
}

/**
 * §243ad: VORAB-Analyse-Lauf für BESTANDS-Belege ohne Cache — läuft im
 * 10-Minuten-Mail-Scan-Cron mit (max. `limit` Vision-Calls je Lauf, konvergiert
 * schnell, weil neue Belege ihre Analyse schon beim Entstehen bekommen).
 * So sind Kategorie/Steuer/Betrag/Zahlungs-Match fertig, BEVOR der Inhaber
 * die /buchhaltung öffnet.
 */
export async function vorabAnalyse(limit = 2): Promise<{ analysiert: number; offenOhneCache: number }> {
  try {
    const { listSevVouchers } = await import('@/lib/sevdesk')
    const vouchers = await listSevVouchers([50, 100, 750])
    if (!vouchers.length) return { analysiert: 0, offenOhneCache: 0 }
    const ids = vouchers.map((v) => String(v.id))
    const cached = new Set<string>()
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await supabaseAdmin
        .from('beleg_inbox').select('sevdesk_voucher_id')
        .in('sevdesk_voucher_id', ids.slice(i, i + 200)).not('ki_analyse', 'is', null)
      for (const r of data ?? []) if (r.sevdesk_voucher_id) cached.add(String(r.sevdesk_voucher_id))
    }
    const fehlen = ids.filter((id) => !cached.has(id))
    let analysiert = 0
    for (const id of fehlen.slice(0, Math.max(0, limit))) {
      try {
        const ki = await analysiereBeleg(id)
        if (ki.ok) await speichereKiAnalyse(id, ki)
        // Fehlschlag ebenfalls cachen (ok:false) — sonst frisst derselbe
        // kaputte Beleg jeden Lauf einen Vision-Call; Client/GET filtern
        // auf accountDatevId und ignorieren solche Einträge
        else await speichereKiAnalyse(id, ki)
        analysiert++
      } catch { /* nächster Lauf */ }
    }
    return { analysiert, offenOhneCache: fehlen.length - analysiert }
  } catch {
    return { analysiert: 0, offenOhneCache: 0 }
  }
}
