import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  getAutoReplySettings, autoReplyTableReady, aktivGate, listAutoReplyLog, rateAutoReply,
  AUTOREPLY_KATEGORIEN, AUTOREPLY_GRENZEN,
} from '@/lib/ai-autoreply'

/**
 * 🤖 KI-Auto-Antworten — Panel-Daten (Mehr → KI-Auto-Antworten). Nur Admins und Gastgeber
 * (nie Mitarbeiter/Dienstleister — das Protokoll enthält Gast-Texte und steuert das Tor).
 *  GET            → Modus, Tor-Fortschritt, letzte 50 Entscheidungen; ?probe=1 → nur { ok }
 *  PATCH { id, bewertung: 'richtig' | 'falsch' | null } → Bewertung speichern (wer + wann);
 *                   das Urteil eines anderen ändert/löscht nur ein Admin
 * Den Modus ändert PUT /api/ai/autoreply (nur is_admin).
 */
export const dynamic = 'force-dynamic'

async function auth(): Promise<{ id: string; name: string; isAdmin: boolean } | null> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host, display_name').eq('id', user.id).maybeSingle()
  if (!me?.is_admin && !me?.is_host) return null
  return { id: user.id, name: String(me.display_name ?? '').trim().split(/\s+/)[0] || 'Team', isAdmin: !!me.is_admin }
}

export async function GET(request: NextRequest) {
  const me = await auth()
  if (!me) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  if (new URL(request.url).searchParams.get('probe') === '1') return NextResponse.json({ ok: true })

  const noStore = { headers: { 'Cache-Control': 'no-store' } }
  const [settings, table] = await Promise.all([getAutoReplySettings(), autoReplyTableReady()])
  const basis = {
    settings, darfModus: me.isAdmin, ich: me.id,
    kategorien: AUTOREPLY_KATEGORIEN, grenzen: AUTOREPLY_GRENZEN,
  }
  if (!table.ok) {
    // Migration fehlt → System ist still aus, egal was gespeichert ist
    return NextResponse.json({
      ...basis, migration: 'fehlt',
      gate: { ok: false, bewertet: 0, falsch: 0, quote: null, min: AUTOREPLY_GRENZEN.torMin, maxQuote: AUTOREPLY_GRENZEN.torMaxFalsch, grund: 'Datenbank-Migration fehlt noch.' },
      rows: [],
    }, noStore)
  }
  try {
    const [gate, rows] = await Promise.all([aktivGate(), listAutoReplyLog(50)])
    return NextResponse.json({ ...basis, migration: 'ok', gate, rows }, noStore)
  } catch (err) {
    console.error('[ai-autoreply] log:', err)
    return NextResponse.json({ error: 'Protokoll konnte nicht geladen werden.' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const me = await auth()
  if (!me) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const body = await request.json().catch(() => ({})) as { id?: unknown; bewertung?: unknown }
  const id = typeof body.id === 'string' ? body.id : ''
  const bewertung = body.bewertung === 'richtig' || body.bewertung === 'falsch' ? body.bewertung : body.bewertung === null ? null : undefined
  if (!/^[0-9a-f-]{36}$/i.test(id) || bewertung === undefined) {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }
  try {
    const res = await rateAutoReply(id, bewertung, { id: me.id, name: me.name, isAdmin: me.isAdmin })
    if (res === 'fremd') return NextResponse.json({ error: 'Dieses Urteil stammt von jemand anderem – ändern kann es nur ein Admin.' }, { status: 403 })
    if (res !== 'ok') return NextResponse.json({ error: 'Eintrag nicht gefunden oder noch in Arbeit.' }, { status: 404 })
    return NextResponse.json({ ok: true, gate: await aktivGate() })
  } catch (err) {
    return NextResponse.json({ error: `Speichern fehlgeschlagen: ${String(err instanceof Error ? err.message : err).slice(0, 160)}` }, { status: 500 })
  }
}
