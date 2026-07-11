import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  const { data } = await supabaseAdmin
    .from('platform_settings')
    .select('platform_markup_pct')
    .eq('id', 1)
    .single()
  return NextResponse.json({ platform_markup_pct: data?.platform_markup_pct ?? 0 })
}

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Nur Admins dürfen diese Einstellung ändern.' }, { status: 403 })
  }

  const body = await request.json()
  const pct = parseFloat(body.platform_markup_pct ?? 0)

  const { error } = await supabaseAdmin
    .from('platform_settings')
    .upsert({ id: 1, platform_markup_pct: pct, updated_at: new Date().toISOString() })
    .eq('id', 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, platform_markup_pct: pct })
}
