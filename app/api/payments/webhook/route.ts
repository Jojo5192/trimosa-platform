import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createReservation } from '@/lib/smoobu'

export const config = { api: { bodyParser: false } }

/**
 * POST /api/payments/webhook
 * Stripe sends events here. Set up in Stripe Dashboard:
 *   Webhook URL: https://trimosa-app.vercel.app/api/payments/webhook
 *   Events: checkout.session.completed, charge.refunded
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
          'vereinigtes königreich': 'GB', 'united kingdom': 'GB',
          'usa': 'US', 'united states': 'US',
          'polen': 'PL', 'tschechien': 'CZ', 'ungarn': 'HU', 'kroatien': 'HR',
        }
        function resolveCountryCode(val: string): string {
          if (!val) return 'DE'
          if (val.length === 2) return val.toUpperCase()
          return countryNameToCode[val.toLowerCase()] ?? 'DE'
        }

        const guestData = await supabaseAdmin.auth.admin.getUserById(booking.guest_id)
        const guestEmail = guestData.data.user?.email ?? ''
        const { data: guestProfile } = await supabaseAdmin
          .from('profiles')
          .select('guest_first_name, guest_last_name, company_name, account_type, display_name, phone, guest_street, guest_zip, guest_city, guest_country')
          .eq('id', booking.guest_id)
          .maybeSingle()
        const gp = guestProfile as Record<string, unknown> | null

        const isBusiness = gp?.account_type === 'business'
        let smoobuFirstName: string
        let smoobuLastName: string
        if (isBusiness) {
          smoobuFirstName = (gp?.company_name as string) || (gp?.display_name as string) || 'Gast'
          smoobuLastName = '-'
        } else {
          const fullName = ((gp?.display_name as string) || '').split(' ')
          smoobuFirstName = (gp?.guest_first_name as string) || fullName[0] || 'Gast'
          smoobuLastName  = ((gp?.guest_last_name as string) || fullName.slice(1).join(' ')) || '-'
        }

        console.log('[Webhook] Creating Smoobu reservation for booking:', bookingId,
          'apartment:', listing.smoobu_id,
          'guest:', smoobuFirstName, smoobuLastName,
          'address:', gp?.guest_street, gp?.guest_zip, gp?.guest_city)

        const smoobuId = await createReservation({
          smoobuApartmentId: parseInt(listing.smoobu_id),
          arrivalDate: booking.check_in,
          departureDate: booking.check_out,
          firstName: smoobuFirstName,
          lastName: smoobuLastName,
          email: guestEmail,
          phone: (gp?.phone as string) || '',
          street: (gp?.guest_street as string) || '',
          postalCode: (gp?.guest_zip as string) || '',
          city: (gp?.guest_city as string) || '',
          country: resolveCountryCode((gp?.guest_country as string) || 'DE'),
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

  return NextResponse.json({ ok: true })
}
