import { NextRequest, NextResponse } from 'next/server'
import { sendNewBookingPush } from '@/lib/push'
import { stripe } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createReservation, cancelReservation } from '@/lib/smoobu'
import { sendBookingEmail, sendHostBookingAlert, sendBookingCancelledEmail } from '@/lib/email'

/**
 * POST /api/payments/webhook
 * Stripe sends events here. Set up in Stripe Dashboard:
 *   Webhook URL: https://trimosa-app.vercel.app/api/payments/webhook
 *   Events: checkout.session.completed, checkout.session.expired, charge.refunded
 */
export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature') ?? ''
  const body = await req.text()

  let event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET ?? '')
  } catch (err) {
    console.error('[Webhook] signature verification failed', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = event.data.object as any
    const bookingId = session.metadata?.bookingId
    const bookingType = session.metadata?.bookingType ?? 'request'

    if (!bookingId) return NextResponse.json({ error: 'missing bookingId' }, { status: 400 })

    // Load booking
    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('*, listings(id, title, smoobu_id, host_id, cancellation_policy)')
      .eq('id', bookingId)
      .single()

    if (!booking) return NextResponse.json({ ok: true }) // idempotent

    const listing = booking.listings as unknown as { id: string; title: string; smoobu_id: string | null; host_id: string; cancellation_policy: string } | null

    // Determine new booking status
    // instant → confirmed immediately; request → stays pending until host confirms
    const newStatus = bookingType === 'instant' ? 'confirmed' : 'pending'

    // Update booking
    await supabaseAdmin
      .from('bookings')
      .update({
        payment_status: 'paid',
        paid_at: new Date().toISOString(),
        stripe_payment_intent_id: session.payment_intent as string,
        status: newStatus,
      })
      .eq('id', bookingId)

    // Notify the host now that payment is confirmed — requests ask for
    // accept/decline, instant bookings just inform (fire-and-forget).
    // The guest confirmation also goes out HERE (only after payment).
    sendBookingEmail(bookingId).catch(err =>
      console.error('[Webhook] guest confirmation failed (non-fatal):', err))
    sendHostBookingAlert(bookingId)
    // Rollenabhängiger Buchungs-Push (Chefs mit Betrag, Staff ohne),
    // Tap → Gast-Thread in der Team-Inbox
    sendNewBookingPush(bookingId).catch(err =>
      console.error('[Webhook] booking push failed (non-fatal):', err)
    )

    // For instant bookings: push to Smoobu immediately
    if (bookingType === 'instant' && listing?.smoobu_id && !booking.smoobu_reservation_id) {
      try {
        // Load host's own Smoobu credentials (per-host support)
        const { data: hostSmoobu } = await supabaseAdmin
          .from('profiles')
          .select('smoobu_api_key, smoobu_channel_id')
          .eq('id', listing.host_id)
          .maybeSingle()
        const hostApiKey = (hostSmoobu as Record<string, unknown> | null)?.smoobu_api_key as string | undefined
        const hostChannelId = (hostSmoobu as Record<string, unknown> | null)?.smoobu_channel_id as number | undefined

        const countryNameToCode: Record<string, string> = {
          'deutschland': 'DE', 'germany': 'DE',
          'österreich': 'AT', 'austria': 'AT',
          'schweiz': 'CH', 'switzerland': 'CH',
          'frankreich': 'FR', 'france': 'FR',
          'niederlande': 'NL', 'netherlands': 'NL',
          'belgien': 'BE', 'belgium': 'BE',
          'luxemburg': 'LU', 'luxembourg': 'LU',
          'italien': 'IT', 'italy': 'IT',
          'spanien': 'ES', 'spain': 'ES',
          'vereinigtes königreich': 'GB', 'united kingdom': 'GB', 'uk': 'GB',
          'usa': 'US', 'united states': 'US',
          'polen': 'PL', 'poland': 'PL',
          'tschechien': 'CZ', 'czech republic': 'CZ',
          'ungarn': 'HU', 'hungary': 'HU',
          'kroatien': 'HR', 'croatia': 'HR',
        }
        function resolveCountryCode(val: string): string {
          if (!val) return 'DE'
          if (val.length === 2) return val.toUpperCase()
          return countryNameToCode[val.toLowerCase()] ?? 'DE'
        }

        const guestData = await supabaseAdmin.auth.admin.getUserById(booking.guest_id)
        const guestEmail = guestData.data.user?.email ?? ''

        // ── Always fetch guest profile from DB — most up-to-date source ──────────
        let guestProfile: Record<string, unknown> | null = null
        {
          const { data: gp1, error: gpErr1 } = await supabaseAdmin
            .from('profiles')
            .select('guest_first_name, guest_last_name, company_name, account_type, display_name, phone, guest_street, guest_zip, guest_city, guest_country')
            .eq('id', booking.guest_id)
            .maybeSingle()

          if (gpErr1) {
            console.error('[Webhook] Full profile select failed:', gpErr1.message, '– retrying minimal select')
            const { data: gp2, error: gpErr2 } = await supabaseAdmin
              .from('profiles')
              .select('guest_first_name, guest_last_name, display_name, guest_street, guest_zip, guest_city, guest_country')
              .eq('id', booking.guest_id)
              .maybeSingle()
            if (gpErr2) {
              console.error('[Webhook] Minimal profile select also failed:', gpErr2.message)
            } else {
              guestProfile = gp2 as Record<string, unknown> | null
            }
          } else {
            guestProfile = gp1 as Record<string, unknown> | null
          }
        }

        console.log('[Webhook] Guest profile data:', JSON.stringify(guestProfile))

        // Ultimate fallback: auth user_metadata (always has at least "name")
        const guestMeta = guestData.data.user?.user_metadata ?? {}
        const metaName = (guestMeta.name as string) || ''
        const metaNameParts = metaName.split(' ')

        // Derive Smoobu fields from profile, with auth metadata as fallback
        const isBiz = guestProfile?.account_type === 'business'
        const displayName = (guestProfile?.display_name as string) || metaName || ''
        const nameParts = displayName.split(' ')

        let smoobuFirstName = isBiz
          ? ((guestProfile?.company_name as string) || displayName || '')
          : ((guestProfile?.guest_first_name as string) || nameParts[0] || metaNameParts[0] || '')
        let smoobuLastName = isBiz
          ? '-'
          : ((guestProfile?.guest_last_name as string) || nameParts.slice(1).join(' ') || metaNameParts.slice(1).join(' ') || '')
        const smoobuStreet  = (guestProfile?.guest_street as string)  || ''
        const smoobuZip     = (guestProfile?.guest_zip    as string)  || ''
        const smoobuCity    = (guestProfile?.guest_city   as string)  || ''
        const smoobuCountry = resolveCountryCode((guestProfile?.guest_country as string) || 'DE')
        const smoobuPhone = (guestProfile?.phone as string) || ''

        // Final fallbacks
        if (!smoobuFirstName) smoobuFirstName = 'Gast'
        if (!smoobuLastName)  smoobuLastName  = '-'

        console.log('[Webhook] Creating Smoobu reservation — booking:', bookingId,
          '| apartment:', listing.smoobu_id,
          '| guest:', smoobuFirstName, smoobuLastName,
          '| email:', guestEmail,
          '| address:', smoobuStreet || '(empty)', smoobuZip || '(empty)', smoobuCity || '(empty)', smoobuCountry,
          '| phone:', smoobuPhone ? 'set' : 'not set')

        const smoobuId = await createReservation({
          smoobuApartmentId: parseInt(listing.smoobu_id),
          arrivalDate: booking.check_in,
          departureDate: booking.check_out,
          firstName: smoobuFirstName,
          lastName: smoobuLastName,
          email: guestEmail,
          phone: smoobuPhone || '+4900000000',
          street: smoobuStreet,
          postalCode: smoobuZip,
          city: smoobuCity,
          country: smoobuCountry,
          adults: booking.adults ?? 1,
          children: booking.children ?? 0,
          price: booking.total_price,
          notice: 'Buchung über TRIMOSA – Bestätigt & Bezahlt',
          apiKey: hostApiKey,
          channelId: hostChannelId,
        })
        await supabaseAdmin.from('bookings').update({ smoobu_reservation_id: smoobuId }).eq('id', bookingId)
      } catch (err) {
        console.error('[Webhook] Smoobu push failed:', err)
      }
    }

    // Send confirmation message in chat
    try {
      const { data: conv } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('booking_id', bookingId)
        .maybeSingle()
      if (conv && listing) {
        const msg = bookingType === 'instant'
          ? `✅ Zahlung erhalten! Deine Buchung für "${listing.title}" (${booking.check_in} – ${booking.check_out}) ist bestätigt.`
          : `💳 Zahlung erhalten! Deine Anfrage für "${listing.title}" (${booking.check_in} – ${booking.check_out}) wartet noch auf die Bestätigung des Gastgebers.`
        await supabaseAdmin.from('messages').insert({
          conversation_id: conv.id,
          sender_id: listing.host_id,
          content: msg,
        })
        await supabaseAdmin.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conv.id)
      }
    } catch (err) {
      console.error('[Webhook] chat msg failed:', err)
    }
  }

  // A booking row is created (status 'confirmed'/'pending') before the
  // guest ever reaches Stripe Checkout. If the session expires unpaid
  // (30 min, see /api/payments/checkout), that row would otherwise sit
  // there indefinitely, looking like a real booking and — for instant
  // bookings — blocking the calendar via the confirmed-only exclusion
  // constraint on bookings.
  if (event.type === 'checkout.session.expired') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = event.data.object as any
    const bookingId = session.metadata?.bookingId
    if (!bookingId) return NextResponse.json({ ok: true })

    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('id, payment_status')
      .eq('id', bookingId)
      .maybeSingle()

    // Only cancel if it's still unpaid — a completed payment always wins
    // over an expiry event, regardless of arrival order.
    if (booking && booking.payment_status !== 'paid') {
      await supabaseAdmin
        .from('bookings')
        .update({ status: 'cancelled' })
        .eq('id', bookingId)
    }

    return NextResponse.json({ ok: true })
  }

  // Refunds triggered from the Stripe Dashboard (outside our own
  // /api/payments/refund or declineBooking flows) never reached the DB
  // before — this keeps bookings.status/refunded_at in sync either way.
  if (event.type === 'charge.refunded') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const charge = event.data.object as any
    const paymentIntentId = charge.payment_intent as string | null
    if (!paymentIntentId) return NextResponse.json({ ok: true })

    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('*, listings(title, host_id)')
      .eq('stripe_payment_intent_id', paymentIntentId)
      .maybeSingle()

    if (!booking) return NextResponse.json({ ok: true }) // unrelated charge

    // Idempotent: our own refund/decline flows already set refunded_at
    // themselves, so skip re-processing (and re-notifying) here.
    if (booking.refunded_at) return NextResponse.json({ ok: true })

    const listing = booking.listings as unknown as { title: string; host_id: string } | null
    const refundId = (charge.refunds?.data?.[0]?.id as string) ?? null

    await supabaseAdmin
      .from('bookings')
      .update({
        status: 'cancelled',
        refunded_at: new Date().toISOString(),
        stripe_refund_id: refundId,
      })
      .eq('id', booking.id)

    if (booking.smoobu_reservation_id) {
      try {
        await cancelReservation(booking.smoobu_reservation_id)
      } catch (err) {
        console.error('[Webhook] Smoobu cancelReservation failed:', err)
      }
    }

    // Cancellation confirmation email to the guest
    try {
      await sendBookingCancelledEmail(booking.id, { refunded: (charge.amount_refunded ?? 0) / 100 })
    } catch (err) {
      console.error('[Webhook] cancellation email failed (non-fatal):', err)
    }

    try {
      const { data: conv } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('booking_id', booking.id)
        .maybeSingle()
      if (conv) {
        const refundedAmount = (charge.amount_refunded ?? 0) / 100
        await supabaseAdmin.from('messages').insert({
          conversation_id: conv.id,
          sender_id: listing?.host_id ?? booking.guest_id,
          content: `❌ Buchung storniert. Rückerstattung von €${refundedAmount.toFixed(2)} wurde veranlasst und erscheint in 5–10 Werktagen auf deiner Zahlungsmethode.`,
        })
        await supabaseAdmin.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conv.id)
      }
    } catch (err) {
      console.error('[Webhook] chat msg failed:', err)
    }
  }

  return NextResponse.json({ ok: true })
}
