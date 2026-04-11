import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

const ALLOWED = new Set([
  'guest_notif_booking_confirmed',
  'guest_notif_booking_cancelled',
  'guest_notif_new_message',
  'guest_notif_payment',
])

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const updates: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED.has(k) && typeof v === 'boolean') updates[k] = v
  }

  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 })

  const { error } = await supabaseAdmin.from('profiles').update(updates).eq('id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
