import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTaskAuth } from '@/lib/tasks'
import { askClaudeWithFile } from '@/lib/ai'
import { parseJsonLoose, sniffMediaType } from '@/lib/beleg-ki'
import { sendPushToTeam } from '@/lib/push'

/**
 * 🧾 TEAM-BELEG-EINREICHUNG (§243ad) — Dienstleister/Mitarbeiter laden
 * Belege hoch (Quittung vom Baumarkt, Handwerker-Rechnung …), optional mit
 * Standort-/Wohnungs-Wahl + kurzer Notiz. Sie sehen NUR die Bestätigung —
 * niemals Beträge, Analysen oder andere Finanzdaten. Der Beleg landet in
 * der Beleg-Inbox der /buchhaltung (Admin entscheidet Gesellschaft +
 * Verbuchung); Vision liest die Kopfdaten vorab.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 120
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

export async function GET() {
  const auth = await getTaskAuth()
  if (!auth) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { data: listings } = await supabaseAdmin
    .from('listings').select('title, location_group').eq('is_active', true).order('title')
  const groups = [...new Set((listings ?? []).map((l) => l.location_group).filter(Boolean).map(String))]
  const titles = (listings ?? []).map((l) => String(l.title))
  return NextResponse.json({ orte: ['Allgemein', ...groups, 'Kanzem', ...titles] }, NO_STORE)
}

export async function POST(req: NextRequest) {
  const auth = await getTaskAuth()
  if (!auth) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'Datei fehlt.' }, { status: 400 })
    if (file.size > 15_000_000) return NextResponse.json({ error: 'Datei zu groß (max 15 MB).' }, { status: 400 })
    const ort = typeof form.get('ort') === 'string' ? String(form.get('ort')).slice(0, 60) : ''
    const notiz = typeof form.get('notiz') === 'string' ? String(form.get('notiz')).slice(0, 300) : ''
    const buf = Buffer.from(await file.arrayBuffer())
    const mt = sniffMediaType(buf)
    if (!mt) return NextResponse.json({ error: 'Nur PDF, JPG oder PNG.' }, { status: 400 })
    const ext = mt === 'image/jpeg' ? 'jpg' : mt === 'image/png' ? 'png' : 'pdf'

    const { data: me } = await supabaseAdmin
      .from('profiles').select('display_name').eq('id', auth.userId).maybeSingle()
    const vorname = String(me?.display_name ?? 'Team').split(' ')[0]

    // Vision: Kopfdaten (best effort — die Einreichung klappt auch ohne)
    let meta: { lieferant?: string; betrag?: number; datum?: string; belegnummer?: string } = {}
    try {
      const raw = await askClaudeWithFile(
        'Lies die Kopfdaten dieses Buchhaltungsbelegs (Rechnung/Quittung/Kassenbon). Antworte NUR mit JSON: {"lieferant": "<Firmenname>", "betrag_brutto": <Zahl oder null>, "datum": "<JJJJ-MM-TT oder null>", "belegnummer": "<oder null>"}',
        'Beleg-Kopfdaten extrahieren.',
        { mediaType: mt, base64: buf.toString('base64') }, 1200)
      const oj = parseJsonLoose(raw)
      meta = {
        lieferant: typeof oj.lieferant === 'string' ? oj.lieferant.slice(0, 80) : undefined,
        betrag: typeof oj.betrag_brutto === 'number' && oj.betrag_brutto > 0 ? Math.round(oj.betrag_brutto * 100) / 100 : undefined,
        datum: typeof oj.datum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(oj.datum) ? oj.datum : undefined,
        belegnummer: typeof oj.belegnummer === 'string' ? oj.belegnummer.slice(0, 40) : undefined,
      }
    } catch { /* best effort */ }

    const path = `einreichung/${crypto.randomUUID()}/beleg.${ext}`
    const { error: upErr } = await supabaseAdmin.storage.from('belege')
      .upload(path, buf, { contentType: mt, upsert: true })
    if (upErr) return NextResponse.json({ error: 'Upload fehlgeschlagen — bitte nochmal versuchen.' }, { status: 502 })

    const zeile = {
      source: 'team', status: 'offen',
      lieferant: meta.lieferant ?? null, betrag: meta.betrag ?? null,
      beleg_datum: meta.datum ?? null, belegnummer: meta.belegnummer ?? null,
      subject: `Eingereicht von ${vorname}${ort ? ` · ${ort}` : ''}`.slice(0, 200),
      ki_hinweis: notiz ? `Notiz von ${vorname}: ${notiz}` : null,
      files: [{ path, name: `beleg.${ext}` }],
    }
    // Migration 20260802_beleg_v3 bringt die eingereicht_*-Spalten —
    // deploy-sicher mit Retry ohne sie
    const { error: insErr } = await supabaseAdmin.from('beleg_inbox').insert({
      ...zeile, eingereicht_von: auth.userId, eingereicht_ort: ort || null, eingereicht_notiz: notiz || null,
    })
    if (insErr) {
      const { error: retryErr } = await supabaseAdmin.from('beleg_inbox').insert(zeile)
      if (retryErr) return NextResponse.json({ error: 'Speichern fehlgeschlagen — bitte nochmal versuchen.' }, { status: 502 })
    }

    await sendPushToTeam(
      '🧾 Beleg eingereicht',
      `${vorname}${meta.lieferant ? ` · ${meta.lieferant}` : ''}${ort ? ` · ${ort}` : ''}`,
      '/buchhaltung', { buchhaltung: true },
    ).catch(() => {})

    // Bewusst OHNE Finanzdaten in der Antwort — der Einreicher sieht nur ✓
    return NextResponse.json({ ok: true }, NO_STORE)
  } catch (e) {
    console.error('[beleg-einreichen]', e)
    return NextResponse.json({ error: 'Einreichung fehlgeschlagen.' }, { status: 500 })
  }
}
