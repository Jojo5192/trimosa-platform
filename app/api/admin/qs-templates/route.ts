import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { cleanTemplate, getQsTemplateStore, invalidateQsTemplateCache, QS_TEMPLATE } from '@/lib/qs'

/**
 * Admin-only: QS-Checklisten-Vorlagen mit Vererbung (Wohnung > Standort >
 * Standard). Ablage in app_settings:
 *   'qs_template' (Standard) · 'qs_template:group:<Name>' · 'qs_template:listing:<id>'
 *  GET    → Scopes + effektive Vorlagen + Override-Status
 *  PUT    → { scope, template } speichern (scope: 'base' | 'group:<Name>' | 'listing:<id>')
 *  DELETE → { scope } Override entfernen (zurück zur geerbten Vorlage)
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

function scopeToKey(scope: unknown): string | null {
  if (scope === 'base') return 'qs_template'
  if (typeof scope !== 'string') return null
  if (scope.startsWith('group:') && scope.length > 6 && scope.length < 80) return 'qs_template:group:' + scope.slice(6).trim()
  if (scope.startsWith('listing:') && /^listing:[0-9a-f-]{36}$/.test(scope)) return 'qs_template:listing:' + scope.slice(8)
  return null
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  invalidateQsTemplateCache() // Editor soll immer den frischen Stand sehen
  const [store, { data: listings }] = await Promise.all([
    getQsTemplateStore(),
    supabaseAdmin.from('listings').select('id, title, location_group').eq('is_active', true).order('title'),
  ])
  const groupNames = [...new Set([
    ...((listings ?? []).map((l) => (l.location_group ?? '').trim()).filter(Boolean)),
    ...Object.keys(store.groups),
  ])].sort()
  return NextResponse.json({
    base: store.base,
    hasBaseOverride: store.base !== QS_TEMPLATE,
    groups: Object.fromEntries(groupNames.map((g) => [g, store.groups[g] ?? null])),
    listings: (listings ?? []).map((l) => ({
      id: l.id,
      title: l.title,
      group: (l.location_group ?? '').trim() || null,
      override: store.listings[l.id] ?? null,
    })),
  }, NO_STORE)
}

export async function PUT(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const key = scopeToKey(body.scope)
  if (!key) return NextResponse.json({ error: 'Ungültiger Scope.' }, { status: 400 })
  const template = cleanTemplate(body.template)
  if (!template) return NextResponse.json({ error: 'Ungültige Checkliste (mindestens 1 Bereich mit 1 Punkt, max. 12 Bereiche à 20 Punkte).' }, { status: 400 })
  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({ key, value: template, updated_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  invalidateQsTemplateCache()
  return NextResponse.json({ ok: true, template }, NO_STORE)
}

export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const key = scopeToKey(body.scope)
  if (!key) return NextResponse.json({ error: 'Ungültiger Scope.' }, { status: 400 })
  const { error } = await supabaseAdmin.from('app_settings').delete().eq('key', key)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  invalidateQsTemplateCache()
  return NextResponse.json({ ok: true }, NO_STORE)
}
