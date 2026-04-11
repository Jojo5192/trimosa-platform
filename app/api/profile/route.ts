import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * POST /api/profile
 * Server-side profile save — uses supabaseAdmin so it bypasses RLS
 * and handles optional columns that might not exist in older DB schemas.
 */
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const body = await req.json()

  // 1. Try full upsert (including optional columns account_type / company_name / vat_id)
  const { error: e1 } = await supabaseAdmin.from('profiles').upsert({
    id: user.id,
    ...body,
  })

  if (!e1) return NextResponse.json({ ok: true })

  // 2. Optional columns probably don't exist yet — retry without them
  console.warn('[ProfileSave] Full upsert failed:', e1.message, '– retrying without optional columns')

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { account_type, company_name, vat_id, ...safeBody } = body

  const { error: e2 } = await supabaseAdmin.from('profiles').upsert({
    id: user.id,
    ...safeBody,
  })

  if (!e2) return NextResponse.json({ ok: true })

  console.error('[ProfileSave] Minimal upsert also failed:', e2.message)
  return NextResponse.json({ error: e2.message }, { status: 500 })
}
