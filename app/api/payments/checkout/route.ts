import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { stripe, toCents } from '@/lib/stripe'

/**
 * POST /api/payments/checkout
 * Creates a Stripe Checkout Session for a booking.
 * Body: { bookingId }
 *
 * Returns: { url } — redirect the user to this URL to complete payment.
 */
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const { bookingId } = await req.json()
  if (!bookingId) return NextResponse.json({ error: 'bookingId fehlt' }, { status: 400 })

  // Load booking
  const { data: booking } = await supabaseAdmin
    .from('bookings')
    .select('*, listings(title, cancellation_policy, host_id)')
    .eq('id', bookingId)
    .eq('guest_id', user.id)   // security: only own bookings
    .single()

  if (!booking) return NextResponse.json({ error: 'Buchung nicht gefunden' }, { status: 404 })
  if (booking.payment_status === 'paid') return NextResponse.json({ error: 'Bereits bezahlt' }, { status: 400 })

  const listing = booking.listings as unknown as { title: string; cancellation_policy: string; host_id: string } | null
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trimosa-app.vercel.app'

  // Load guest profile data — embed in Stripe metadata so the webhook
  // has reliable access without a second DB round-trip.
  const countryMap: Record<string, string> = {
    'deutschland': 'DE', 'germany': 'DE', 'österreich': 'AT', 'austria': 'AT',
    'schweiz': 'CH', 'switzerland': 'CH', 'frankreich': 'FR', 'france': 'FR',
    'niederlande': 'NL', 'belgien': 'BE', 'luxemburg': 'LU', 'italien': 'IT',
    'spanien': 'ES', 'usa': 'US', 'united states': 'US', 'polen': 'PL',
  }
  function toCountryCode(v: string) {
    if (!v) return 'DE'
    if (v.length === 2) return v.toUpperCase()
    return countryMap[v.toLowerCase()] ?? v
  }

  let guestFirstName = ''
  let guestLastName  = ''
  let guestStreet    = ''
  let guestZip       = ''
  let guestCity      = ''
  let guestCountry   = 'DE'
  let guestPhone     = ''

  try {
    // Try with optional columns first; fall back to safe minimal set on error
    const profileSelect = 'guest_first_name, guest_last_name, company_name, account_type, display_name, phone, guest_street, guest_zip, guest_city, guest_country'
    let gp: Record<string, unknown> | null = null
    const { data: d1, error: e1 } = await supabaseAdmin.from('profiles').select(profileSelect).eq('id', user.id).maybeSingle()
    if (e1) {
      const { data: d2 } = await supabaseAdmin.from('profiles')
        .select('guest_first_name, guest_last_name, display_name, phone, guest_street, guest_zip, guest_city, guest_country')
        .eq('id', user.id).maybeSingle()
      gp = d2 as Record<string, unknown> | null
    } else {
      gp = d1 as Record<string, unknown> | null
    }

    if (gp) {
      const isBiz = gp.account_type === 'business'
      if (isBiz) {
        guestFirstName = (gp.company_name as string) || (gp.display_name as string) || ''
        guestLastName  = '-'
      } else {
        const nameParts = ((gp.display_name as string) || '').split(' ')
        guestFirstName = (gp.guest_first_name as string) || nameParts[0] || ''
        guestLastName  = (gp.guest_last_name  as string) || nameParts.slice(1).join(' ') || ''
      }
      guestStreet  = (gp.guest_street  as string) || ''
      guestZip     = (gp.guest_zip     as string) || ''
      guestCity    = (gp.guest_city    as string) || ''
      guestCountry = toCountryCode((gp.guest_country as string) || 'DE')
      guestPhone   = (gp.phone as string) || ''
    }
  } catch { /* non-fatal — webhook will fall back to profile query */ }

  console.log('[Checkout] Guest data for Stripe metadata:', { guestFirstName, guestLastName, guestStreet, guestZip, guestCity })

  // Create Stripe Checkout Session
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'eur',
          unit_amount: toCents(booking.total_price),
          product_data: {
            name: listing?.title ?? 'Unterkunft',
            description: `${booking.check_in} – ${booking.check_out} · ${booking.adults ?? 1} Gäste`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      bookingId,
      guestId: user.id,
      bookingType: booking.booking_type ?? 'request',
      // Guest data — webhook reads these directly, no extra DB query needed
      guestFirstName,
      guestLastName,
      guestStreet,
      guestZip,
      guestCity,
      guestCountry,
      guestPhone,
    },
    success_url: `${siteUrl}/booking/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/listing/${booking.listing_id}`,
    customer_email: user.email,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // 30 min expiry
  })

  // Save session ID to booking
  await supabaseAdmin
    .from('bookings')
    .update({
      stripe_checkout_session_id: session.id,
      payment_status: 'pending',
    })
    .eq('id', bookingId)

  return NextResponse.json({ url: session.url })
}
