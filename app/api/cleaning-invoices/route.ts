import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTaskAuth } from '@/lib/tasks'
import { askClaude, askClaudeWithFile } from '@/lib/ai'
import { getCleaningSettings } from '@/lib/cleaning'
import { sevJson } from '@/lib/sevdesk'
import { parseJsonLoose, pdfForVoucher } from '@/lib/beleg-ki'

/**
 * 💶 Reinigungs-Rechnungen (nur Admins/Gastgeber — dieselben, die die
 * Kosten-Prognose sehen):
 *  GET    ?month=YYYY-MM            → Rechnungen des Monats (ohne month: letzte 30)
 *  POST   { action:'upload-url', fileType, month }
 *         → signierte Upload-URL (Client lädt direkt zu Supabase — 4,5-MB-Limit)
 *  POST   { action:'analyze', path, publicUrl, fileName, fileType, month,
 *           personId?, expected } → KI liest die Rechnung und gleicht sie
 *         gegen die erwarteten Kosten ab; Ergebnis wird gespeichert.
 *  DELETE { id }                    → Eintrag + Datei löschen
 * Fail-soft: Ohne Migration 20260719_cleaning_invoices liefert GET einen
 * Hinweis statt zu crashen.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

const ALLOWED: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
const MAX_FILE = 15 * 1024 * 1024 // Anthropic-Request-Limit (base64 bläht ×1,33)

async function requireAdmin() {
  const auth = await getTaskAuth()
  return auth && auth.role === 'admin' ? auth : null
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const month = req.nextUrl.searchParams.get('month')
  try {
    let q = supabaseAdmin
      .from('cleaning_invoices')
      .select('id, month, person_id, file_url, file_name, amount_expected, amount_invoiced, analysis, status, created_at')
      .order('created_at', { ascending: false })
      .limit(60)
    if (month) q = q.eq('month', month)
    const { data, error } = await q
    if (error) throw error
    return NextResponse.json({ invoices: data ?? [] }, NO_STORE)
  } catch {
    return NextResponse.json({ invoices: [], hint: 'Migration 20260719_cleaning_invoices.sql fehlt noch.' }, NO_STORE)
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))

  if (body.action === 'upload-url') {
    const ext = ALLOWED[String(body.fileType ?? '')]
    if (!ext) return NextResponse.json({ error: 'Nur PDF oder Foto (JPG/PNG/WebP).' }, { status: 400 })
    const ym = /^\d{4}-\d{2}$/.test(String(body.month)) ? body.month : 'unbekannt'
    const path = `cleaning-invoices/${ym}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { data, error } = await supabaseAdmin.storage.from('listing-images').createSignedUploadUrl(path)
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Upload-URL fehlgeschlagen.' }, { status: 500 })
    const { data: pub } = supabaseAdmin.storage.from('listing-images').getPublicUrl(path)
    return NextResponse.json({ path: data.path, token: data.token, bucket: 'listing-images', publicUrl: pub.publicUrl }, NO_STORE)
  }

  if (body.action === 'analyze') {
    const { path, publicUrl, fileName, fileType, month, personId, personName, expected } = body
    if (!path || !publicUrl || !ALLOWED[String(fileType)] || !/^\d{4}-\d{2}$/.test(String(month))) {
      return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
    }
    // Datei aus dem Storage laden (Client hat sie direkt hochgeladen)
    const { data: blob, error: dlErr } = await supabaseAdmin.storage.from('listing-images').download(String(path))
    if (dlErr || !blob) return NextResponse.json({ error: 'Datei nicht gefunden: ' + (dlErr?.message ?? '') }, { status: 400 })
    const buf = Buffer.from(await blob.arrayBuffer())
    if (buf.length > MAX_FILE) return NextResponse.json({ error: 'Datei zu groß (max. 15 MB).' }, { status: 400 })

    const system = `Du prüfst für TRIMOSA Apartments & Homes (Ferienwohnungs-Vermieter) die
Monats-Rechnung einer Reinigungskraft gegen die intern ERWARTETEN Kosten.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt (kein Markdown, keine Fences):
{
  "betrag_rechnung": <Gesamtbetrag der Rechnung in Euro als Zahl, null wenn nicht lesbar>,
  "positionen": [{ "text": "<Position kurz>", "betrag": <Zahl|null> }],
  "differenz": <betrag_rechnung minus erwarteter Betrag, Zahl|null>,
  "einschaetzung": "<2-4 Sätze auf Deutsch: Passt die Rechnung zur Erwartung? Woher kommt die Abweichung plausibel (mehr/weniger Reinigungen, andere Sätze, Zulagen, Anfahrten)? Konkret bleiben.>",
  "auffaelligkeiten": ["<konkrete Prüfpunkte, z. B. doppelte Position, Satz weicht ab, Reinigung an belegtem Tag — leer wenn nichts auffällt>"]
}

Regeln: Nur aus der Rechnung und den erwarteten Daten argumentieren, NICHTS
erfinden. Kleine Abweichungen (<10 %) nüchtern einordnen — die Erwartung ist
eine PROGNOSE (geplante Reinigungen), keine exakte Sollzahl. Bei unlesbarer
Rechnung das ehrlich sagen.`

    const user = `ERWARTETE KOSTEN für ${month}${personName ? ` (Reinigungskraft: ${personName})` : ' (alle Reinigungskräfte)'}:
${JSON.stringify(expected ?? {}, null, 1).slice(0, 4000)}

Oben angehängt: die eingereichte Rechnung („${String(fileName ?? 'Rechnung')}"). Prüfe sie gegen die Erwartung.`

    let analysis: Record<string, unknown> = {}
    let status = 'geprueft'
    try {
      const raw = await askClaudeWithFile(system, user, {
        mediaType: String(fileType), base64: buf.toString('base64'),
      }, 6000)
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      analysis = JSON.parse(clean)
    } catch (e) {
      status = 'fehler'
      analysis = { einschaetzung: 'Automatische Analyse fehlgeschlagen: ' + (e instanceof Error ? e.message : String(e)) }
    }

    const row = {
      month, person_id: typeof personId === 'string' && personId ? personId : null,
      file_url: String(publicUrl), file_name: String(fileName ?? '').slice(0, 200) || null,
      amount_expected: typeof expected?.total === 'number' ? expected.total : null,
      amount_invoiced: typeof analysis.betrag_rechnung === 'number' ? analysis.betrag_rechnung : null,
      analysis, status, created_by: auth.userId,
    }
    const { data: saved, error } = await supabaseAdmin.from('cleaning_invoices').insert(row).select('id').single()
    if (error) {
      return NextResponse.json({
        error: error.message.includes('cleaning_invoices')
          ? 'Migration 20260719_cleaning_invoices.sql fehlt noch — Analyse konnte nicht gespeichert werden.'
          : error.message,
        analysis,
      }, { status: 500 })
    }
    return NextResponse.json({ ok: true, id: saved.id, analysis, status }, NO_STORE)
  }

  /* 🔍 §257: Rechnung AUTOMATISCH aus dem Mail-Import prüfen — kein Upload:
     Die per Mail-Scan erfassten sevdesk-Belege des Lieferanten werden im
     Monats-Fenster gesucht, die KI ordnet zu, welche zur Reinigungs-
     Abrechnung gehören (Gästemanagement-Pauschalen etc. ausgeklammert),
     und die EXAKTE Beleg-Summe wird gegen die Erwartung gehalten. */
  if (body.action === 'auto-check') {
    const { month, personId, personName, expected } = body
    if (!/^\d{4}-\d{2}$/.test(String(month)) || typeof personId !== 'string' || !personId) {
      return NextResponse.json({ error: 'Ungültige Anfrage (Monat/Person).' }, { status: 400 })
    }
    // Zeitbudget (Review §257c): Vercel kappt bei 300 s und verwirft dann
    // ALLES — lieber Belege/Bewertung auslassen als das Ergebnis verlieren
    const deadline = Date.now() + 235_000

    // Lieferant: Admin-Einstellung (🧹-Karte) > Profilname als Fallback
    const settings = await getCleaningSettings()
    let supplier = (settings.supplierByPerson?.[personId] ?? '').trim()
    if (!supplier) {
      const { data: prof } = await supabaseAdmin
        .from('profiles').select('display_name').eq('id', personId).maybeSingle()
      supplier = String(prof?.display_name ?? '').trim()
    }
    if (!supplier) {
      return NextResponse.json({ error: 'Kein Rechnungs-Absender hinterlegt — Admin → 🧹 Reinigung → pro Reinigungskraft.' }, { status: 400 })
    }

    // sevdesk-Belege des Lieferanten im Fenster [Monatsanfang−10, Monatsende+25]
    // (Monatsrechnungen sind oft zum Ultimo oder Anfang des Folgemonats datiert).
    // supplierName-Filter matcht FUZZY (§243d) + Status-Listen können Belege
    // doppelt liefern (§243ac) → Dedupe über die Beleg-ID.
    const [y, mo] = String(month).split('-').map(Number)
    const monthEnd = `${month}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`
    const winFrom = new Date(Date.parse(`${month}-01T00:00:00Z`) - 10 * 86400_000).toISOString().slice(0, 10)
    const winTo = new Date(Date.parse(monthEnd + 'T00:00:00Z') + 25 * 86400_000).toISOString().slice(0, 10)
    type Cand = { id: string; datum: string; betrag: number; text: string; wohnung: string | null }
    const byId = new Map<string, Cand>()
    try {
      for (const st of [50, 100, 750, 1000]) {
        for (let offset = 0; offset < 300; offset += 100) {
          const list = await sevJson<Record<string, unknown>[]>(
            `/Voucher?status=${st}&limit=100&offset=${offset}&supplierName=${encodeURIComponent(supplier)}`)
          for (const v of list ?? []) {
            const d = String(v.voucherDate ?? '').slice(0, 10)
            if (d < winFrom || d > winTo) continue
            byId.set(String(v.id), {
              id: String(v.id), datum: d,
              betrag: Math.round(Number(v.sumGross ?? 0) * 100) / 100,
              text: String(v.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 140),
              wohnung: null,
            })
          }
          if (!list || list.length < 100) break
        }
      }
    } catch (e) {
      return NextResponse.json({ error: 'Buchhaltung (sevdesk) nicht erreichbar: ' + (e instanceof Error ? e.message : String(e)) }, { status: 502 })
    }

    // §257b: Wohnungs-Zuordnung je Beleg aus der Beleg-Inbox — die wurde
    // beim Verbuchen per Vision aus den Rechnungs-PDFs gelesen (§243c).
    // Fail-soft: ohne Zuordnung läuft die Prüfung ohne Wohnungs-Vergleich.
    try {
      const ids = [...byId.keys()]
      if (ids.length) {
        const { data: ib } = await supabaseAdmin
          .from('beleg_inbox')
          .select('sevdesk_voucher_id, zuordnung')
          .in('sevdesk_voucher_id', ids)
        type Zu = { modus?: string; listingIds?: string[]; standort?: string } | null
        const lids = new Set<string>()
        for (const r of ib ?? []) {
          const z = r.zuordnung as Zu
          for (const x of z?.listingIds ?? []) lids.add(x)
        }
        const titles = new Map<string, string>()
        if (lids.size) {
          const { data: ls } = await supabaseAdmin.from('listings').select('id, title').in('id', [...lids])
          for (const l of ls ?? []) titles.set(String(l.id), String(l.title ?? ''))
        }
        for (const r of ib ?? []) {
          const cand = byId.get(String(r.sevdesk_voucher_id))
          if (!cand) continue
          const z = r.zuordnung as Zu
          if (!z) continue
          if (z.modus === 'wohnung' && z.listingIds?.length === 1) cand.wohnung = titles.get(z.listingIds[0]) ?? null
          else if ((z.listingIds?.length ?? 0) > 1 || z.modus === 'split') cand.wohnung = 'mehrere Wohnungen'
          else if (z.modus === 'standort' && z.standort) cand.wohnung = `Standort ${z.standort}`
          else if (z.modus === 'allgemein') cand.wohnung = 'allgemein'
        }
      }
    } catch { /* Zuordnung optional */ }

    const cands = [...byId.values()].sort((a, b) => a.datum.localeCompare(b.datum))
    if (!cands.length) {
      return NextResponse.json({
        error: `Keine Belege von „${supplier}" im Zeitraum ${winFrom} bis ${winTo} im Mail-Import gefunden — ist die Rechnung schon eingegangen? (Absendername prüfbar unter Admin → 🧹 Reinigung.)`,
      }, { status: 404 })
    }

    /* ── Phase 1: KI ordnet zu, welche Belege zur Monats-Abrechnung gehören ── */
    const system = `Du prüfst für TRIMOSA Apartments & Homes die Monats-Abrechnung einer
Reinigungskraft. Unten die LISTE der automatisch per Mail-Import erfassten
Buchhaltungs-Belege dieses Lieferanten (Beträge EXAKT aus der Buchhaltung).

Aufgabe: Entscheide je Beleg, ob er zur REINIGUNGS-Abrechnung des Prüfmonats
gehört (Belegdatum im Monat oder kurz danach; Beschreibung beachten). Belege,
die erkennbar NICHT Reinigung sind (z. B. Gästemanagement-Pauschalen,
Sonderleistungen) oder zu einem ANDEREN Monat gehören, NICHT zuordnen und
den Grund nennen.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt (kein Markdown, keine Fences):
{
  "zugeordnet": ["<beleg-id>", ...],
  "nicht_zugeordnet": [{ "id": "<beleg-id>", "grund": "<kurz>" }]
}
Regeln: Nur aus Belegliste + Erwartung argumentieren, NICHTS erfinden.
Im Zweifel (Betrag passt zum Muster der Reinigungs-Pauschalen) eher zuordnen —
der Leistungszeitraum wird danach automatisch aus den Rechnungs-PDFs geprüft
(Lieferanten fakturieren oft NACHLAUFEND: eine Rechnung von Anfang des
Folgemonats kann die Monats-Abrechnung sein, eine Rechnung MITTEN im Monat
kann noch den Vormonat abrechnen).`

    const user = `PRÜFMONAT: ${month}${personName ? ` · Reinigungskraft: ${personName}` : ''} · Lieferant in der Buchhaltung: ${supplier}

ERWARTETE KOSTEN:
${JSON.stringify(expected ?? {}, null, 1).slice(0, 12000)}

BELEGE AUS DEM MAIL-IMPORT (id | belegdatum | betrag EUR | wohnung | beschreibung):
${cands.map((c) => `${c.id} | ${c.datum} | ${c.betrag} | ${c.wohnung ?? '?'} | ${c.text || '—'}`).join('\n').slice(0, 6000)}`

    let status = 'geprueft'
    let ki: Record<string, unknown> = {}
    try {
      // §45-Lektion: das Denkbudget frisst max_tokens — 4000 führte zu
      // abgeschnittenem JSON („Unterminated string"); 12000 lässt Denk- UND
      // Antwort-Anteil sicher Platz, parseJsonLoose fängt Prosa-Reste ab
      const raw = await askClaude(system, user, 12000)
      ki = parseJsonLoose(raw)
      if (!Array.isArray(ki.zugeordnet)) throw new Error('Antwort ohne zugeordnet-Liste')
    } catch (e) {
      status = 'fehler'
      ki = { einschaetzung: 'Automatische Zuordnung fehlgeschlagen — unten alle gefundenen Belege des Lieferanten. Fehler: ' + (e instanceof Error ? e.message : String(e)) }
    }
    const matched = new Set(
      Array.isArray(ki.zugeordnet) ? (ki.zugeordnet as unknown[]).map(String) : cands.map((c) => c.id))
    const grund = new Map<string, string>(
      (Array.isArray(ki.nicht_zugeordnet) ? (ki.nicht_zugeordnet as { id?: unknown; grund?: unknown }[]) : [])
        .map((x) => [String(x.id ?? ''), String(x.grund ?? '')] as [string, string]))
    const r2 = (x: number) => Math.round(x * 100) / 100
    const dayDiff = (a: string, b: string) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400_000)
    const fmtDm = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`
    const expectedTotal = typeof expected?.total === 'number' ? expected.total : null

    /* ── Phase 2 (§257c): TIEFENANALYSE — die Rechnungs-PDFs werden per
       Vision gelesen: einzelne Positionen mit LEISTUNGS-Datum, Wohnung, Art
       und Betrag. Damit (a) werden Sammel-Rechnungen (Tip-Top rechnet
       mehrere Wohnungen je Rechnung ab) exakt auf die Wohnungen GESPLITTET
       und (b) jeder abgerechnete Reinigungstag gegen die geplanten Wechsel
       abgeglichen. Fail-soft je Beleg — ohne lesbares PDF bleibt die
       bisherige Ganz-Beleg-Zuordnung. ── */
    const { data: allLs } = await supabaseAdmin.from('listings').select('title').eq('is_active', true)
    const titleList = (allLs ?? []).map((l) => String(l.title ?? '')).filter(Boolean)
    const titleSet = new Set(titleList)
    type Pos = { datum: string | null; wohnung: string; art: string; text: string; betrag: number | null }
    type BelegDetail = { zeitraum: { von: string | null; bis: string | null } | null; positionen: Pos[]; factor: number | null }
    const posByBeleg = new Map<string, BelegDetail>()
    const hinweise: string[] = []
    const assigned = cands.filter((c) => matched.has(c.id))
    if (status === 'geprueft' && assigned.length > 9) {
      hinweise.push(`Positions-Tiefenanalyse auf die ersten 9 von ${assigned.length} Belegen begrenzt.`)
    }
    // Monats-Fenster (±6 Tage) + Leistungs-Anteil eines Belegs darin —
    // Grundlage für Perioden-Filter UND Erkundungs-Aufnahme
    const rangeLo = new Date(Date.parse(`${month}-01T00:00:00Z`) - 6 * 86400_000).toISOString().slice(0, 10)
    const rangeHi = new Date(Date.parse(monthEnd + 'T00:00:00Z') + 6 * 86400_000).toISOString().slice(0, 10)
    const monatsAnteil = (pv: BelegDetail): { anteil: number; spanne: [string, string] } | null => {
      const tage = pv.positionen.map((p) => p.datum).filter((d): d is string => !!d)
      if (tage.length >= 2) {
        return {
          anteil: tage.filter((d) => d >= rangeLo && d <= rangeHi).length / tage.length,
          spanne: [tage.reduce((a, b) => (a < b ? a : b)), tage.reduce((a, b) => (a > b ? a : b))],
        }
      }
      if (pv.zeitraum?.von && pv.zeitraum?.bis) {
        const { von, bis } = pv.zeitraum
        const lo = von > rangeLo ? von : rangeLo
        const hi = bis < rangeHi ? bis : rangeHi
        return { anteil: Math.max(0, dayDiff(hi, lo) + 1) / Math.max(1, dayDiff(bis, von) + 1), spanne: [von, bis] }
      }
      // Tip-Top-Realität: Rechnungen tragen oft nur EIN Leistungs-Startdatum
      // („Leistungszeitraum ab 01.06.") — dann entscheidet dieses Datum
      const einzel = pv.zeitraum?.von ?? pv.zeitraum?.bis
      if (einzel) {
        return { anteil: einzel >= rangeLo && einzel <= rangeHi ? 1 : 0, spanne: [einzel, einzel] }
      }
      return null
    }
    if (status === 'geprueft' && cands.length) {
      const vSystem = `Du liest die RECHNUNG einer Reinigungsfirma für TRIMOSA Apartments & Homes
