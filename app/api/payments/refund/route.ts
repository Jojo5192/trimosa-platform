import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { stripe, refundAmount } from '@/lib/stripe'
import { cancelReservation, sendMessageToGuest } from '@/lib/smoobu'

/**
 * POST /api/payments/refund
 * Body: { bookingId }
 * Can be called by the guest (cancelling own booking) or the host.
 * Automatically calculates refund amount based on cancellation policy.
 * Also cancels the Smoobu reservation to free the calendar block.
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

  const policy = listing?.cancellation_policy ?? 'moderat'
  let refund = 0
  let stripeRefundId: string | null = null

  if (booking.payment_status === 'paid') {
    if (!booking.stripe_payment_intent_id) {
      return NextResponse.json({ error: 'Keine Zahlungsinformationen gespeichert' }, { status: 400 })
    }

    refund = refundAmount(booking.total_price, policy, booking.check_in)

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
  }

  // Update booking in Supabase
  await supabaseAdmin
    .from('bookings')
    .update({
      status: 'cancelled',
      refunded_at: new Date().toISOString(),
      stripe_refund_id: stripeRefundId,
    })
    .eq('id', bookingId)

  // ─── Cancel in Smoobu to free the calendar block ──────────────
  if (booking.smoobu_reservation_id) {
    try {
      await cancelReservation(booking.smoobu_reservation_id)
    } catch (err) {
      // Log but don't fail the whole cancellation — Supabase is already updated
      console.error('[Refund] Smoobu cancelReservation failed:', err)
    }
  }

  // ─── Notify via chat ──────────────────────────────────────────
  const cancelMsg = refund > 0
    ? `❌ Buchung storniert. Rückerstattung von €${refund.toFixed(2)} wurde veranlasst und erscheint in 5–10 Werktagen auf deiner Zahlungsmethode.`
    : `❌ Buchung storniert. Gemäß der Stornierungsbedingungen (${policy}) ist keine Rückerstattung möglich.`

  try {
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('booking_id', bookingId)
      .maybeSingle()
    if (conv) {
      await supabaseAdmin.from('messages').insert({
        conversation_id: conv.id,
        sender_id: listing?.host_id ?? user.id,
        content: cancelMsg,
      })
      await supabaseAdmin.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conv.id)
    }
  } catch (err) {
    console.error('[Refund] chat notify failed:', err)
  }

  // ─── Also send cancellation notice via Smoobu messages ───────
  if (booking.smoobu_reservation_id) {
    try {
      await sendMessageToGuest(booking.smoobu_reservation_id, cancelMsg)
    } catch (err) {
      console.error('[Refund] Smoobu message failed:', err)
    }
  }

  return NextResponse.json({ ok: true, refunded: refund, stripeRefundId })
}
