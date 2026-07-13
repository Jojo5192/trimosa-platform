import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('allow_instant_booking, allow_requests, min_request_nights, notification_email')
    .eq('id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    allow_instant_booking: data?.allow_instant_booking ?? true,
    allow_requests: data?.allow_requests ?? true,
    min_request_nights: data?.min_request_nights ?? 1,
    notification_email: data?.notification_email ?? '',
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
  if (typeof body.notification_email === 'string') {
    const mail = body.notification_email.trim().slice(0, 200)
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      return NextResponse.json({ error: 'Ungültige E-Mail-Adresse' }, { status: 400 })
    }
    updates.notification_email = mail || null
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Optionally push the booking-mode settings to ALL existing listings of
  // this host (the listing columns are what the detail page + booking API
  // actually read — the profile values are only the default for new ones).
  if (body.apply_to_listings === true) {
    const listingUpdates: Record<string, unknown> = {}
    if ('allow_instant_booking' in updates) listingUpdates.allow_instant_booking = updates.allow_instant_booking
    if ('allow_requests' in updates) listingUpdates.allow_requests = updates.allow_requests
    if ('min_request_nights' in updates) listingUpdates.min_request_nights = updates.min_request_nights
    if (Object.keys(listingUpdates).length > 0) {
      const { error: listErr } = await supabaseAdmin
        .from('listings')
        .update(listingUpdates)
        .eq('host_id', user.id)
      if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