(Ferienwohnungen) und extrahierst die einzelnen Positionen.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt (kein Markdown, keine Fences):
{
  "leistungszeitraum": { "von": "YYYY-MM-DD oder null", "bis": "YYYY-MM-DD oder null" },
  "positionen": [{
    "datum": "YYYY-MM-DD des LEISTUNGSTAGS (Reinigungstag) oder null",
    "wohnung": "<EXAKT einer der Titel unten oder 'unbekannt'>",
    "art": "reinigung" | "anfahrt" | "zulage" | "sonstiges",
    "text": "<Positionstext kurz, max. 60 Zeichen>",
    "betrag": <Zahl EXAKT wie gedruckt oder null>
  }]
}

Regeln:
- JEDE Rechnungszeile als eigene Position. "datum" ist der Tag der LEISTUNG
  (Reinigungstag), NICHT das Rechnungsdatum; steht nur ein Zeitraum da → null.
- "wohnung" auf EXAKT einen dieser Titel normalisieren: ${titleList.join(' · ')}.
  Hilfen: Feldstraße 10 (Trierweiler/Sirzenich) = Cozy Flat + Sweet Spot (beide
  DG) + Magnolia Flat (1. OG) · Bergstraße 3a (Minden) = Panorama Home +
  Sunrise Suite · Echternacher Str. 12A (Bitburg) = City Home · Breitenweg
  (Ralingen/Edingen) = River Retreat. Nicht sicher zuordenbar → "unbekannt".
