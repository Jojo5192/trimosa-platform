// server-only (Kommentar-Konvention §243 — kein 'server-only'-Package installiert)
import { supabaseAdmin } from '@/lib/supabase-admin'
import { stripe, toCents } from '@/lib/stripe'

/**
 * §266d: Stripe-Checkout-Session für eine Buchung erstellen — aus
 * app/api/payments/checkout extrahiert, damit auch der Guest-Checkout
 * (Auto-Konto ohne Browser-Session, §266d) sie server-seitig erzeugen
 * kann. Verhalten 1:1 wie vorher; der guest_id-Check bleibt die
 * Sicherheitsgrenze (nur eigene Buchungen).
 */
export async function createStripeCheckout(
  bookingId: string,
  guest: { id: string; email: string | null },
): Promise<{ ok: true; url: string | null } | { ok: false; error: string; status: number }> {
  const { data: booking } = await supabaseAdmin
    .from('bookings')
    .select('*, listings(title, cancellation_policy, host_id)')
    .eq('id', bookingId)
    .eq('guest_id', guest.id) // security: only own bookings
    .single()

  if (!booking) return { ok: false, error: 'Buchung nicht gefunden', status: 404 }
  if (booking.payment_status === 'paid') return { ok: false, error: 'Bereits bezahlt', status: 400 }

  const listing = booking.listings as unknown as { title: string; cancellation_policy: string; host_id: string } | null
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trimosa-app.vercel.app'

  try {
    // Guest profile data is fetched fresh from DB by the webhook — no need
    // to embed it here.
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            unit_amount: toCents(Number(booking.total_price)), // §221 numeric -> number
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
        guestId: guest.id,
        bookingType: booking.booking_type ?? 'request',
      },
      success_url: `${siteUrl}/booking/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/listing/${booking.listing_id}`,
      customer_email: guest.email ?? undefined,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // 30 min expiry
    })

    await supabaseAdmin
      .from('bookings')
      .update({ stripe_checkout_session_id: session.id, payment_status: 'pending' })
      .eq('id', bookingId)

    return { ok: true, url: session.url }
  } catch (e) {
    console.error('[checkout] Stripe-Session fehlgeschlagen:', bookingId.slice(0, 8), e)
    return { ok: false, error: 'Die Zahlung konnte nicht gestartet werden.', status: 502 }
  }
}
