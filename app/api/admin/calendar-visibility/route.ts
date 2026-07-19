import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * 📅 Individuelle Kalender-Sichten (Pascal §99.4): je Mitarbeiter/Dienstleister
 * einstellbar, WELCHE Wohnungen ihr Kalender zeigt (Vanessa: ihre · Patrick:
 * alle). Ablage app_settings 'calendar_visibility' = { [userId]: listingId[] };
 * KEIN Eintrag = alle Wohnungen (Default). Admins/Gastgeber sehen immer alles.
 *  GET   → people (Staff + Dienstleister) + listings + aktuelle Zuordnung
 *  PATCH → { userId, listingIds } (leeres Array/null = Eintrag löschen = alle)
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

async function requireAdmin() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabaseAdmin.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  return me?.is_admin ? user : null
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const [{ data: people }, { data: listings }, { data: setting }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id, display_name, is_staff, is_provider')
      .or('is_staff.eq.true,is_provider.eq.true')
      .order('display_name'),
    supabaseAdmin.from('listings').select('id, title').eq('is_active', true).order('title'),
    supabaseAdmin.from('app_settings').select('value').eq('key', 'calendar_visibility').maybeSingle(),
  ])
  return NextResponse.json({
    people: (people ?? []).map((p) => ({
      id: p.id,
      name: (p.display_name ?? '').trim() || '—',
      role: p.is_provider ? 'Dienstleister' : 'Team',
    })),
    listings: listings ?? [],
    visibility: (setting?.value ?? {}) as Record<string, string[]>,
  }, NO_STORE)
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const userId = typeof body.userId === 'string' ? body.userId : null
  if (!userId) return NextResponse.json({ error: 'userId fehlt.' }, { status: 400 })
  const ids = Array.isArray(body.listingIds)
    ? [...new Set(body.listingIds.filter((x: unknown) => typeof x === 'string'))] as string[]
    : null

  const { data: setting } = await supabaseAdmin
    .from('app_settings').select('value').eq('key', 'calendar_visibility').maybeSingle()
  const map = { ...((setting?.value ?? {}) as Record<string, string[]>) }
  if (!ids || ids.length === 0) delete map[userId]
  else map[userId] = ids

  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({ key: 'calendar_visibility', value: map, updated_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, visibility: map }, NO_STORE)
}
