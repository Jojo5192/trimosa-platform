import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCleaningSettings, resolveCleaningFor, CLEANING_DEFAULTS, type CleaningRuleSet } from '@/lib/cleaning'

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

  const num = (v: unknown, fallback: number, max = 10000) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 && n <= max ? n : fallback
  }
  const cleanRuleSet = (src: Record<string, unknown>, base: CleaningRuleSet): CleaningRuleSet => ({
    avoidSundays: typeof src.avoidSundays === 'boolean' ? src.avoidSundays : base.avoidSundays,
    avoidHolidays: typeof src.avoidHolidays === 'boolean' ? src.avoidHolidays : base.avoidHolidays,
    hourlyRate: 'hourlyRate' in src ? num(src.hourlyRate, base.hourlyRate, 500) : base.hourlyRate,
    travelFee: 'travelFee' in src ? num(src.travelFee, base.travelFee, 500) : base.travelFee,
    travelPerCleaning: typeof src.travelPerCleaning === 'boolean' ? src.travelPerCleaning : (base.travelPerCleaning ?? false),
    sundaySurchargePct: 'sundaySurchargePct' in src ? num(src.sundaySurchargePct, base.sundaySurchargePct, 300) : base.sundaySurchargePct,
    holidaySurchargePct: 'holidaySurchargePct' in src ? num(src.holidaySurchargePct, base.holidaySurchargePct, 300) : base.holidaySurchargePct,
    specialSurchargePct: 'specialSurchargePct' in src ? num(src.specialSurchargePct, base.specialSurchargePct ?? base.holidaySurchargePct, 300) : (base.specialSurchargePct ?? base.holidaySurchargePct),
    vatPct: 'vatPct' in src ? num(src.vatPct, base.vatPct ?? 0, 30) : (base.vatPct ?? 0),
  })

  if (body.settings && typeof body.settings === 'object') {
    const current = await getCleaningSettings()
    // perPerson MITNEHMEN — sonst löscht ein Standard-Save alle Overrides
    const value = { ...cleanRuleSet(body.settings, current), perPerson: current.perPerson ?? {} }
    const { error } = await supabaseAdmin
      .from('app_settings')
      .upsert({ key: 'cleaning_settings', value, updated_at: new Date().toISOString() })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, settings: { ...CLEANING_DEFAULTS, ...value } }, NO_STORE)
  }

  // 👤 Abweichende Regeln/Sätze je Reinigungskraft: { personId, values | null }
  if (body.personSettings && typeof body.personSettings === 'object') {
    const { personId, values } = body.personSettings
    if (typeof personId !== 'string' || !personId) {
      return NextResponse.json({ error: 'personId fehlt.' }, { status: 400 })
    }
    const current = await getCleaningSettings()
    const perPerson = { ...(current.perPerson ?? {}) }
    if (values === null) delete perPerson[personId]
    else if (values && typeof values === 'object') {
      perPerson[personId] = cleanRuleSet(values, resolveCleaningFor(current, personId))
    } else {
      return NextResponse.json({ error: 'values fehlt.' }, { status: 400 })
    }
    const value = { ...cleanRuleSet(current as unknown as Record<string, unknown>, current), perPerson }
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
