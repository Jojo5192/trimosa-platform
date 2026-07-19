import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCleaningSettings, CLEANING_DEFAULTS } from '@/lib/cleaning'

/**
 * 🧹 Admin: Reinigungs-Verantwortliche + Ø-Dauer je Wohnung und globale
 * Regeln (Sonn-/Feiertage möglichst meiden).
 *  GET   → listings (mit responsible/minutes), people (Staff + Dienstleister), settings
 *  PATCH → { listingId, responsibleId?, minutes? } ODER { settings: {...} }
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
  const [{ data: listings, error: lErr }, { data: people }, settings] = await Promise.all([
    supabaseAdmin
      .from('listings')
      .select('id, title, cleaning_responsible, cleaning_minutes')
      .eq('is_active', true)
      .order('title'),
    supabaseAdmin
      .from('profiles')
      .select('id, display_name, is_staff, is_provider')
      .or('is_staff.eq.true,is_provider.eq.true')
      .order('display_name'),
    getCleaningSettings(),
  ])
  if (lErr) {
    // Migration noch nicht gelaufen → Spalten fehlen
    return NextResponse.json({ error: 'Migration 20260719_cleaning.sql fehlt noch (cleaning_responsible/cleaning_minutes).' }, { status: 500 })
  }
  return NextResponse.json({
    listings: listings ?? [],
    people: (people ?? []).map((p) => ({
      id: p.id,
      name: (p.display_name ?? '').trim() || '—',
      role: p.is_provider && !p.is_staff ? 'Dienstleister' : 'Team',
    })),
    settings,
  }, NO_STORE)
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))

  if (body.settings && typeof body.settings === 'object') {
    const current = await getCleaningSettings()
    const num = (v: unknown, fallback: number, max = 10000) => {
      const n = Number(v)
      return Number.isFinite(n) && n >= 0 && n <= max ? n : fallback
    }
    const value = {
      avoidSundays: typeof body.settings.avoidSundays === 'boolean' ? body.settings.avoidSundays : current.avoidSundays,
      avoidHolidays: typeof body.settings.avoidHolidays === 'boolean' ? body.settings.avoidHolidays : current.avoidHolidays,
      hourlyRate: 'hourlyRate' in body.settings ? num(body.settings.hourlyRate, current.hourlyRate, 500) : current.hourlyRate,
      travelFee: 'travelFee' in body.settings ? num(body.settings.travelFee, current.travelFee, 500) : current.travelFee,
      sundaySurchargePct: 'sundaySurchargePct' in body.settings ? num(body.settings.sundaySurchargePct, current.sundaySurchargePct, 300) : current.sundaySurchargePct,
      holidaySurchargePct: 'holidaySurchargePct' in body.settings ? num(body.settings.holidaySurchargePct, current.holidaySurchargePct, 300) : current.holidaySurchargePct,
    }
    const { error } = await supabaseAdmin
      .from('app_settings')
      .upsert({ key: 'cleaning_settings', value, updated_at: new Date().toISOString() })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, settings: { ...CLEANING_DEFAULTS, ...value } }, NO_STORE)
  }

  const listingId = typeof body.listingId === 'string' ? body.listingId : null
  if (!listingId) return NextResponse.json({ error: 'listingId fehlt.' }, { status: 400 })
  const upd: Record<string, unknown> = {}
  if ('responsibleId' in body) upd.cleaning_responsible = typeof body.responsibleId === 'string' && body.responsibleId ? body.responsibleId : null
  if ('minutes' in body) {
    const n = Number(body.minutes)
    upd.cleaning_minutes = Number.isFinite(n) && n > 0 && n <= 1440 ? Math.round(n) : null
  }
  if (!Object.keys(upd).length) return NextResponse.json({ error: 'Nichts zu ändern.' }, { status: 400 })
  const { error } = await supabaseAdmin.from('listings').update(upd).eq('id', listingId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true }, NO_STORE)
}
