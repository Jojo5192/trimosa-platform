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

  // 🔒 Sicherheitsprüfung 9.10.2026: select('*') ging 1:1 an den Gast — inklusive Türcode (vor dem
  // Freigabe-Fenster der Gästemappe), Stummschalt-/Sperrgründen („KI: Beschwerde erkannt"), Stripe- und
  // Portal-Kennungen. Der Gast bekommt nur noch die Felder seiner eigenen Buchungsansicht.
  if (listing?.host_id !== user.id) {
    const GAST_FELDER = ['id', 'listing_id', 'check_in', 'check_out', 'adults', 'children', 'total_price', 'currency',
      'status', 'payment_status', 'paid_at', 'message', 'guest_name', 'created_at', 'listings'] as const
    const rec = booking as Record<string, unknown>
    const gast = Object.fromEntries(GAST_FELDER.filter((k) => k in rec).map((k) => [k, rec[k]]))
    return NextResponse.json(gast)
  }

  // Fetch guest profile for host view
  let guestInfo: Record<string, string | null> = {}
  if (booking.guest_id) {
    const { data: guestProfile } = await supabaseAdmin
      .from('profiles')
      .select('guest_first_name, guest_last_name, company_name, account_type, display_name, guest_street, guest_zip, guest_city, guest_country')
      .eq('id', booking.guest_id as string)
      .maybeSingle()
    const gp = guestProfile as Record<string, unknown> | null
    if (gp) {
      const isBusiness = gp.account_type === 'business'
      const name = isBusiness
        ? (gp.company_name as string | null) ?? (gp.display_name as string | null) ?? 'Unbekannt'
        : [gp.guest_first_name, gp.guest_last_name].filter(Boolean).join(' ') || (gp.display_name as string | null) || 'Unbekannt'
      guestInfo = {
        guest_name: name,
        guest_street: gp.guest_street as string | null,
        guest_zip: gp.guest_zip as string | null,
        guest_city: gp.guest_city as string | null,
        guest_country: gp.guest_country as string | null,
      }
    }
  }

  return NextResponse.json({ ...booking, ...guestInfo })
}
