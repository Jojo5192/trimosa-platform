import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * 📖 Gästemappe: Mappe-Links der aktuellen + kommenden Buchungen einer Wohnung
 * (für den Builder — Host kopiert den Link und schickt ihn dem Gast, bis der
 * automatische Versand der Auto-Nachrichten-Engine kommt). Team-gated.
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host, is_staff').eq('id', user.id).maybeSingle()
  if (!me?.is_admin && !me?.is_host && !me?.is_staff) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  }

  const listingId = request.nextUrl.searchParams.get('listingId')
  if (!listingId) return NextResponse.json({ error: 'listingId fehlt.' }, { status: 400 })

  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select('id, guest_name, check_in, check_out, portal_token, channel, status')
    .eq('listing_id', listingId)
    .gte('check_out', today)
    .neq('status', 'cancelled')
    .order('check_in', { ascending: true })
    .limit(10)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    bookings: (data ?? []).map((b) => ({
      id: b.id,
      guestName: b.guest_name ?? 'Gast',
      checkIn: b.check_in,
      checkOut: b.check_out,
      channel: b.channel ?? null,
      url: b.portal_token ? `/mappe/${b.portal_token}` : null,
    })),
  }, NO_STORE)
}
