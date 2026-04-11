import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createReservation, checkAvailability } from '@/lib/smoobu'

/**
 * POST /api/bookings
 * Creates a booking in Supabase and syncs it to Smoobu.
 *
 * Body: { listingId, checkIn, checkOut, adults?, children?, message? }
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Bitte zuerst anmelden' }, { status: 401 })
  }

  const body = await request.json()
  const { listingId, checkIn, checkOut, adults = 1, children = 0, message = '' } = body

  if (!listingId || !checkIn || !checkOut) {
    return NextResponse.json({ error: 'listingId, checkIn und checkOut erforderlich' }, { status: 400 })
  }

  // Load listing
  const { data: listing } = await supabaseAdmin
    .from('listings')
    .select('id, title, smoobu_id, price_per_night, host_id')
    .eq('id', listingId)
    .single()

  if (!listing) {
    return NextResponse.json({ error: 'Unterkunft nicht gefunden' }, { status: 404 })
  }

  // Check availability + get price
  let totalPrice = 0
  if (listing.smoobu_id) {
    const avail = await checkAvailability(listing.smoobu_id, checkIn, checkOut)
    if (!avail.available) {
      return NextResponse.json({ error: 'Diese Daten sind leider nicht verfügbar.' }, { status: 409 })
    }
    totalPrice = avail.totalPrice
  } else {
    const nights = Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000)
    totalPrice = (listing.price_per_night ?? 0) * nights
  }

  // Create booking in Supabase
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
      status: 'pending',
      message,
    })
    .select('id')
    .single()

  if (bookingError || !newBooking) {
    console.error('[Bookings] Supabase insert error:', bookingError)
    return NextResponse.json({ error: 'Buchung konnte nicht gespeichert werden.' }, { status: 500 })
  }

  // Push to Smoobu (best-effort — don't fail the booking if Smoobu is unavailable)
  let smoobuReservationId: number | null = null
  if (listing.smoobu_id) {
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
        notice: message || 'Direkte Buchung über TRIMOSA',
      })

      // Store Smoobu reservation ID
      if (smoobuReservationId) {
        await supabaseAdmin
          .from('bookings')
          .update({ smoobu_reservation_id: smoobuReservationId })
          .eq('id', newBooking.id)
      }
    } catch (err) {
      console.error('[Bookings] Smoobu sync failed (non-fatal):', err)
    }
  }

  // Send confirmation email (fire-and-forget)
  fetch(`${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/api/send-booking-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookingId: newBooking.id }),
  }).catch(() => {})

  return NextResponse.json({
    ok: true,
    bookingId: newBooking.id,
    totalPrice,
    smoobuReservationId,
  })
}
