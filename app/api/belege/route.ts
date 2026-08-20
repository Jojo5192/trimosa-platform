import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { uploadSevVoucherFile, createSevVoucherDraft } from '@/lib/sevdesk'

/**
 * 🧾 BELEG-INBOX (§238) — Admin/Gastgeber: Belege aus dem Mail-Scan, die
 * nicht eindeutig der A&H zuzuordnen waren. Der Inhaber entscheidet:
 *  GET  → offene Belege (mit signierten PDF-Links) + Kostenstellen-Optionen
 *         (?probe=1 = nur Berechtigungs-Check für den Mehr-Tab)
 *  POST → { id, ziel: 'sevdesk'|'andere'|'verworfen', kostenstelle? }
 *         sevdesk  = Apartments & Homes → PDF als Beleg-Entwurf hochladen
 *         andere   = andere Gesellschaft (UG/GbR) — bleibt hier archiviert
 *         verworfen = kein Beleg / irrelevant
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300
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

interface BelegRow {
  id: string; mailbox: string | null; from_addr: string | null; subject: string | null
  lieferant: string | null; betrag: number | string | null; beleg_datum: string | null
  belegnummer: string | null; ki_hinweis: string | null
  files: { path: string; name: string }[]; status: string; created_at: string
}

export async function GET(req: NextRequest) {
  const user = await requireFinance()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  if (req.nextUrl.searchParams.get('probe') === '1') return NextResponse.json({ ok: true }, NO_STORE)

  const { data: rows, error } = await supabaseAdmin
    .from('beleg_inbox').select('*')
    .eq('status', 'offen').order('created_at', { ascending: false }).limit(60)
  if (error) return NextResponse.json({ error: `Migration 20260801_beleg_inbox.sql fehlt noch? ${error.message}` }, { status: 500 })

  const belege = []
  for (const r of (rows ?? []) as BelegRow[]) {
    const links: { name: string; url: string }[] = []
    for (const f of r.files ?? []) {
      const { data: signed } = await supabaseAdmin.storage.from('belege').createSignedUrl(f.path, 3600)
      if (signed?.signedUrl) links.push({ name: f.name, url: signed.signedUrl })
    }
    const rx = r as BelegRow & { eingereicht_ort?: string | null; eingereicht_notiz?: string | null }
    belege.push({
      id: r.id, mailbox: r.mailbox, from: r.from_addr, subject: r.subject,
      lieferant: r.lieferant, betrag: r.betrag == null ? null : Number(r.betrag),
      datum: r.beleg_datum, belegnummer: r.belegnummer, kiHinweis: r.ki_hinweis,
      links, erhalten: r.created_at,
      // §243ad: Team-Einreichungen tragen Ort-Wunsch + Notiz des Einreichers
      eingereichtOrt: rx.eingereicht_ort ?? null,
      eingereichtNotiz: rx.eingereicht_notiz ?? null,
    })
  }

  const { data: listings } = await supabaseAdmin
    .from('listings').select('title, location_group').eq('is_active', true).order('title')
  // §240-Doktrin: KSt = Standorte; Wohnungen nur ohne Gruppe (River)
  const titles = (listings ?? []).filter((l) => !l.location_group).map((l) => String(l.title))
  const groups = [...new Set((listings ?? []).map((l) => l.location_group).filter(Boolean).map(String))]
  return NextResponse.json({
    belege,
    // §243p: Kanzem = angemietetes UG-Objekt MIT Mietvertrag (noch ohne
    // Listings) — eigene Kostenstelle, bis die Kanzem-Wohnungen live sind
    kostenstellen: ['Allgemein', ...groups, 'Kanzem', ...titles],
  }, NO_STORE)
}

/** Entscheidung auf EINE Inbox-Zeile anwenden (Einzel- und Bulk-Pfad).
 *  §271: ziel 'andere' + firma 'ug' → Beleg geht in die BuchhaltungsButler-
 *  Pipeline (bb_status 'wartet', Sync direkt danach); firma 'gbr' = Archiv. */
async function decideRow(r: BelegRow, ziel: string, kostenstelle: string | null, userId: string, zuordnung: Record<string, unknown> | null = null, firma: string | null = null): Promise<{ ok: boolean; error?: string }> {
  let voucherId: string | null = null
  if (ziel === 'sevdesk') {
    let erstellt = 0
    const fehler: string[] = []
    for (const f of r.files ?? []) {
      const { data: file, error: dlErr } = await supabaseAdmin.storage.from('belege').download(f.path)
      if (dlErr || !file) { fehler.push(`Download ${f.name}: ${dlErr?.message ?? '?'}`); continue }
      const buf = Buffer.from(await file.arrayBuffer())
      const up = await uploadSevVoucherFile(buf, f.name)
      if (!up.ok || !up.internalFilename) { fehler.push(up.error ?? 'Upload fehlgeschlagen'); continue }
      const v = await createSevVoucherDraft({
        internalFilename: up.internalFilename,
        supplierName: r.lieferant ?? 'Unbekannt',
        description: (`Beleg (aus Beleg-Inbox): ${r.subject ?? ''}`.slice(0, 160)
          + (r.betrag != null ? ` · ${Number(r.betrag).toFixed(2)} €` : '')
          + (r.belegnummer ? ` · Nr. ${r.belegnummer}` : '')
          + (kostenstelle ? ` · KSt ${kostenstelle}` : '')).slice(0, 255),
        ...(r.beleg_datum ? { voucherDate: r.beleg_datum } : {}),
        ...(kostenstelle ? { costCentreName: kostenstelle } : {}),
      })
      if (v.ok) { erstellt++; if (v.voucherId) voucherId = v.voucherId }
      else fehler.push(v.error ?? 'saveVoucher fehlgeschlagen')
    }
    if (!erstellt) return { ok: false, error: `sevdesk-Upload fehlgeschlagen: ${fehler.join(' · ').slice(0, 200)}` }
  }
  const upd: Record<string, unknown> = {
    status: ziel, decided_by: userId, decided_at: new Date().toISOString(),
    ...(voucherId ? { sevdesk_voucher_id: voucherId } : {}),
    ...(zuordnung ? { zuordnung } : {}),
    ...(ziel === 'andere' && firma ? { firma, ...(firma === 'ug' ? { bb_status: 'wartet' } : {}) } : {}),
  }
  let { error: updErr } = await supabaseAdmin.from('beleg_inbox').update(upd).eq('id', r.id)
  if (updErr && /firma|bb_status/.test(updErr.message) && firma) {
    // Review §271: die UG-Markierung darf NIE still verloren gehen — sonst
    // ist der Beleg „entschieden" und taucht nach der Migration nirgends auf
    return { ok: false, error: 'Migration 20260820_bb_ug.sql fehlt noch — bitte zuerst im SQL-Editor ausführen.' }
  }
  if (updErr && /sevdesk_voucher_id|zuordnung/.test(updErr.message)) {
    // Migration 20260801_buchhaltung_v2 fehlt noch → ohne die neuen Felder
    delete upd.sevdesk_voucher_id
    delete upd.zuordnung
    ;({ error: updErr } = await supabaseAdmin.from('beleg_inbox').update(upd).eq('id', r.id))
  }
  if (updErr) return { ok: false, error: updErr.message }
  return { ok: true }
}

