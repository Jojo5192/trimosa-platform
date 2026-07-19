import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTaskAuth } from '@/lib/tasks'
import { askClaudeWithFile } from '@/lib/ai'

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
      .limit(30)
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
