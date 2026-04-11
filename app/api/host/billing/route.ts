import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 })

  const { data } = await supabaseAdmin
    .from('profiles')
    .select('billing_name,billing_address,billing_city,billing_zip,billing_country,billing_tax_id,iban,bic,account_holder,onboarding_step')
    .eq('id', user.id)
    .single()

  return NextResponse.json(data ?? {})
}

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 })

  const body = await request.json()
  const allowed = ['billing_name','billing_address','billing_city','billing_zip','billing_country','billing_tax_id','iban','bic','account_holder','onboarding_step']
  const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)))

  const { error } = await supabaseAdmin
    .from('profiles')
    .upsert({ id: user.id, ...patch })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
