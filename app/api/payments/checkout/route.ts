import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createStripeCheckout } from '@/lib/checkout'

/**
 * POST /api/payments/checkout
 * Creates a Stripe Checkout Session for a booking.
 * Body: { bookingId }
 *
 * Returns: { url } — redirect the user to this URL to complete payment.
 * §266d: Kern-Logik lebt in lib/checkout.ts (geteilt mit dem
 * Guest-Checkout-Zweig von /api/bookings, der ohne Browser-Session läuft).
 */
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const { bookingId } = await req.json()
  if (!bookingId) return NextResponse.json({ error: 'bookingId fehlt' }, { status: 400 })

  const r = await createStripeCheckout(String(bookingId), { id: user.id, email: user.email ?? null })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ url: r.url })
}
