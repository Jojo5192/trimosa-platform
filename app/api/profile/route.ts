import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * POST /api/profile
 * Server-side profile save — uses supabaseAdmin so it bypasses RLS
 * and handles optional columns that might not exist in older DB schemas.
 *
 * Only these fields are user-editable via this route. Never accept the
 * raw request body directly here (e.g. via spread) — this route runs with
 * the service-role client, so any field not on this explicit whitelist
 * must stay out of reach of the caller.
 */
const EDITABLE_FIELDS = [
  'display_name', 'bio', 'location', 'languages', 'avatar_url',
  'account_type', 'guest_first_name', 'guest_last_name',
  'company_name', 'vat_id', 'guest_street', 'guest_city',
  'guest_zip', 'guest_country', 'phone',
] as const

function pickEditableFields(body: Record<string, unknown>) {
  const picked: Record<string, unknown> = {}
  for (const key of EDITABLE_FIELDS) {
    if (key in body) picked[key] = body[key]
  }
  return picked
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const body = await req.json()
  const fields = pickEditableFields(body)

  // 1. Try full upsert (including optional columns account_type / company_name / vat_id)
  const { error: e1 } = await supabaseAdmin.from('profiles').upsert({
    id: user.id,
    ...fields,
  })

  if (!e1) return NextResponse.json({ ok: true })

  // 2. Optional columns probably don't exist yet — retry without them
  console.warn('[ProfileSave] Full upsert failed:', e1.message, '– retrying without optional columns')

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { account_type, company_name, vat_id, ...safeFields } = fields

  const { error: e2 } = await supabaseAdmin.from('profiles').upsert({
    id: user.id,
    ...safeFields,
  })

  if (!e2) return NextResponse.json({ ok: true })

  console.error('[ProfileSave] Minimal upsert also failed:', e2.message)
  return NextResponse.json({ error: e2.message }, { status: 500 })
}
