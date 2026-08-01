import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { askClaudeWithFile } from '@/lib/ai'
import { parseJsonLoose, sniffMediaType, autoVerbucheBeleg } from '@/lib/beleg-ki'
import { uploadSevVoucherFile, createSevVoucherDraft } from '@/lib/sevdesk'

/**
 * 📸 FOTO-BELEG-UPLOAD (§243g) — Papier-Belege direkt aus der /buchhaltung-
 * Oberfläche fotografieren/hochladen: Vision liest Lieferant/Betrag/Datum →
 * sevdesk-Entwurf mit Datei → Storage-Kopie + Protokollzeile (Viewer) →
 * VOLL-AUTOMATIK (autoVerbucheBeleg §243f): sichere Kategorien werden
 * direkt verbucht inkl. Zahlungs-Match, sonst bleibt der Entwurf zur
 * Prüfung im Belege-Reiter. Admin-only.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  if (!me?.is_admin) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'Datei fehlt.' }, { status: 400 })
    if (file.size > 15_000_000) return NextResponse.json({ error: 'Datei zu groß (max 15 MB).' }, { status: 400 })
    const buf = Buffer.from(await file.arrayBuffer())
    const mt = sniffMediaType(buf)
    if (!mt) return NextResponse.json({ error: 'Nur PDF, JPG oder PNG.' }, { status: 400 })
    const ext = mt === 'image/jpeg' ? 'jpg' : mt === 'image/png' ? 'png' : 'pdf'

    // 1) Vision: Kopf-Daten aus dem Beleg lesen (Lieferant/Betrag/Datum)
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
    } catch { /* best effort — Draft entsteht trotzdem */ }
    const lieferant = meta.lieferant ?? 'Foto-Beleg'

    // 2) sevdesk-Entwurf mit der Datei
    const up = await uploadSevVoucherFile(buf, `foto-beleg.${ext}`, mt)
    if (!up.ok || !up.internalFilename) return NextResponse.json({ error: up.error ?? 'sevdesk-Upload fehlgeschlagen.' }, { status: 502 })
    const draft = await createSevVoucherDraft({
      internalFilename: up.internalFilename,
      supplierName: lieferant,
      description: (`Beleg (Foto-Upload): ${lieferant}`
        + (meta.betrag ? ` · ${meta.betrag.toFixed(2)} €` : '')
        + (meta.belegnummer ? ` · Nr. ${meta.belegnummer}` : '')).slice(0, 255),
      ...(meta.datum ? { voucherDate: meta.datum } : {}),
    })
    if (!draft.ok || !draft.voucherId) return NextResponse.json({ error: draft.error ?? 'Beleg-Anlage fehlgeschlagen.' }, { status: 502 })

    // 3) Storage-Kopie + Protokollzeile (Beleg-Viewer)
    try {
      const path = `sevdesk/foto-${draft.voucherId}/beleg.${ext}`
      const { error: upErr } = await supabaseAdmin.storage.from('belege')
        .upload(path, buf, { contentType: mt, upsert: true })
      await supabaseAdmin.from('beleg_inbox').insert({
        source: 'app', status: 'sevdesk',
        lieferant, betrag: meta.betrag ?? null, beleg_datum: meta.datum ?? null,
        subject: `Foto-Upload: ${lieferant}`.slice(0, 200),
        files: upErr ? [] : [{ path, name: `beleg.${ext}` }],
        sevdesk_voucher_id: draft.voucherId,
        decided_by: user.id, decided_at: new Date().toISOString(),
      })
    } catch { /* fail-soft */ }

    // 4) Voll-Automatik (§243f): sichere Fälle direkt verbuchen
    const auto = await autoVerbucheBeleg(draft.voucherId)
    return NextResponse.json({
      ok: true, voucherId: draft.voucherId, lieferant, betrag: meta.betrag ?? null,
      auto: auto.auto, text: auto.text,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e).slice(0, 300) }, { status: 500 })
  }
}
