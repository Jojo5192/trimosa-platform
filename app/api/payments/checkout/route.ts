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
