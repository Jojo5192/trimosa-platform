import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTaskAuth } from '@/lib/tasks'
import { askClaude, askClaudeWithFile } from '@/lib/ai'
import { getCleaningSettings } from '@/lib/cleaning'
import { sevJson } from '@/lib/sevdesk'

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
    type Cand = { id: string; datum: string; betrag: number; text: string }
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
            })
          }
          if (!list || list.length < 100) break
        }
      }
    } catch (e) {
      return NextResponse.json({ error: 'Buchhaltung (sevdesk) nicht erreichbar: ' + (e instanceof Error ? e.message : String(e)) }, { status: 502 })
    }
    const cands = [...byId.values()].sort((a, b) => a.datum.localeCompare(b.datum))
    if (!cands.length) {
      return NextResponse.json({
        error: `Keine Belege von „${supplier}" im Zeitraum ${winFrom} bis ${winTo} im Mail-Import gefunden — ist die Rechnung schon eingegangen? (Absendername prüfbar unter Admin → 🧹 Reinigung.)`,
      }, { status: 404 })
    }

    const system = `Du prüfst für TRIMOSA Apartments & Homes die Monats-Abrechnung einer
Reinigungskraft. Es gibt KEINE hochgeladene Rechnung — stattdessen die LISTE
der automatisch per Mail-Import erfassten Buchhaltungs-Belege dieses
Lieferanten (Beträge EXAKT aus der Buchhaltung, nicht schätzen).

Aufgaben:
1. Entscheide je Beleg, ob er zur REINIGUNGS-Abrechnung des Prüfmonats
   gehört (Belegdatum im Monat oder kurz danach; Beschreibung beachten).
   Belege, die erkennbar NICHT Reinigung sind (z. B. Gästemanagement-
   Pauschalen, Sonderleistungen) oder zu einem ANDEREN Monat gehören,
   NICHT zuordnen und den Grund nennen.
2. Vergleiche die Summe der zugeordneten Belege mit der Erwartung und
   erkläre Abweichungen konkret (mehr/weniger Reinigungen, Zulagen,
   Anfahrten, Sätze).

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt (kein Markdown, keine Fences):
{
  "zugeordnet": ["<beleg-id>", ...],
  "nicht_zugeordnet": [{ "id": "<beleg-id>", "grund": "<kurz>" }],
  "einschaetzung": "<2-4 Sätze auf Deutsch>",
  "auffaelligkeiten": ["<konkrete Prüfpunkte — leer wenn nichts auffällt>"]
}
Regeln: Nur aus Belegliste + Erwartung argumentieren, NICHTS erfinden.
Kleine Abweichungen (<10 %) nüchtern einordnen — die Erwartung ist eine
PROGNOSE (geplante Reinigungen), keine exakte Sollzahl. Im Zweifel (Betrag
passt zum Muster der Reinigungs-Pauschalen) eher zuordnen.`

    const user = `PRÜFMONAT: ${month}${personName ? ` · Reinigungskraft: ${personName}` : ''} · Lieferant in der Buchhaltung: ${supplier}

ERWARTETE KOSTEN:
${JSON.stringify(expected ?? {}, null, 1).slice(0, 4000)}

BELEGE AUS DEM MAIL-IMPORT (id | belegdatum | betrag EUR | beschreibung):
${cands.map((c) => `${c.id} | ${c.datum} | ${c.betrag} | ${c.text || '—'}`).join('\n').slice(0, 6000)}`

    let status = 'geprueft'
    let ki: Record<string, unknown> = {}
    try {
      const raw = await askClaude(system, user, 4000)
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      ki = JSON.parse(clean)
    } catch (e) {
      status = 'fehler'
      ki = { einschaetzung: 'Automatische Zuordnung fehlgeschlagen — unten alle gefundenen Belege des Lieferanten. Fehler: ' + (e instanceof Error ? e.message : String(e)) }
    }
    const matched = new Set(
      Array.isArray(ki.zugeordnet) ? (ki.zugeordnet as unknown[]).map(String) : cands.map((c) => c.id))
    const grund = new Map<string, string>(
      (Array.isArray(ki.nicht_zugeordnet) ? (ki.nicht_zugeordnet as { id?: unknown; grund?: unknown }[]) : [])
        .map((x) => [String(x.id ?? ''), String(x.grund ?? '')] as [string, string]))
    const sum = Math.round(cands.filter((c) => matched.has(c.id)).reduce((a, c) => a + c.betrag, 0) * 100) / 100
    const expectedTotal = typeof expected?.total === 'number' ? expected.total : null
    const analysis: Record<string, unknown> = {
      betrag_rechnung: sum,
      differenz: expectedTotal != null ? Math.round((sum - expectedTotal) * 100) / 100 : null,
      einschaetzung: typeof ki.einschaetzung === 'string' ? ki.einschaetzung : undefined,
      auffaelligkeiten: Array.isArray(ki.auffaelligkeiten) ? (ki.auffaelligkeiten as unknown[]).map(String).slice(0, 10) : [],
      lieferant: supplier,
      belege: cands.map((c) => ({
        id: c.id, datum: c.datum, betrag: c.betrag,
        text: c.text || 'Beleg', zugeordnet: matched.has(c.id),
        grund: grund.get(c.id) || undefined,
        url: `/api/buchhaltung/beleg-pdf?voucherId=${c.id}`,
      })),
    }

    // Ersetzen statt stapeln: vorherige Auto-Prüfungen desselben Monats +
    // derselben Person räumen (manuelle Uploads bleiben unberührt)
    await supabaseAdmin.from('cleaning_invoices').delete()
      .eq('month', month).eq('person_id', personId).eq('file_url', 'auto')

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
