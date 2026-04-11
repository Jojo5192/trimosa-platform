import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createReservation, checkAvailability } from '@/lib/smoobu'

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Bitte zuerst anmelden' }, { status: 401 })

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
    .select('id, title, smoobu_id, price_per_night, host_id')
    .eq('id', listingId)
    .single()
  if (!listing) return NextResponse.json({ error: 'Unterkunft nicht gefunden' }, { status: 404 })

  // Check host booking settings
  const { data: hostProfile } = await supabaseAdmin
    .from('profiles')
    .select('allow_instant_booking, allow_requests, min_request_nights')
    .eq('id', listing.host_id)
    .single()

  if (booking_type === 'instant' && hostProfile?.allow_instant_booking === false)
    return NextResponse.json({ error: 'Sofortbuchung ist für diese Unterkunft nicht verfügbar.' }, { status: 403 })
  if (booking_type === 'request' && hostProfile?.allow_requests === false)
    return NextResponse.json({ error: 'Anfragen sind für diese Unterkunft deaktiviert.' }, { status: 403 })

  const nights = Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000)
  if (booking_type === 'request') {
    const minNights = hostProfile?.min_request_nights ?? 1
    if (nights < minNights)
      return NextResponse.json({ error: `Anfragen erst ab ${minNights} Nächten möglich.` }, { status: 400 })
  }

  // Check availability + get price
  let totalPrice = 0
  if (listing.smoobu_id) {
    const avail = await checkAvailability(listing.smoobu_id, checkIn, checkOut)
    if (!avail.available)
      return NextResponse.json({ error: 'Diese Daten sind leider nicht verfügbar.' }, { status: 409 })
    totalPrice = avail.totalPrice
  } else {
    totalPrice = (listing.price_per_night ?? 0) * nights
  }

  const initialStatus = booking_type === 'instant' ? 'confirmed' : 'pending'

  const { data: newBooking, error: bookingError } = await supabaseAdmin
    .from('bookings')
    .insert({
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
    console.error('[Bookings] insert error:', bookingError)
    return NextResponse.json({ error: 'Buchung konnte nicht gespeichert werden.' }, { status: 500 })
  }

  // Instant bookings: push to Smoobu to block calendar
  let smoobuReservationId: number | null = null
  if (booking_type === 'instant' && listing.smoobu_id) {
    try {
      const name = (user.user_metadata?.name ?? user.email ?? 'Gast').split(' ')
      smoobuReservationId = await createReservation({
        smoobuApartmentId: parseInt(listing.smoobu_id),
        arrivalDate: checkIn,
        departureDate: checkOut,
        firstName: name[0] ?? 'Gast',
        lastName: name.slice(1).join(' ') || '-',
        email: user.email ?? '',
        adults,
        children,
        price: totalPrice,
        notice: message || 'Sofortbuchung über TRIMOSA',
      })
      if (smoobuReservationId) {
        await supabaseAdmin.from('bookings').update({ smoobu_reservation_id: smoobuReservationId }).eq('id', newBooking.id)
      }
    } catch (err) {
      console.error('[Bookings] Smoobu sync failed (non-fatal):', err)
    }
  }

  fetch(`${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/api/send-booking-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookingId: newBooking.id }),
  }).catch(() => {})

  return NextResponse.json({ ok: true, bookingId: newBooking.id, totalPrice, booking_type, smoobuReservationId })
}
