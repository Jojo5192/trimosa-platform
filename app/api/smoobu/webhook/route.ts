import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * POST /api/smoobu/webhook
 *
 * Receives reservation events from Smoobu.
 * Configure in Smoobu → Settings → Notifications → Webhook URL:
 *   https://your-domain.com/api/smoobu/webhook
 *
 * Events: reservation.created, reservation.modified, reservation.cancelled
 */
export async function POST(request: Request) {
  let payload: Record<string, unknown>

  try {
    payload = await request.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  console.log('[Smoobu Webhook] Received:', JSON.stringify(payload, null, 2))

  // Smoobu sends reservation data directly — no separate event wrapper
  const reservationId = payload.id ?? payload.reservationId
  const action = (payload.action as string) ?? 'created'
  const apartment = payload.apartment as Record<string, unknown> | undefined
  const smoobuApartmentId = apartment?.id ?? payload.apartmentId

  if (!reservationId || !smoobuApartmentId) {
    console.warn('[Smoobu Webhook] Missing reservationId or apartmentId')
    return new Response('OK', { status: 200 }) // Return 200 so Smoobu doesn't retry
  }

  // Find the matching listing by smoobu_id
  const { data: listing } = await supabaseAdmin
    .from('listings')
    .select('id, host_id')
    .eq('smoobu_id', String(smoobuApartmentId))
    .maybeSingle()

  if (!listing) {
    console.warn(`[Smoobu Webhook] No listing found for smoobu_id=${smoobuApartmentId}`)
    return new Response('OK', { status: 200 })
  }

  const checkIn = (payload.arrivalDate ?? payload.arrival_date) as string
  const checkOut = (payload.departureDate ?? payload.departure_date) as string
  const channel = (payload.channel as Record<string, unknown>)?.name ?? 'Smoobu'
  const guestName = [payload.firstName, payload.lastName].filter(Boolean).join(' ') || 'Externer Gast'
  const guestEmail = (payload.email as string) ?? ''
  const totalPrice = Number(payload.price ?? payload.totalPrice ?? 0)

  if (action === 'cancelled' || payload.status === 'cancelled') {
    // Mark existing external booking as cancelled
    await supabaseAdmin
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('smoobu_reservation_id', reservationId)

    console.log(`[Smoobu Webhook] Cancelled reservation ${reservationId}`)
    return new Response('OK', { status: 200 })
  }

  // Upsert the external booking
  const { error } = await supabaseAdmin
    .from('bookings')
    .upsert(
      {
        listing_id: listing.id,
        guest_id: null,                         // No TRIMOSA account for external guests
        smoobu_reservation_id: reservationId,
        check_in: checkIn,
        check_out: checkOut,
        total_price: totalPrice,
        status: 'confirmed',
        channel: channel,
        guest_name: guestName,
        guest_email: guestEmail,
        source: 'smoobu_webhook',
      },
      { onConflict: 'smoobu_reservation_id', ignoreDuplicates: false },
    )

  if (error) {
    console.error('[Smoobu Webhook] Upsert error:', error)
    // Still return 200 to prevent Smoobu from retrying indefinitely
  } else {
    console.log(`[Smoobu Webhook] Upserted reservation ${reservationId} for listing ${listing.id}`)
  }

  return new Response('OK', { status: 200 })
}
