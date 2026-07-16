import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTaskPermissions, invalidateTaskPermCache, type TaskPermissions } from '@/lib/tasks'

/** Admin-only: Aufgaben-Rechte je Rolle lesen/schreiben (app_settings). */
async function requireAdmin() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabaseAdmin.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  return me?.is_admin ? user : null
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  return NextResponse.json({ permissions: await getTaskPermissions() })
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))

  const clean = (r: { view?: string; manage?: boolean } | undefined, fallback: { view: 'all' | 'own'; manage: boolean }) => ({
    view: r?.view === 'all' ? 'all' as const : r?.view === 'own' ? 'own' as const : fallback.view,
    manage: typeof r?.manage === 'boolean' ? r.manage : fallback.manage,
  })
  const current = await getTaskPermissions()
  const value: TaskPermissions = {
    staff: clean(body.staff, current.staff),
    provider: clean(body.provider, current.provider),
  }

  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({ key: 'task_permissions', value, updated_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  invalidateTaskPermCache()
  return NextResponse.json({ permissions: value })
}
