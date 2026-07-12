import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * Host price markup. Each host manages their own markup on their own profile.
 * The JSON key stays `platform_markup_pct` for backwards-compatibility with the
 * existing dashboard UI, but it now reads/writes the caller's profile.markup_pct
 * (there is no platform-wide markup anymore).
 */
export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ platform_markup_pct: 0 })

  const { data } = await supabaseAdmin
    .from('profiles')
    .select('markup_pct')
    .eq('id', user.id)
    .maybeSingle()
  return NextResponse.json({ platform_markup_pct: data?.markup_pct ?? 0 })
}

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 })

  const body = await request.json()
  const pct = parseFloat(body.platform_markup_pct ?? 0)
  if (isNaN(pct)) return NextResponse.json({ error: 'Ungültiger Wert' }, { status: 400 })

  // A host writes their own markup (their own profile row only).
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ markup_pct: pct })
    .eq('id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, platform_markup_pct: pct })
}