- "art": End-/Grundreinigung → reinigung · Anfahrt/Fahrtkosten → anfahrt ·
  Sonn-/Feiertagszuschlag → zulage · alles andere → sonstiges.
- KEINE Summen-, Zwischensummen-, Gesamtbetrags-, Übertrags- oder Steuer-/
  USt-Zeilen als Positionen aufnehmen — NUR echte Leistungszeilen.
- Beträge und Daten NUR aus der Rechnung — NICHTS erfinden oder schätzen.`
      const visionBeleg = async (c: Cand) => {
        try {
          const pdf = await pdfForVoucher(c.id)
          if (!pdf) {
            hinweise.push(`Beleg vom ${c.datum}: kein PDF abrufbar — ohne Positions-Analyse geprüft.`)
            return
          }
          const vRaw = await askClaudeWithFile(vSystem,
            `Rechnung von ${supplier}, Belegdatum ${c.datum}, Gesamtbetrag laut Buchhaltung ${c.betrag} € (brutto).`,
            pdf, 9000)
          const vj = parseJsonLoose(vRaw)
          const isoOk = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null)
          const positionen: Pos[] = (Array.isArray(vj.positionen) ? (vj.positionen as Record<string, unknown>[]) : [])
            .map((p) => ({
              datum: isoOk(p?.datum),
              wohnung: typeof p?.wohnung === 'string' ? p.wohnung : 'unbekannt',
              art: ['reinigung', 'anfahrt', 'zulage', 'sonstiges'].includes(String(p?.art)) ? String(p?.art) : 'sonstiges',
              text: String(p?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
              betrag: typeof p?.betrag === 'number' && isFinite(p.betrag) ? r2(p.betrag) : null,
            })).slice(0, 60)
          const z = vj.leistungszeitraum as { von?: unknown; bis?: unknown } | undefined
          // Review §257c: Summen-/USt-/Übertrags-Zeilen, die trotz Prompt-
          // Regel durchrutschen, vergiften die Faktor-Normalisierung —
          // deterministisch rausfiltern (nur Zeilen OHNE Wohnungs-Treffer)
          const SUMMEN_RE = /summe|gesamt|übertrag|zahlbetrag|endbetrag|mwst|mehrwertsteuer|umsatzsteuer|\bust\b|netto|brutto/i
          const leistungen = positionen.filter((p) => titleSet.has(p.wohnung) || p.art !== 'sonstiges' || !SUMMEN_RE.test(p.text))
          // Positions-Beträge sind meist NETTO, der Beleg-Betrag BRUTTO —
          // proportional normalisieren, damit die Wohnungs-Anteile in Summe
          // EXAKT den Beleg-Betrag ergeben. Plausibel sind nur Faktoren um
          // 1,0 (Brutto-Zeilen) bis ~1,19 (Netto + USt) — alles andere
          // (Vision hat Zeilen verpasst/erfunden/Summen mitgezählt) →
          // keine Geld-Splittung über Positionen, Termine bleiben nutzbar.
          const rawSum = leistungen.reduce((a, p) => a + (p.betrag ?? 0), 0)
          const f = rawSum > 0 && c.betrag > 0 ? c.betrag / rawSum : null
          posByBeleg.set(c.id, {
            zeitraum: z ? { von: isoOk(z.von), bis: isoOk(z.bis) } : null,
            positionen: leistungen,
            factor: f != null && f >= 0.9 && f <= 1.3 ? f : null,
          })
        } catch (e) {
          hinweise.push(`Beleg vom ${c.datum}: Positions-Analyse fehlgeschlagen (${(e instanceof Error ? e.message : String(e)).slice(0, 120)}).`)
        }
      }
      // Wellen à 3 — Vision dominiert die Laufzeit, sevdesk (PDF-Abruf) wird
      // nicht mit allen Downloads parallel geflutet
      const queue = assigned.slice(0, 9)
      for (let i = 0; i < queue.length; i += 3) {
        if (Date.now() > deadline - 70_000) {
          hinweise.push(`Zeitbudget erreicht — ${queue.length - i} Beleg(e) ohne Positions-Analyse geprüft.`)
          break
        }
        await Promise.all(queue.slice(i, i + 3).map(visionBeleg))
      }
      /* ── ERKUNDUNG (Live-Funde Tip-Top): von Phase 1 ABGELEHNTE Kandidaten
         mit Belegdatum ab Monatsanfang werden TROTZDEM gelesen — die KI
         lehnt Sammel-/Mehrmonats-Rechnungen mangels Zeitraum-Wissen oft
         falsch ab (Lauf 3: nur 1 der 2 Juni-Belege zugeordnet). Belege mit
         überwiegend Monats-Leistungen kommen nachträglich in die Prüfung,
         Fremd-Perioden bekommen einen PRÄZISEN Grund aus dem PDF — der
         Inhalt wird nie verschluckt. ── */
      {
        const explor = cands
          .filter((c) => !matched.has(c.id) && !posByBeleg.has(c.id) && c.datum >= `${month}-01`)
          .sort((a, b) => Math.abs(dayDiff(a.datum, monthEnd)) - Math.abs(dayDiff(b.datum, monthEnd)))
          .slice(0, 4)
        for (let i = 0; i < explor.length; i += 2) {
          if (Date.now() > deadline - 70_000) break
          await Promise.all(explor.slice(i, i + 2).map(visionBeleg))
        }
        for (const c of explor) {
          const pv = posByBeleg.get(c.id)
          if (!pv) continue
          const ma = monatsAnteil(pv)
          if (!ma) continue
          if (ma.anteil >= 0.5) {
            matched.add(c.id)
            grund.delete(c.id)
          } else if (ma.anteil < 0.3) {
            grund.set(c.id, `Leistungszeitraum ${fmtDm(ma.spanne[0])}–${fmtDm(ma.spanne[1])} — andere Abrechnungs-Periode`)
          } else {
            hinweise.push(`Beleg vom ${c.datum} (${c.betrag} €): nur ein Teil der Leistungstage (${fmtDm(ma.spanne[0])}–${fmtDm(ma.spanne[1])}) liegt in ${month} — Mehrmonats-/Sammelrechnung, bitte per 📄-PDF prüfen.`)
          }
        }
      }
    }

    /* ── Phase 2.5 (deterministisch): PERIODEN-Filter — Belege, deren
       LEISTUNGSTAGE klar außerhalb des Prüfmonats liegen, fliegen aus der
       Zuordnung, egal was Phase 1 dachte. Live-Beweis Juni/VP: Rechnungen
       vom 12.06. decken die MAI-Leistungen (nachlaufende Fakturierung),
       die Juni-Abrechnung kam erst am 05.07. — ohne diesen Filter würden
       beide Batches addiert und die Prüfsumme verdoppelt. ── */
    for (const c of cands) {
      if (!matched.has(c.id)) continue
      const pv = posByBeleg.get(c.id)
      if (!pv) continue
      const ma = monatsAnteil(pv)
      if (ma && ma.anteil < 0.3) {
        matched.delete(c.id)
        grund.set(c.id, `Leistungszeitraum ${fmtDm(ma.spanne[0])}–${fmtDm(ma.spanne[1])} — andere Abrechnungs-Periode`)
      }
    }
    const sum = r2(cands.filter((c) => matched.has(c.id)).reduce((a, c) => a + c.betrag, 0))

    /* ── Phase 3 (deterministisch): Wohnungs-Split + Termin-Abgleich ── */
    const expWohnungen = Array.isArray(expected?.wohnungen)
      ? (expected.wohnungen as { wohnung?: unknown; gesamt?: unknown }[]) : []
    const erwartetBy = new Map<string, number>()
    for (const w of expWohnungen) {
      if (typeof w.wohnung === 'string' && typeof w.gesamt === 'number') erwartetBy.set(w.wohnung, w.gesamt)
    }
    // abgerechnet je Wohnung: POSITIONS-genau, wenn das PDF gelesen wurde
    // (löst Tip-Tops Sammel-Rechnungen), sonst Ganz-Beleg-Zuordnung (§243c)
    const abgerBy = new Map<string, number>()
    for (const c of cands) {
      if (!matched.has(c.id)) continue
      const pv = posByBeleg.get(c.id)
      // Positions-Split nur, wenn mindestens EINE Position eine ECHTE Wohnung
      // trägt — sonst würde eine bekannte Ganz-Beleg-Zuordnung (§243c) durch
      // lauter „unbekannt"-Positionen entwertet (Review §257c)
      if (pv?.factor != null && pv.positionen.some((p) => p.betrag != null && titleSet.has(p.wohnung))) {
        for (const p of pv.positionen) {
          if (p.betrag == null) continue
          const key = titleSet.has(p.wohnung) ? p.wohnung : 'Ohne Wohnungs-Zuordnung'
          abgerBy.set(key, (abgerBy.get(key) ?? 0) + p.betrag * pv.factor)
        }
      } else {
        const key = c.wohnung && !/^(mehrere|allgemein|Standort )/.test(c.wohnung) ? c.wohnung : 'Ohne Wohnungs-Zuordnung'
        abgerBy.set(key, (abgerBy.get(key) ?? 0) + c.betrag)
      }
    }
    const alleWohnungen = new Set([...erwartetBy.keys(), ...abgerBy.keys()])
    alleWohnungen.delete('Ohne Wohnungs-Zuordnung')
    const wohnungenBase = [...alleWohnungen].map((w) => {
      const e = erwartetBy.get(w) ?? null
      const a = r2(abgerBy.get(w) ?? 0)
      return { wohnung: w, erwartet: e, abgerechnet: a, differenz: e != null ? r2(a - e) : null }
    }).sort((x, y) => Math.abs(y.differenz ?? y.abgerechnet) - Math.abs(x.differenz ?? x.abgerechnet))
    const ohneZu = abgerBy.get('Ohne Wohnungs-Zuordnung')
    if (ohneZu && Math.abs(ohneZu) > 0.005) {
      wohnungenBase.push({ wohnung: 'Ohne Wohnungs-Zuordnung', erwartet: null, abgerechnet: r2(ohneZu), differenz: null })
    }

    // Termin-Abgleich: geplante Reinigungen (Erwartung) vs. abgerechnete
    // LEISTUNGSTAGE aus den PDF-Positionen — beantwortet direkt „wie können
    // weniger Reinigungen als Wechsel abgerechnet worden sein?"
    const expTermine = new Map<string, string[]>()
    {
      const er = (expected as { einzelne_reinigungen?: unknown })?.einzelne_reinigungen
      for (const t of Array.isArray(er) ? (er as { datum?: unknown; wohnung?: unknown }[]) : []) {
        if (typeof t?.datum === 'string' && typeof t?.wohnung === 'string') {
          const arr = expTermine.get(t.wohnung) ?? []
          arr.push(t.datum)
          expTermine.set(t.wohnung, arr)
        }
      }
    }
    // Rand-Termine (±7 Tage um die Monatsgrenzen, vom Client mitgeschickt):
    // eine Abreise am 30.6. mit Reinigungs-Termin 1.7. steht in der JULI-
    // Erwartung — rechnet der Lieferant sie auf der Juni-Rechnung ab, darf
    // sie nicht als „zusätzlich" alarmieren (Review §257c: Monatsrand)
    const randTermine = new Map<string, string[]>()
    {
      const rr = (expected as { rand_termine?: unknown })?.rand_termine
      for (const t of Array.isArray(rr) ? (rr as { datum?: unknown; wohnung?: unknown }[]) : []) {
        if (typeof t?.datum === 'string' && typeof t?.wohnung === 'string') {
          const arr = randTermine.get(t.wohnung) ?? []
          arr.push(t.datum)
          randTermine.set(t.wohnung, arr)
        }
      }
    }
    // abgerechnete Leistungstage je Wohnung MIT Zähler — zweimal derselbe
    // Tag = Doppel-Abrechnungs-Verdacht (Review §257c: Set verschluckte das)
    const gotTermine = new Map<string, Map<string, number>>()
    for (const c of cands) {
      // nur noch ZUGEORDNETE Belege — die vom Perioden-Filter aussortierten
      // Mai-Rechnungen dürfen keine „zusätzlich"-Termine erzeugen
      if (!matched.has(c.id)) continue
      const pv = posByBeleg.get(c.id)
      if (!pv) continue
      for (const p of pv.positionen) {
        if (p.art !== 'reinigung' || !p.datum || !titleSet.has(p.wohnung)) continue
        const m2 = gotTermine.get(p.wohnung) ?? new Map<string, number>()
        m2.set(p.datum, (m2.get(p.datum) ?? 0) + 1)
        gotTermine.set(p.wohnung, m2)
      }
    }
    type Abgleich = { wohnung: string; erwartetTermine: number; abgerechnetTermine: number; fehlend: string[]; zusaetzlich: string[]; doppelt: string[] }
    let abgleichOut: Abgleich[] | undefined
    if ([...gotTermine.values()].some((m2) => m2.size)) {
      const ws = new Set([...expTermine.keys(), ...gotTermine.keys()])
      abgleichOut = [...ws].map((w) => {
        const exp = [...(expTermine.get(w) ?? [])].sort()
        const gm = gotTermine.get(w) ?? new Map<string, number>()
        const got = [...gm.keys()].sort()
        const doppelt = got.filter((g) => (gm.get(g) ?? 0) > 1)
        const abgerechnetTermine = [...gm.values()].reduce((a, n) => a + n, 0)
        const used = new Set<number>()
        const gotUsed = new Set<string>()
        // Pass 1: EXAKTE Treffer zuerst (Review §257c: sonst klaut ein
        // 6-Tage-Nachbar den Exakt-Partner und der echte Tag wird rot)
        for (const g of got) {
          const i = exp.findIndex((e, idx) => !used.has(idx) && e === g)
          if (i >= 0) { used.add(i); gotUsed.add(g) }
        }
        // Pass 2: Rest global nach Distanz (±6 Tage — Reinigung darf nach
        // der Abreise liegen), nächstliegende Paare zuerst
        const pairs: { g: string; i: number; d: number }[] = []
        for (const g of got) {
          if (gotUsed.has(g)) continue
          exp.forEach((e, i) => {
            if (used.has(i)) return
            const d = Math.abs(dayDiff(e, g))
            if (d <= 6) pairs.push({ g, i, d })
          })
        }
        pairs.sort((a, b) => a.d - b.d)
        for (const p of pairs) {
          if (gotUsed.has(p.g) || used.has(p.i)) continue
          used.add(p.i)
          gotUsed.add(p.g)
        }
        // Pass 3: übrige abgerechnete Tage gegen die RAND-Termine der
        // Nachbarmonate neutralisieren (weder „zusätzlich" noch „fehlt")
        const rand = [...(randTermine.get(w) ?? [])]
        const randUsed = new Set<number>()
        for (const g of got) {
          if (gotUsed.has(g)) continue
          const i = rand.findIndex((e, idx) => !randUsed.has(idx) && Math.abs(dayDiff(e, g)) <= 6)
          if (i >= 0) { randUsed.add(i); gotUsed.add(g) }
        }
        const zusaetzlich = got.filter((g) => !gotUsed.has(g))
        const fehlend = exp.filter((_, i) => !used.has(i))
        return { wohnung: w, erwartetTermine: exp.length, abgerechnetTermine, fehlend, zusaetzlich, doppelt }
      }).sort((a, b) => (b.fehlend.length + b.zusaetzlich.length + b.doppelt.length) - (a.fehlend.length + a.zusaetzlich.length + a.doppelt.length))
    }

    /* ── Phase 4: Bewertungs-KI — nur die TEXTE zu den exakt berechneten
       Zahlen (Einschätzung, Ursachen je Wohnung, Prüfpunkte). Fällt sie aus,
       entstehen die Ursachen deterministisch aus dem Termin-Abgleich. ── */
    let ursachen = new Map<string, string>()
    let einschaetzung: string | undefined
    let auffaellig: string[] = []
    let phase4Err: string | null = null
    if (status === 'geprueft' && Date.now() > deadline - 45_000) {
      phase4Err = 'Zeitbudget erreicht — Bewertung deterministisch statt per KI.'
    }
    if (status === 'geprueft' && !phase4Err) {
      try {
        const bSystem = `Du bewertest für TRIMOSA Apartments & Homes die Monats-Abrechnung einer