export async function POST(req: NextRequest) {
  const user = await requireFinance()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const ziel = String(b.ziel ?? '')
  if (!['sevdesk', 'andere', 'verworfen'].includes(ziel)) {
    return NextResponse.json({ error: 'ziel (sevdesk|andere|verworfen) nötig.' }, { status: 400 })
  }
  const kostenstelle = typeof b.kostenstelle === 'string' && b.kostenstelle.trim() && b.kostenstelle !== 'Allgemein'
    ? b.kostenstelle.trim().slice(0, 80) : null
  const zuordnung = b.zuordnung && typeof b.zuordnung === 'object' ? b.zuordnung as Record<string, unknown> : null
  const firma = ziel === 'andere' && ['ug', 'gbr'].includes(String(b.firma)) ? String(b.firma) : null

  // §241: Sammel-Aktion — alle OFFENEN Belege eines Lieferanten auf einmal
  // (z. B. 38× VP Glanzteam → sevdesk mit einer Kostenstelle)
  if (typeof b.bulkLieferant === 'string' && b.bulkLieferant.trim()) {
    const { data: rows } = await supabaseAdmin
      .from('beleg_inbox').select('*')
      .eq('status', 'offen').eq('lieferant', b.bulkLieferant.trim()).limit(60)
    if (!rows?.length) return NextResponse.json({ error: 'Keine offenen Belege dieses Lieferanten.' }, { status: 404 })
    let ok = 0
    const fehler: string[] = []
    for (const row of rows as BelegRow[]) {
      const res = await decideRow(row, ziel, kostenstelle, user.id, zuordnung, firma)
      if (res.ok) ok++
      else fehler.push(`${row.subject?.slice(0, 40) ?? row.id}: ${res.error}`)
    }
    return NextResponse.json({ ok: true, erledigt: ok, fehler: fehler.slice(0, 10) }, NO_STORE)
  }

  if (!b.id) return NextResponse.json({ error: 'id oder bulkLieferant nötig.' }, { status: 400 })
  const { data: row } = await supabaseAdmin
    .from('beleg_inbox').select('*').eq('id', b.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Beleg nicht gefunden.' }, { status: 404 })
  if (row.status !== 'offen') return NextResponse.json({ error: `Bereits entschieden (${row.status}).` }, { status: 409 })
  const res = await decideRow(row as BelegRow, ziel, kostenstelle, user.id, zuordnung, firma)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 })
  // §243ad: nach der Einzel-Übernahme direkt die Voll-Automatik (§243f) —
  // sichere Kategorien werden sofort verbucht, sonst liegt die Analyse
  // danach als Vorab-Cache am Entwurf (bulk bewusst ohne: Vision-Zeit)
  let auto: { auto: boolean; text: string } | null = null
  if (ziel === 'sevdesk') {
    try {
      const { data: fresh } = await supabaseAdmin
        .from('beleg_inbox').select('sevdesk_voucher_id').eq('id', b.id).maybeSingle()
      if (fresh?.sevdesk_voucher_id) {
        const { autoVerbucheBeleg } = await import('@/lib/beleg-ki')
        auto = await autoVerbucheBeleg(String(fresh.sevdesk_voucher_id))
      }
    } catch { /* fail-soft */ }
  }
  // §271: UG-Beleg → sofort gegen BuchhaltungsButler matchen (awaited, §135;
  // fail-soft — ohne Envs/Migration bleibt der Beleg auf 'wartet')
  let bb: string | null = null
  if (firma === 'ug') {
    try {
      const { bbConfigured, bbSyncAlle } = await import('@/lib/bb')
      if (bbConfigured()) {
        const { report } = await bbSyncAlle(String(b.id))
        bb = report[0] ? `${report[0].status}: ${report[0].detail}` : null
      } else bb = 'wartet: BB-Zugangsdaten noch nicht hinterlegt (Vercel-Envs)'
    } catch (e) { bb = 'fehler: ' + String(e instanceof Error ? e.message : e).slice(0, 150) }
  }
  return NextResponse.json({ ok: true, status: ziel, ...(auto ? { auto: auto.auto, autoText: auto.text } : {}), ...(bb ? { bb } : {}) }, NO_STORE)
}
