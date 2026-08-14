import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTaskAuth } from '@/lib/tasks'
import type { PushCategory } from '@/lib/push'

/**
 * 🔔 Push-Präferenzen je Nutzer (§254). Alle Kategorien in EINER jsonb-Spalte
 * profiles.push_prefs — nur die AUS-Zustände werden gespeichert (Default = an).
 * Fallback auf die Alt-Einzelspalten (push_guest_chats …) solange die
 * push_prefs-Migration noch aussteht.
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

const ALL: PushCategory[] = ['guestChats', 'teamChats', 'bookings', 'tasks', 'reinigung', 'calls', 'buchhaltung', 'wallbox', 'material', 'system']
const LEGACY: Partial<Record<PushCategory, string>> = {
  guestChats: 'push_guest_chats', teamChats: 'push_team_chats', bookings: 'push_bookings', buchhaltung: 'push_buchhaltung',
}

function resolve(profile: Record<string, unknown> | null): Record<PushCategory, boolean> {
  const prefs = (profile?.push_prefs as Record<string, unknown> | null) ?? {}
  const out = {} as Record<PushCategory, boolean>
  for (const c of ALL) {
    const legacy = LEGACY[c]
    const v = c in prefs ? prefs[c] : (legacy && profile ? profile[legacy] : undefined)
    out[c] = v !== false
  }
  return out
}

export async function GET() {
  const auth = await getTaskAuth()
  if (!auth) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { data } = await supabaseAdmin.from('profiles').select('*').eq('id', auth.userId).maybeSingle()
  return NextResponse.json(resolve(data as Record<string, unknown> | null), NO_STORE)
}

export async function PATCH(req: NextRequest) {
  const auth = await getTaskAuth()
  if (!auth) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  // Nur bekannte Kategorien mit boolean-Wert übernehmen
  const changes: Partial<Record<PushCategory, boolean>> = {}
  for (const c of ALL) if (typeof body[c] === 'boolean') changes[c] = body[c] as boolean
  if (!Object.keys(changes).length) return NextResponse.json({ error: 'Nichts zu ändern.' }, { status: 400 })

  const { data: cur } = await supabaseAdmin.from('profiles').select('push_prefs').eq('id', auth.userId).maybeSingle()
  const prefs: Record<string, boolean> = { ...((cur?.push_prefs as Record<string, boolean> | null) ?? {}) }
  for (const [c, v] of Object.entries(changes)) {
    if (v) delete prefs[c]        // an = Default, muss nicht gespeichert werden
    else prefs[c] = false          // aus = explizit merken
  }
  const { error } = await supabaseAdmin.from('profiles').update({ push_prefs: prefs }).eq('id', auth.userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true }, NO_STORE)
}
