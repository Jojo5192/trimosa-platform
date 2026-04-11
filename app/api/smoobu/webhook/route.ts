import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getReservationMessages } from '@/lib/smoobu'

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

  const action = (payload.action as string) ?? 'created'

  // ── Handle new message notifications ─────────────────────────
  if (action === 'newMessage') {
    const msgData = payload.data as Record<string, unknown> | undefined
    const smoobuBookingId = ((msgData?.booking as Record<string, unknown>)?.id) as number | undefined

    if (!smoobuBookingId) {
      console.warn('[Smoobu Webhook] newMessage: missing data.booking.id')
      return new Response('OK', { status: 200 })
    }

    // Find the booking + linked conversation
    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('id, conversations(id, host_id, guest_id)')
      .eq('smoobu_reservation_id', smoobuBookingId)
      .maybeSingle()

    if (!booking) {
      console.warn(`[Smoobu Webhook] newMessage: no booking for smoobu_id=${smoobuBookingId}`)
      return new Response('OK', { status: 200 })
    }

    const convArr = booking.conversations as { id: string; host_id: string; guest_id: string }[] | null
    const conv = Array.isArray(convArr) ? convArr[0] : (convArr as unknown as { id: string; host_id: string; guest_id: string } | null)

    if (!conv?.id) {
      console.warn('[Smoobu Webhook] newMessage: no conversation linked to booking', booking.id)
      return new Response('OK', { status: 200 })
    }

    // Load host's Smoobu API key
    const { data: hostProfile } = await supabaseAdmin
      .from('profiles')
      .select('smoobu_api_key')
      .eq('id', conv.host_id)
      .maybeSingle()
    const hostApiKey = (hostProfile as Record<string, unknown> | null)?.smoobu_api_key as string | undefined

    // Fetch all messages and upsert (deduplication via smoobu_message_id)
    const smoobuMsgs = await getReservationMessages(smoobuBookingId, hostApiKey)
    let synced = 0
    for (const msg of smoobuMsgs) {
      if (!msg.message?.trim()) continue
      const isHost = msg.type?.toLowerCase().includes('host') || msg.sender?.toLowerCase().includes('host')
      const { error } = await supabaseAdmin
        .from('messages')
        .upsert(
          {
            conversation_id: conv.id,
            sender_id: isHost ? conv.host_id : conv.guest_id,
            content: msg.message.trim(),
            smoobu_message_id: String(msg.id),
            created_at: msg.date || new Date().toISOString(),
          },
          { onConflict: 'smoobu_message_id', ignoreDuplicates: true },
        )
      if (error && error.code !== '23505') {
        console.error('[Smoobu Webhook] message upsert error:', error.message)
      } else {
        synced++
      }
    }

    // Update conversation's last_message_at
    await supabaseAdmin
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conv.id)

    console.log(`[Smoobu Webhook] Synced ${synced} messages for reservation ${smoobuBookingId}`)
    return new Response('OK', { status: 200 })
  }

  // ── Handle reservation events ─────────────────────────────────
  const reservationId = payload.id ?? payload.reservationId
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
