import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getOncallIds, saveOncallIds } from '@/lib/oncall'

export const dynamic = 'force-dynamic'

async function requireAdmin(): Promise<NextResponse | null> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  if (!me?.is_admin) return NextResponse.json({ error: 'Nicht berechtigt' }, { status: 403 })
  return null
}

/** ☎️ Bereitschaft (§175): GET Team-Liste + Auswahl · PATCH { userIds } */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  const { data: profs } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, is_admin, is_host, is_staff')
    .or('is_admin.eq.true,is_host.eq.true,is_staff.eq.true')
    .order('display_name')
  const people = (profs ?? []).map((p) => ({
    id: String(p.id),
    name: String(p.display_name ?? 'Unbenannt'),
    role: p.is_admin || p.is_host ? 'Chef-Etage' : 'Team',
  }))
  return NextResponse.json({ people, selected: await getOncallIds() })
}

export async function PATCH(request: Request) {
  const denied = await requireAdmin()
  if (denied) return denied

  let body: { userIds?: unknown }
  try { body = await request.json() } catch { body = {} }
  if (!Array.isArray(body.userIds)) {
    return NextResponse.json({ error: 'userIds (Array) fehlt' }, { status: 400 })
  }
  const userIds = body.userIds.filter((x): x is string => typeof x === 'string').slice(0, 50)
  await saveOncallIds(userIds)
  return NextResponse.json({ ok: true, selected: userIds })
}
