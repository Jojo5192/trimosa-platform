import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { stripe, refundAmount } from '@/lib/stripe'

/**
 * POST /api/payments/refund
 * Body: { bookingId }
 * Can be called by the guest (cancelling own booking) or the host.
 * Automatically calculates refund amount based on cancellation policy.
 */
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const { bookingId } = await req.json()

  const { data: booking } = await supabaseAdmin
    .from('bookings')
    .select('*, listings(host_id, title, cancellation_policy)')
    .eq('id', bookingId)
    .single()

  if (!booking) return NextResponse.json({ error: 'Buchung nicht gefunden' }, { status: 404 })

  const listing = booking.listings as unknown as { host_id: string; title: string; cancellation_policy: string } | null

  // Only the guest or the host can cancel
  const isGuest = booking.guest_id === user.id
  const isHost = listing?.host_id === user.id
  if (!isGuest && !isHost) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })

  if (booking.payment_status !== 'paid') {
    // No Stripe payment to refund — just cancel the booking
    await supabaseAdmin.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId)
    return NextResponse.json({ ok: true, refunded: 0 })
  }

  if (!booking.stripe_payment_intent_id) {
    return NextResponse.json({ error: 'Keine Zahlungsinformationen gespeichert' }, { status: 400 })
  }

  const policy = listing?.cancellation_policy ?? 'moderat'
  const refund = refundAmount(booking.total_price, policy, booking.check_in)

  let stripeRefundId: string | null = null
  if (refund > 0) {
    try {
      const stripeRefund = await stripe.refunds.create({
        payment_intent: booking.stripe_payment_intent_id,
        amount: Math.round(refund * 100),
        reason: 'requested_by_customer',
      })
      stripeRefundId = stripeRefund.id
    } catch (err) {
      console.error('[Refund] Stripe error:', err)
      return NextResponse.json({ error: 'Rückerstattung fehlgeschlagen' }, { status: 500 })
    }
  }

  await supabaseAdmin
    .from('bookings')
    .update({
      status: 'cancelled',
      refunded_at: new Date().toISOString(),
      stripe_refund_id: stripeRefundId,
    })
    .eq('id', bookingId)

  // Notify via chat
  try {
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('booking_id', bookingId)
      .maybeSingle()
    if (conv) {
      const msg = refund > 0
        ? `Buchung storniert. Rückerstattung von €${refund.toFixed(2)} wurde veranlasst und erscheint in 5–10 Werktagen auf deiner Zahlungsmethode.`
        : `Buchung storniert. Gemäß der Stornierungsbedingungen (${policy}) ist keine Rückerstattung möglich.`
      await supabaseAdmin.from('messages').insert({
        conversation_id: conv.id,
        sender_id: listing?.host_id ?? user.id,
        content: msg,
      })
      await supabaseAdmin.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conv.id)
    }
  } catch (err) {
    console.error('[Refund] chat notify failed:', err)
  }

  return NextResponse.json({ ok: true, refunded: refund, stripeRefundId })
}
