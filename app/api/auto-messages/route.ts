import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { TriggerType } from '@/lib/auto-messages'

/**
 * 📨 Auto-Nachrichten-Vorlagen (§145): GET Liste · PUT anlegen/ändern ·
 * DELETE. Admin/Gastgeber. Fail-soft, solange die Migration aussteht.
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

async function requireHost() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host').eq('id', user.id).maybeSingle()
  return (me?.is_admin || me?.is_host) ? user : null
}

const TRIGGERS: TriggerType[] = ['nach_buchung', 'vor_anreise', 'nach_anreise', 'vor_abreise', 'nach_abreise']

export async function GET() {
  if (!(await requireHost())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { data, error } = await supabaseAdmin
    .from('auto_messages').select('*').order('sort').order('created_at')
  if (error) {
    // Tabelle fehlt noch → leere Liste + Hinweis (Editor bleibt bedienbar)
    return NextResponse.json({ messages: [], migrationMissing: true }, NO_STORE)
  }
  return NextResponse.json({ messages: data ?? [] }, NO_STORE)
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

export async function PUT(req: NextRequest) {
  if (!(await requireHost())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const b = await req.json().catch(() => ({}))

  const row = {
    name: String(b.name ?? '').slice(0, 120),
    enabled: b.enabled !== false,
    trigger_type: TRIGGERS.includes(b.trigger_type) ? b.trigger_type : 'vor_anreise',
    offset_days: clampInt(b.offset_days, 0, 60, 0),
    send_hour: clampInt(b.send_hour, 0, 23, 10),
    listing_id: b.listing_id ? String(b.listing_id) : null,
    channel_filter: Array.isArray(b.channel_filter) && b.channel_filter.length
      ? b.channel_filter.map(String).slice(0, 8) : null,
    min_nights: b.min_nights ? clampInt(b.min_nights, 1, 60, 1) : null,
    body: String(b.body ?? '').slice(0, 4000),
    sort: clampInt(b.sort, 0, 9999, 0),
    updated_at: new Date().toISOString(),
  }

  if (b.id) {
    const { error } = await supabaseAdmin.from('auto_messages').update(row).eq('id', String(b.id))
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, id: b.id })
  }
  const { data, error } = await supabaseAdmin.from('auto_messages').insert(row).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id })
}

export async function DELETE(req: NextRequest) {
  if (!(await requireHost())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.id) return NextResponse.json({ error: 'id fehlt.' }, { status: 400 })
  const { error } = await supabaseAdmin.from('auto_messages').delete().eq('id', String(b.id))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
