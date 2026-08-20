import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  bbConfigured, bbCall, getBbSettings, saveBbSettings,
  listBbCostLocations, listBbPostingAccounts, listBbTransactions, bbSyncAlle,
} from '@/lib/bb'

/**
 * 🏢 §271 BuchhaltungsButler (TRIMOSA Immobilien UG):
 *  GET  ?probe=1        → Sichtbarkeits-Check
 *  GET  (Cron, Bearer)  → täglicher Re-Match aller wartenden UG-Belege
 *  GET  (Admin)         → Status: Settings + Zähler + Listen
 *  POST (Admin) actions → setup | settings | sync | tx-debug | match-betraege
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

async function requireAdmin() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  return me?.is_admin ? user : null
}

export async function GET(req: NextRequest) {
  // Cron-Zweig (täglich): wartende UG-Belege erneut matchen.
  // Review §271: !secret-Guard wie bei allen Cron-Routen — ohne gesetztes
  // CRON_SECRET darf „Bearer undefined" niemanden authentifizieren.
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (secret && auth === `Bearer ${secret}`) {
    if (!bbConfigured()) return NextResponse.json({ ok: true, skipped: 'BB-Envs fehlen' })
    try {
      const { report, txCount } = await bbSyncAlle()
      console.log('[bb] Cron:', txCount, 'Zahlungen ·', report.length, 'Belege:',
        report.map((r) => `${r.status}`).join(','))
      return NextResponse.json({ ok: true, txCount, report })
    } catch (e) {
      console.error('[bb] Cron:', e)
      return NextResponse.json({ ok: false, error: String(e instanceof Error ? e.message : e) }, { status: 500 })
    }
  }

  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  if (req.nextUrl.searchParams.get('probe') === '1') {
    return NextResponse.json({ ok: true, configured: bbConfigured() }, NO_STORE)
  }

  const settings = await getBbSettings().catch(() => null)
  const { data: rows } = await supabaseAdmin
    .from('beleg_inbox')
    .select('id, lieferant, betrag, beleg_datum, subject, bb_status, bb_detail, bb_transaction_ids, mail_key')
    .eq('firma', 'ug')
    .order('beleg_datum', { ascending: false })
    .limit(200)
  const list = (rows ?? []) as Array<{ id: string; lieferant: string | null; betrag: number | string | null; beleg_datum: string | null; subject: string | null; bb_status: string | null; bb_detail: string | null; bb_transaction_ids: string | null; mail_key: string | null }>
  const zaehler: Record<string, number> = {}
  for (const r of list) zaehler[r.bb_status ?? '—'] = (zaehler[r.bb_status ?? '—'] ?? 0) + 1
  return NextResponse.json({
    configured: bbConfigured(),
    settings,
    zaehler,
    belege: list.map((r) => ({
      id: r.id, lieferant: r.lieferant, betrag: r.betrag == null ? null : Number(r.betrag),
      datum: r.beleg_datum, subject: r.subject, status: r.bb_status, detail: r.bb_detail,
      txIds: r.bb_transaction_ids,
    })),
  }, NO_STORE)
}

export async function POST(req: NextRequest) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const action = String(b.action ?? '')

  try {
    // Einrichtungslauf: Kostenstellen + Sachkonten live auflisten
    if (action === 'setup') {
      if (!bbConfigured()) return NextResponse.json({ error: 'BB-Envs fehlen (BB_API_CLIENT/SECRET/KEY in Vercel).' }, { status: 503 })
      const [kst, konten] = await Promise.all([listBbCostLocations(), listBbPostingAccounts()])
      return NextResponse.json({ ok: true, kostenstellen: kst, sachkonten: konten.slice(0, 400), settings: await getBbSettings() }, NO_STORE)
    }

    if (action === 'settings') {
      const patch: Record<string, unknown> = {}
      if (typeof b.kostenstelleCode === 'string') patch.kostenstelleCode = b.kostenstelleCode.trim().slice(0, 40)
      if (typeof b.sachkonto === 'string') patch.sachkonto = b.sachkonto.trim().slice(0, 40)
      if (typeof b.zeitraumAb === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.zeitraumAb)) patch.zeitraumAb = b.zeitraumAb
      if (Number.isFinite(Number(b.tolTage))) patch.tolTage = Math.min(30, Math.max(0, Math.round(Number(b.tolTage))))
      const next = await saveBbSettings(patch)
      return NextResponse.json({ ok: true, settings: next }, NO_STORE)
    }

    // Sonderfall-Override: abweichende Zahlbeträge/Tranchen je Beleg.
    // Review §271: NUR solange noch nichts in BB zugeordnet/gebucht ist —
    // ein Betrags-Reset auf einem verknüpften Beleg würde die Pipeline in
    // eine Zweitbuchung treiben.
    if (action === 'match-betraege') {
      if (!b.id) return NextResponse.json({ error: 'id nötig.' }, { status: 400 })
      const { data: cur } = await supabaseAdmin
        .from('beleg_inbox').select('bb_status, bb_transaction_ids').eq('id', b.id).eq('firma', 'ug').maybeSingle()
      if (!cur) return NextResponse.json({ error: 'UG-Beleg nicht gefunden.' }, { status: 404 })
      if (cur.bb_status === 'gebucht' || cur.bb_transaction_ids) {
        return NextResponse.json({ error: `Beleg ist bereits in BB verknüpft (${cur.bb_status}) — Tranchen dort manuell korrigieren.` }, { status: 409 })
      }
      const betraege = Array.isArray(b.betraege)
        ? b.betraege.map(Number).filter((n: number) => Number.isFinite(n) && n > 0) : []
      const { error } = await supabaseAdmin.from('beleg_inbox')
        .update({ bb_match_betraege: betraege.length ? betraege : null, bb_status: 'wartet', bb_detail: null })
        .eq('id', b.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, betraege }, NO_STORE)
    }

    if (action === 'sync') {
      if (!bbConfigured()) return NextResponse.json({ error: 'BB-Envs fehlen (BB_API_CLIENT/SECRET/KEY in Vercel).' }, { status: 503 })
      const { report, txCount } = await bbSyncAlle(typeof b.id === 'string' ? b.id : undefined)
      return NextResponse.json({ ok: true, txCount, report }, NO_STORE)
    }

    // Kalibrier-Blick: rohe Zahlungen (Feldnamen!), §127-Muster
    if (action === 'tx-debug') {
      if (!bbConfigured()) return NextResponse.json({ error: 'BB-Envs fehlen.' }, { status: 503 })
      const s = await getBbSettings()
      const j = await bbCall('/transactions/get', { date_from: s.zeitraumAb, date_to: new Date().toISOString().slice(0, 10), limit: 3, offset: 0 })
      const mapped = await listBbTransactions(s.zeitraumAb, new Date().toISOString().slice(0, 10))
      return NextResponse.json({ ok: true, roh: j, gemappt: mapped.slice(0, 3), anzahlGemappt: mapped.length }, NO_STORE)
    }

    return NextResponse.json({ error: `Unbekannte action ${action}` }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e).slice(0, 400) }, { status: 502 })
  }
}
