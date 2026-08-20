import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * 🏢 §271 Kanzem-Backfill: Bestands-Belege des UG-Sanierungsprojekts
 * (Documents/Rechnungen Reinvest Kanzem) als bereits ENTSCHIEDENE
 * Inbox-Zeilen (firma='ug', bb_status='wartet') + PDF im Storage anlegen.
 * Der BB-Sync (Cron/Action) übernimmt danach Matching + Buchung.
 * multipart: file (PDF) + meta (JSON: anlageNr, datum JJJJ-MM-TT,
 * aussteller, betrag, beschreibung, belegnummer?, vat?, matchBetraege?).
 * Idempotent über mail_key 'kanzem-anlage-NN'.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function requireAdmin() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  return me?.is_admin ? user : null
}

export async function POST(req: NextRequest) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'multipart/form-data erwartet.' }, { status: 400 })
  const file = form.get('file')
  let meta: Record<string, unknown> = {}
  try { meta = JSON.parse(String(form.get('meta') ?? '{}')) } catch { /* unten */ }

  const anlageNr = Math.round(Number(meta.anlageNr))
  const datum = String(meta.datum ?? '')
  const aussteller = String(meta.aussteller ?? '').trim().slice(0, 120)
  const betrag = Number(meta.betrag)
  if (!(file instanceof File) || !Number.isFinite(anlageNr) || anlageNr < 1
    || !/^\d{4}-\d{2}-\d{2}$/.test(datum) || !aussteller || !Number.isFinite(betrag) || betrag <= 0) {
    return NextResponse.json({ error: 'file + meta {anlageNr, datum JJJJ-MM-TT, aussteller, betrag} nötig.' }, { status: 400 })
  }

  const mailKey = `kanzem-anlage-${String(anlageNr).padStart(2, '0')}`
  // Review §271: maybeSingle-error MUSS geprüft werden — bei je entstandenen
  // Duplikaten liefert er error statt data, und ein ignorierter Fehler würde
  // die Idempotenz ins Gegenteil kippen (jeder Aufruf legt neu an).
  const { data: existing, error: exErr } = await supabaseAdmin
    .from('beleg_inbox').select('id, bb_status').eq('mail_key', mailKey).maybeSingle()
  if (exErr) return NextResponse.json({ error: `Dedupe-Check: ${exErr.message}` }, { status: 500 })
  if (existing) return NextResponse.json({ ok: true, skipped: 'schon importiert', id: existing.id, bbStatus: existing.bb_status })

  const buf = Buffer.from(await file.arrayBuffer())
  if (buf.length > 15 * 1024 * 1024) return NextResponse.json({ error: 'Datei > 15 MB.' }, { status: 400 })
  const safeName = (file.name || `anlage-${anlageNr}.pdf`).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120)
  const path = `bb/kanzem/${mailKey}-${safeName}`
  const { error: upErr } = await supabaseAdmin.storage.from('belege')
    .upload(path, buf, { contentType: file.type || 'application/pdf', upsert: true })
  if (upErr) return NextResponse.json({ error: `Storage: ${upErr.message}` }, { status: 502 })

  const vat = Number(meta.vat)
  const matchBetraege = Array.isArray(meta.matchBetraege)
    ? (meta.matchBetraege as unknown[]).map(Number).filter((n) => Number.isFinite(n) && n > 0) : []

  const { data: ins, error: insErr } = await supabaseAdmin.from('beleg_inbox').insert({
    mail_key: mailKey,
    mailbox: 'kanzem-backfill',
    from_addr: null,
    subject: String(meta.beschreibung ?? '').slice(0, 200) || aussteller,
    lieferant: aussteller,
    betrag,
    beleg_datum: datum,
    belegnummer: String(meta.belegnummer ?? '').slice(0, 80) || null,
    ki_hinweis: `Kanzem-Backfill Anlage ${anlageNr} (Sanierung Brückenstraße 1)`,
    files: [{ path, name: safeName }],
    status: 'andere',
    decided_by: user.id,
    decided_at: new Date().toISOString(),
    firma: 'ug',
    bb_status: 'wartet',
    ...(matchBetraege.length ? { bb_match_betraege: matchBetraege } : {}),
    ...([0, 7, 17, 19].includes(vat) ? { ki_analyse: { taxRate: vat } } : {}),
    // §271b: Backfill kennt das Projekt — fixe Kostenstelle spart die
    // KI-Wahl und ist garantiert korrekt (Baumarkt-Bons ohne Objektbezug!)
    ...(typeof meta.kostenstelle === 'string' && meta.kostenstelle.trim()
      ? { bb_kostenstelle: meta.kostenstelle.trim().slice(0, 40) } : {}),
  }).select('id').maybeSingle()
  if (insErr) return NextResponse.json({ error: `Insert: ${insErr.message}` }, { status: 502 })
  return NextResponse.json({ ok: true, id: ins?.id ?? null, path })
}
