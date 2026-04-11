import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('allow_instant_booking, allow_requests, min_request_nights')
    .eq('id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    allow_instant_booking: data?.allow_instant_booking ?? true,
    allow_requests: data?.allow_requests ?? true,
    min_request_nights: data?.min_request_nights ?? 1,
  })
}

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()

  const updates: Record<string, unknown> = {}
  if (typeof body.allow_instant_booking === 'boolean') updates.allow_instant_booking = body.allow_instant_booking
  if (typeof body.allow_requests === 'boolean') updates.allow_requests = body.allow_requests
  if (typeof body.min_request_nights === 'number') updates.min_request_nights = Math.max(1, Math.min(30, body.min_request_nights))

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
