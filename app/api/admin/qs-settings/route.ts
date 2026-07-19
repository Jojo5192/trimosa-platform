import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getQsSettings, ensureQsChecks } from '@/lib/qs'

/**
 * Admin-only: Einstellungen der Qualitätssicherung (app_settings 'qs_settings').
 *  GET   → { settings, people } (people = Team-Konten für die Zuweisung)
 *  PATCH → { assigneeId?, intervalDays? } speichern
 *  POST  → { action: 'run' } Planung sofort ausführen (statt auf den Cron warten)
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60
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
  const settings = await getQsSettings()
  const { data: people } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, is_admin, is_host, is_staff')
    .or('is_admin.eq.true,is_host.eq.true,is_staff.eq.true')
  return NextResponse.json({
    settings,
    people: (people ?? []).map((p) => ({ id: p.id, name: (p.display_name ?? '').trim() || '—' })),
  }, NO_STORE)
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const current = await getQsSettings()
  const value = {
    assigneeId: typeof body.assigneeId === 'string' ? (body.assigneeId || null) : current.assigneeId,
    intervalDays: Number.isFinite(body.intervalDays) && body.intervalDays >= 30 && body.intervalDays <= 730
      ? Math.round(body.intervalDays) : current.intervalDays,
    leadDays: current.leadDays,
  }
  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({ key: 'qs_settings', value, updated_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: value }, NO_STORE)
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  if (body.action !== 'run') return NextResponse.json({ error: 'Unbekannte Aktion.' }, { status: 400 })
  const result = await ensureQsChecks()
  return NextResponse.json({ ok: true, ...result }, NO_STORE)
}
