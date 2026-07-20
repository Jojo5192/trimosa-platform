import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getReservationMessages } from '@/lib/smoobu'
import { sendNewBookingPush } from '@/lib/push'

/**
 * POST /api/smoobu/webhook
 *
 * Receives reservation events from Smoobu.
 * Configure in Smoobu → Settings → Notifications → Webhook URL:
 *   https://your-domain.com/api/smoobu/webhook?secret=<SMOOBU_WEBHOOK_SECRET>
 *
 * Smoobu webhooks carry no signature — the ?secret= query param on the
 * configured URL is the only way to authenticate the caller.
 *
 * Events: reservation.created, reservation.modified, reservation.cancelled
 */
export async function POST(request: Request) {
  const url = new URL(request.url)
  const expectedSecret = process.env.SMOOBU_WEBHOOK_SECRET
  if (!expectedSecret || url.searchParams.get('secret') !== expectedSecret) {
    console.warn('[Smoobu Webhook] Rejected: missing or invalid secret')
    return new Response('Unauthorized', { status: 401 })
  }

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
      .select('id, guest_name, conversations(id, host_id, guest_id), listings(title)')
      .eq('smoobu_reservation_id', smoobuBookingId)
      .maybeSingle()

    if (!booking) {
      console.warn(`[Smoobu Webhook] newMessage: no booking for smoobu_id=${smoobuBookingId}`)
      return new Response('OK', { status: 200 })
    }

    const convArr = booking.conversations as { id: string; host_id: string; guest_id: string }[] | null
    const conv = Array.isArray(convArr) ? convArr[0] : (convArr as unknown as { id: string; host_id: string; guest_id: string } | null)

    if (!conv?.id) {
      // Portal-Buchung (Airbnb/Booking/FeWo) ohne Plattform-Konto — die Welt
      // der Team-Inbox. Vorher wurde das Event hier VERWORFEN und die
      // Nachricht kam erst per 10-Min-Poll oder beim Thread-Öffnen (§131);
      // jetzt: sofort syncen + übersetzt pushen (gleiche Logik wie der Poll).
      try {
        const { syncBookingMessages } = await import('@/lib/message-sync')
        const listing = (Array.isArray(booking.listings) ? booking.listings[0] : booking.listings) as { title: string } | null
        const r = await syncBookingMessages({
          id: booking.id,
          guest_name: (booking.guest_name as string | null) ?? null,
          smoobu_reservation_id: smoobuBookingId,
          listingTitle: listing?.title ?? null,
        })
        console.log('[Smoobu Webhook] newMessage → booking-sync:', booking.id, JSON.stringify(r))
      } catch (err) {
        console.error('[Smoobu Webhook] newMessage booking-sync failed:', err)
      }
      return new Response('OK', { status: 200 })
    }

    // Load host's Smoobu API key
    const { data: hostProfile } = await supabaseAdmin
      .from('profiles')
      .select('smoobu_api_key')
      .eq('id', conv.host_id)
      .maybeSingle()
    const hostApiKey = (hostProfile as Record<string, unknown> | null)?.smoobu_api_key as string | undefined

    // Fetch all messages and insert new ones (deduplication via smoobu_message_id check)
    const smoobuMsgs = await getReservationMessages(smoobuBookingId, hostApiKey)
    let synced = 0
    for (const msg of smoobuMsgs) {
      if (!msg.message?.trim()) continue
      const msgId   = String(msg.id)
      const content = msg.message.trim()

      // Step 1: Skip if already synced by smoobu_message_id
      const { data: existing } = await supabaseAdmin
        .from('messages')
        .select('id')
        .eq('smoobu_message_id', msgId)
        .maybeSingle()
      if (existing) continue

      // Step 2: Content-based linking — prevents duplicates when smoobu_message_id
      // wasn't saved after send (Smoobu may not return an ID, or race with webhook)
      const { data: unlinked } = await supabaseAdmin
        .from('messages')
        .select('id')
        .eq('conversation_id', conv.id)
        .eq('content', content)
        .is('smoobu_message_id', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (unlinked) {
        await supabaseAdmin
          .from('messages')
          .update({ smoobu_message_id: msgId })
          .eq('id', unlinked.id)
        console.log('[Smoobu Webhook] Linked smoobu_message_id', msgId, '→ existing msg', unlinked.id)
        continue
      }

      // Step 3: New Smoobu-originated message — detect sender and insert
      const typeStr    = (msg.type ?? '').toLowerCase()
      const senderStr  = (msg.sender ?? '').toLowerCase()
      const subjectStr = (msg.subject ?? '').toLowerCase()
      const subjectIsGuest = subjectStr.includes('nachricht von gast') || subjectStr.includes('via trimosa')
      const subjectIsHost  = subjectStr.includes('nachricht von trimosa')
      // NOTE: Smoobu uses type=1 as message category, not sender. senderType/direction already
      // normalised into msg.type by smoobu.ts (senderType > direction > type).
      const typeIsGuest = typeStr.includes('guest') || typeStr === 'incoming' || typeStr === 'guest_to_host'
      const typeIsHost  = typeStr.includes('host') || typeStr === 'outgoing' || typeStr === 'sent'
                        || typeStr === 'owner' || typeStr === 'automated' || typeStr === 'host_to_guest'
                        || senderStr.includes('host') || senderStr.includes('gastgeber')
      const isHost = subjectIsHost ? true : subjectIsGuest ? false : typeIsGuest ? false : (typeIsHost || !typeIsGuest)

      console.log('[Smoobu Webhook] syncMsg id:', msg.id,
        '| type:', JSON.stringify(msg.type), '| sender:', JSON.stringify(msg.sender),
        '| subject:', msg.subject?.slice(0, 50), '| → isHost:', isHost)

      const { error } = await supabaseAdmin
        .from('messages')
        .insert({
          conversation_id: conv.id,
          sender_id: isHost ? conv.host_id : (conv.guest_id ?? conv.host_id),
          content,
          smoobu_message_id: msgId,
          created_at: msg.date || new Date().toISOString(),
        })
      if (error) {
        console.error('[Smoobu Webhook] message insert error:', error.message)
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

  // War die Reservierung schon bekannt? (Update/Echo unserer eigenen
  // Website-Buchungen ODER 'modified'-Events → dann KEIN Buchungs-Push)
  const { data: known } = await supabaseAdmin
    .from('bookings')
    .select('id')
    .eq('smoobu_reservation_id', reservationId)
    .maybeSingle()

  // Upsert the external booking
  const { data: upserted, error } = await supabaseAdmin
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
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[Smoobu Webhook] Upsert error:', error)
    // Still return 200 to prevent Smoobu from retrying indefinitely
  } else {
    console.log(`[Smoobu Webhook] Upserted reservation ${reservationId} for listing ${listing.id}`)
    // NEUE externe Buchung (Airbnb/Booking/…) → rollenabhängiger Team-Push
    if (!known && upserted?.id) {
      sendNewBookingPush(upserted.id).catch((err) =>
        console.error('[Smoobu Webhook] booking push failed (non-fatal):', err))
    }
  }

  return new Response('OK', { status: 200 })
}