Reinigungskraft. Alle ZAHLEN unten sind bereits EXAKT berechnet — Belege aus
der Buchhaltung, Einzelpositionen aus den Rechnungs-PDFs, Termin-Abgleich
gegen die geplanten Reinigungen. Du lieferst NUR die Bewertung dazu.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt (kein Markdown, keine Fences):
{
  "einschaetzung": "<2-5 Sätze auf Deutsch: Passt die Abrechnung zur Erwartung? Konkret auf Termine und Beträge eingehen.>",
  "wohnungs_ursachen": [{ "wohnung": "<Name exakt wie in den Daten>", "ursache": "<1 kurzer Satz — konkrete Termine/Daten nennen, wenn der Termin-Abgleich sie zeigt>" }],
  "auffaelligkeiten": ["<konkrete Prüfpunkte — leer wenn nichts auffällt>"]
}
Regeln: NUR aus den Daten argumentieren, NICHTS erfinden. Kleine Abweichungen
(<10 %) nüchtern einordnen — die Erwartung ist eine PROGNOSE. FEHLENDE Termine
können auch heißen, dass eine ANDERE Reinigungskraft sie übernommen hat
(Zuständigkeits-Wechsel) — als mögliche Erklärung nennen. ZUSÄTZLICH
abgerechnete Termine ohne geplanten Wechsel sind ein echter Prüfpunkt (Datum
nennen). Doppelt abgerechnete Tage oder doppelte Beträge immer anmerken.
Termine in den ersten/letzten Tagen des Monats können auf der Rechnung des
NACHBAR-Monats stehen — fehlende Rand-Termine vorsichtig bewerten.
Nennen Positionen STUNDEN (z. B. „31,10 Std."): den impliziten Stundensatz
(Betrag ÷ Stunden, ggf. netto) gegen den Satz in der Erwartung (saetze.
hourlyRate) prüfen — ein abweichender Satz ist ein WICHTIGER Prüfpunkt
(Vertragssatz vs. Listenpreis).
WICHTIG fürs JSON: In String-Werten KEINE doppelten Anführungszeichen —
Wohnungsnamen und Zitate OHNE "…" schreiben, sonst ist das JSON ungültig.`
        const bUser = `PRÜFMONAT: ${month}${personName ? ` · Reinigungskraft: ${personName}` : ''} · Lieferant: ${supplier}

ERWARTUNG (geplante Reinigungen):
${JSON.stringify(expected ?? {}, null, 1).slice(0, 8000)}

EXAKT BERECHNETES PRÜF-ERGEBNIS:
${JSON.stringify({
  summe_zugeordnete_belege: sum,
  erwartet_gesamt: expectedTotal,
  differenz: expectedTotal != null ? r2(sum - expectedTotal) : null,
  wohnungs_vergleich: wohnungenBase,
  termin_abgleich: abgleichOut ?? 'keine Leistungstage in den PDFs gefunden',
  belege: cands.filter((c) => matched.has(c.id)).map((c) => {
    const pv = posByBeleg.get(c.id)
    return { belegdatum: c.datum, betrag: c.betrag, zeitraum: pv?.zeitraum, positionen: pv?.positionen }
  }),
}, null, 1).slice(0, 14000)}`
        // Live-Fund Tip-Top: die KI schrieb Wohnungsnamen mit "…"-Zitaten →
        // ungültiges JSON. Ein Retry mit explizitem Hinweis, wenn Zeit bleibt.
        let bj: Record<string, unknown>
        try {
          bj = parseJsonLoose(await askClaude(bSystem, bUser, 12000))
        } catch (parseErr) {
          if (Date.now() > deadline - 45_000) throw parseErr
          bj = parseJsonLoose(await askClaude(
            bSystem + '\n\nACHTUNG: Der vorige Versuch war KEIN gültiges JSON (vermutlich doppelte Anführungszeichen in String-Werten). Antworte erneut — Strings strikt ohne "-Zeichen.',
            bUser, 12000))
        }
        einschaetzung = typeof bj.einschaetzung === 'string' ? bj.einschaetzung : undefined
        auffaellig = Array.isArray(bj.auffaelligkeiten) ? (bj.auffaelligkeiten as unknown[]).map(String).slice(0, 10) : []
        ursachen = new Map(
          (Array.isArray(bj.wohnungs_ursachen) ? (bj.wohnungs_ursachen as { wohnung?: unknown; ursache?: unknown }[]) : [])
            .map((x) => [String(x.wohnung ?? ''), String(x.ursache ?? '')] as [string, string]))
      } catch (e) {
        phase4Err = (e instanceof Error ? e.message : String(e)).slice(0, 140)
      }
    }
    if (status === 'geprueft' && phase4Err) {
      // Zahlen sind exakt berechnet — nur die Prosa fällt aus; Ursachen
      // entstehen deterministisch aus dem Termin-Abgleich (inkl. Doppelte)
      for (const a of abgleichOut ?? []) {
        if (!a.fehlend.length && !a.zusaetzlich.length && !a.doppelt.length) continue
        ursachen.set(a.wohnung, [
          a.fehlend.length ? `${a.fehlend.length} geplante Termine ohne abgerechnete Reinigung (${a.fehlend.map(fmtDm).join(', ')})` : '',
          a.zusaetzlich.length ? `${a.zusaetzlich.length} abgerechnete Termine ohne geplanten Wechsel (${a.zusaetzlich.map(fmtDm).join(', ')})` : '',
          a.doppelt.length ? `doppelt abgerechnet: ${a.doppelt.map(fmtDm).join(', ')}` : '',
        ].filter(Boolean).join(' · '))
      }
      einschaetzung = `Summe der zugeordneten Belege ${sum} € gegenüber erwarteten ${expectedTotal ?? '?'} €. Automatische Bewertung ausgefallen — die Zahlen unten sind exakt berechnet (${phase4Err}).`
    }
    if (status !== 'geprueft') {
      einschaetzung = typeof ki.einschaetzung === 'string' ? ki.einschaetzung : undefined
    }
    const wohnungenOut = wohnungenBase.map((w) => ({ ...w, ursache: ursachen.get(w.wohnung) || undefined }))

    const analysis: Record<string, unknown> = {
      betrag_rechnung: sum,
      differenz: expectedTotal != null ? r2(sum - expectedTotal) : null,
      einschaetzung,
      auffaelligkeiten: auffaellig,
      hinweise: hinweise.length ? hinweise.slice(0, 8) : undefined,
      lieferant: supplier,
      wohnungen: status === 'geprueft' && wohnungenOut.length ? wohnungenOut : undefined,
      abgleich: abgleichOut,
      belege: cands.map((c) => {
        const pv = posByBeleg.get(c.id)
        return {
          id: c.id, datum: c.datum, betrag: c.betrag,
          text: c.text || 'Beleg', wohnung: c.wohnung,
          zugeordnet: matched.has(c.id),
          grund: grund.get(c.id) || undefined,
          zeitraum: pv?.zeitraum ?? undefined,
          positionen: pv?.positionen.length ? pv.positionen : undefined,
          url: `/api/buchhaltung/beleg-pdf?voucherId=${c.id}`,
        }
      }),
    }

    const row = {
      month, person_id: personId, file_url: 'auto',
      file_name: `Mail-Import: ${cands.filter((c) => matched.has(c.id)).length} Beleg(e) von ${supplier}`.slice(0, 200),
      amount_expected: expectedTotal, amount_invoiced: sum,
      analysis, status, created_by: auth.userId,
    }
    const { data: saved, error } = await supabaseAdmin.from('cleaning_invoices').insert(row).select('id').single()
    if (error) {
      return NextResponse.json({
        error: error.message.includes('cleaning_invoices')
          ? 'Migration 20260719_cleaning_invoices.sql fehlt noch — Analyse konnte nicht gespeichert werden.'
          : error.message,
        analysis,
      }, { status: 500 })
    }
    // Ersetzen statt stapeln — ERST einfügen, DANN ältere Auto-Prüfungen
    // räumen (Review §257b: delete-before-insert hätte bei Insert-Fehlern
    // die letzte gültige Analyse verloren); manuelle Uploads bleiben.
    await supabaseAdmin.from('cleaning_invoices').delete()
      .eq('month', month).eq('person_id', personId).eq('file_url', 'auto').neq('id', saved.id)
    return NextResponse.json({ ok: true, id: saved.id, analysis, status }, NO_STORE)
  }

  return NextResponse.json({ error: 'Unbekannte Aktion.' }, { status: 400 })
}

export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id fehlt.' }, { status: 400 })
  const { data: row } = await supabaseAdmin.from('cleaning_invoices').select('file_url').eq('id', id).maybeSingle()
  const { error } = await supabaseAdmin.from('cleaning_invoices').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Storage-Datei best-effort mitlöschen
  try {
    const marker = '/listing-images/'
    const url = String(row?.file_url ?? '')
    const i = url.indexOf(marker)
    if (i > 0) await supabaseAdmin.storage.from('listing-images').remove([decodeURIComponent(url.slice(i + marker.length))])
  } catch { /* egal */ }
  return NextResponse.json({ ok: true }, NO_STORE)
}
