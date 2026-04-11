import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

async function getListingAndAuth(id: string, userId: string) {
  const { data: existing } = await supabaseAdmin
    .from('listings')
    .select('id, host_id')
    .eq('id', id)
    .single()
  if (!existing) return { error: 'Inserat nicht gefunden', status: 404 }
  if (existing.host_id !== userId) return { error: 'Keine Berechtigung', status: 403 }
  return { existing }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const check = await getListingAndAuth(id, user.id)
  if (check.error) return NextResponse.json({ error: check.error }, { status: check.status })

  const body = await request.json()

  // Onboarding gate: nur aktivieren wenn Einrichtung abgeschlossen
  if (body.is_active === true) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('onboarding_step, iban, billing_name')
      .eq('id', user.id)
      .single()

    const step = profile?.onboarding_step ?? 0
    const hasBilling = !!(profile?.iban && profile?.billing_name)

    if (step < 6 || !hasBilling) {
      return NextResponse.json({
        error: 'onboarding_incomplete',
        message: 'Bitte schließe zuerst den Einrichtungsassistenten ab und hinterlege deine Zahlungsdaten.',
      }, { status: 403 })
    }
  }

  const allowed = [
    'title', 'description', 'location', 'address',
    'max_guests', 'bedrooms', 'bathrooms',
    'amenities', 'rooms',
    'house_rules', 'check_in_time', 'check_out_time',
    'is_active', 'cancellation_policy',
  ]
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) patch[key] = body[key]
  }
  if ('cover_image' in body) {
    patch.images = body.cover_image ? [body.cover_image] : []
  }

  const { error } = await supabaseAdmin.from('listings').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const check = await getListingAndAuth(id, user.id)
  if (check.error) return NextResponse.json({ error: check.error }, { status: check.status })

  // Delete associated bookings first (or set listing to inactive first)
  const { error } = await supabaseAdmin.from('listings').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
