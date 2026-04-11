import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Auth prüfen
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  }

  // Sicherstellen dass das Inserat diesem Host gehört
  const { data: existing } = await supabaseAdmin
    .from('listings')
    .select('id, host_id')
    .eq('id', id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Inserat nicht gefunden' }, { status: 404 })
  }
  if (existing.host_id !== user.id) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })
  }

  const body = await request.json()

  // Nur erlaubte Felder updaten (host_id, smoobu_id etc. können nicht überschrieben werden)
  const allowed = [
    'title', 'description', 'location', 'address',
    'max_guests', 'bedrooms', 'bathrooms',
    'amenities', 'rooms',
    'house_rules', 'check_in_time', 'check_out_time',
    'is_active',
  ]
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) patch[key] = body[key]
  }

  // cover_image → images[0]
  if ('cover_image' in body) {
    patch.images = body.cover_image ? [body.cover_image] : []
  }

  const { error } = await supabaseAdmin
    .from('listings')
    .update(patch)
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
