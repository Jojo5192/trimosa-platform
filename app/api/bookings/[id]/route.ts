import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const { data: booking } = await supabaseAdmin
    .from('bookings')
    .select('*, listings(id, host_id, title, location)')
    .eq('id', id)
    .single()

  if (!booking) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 })

  const listing = booking.listings as { host_id: string } | null
  if (listing?.host_id !== user.id && booking.guest_id !== user.id) {
    return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })
  }

  return NextResponse.json(booking)
}
