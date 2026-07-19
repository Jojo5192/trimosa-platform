import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTaskAuth } from '@/lib/tasks'

/**
 * 🔔 Push-Präferenzen je Nutzer (Pascal §97.5): Gäste-Chat-Pushes und interne
 * Pushes getrennt schaltbar. GET = aktueller Stand, PATCH = ändern.
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

export async function GET() {
  const auth = await getTaskAuth()
  if (!auth) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { data } = await supabaseAdmin
    .from('profiles').select('push_guest_chats, push_team_chats').eq('id', auth.userId).maybeSingle()
  return NextResponse.json({
    guestChats: data?.push_guest_chats !== false,
    teamChats: data?.push_team_chats !== false,
  }, NO_STORE)
}

export async function PATCH(req: NextRequest) {
  const auth = await getTaskAuth()
  if (!auth) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const upd: Record<string, boolean> = {}
  if (typeof body.guestChats === 'boolean') upd.push_guest_chats = body.guestChats
  if (typeof body.teamChats === 'boolean') upd.push_team_chats = body.teamChats
  if (!Object.keys(upd).length) return NextResponse.json({ error: 'Nichts zu ändern.' }, { status: 400 })
  const { error } = await supabaseAdmin.from('profiles').update(upd).eq('id', auth.userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
