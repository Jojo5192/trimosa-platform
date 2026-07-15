import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkAvailability } from '@/lib/smoobu'
import { getMarkupMultiplier } from '@/lib/pricing'
import { checkRateLimit } from '@/lib/rate-limit'
import { getUiLang } from '@/lib/i18n-server'

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Bitte zuerst anmelden' }, { status: 401 })

  const allowed = await checkRateLimit(`bookings:${user.id}`, 20, 3600)
  if (!allowed) {
    return NextResponse.json({ error: 'Zu viele Buchungsanfragen. Bitte später erneut versuchen.' }, { status: 429 })
  }

  const body = await request.json()
  const {
    listingId, checkIn, checkOut,
    adults = 1, children = 0, message = '',
    booking_type = 'request',
    guest_price_suggestion,
  } = body

  if (!listingId || !checkIn || !checkOut)
    return NextResponse.json({ error: 'listingId, checkIn und checkOut erforderlich' }, { status: 400 })

  const { data: listing } = await supabaseAdmin
    .from('listings')
    .select('id, title, smoobu_id, price_per_night, host_id, allow_instant_booking, allow_requests, min_request_nights')
    .eq('id', listingId)
    .single()
  if (!listing) return NextResponse.json({ error: 'Unterkunft nicht gefunden' }, { status: 404 })

  // Booking settings live on the listing (per-listing, not per-host)
  if (booking_type === 'instant' && listing.allow_instant_booking === false)
    return NextResponse.json({ error: 'Sofortbuchung ist für diese Unterkunft nicht verfügbar.' }, { status: 403 })
  if (booking_type === 'request' && listing.allow_requests === false)
    return NextResponse.json({ error: 'Anfragen sind für diese Unterkunft deaktiviert.' }, { status: 403 })

  const nights = Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000)
  if (booking_type === 'request') {
    const minNights = listing.min_request_nights ?? 1
    if (nights < minNights)
      return NextResponse.json({ error: `Anfragen erst ab ${minNights} Nächten möglich.` }, { status: 400 })
  }

  // ── Check availability + get price (with platform markup) ────────────
  let totalPrice = 0
  const markup = await getMarkupMultiplier(listing.host_id)
  console.log('[Bookings] markup multiplier:', markup)

  if (listing.smoobu_id) {
    const avail = await checkAvailability(listing.smoobu_id, checkIn, checkOut)
    if (!avail.available)
      return NextResponse.json({ error: 'Diese Daten sind leider nicht verfügbar.' }, { status: 409 })
    // Apply platform markup to the raw Smoobu price
    totalPrice = Math.round(avail.totalPrice * markup)
    console.log('[Bookings] raw Smoobu price:', avail.totalPrice, '→ with markup:', totalPrice)
  } else {
    totalPrice = Math.round((listing.price_per_night ?? 0) * nights * markup)
  }

  const initialStatus = booking_type === 'instant' ? 'confirmed' : 'pending'

  const { data: newBooking, error: bookingError } = await supabaseAdmin
    .from('bookings')
    .insert({
      guest_lang: await getUiLang(),
      listing_id: listingId,
      guest_id: user.id,
      check_in: checkIn,
      check_out: checkOut,
      total_price: totalPrice,
      adults,
      children,
      status: initialStatus,
      message,
      booking_type,
      guest_price_suggestion: guest_price_suggestion ?? null,
    })
    .select('id')
    .single()

  if (bookingError || !newBooking) {
    // 23P01 = exclusion_violation → the DB-level double-booking guard caught
    // an overlapping confirmed booking for this listing (see migration
    // 20260711_prevent_double_booking.sql).
    if (bookingError?.code === '23P01') {
      return NextResponse.json({ error: 'Diese Daten sind leider inzwischen belegt.' }, { status: 409 })
    }
    console.error('[Bookings] insert error:', bookingError)
    return NextResponse.json({ error: 'Buchung konnte nicht gespeichert werden.' }, { status: 500 })
  }

  // ── NOTE: Smoobu reservation is created AFTER payment on the success page ──
  // We do NOT push to Smoobu here because payment hasn't happened yet.
  // The success page (app/booking/success/page.tsx) handles Smoobu creation
  // once Stripe confirms payment.

  // Auto-create a linked conversation so host & guest can chat immediately
  try {
    const guestName = user.user_metadata?.name ?? user.email ?? 'Gast'
    const { data: hostProfileForName } = await supabaseAdmin
      .from('profiles')
      .select('display_name')
      .eq('id', listing.host_id)
      .maybeSingle()
    const hostName = hostProfileForName?.display_name ?? 'Gastgeber'

    const { data: existing } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('listing_id', listingId)
      .eq('guest_id', user.id)
      .maybeSingle()

    let convId = existing?.id
    if (!convId) {
      const { data: newConv } = await supabaseAdmin
        .from('conversations')
        .insert({
          listing_id: listingId,
          host_id: listing.host_id,
          guest_id: user.id,
          guest_name: guestName,
          host_name: hostName,
          listing_title: listing.title ?? '',
          booking_id: newBooking.id,
          last_message_at: new Date().toISOString(),
        })
        .select('id')
        .single()
      convId = newConv?.id
    } else {
      await supabaseAdmin
        .from('conversations')
        .update({ booking_id: newBooking.id, host_name: hostName })
        .eq('id', convId)
    }

    // Send an auto-message
    if (convId) {
      const autoMsg = booking_type === 'instant'
        ? `Deine Buchung für ${listing.title} (${checkIn} – ${checkOut}) wurde angelegt. Zahlung wird verarbeitet…`
        : `Deine Anfrage für ${listing.title} (${checkIn} – ${checkOut}) wurde gesendet. Der Gastgeber wird sie in Kürze bearbeiten.`
      await supabaseAdmin
        .from('messages')
        .insert({
          conversation_id: convId,
          sender_id: listing.host_id,
          content: autoMsg,
        })
      await supabaseAdmin
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', convId)
    }
  } catch (err) {
    console.error('[Bookings] auto-conversation failed (non-fatal):', err)
  }

  // Gast-Bestätigung wird bewusst NICHT hier verschickt, sondern erst im
  // Stripe-Webhook nach bestätigter Zahlung (Inhaber-Vorgabe: keine Mail
  // vor Zahlungseingang; abgebrochene Checkouts bekommen so nie eine Mail).

  return NextResponse.json({ ok: true, bookingId: newBooking.id, totalPrice, booking_type })
}
