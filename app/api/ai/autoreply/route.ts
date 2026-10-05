import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  runAutoReply, saveAutoReplySettings, getAutoReplySettings, autoReplyTableReady, aktivGate,
  AUTOREPLY_GRENZEN, type AutoReplyMode,
} from '@/lib/ai-autoreply'

/**
 * 🤖 KI-Auto-Antworten (Phase 2):
 *  GET → Vercel-Cron alle 10 Min (Bearer CRON_SECRET) — ein Lauf von lib/ai-autoreply.ts.
 *        Modus 'aus' (Standard) oder fehlende Tabelle = sofort Ende, nichts passiert.
 *  PUT → NUR is_admin: { mode?: 'aus' | 'schatten' | 'aktiv', schwelle?: 85..100 }.
 *        'schatten'/'aktiv' nur mit vorhandener Tabelle; 'aktiv' nur mit erfülltem Tor (im Code).
 *        Die Schwelle lässt sich im Modus 'aktiv' NICHT senken (auch nicht zusammen mit dem
 *        Einschalten); eine Senkung in 'aus'/'schatten' setzt das Tor zurück (es zählt neu).
 */
export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 401 })
  }
  try {
    return NextResponse.json(await runAutoReply())
  } catch (err) {
    console.error('[ai-autoreply] cron:', err)
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err).slice(0, 300) }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, display_name').eq('id', user.id).maybeSingle()
  // autonomer Gast-Versand ist Chefsache: NUR Admins (bewusst nicht is_host)
  if (!me?.is_admin) return NextResponse.json({ error: 'Nur Admins dürfen den Modus ändern.' }, { status: 403 })

  const body = await request.json().catch(() => ({})) as { mode?: unknown; schwelle?: unknown }
  const patch: { mode?: AutoReplyMode; schwelle?: number } = {}
  if (body.mode !== undefined) {
    if (body.mode !== 'aus' && body.mode !== 'schatten' && body.mode !== 'aktiv') {
      return NextResponse.json({ error: 'Unbekannter Modus.' }, { status: 400 })
    }
    patch.mode = body.mode
  }
  if (body.schwelle !== undefined) {
    const n = Number(body.schwelle)
    if (!Number.isFinite(n)) return NextResponse.json({ error: 'Ungültige Schwelle.' }, { status: 400 })
    patch.schwelle = n // wird in der Lib auf 85..100 geklemmt
  }
  if (patch.mode === undefined && patch.schwelle === undefined) {
    return NextResponse.json({ error: 'Nichts zu ändern.' }, { status: 400 })
  }

  if (patch.mode && patch.mode !== 'aus') {
    const table = await autoReplyTableReady()
    if (!table.ok) {
      return NextResponse.json({
        error: 'Die Datenbank-Migration 20261004_ai_autoreply.sql wurde noch nicht ausgeführt – bis dahin bleibt die Funktion aus.',
        migrationMissing: true,
      }, { status: 409 })
    }
  }
  // Senken im (künftigen) Modus 'aktiv' ist gesperrt: der neu geöffnete Konfidenz-Bereich wurde nie
  // von einem Menschen bewertet. Erst in 'schatten' senken (das Tor zählt dann neu) und bewerten.
  if (patch.schwelle !== undefined) {
    const cur = await getAutoReplySettings()
    const neu = Math.min(AUTOREPLY_GRENZEN.schwelleMax, Math.max(AUTOREPLY_GRENZEN.schwelleMin, Math.round(patch.schwelle)))
    if ((patch.mode ?? cur.mode) === 'aktiv' && neu < cur.schwelle) {
      return NextResponse.json({
        error: 'Die Schwelle lässt sich im Modus „Aktiv“ nicht senken – erst auf „Schatten“ stellen, senken und die neuen Entscheidungen bewerten.',
      }, { status: 409 })
    }
  }
  if (patch.mode === 'aktiv') {
    const gate = await aktivGate()
    if (!gate.ok) return NextResponse.json({ error: `„Aktiv“ ist gesperrt: ${gate.grund}`, gate }, { status: 409 })
  }

  try {
    const wer = String(me.display_name ?? '').trim().split(/\s+/)[0] || 'Admin'
    const settings = await saveAutoReplySettings(patch, wer)
    console.log('[ai-autoreply] Einstellungen geändert:', settings.mode, settings.schwelle, 'von', wer)
    return NextResponse.json({ settings, gate: await aktivGate() })
  } catch (err) {
    return NextResponse.json({ error: `Speichern fehlgeschlagen: ${String(err instanceof Error ? err.message : err).slice(0, 160)}` }, { status: 500 })
  }
}
