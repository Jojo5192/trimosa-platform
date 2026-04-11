'use server'

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { revalidatePath } from 'next/cache'
import { createReservation } from '@/lib/smoobu'

export async function acceptBooking(bookingId: string) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht eingeloggt')

  const { data: booking } = await supabaseAdmin
    .from('bookings')
    .select('*, listings(id, title, host_id, smoobu_id)')
    .eq('id', bookingId)
    .single()

  const listing = booking?.listings as unknown as { id: string; title: string; host_id: string; smoobu_id: string | null } | null
  if (!booking || listing?.host_id !== user.id) throw new Error('Keine Berechtigung')

  // Update booking to confirmed
  await supabaseAdmin
    .from('bookings')
    .update({ status: 'confirmed' })
    .eq('id', bookingId)

  // Push to Smoobu to block the calendar (for requests that weren't previously pushed)
  if (listing?.smoobu_id && !booking.smoobu_reservation_id) {
    try {
      const [guestInfo, guestAuth, hostProfile] = await Promise.all([
        supabaseAdmin.from('profiles')
          .select('guest_first_name, guest_last_name, display_name, phone, guest_street, guest_city, guest_zip, guest_country')
          .eq('id', booking.guest_id)
          .maybeSingle(),
        supabaseAdmin.auth.admin.getUserById(booking.guest_id),
        supabaseAdmin.from('profiles')
          .select('smoobu_api_key, smoobu_channel_id')
          .eq('id', listing.host_id)
          .maybeSingle(),
      ])
      const g = guestInfo.data as Record<string, unknown> | null
      const hp = hostProfile.data as Record<string, unknown> | null
      const fullName = ((g?.display_name as string) ?? 'Gast').split(' ')
      const smoobuId = await createReservation({
        smoobuApartmentId: parseInt(listing.smoobu_id),
        arrivalDate: booking.check_in,
        departureDate: booking.check_out,
        firstName: (g?.guest_first_name as string) || fullName[0] || 'Gast',
        lastName: ((g?.guest_last_name as string) || fullName.slice(1).join(' ')) || '-',
        email: guestAuth.data.user?.email ?? '',
        phone: (g?.phone as string) || '',
        street: (g?.guest_street as string) || '',
        postalCode: (g?.guest_zip as string) || '',
        city: (g?.guest_city as string) || '',
        country: (g?.guest_country as string) || 'DE',
        adults: booking.adults ?? 1,
        children: booking.children ?? 0,
        price: booking.total_price,
        notice: `Anfrage bestätigt über TRIMOSA`,
        apiKey: (hp?.smoobu_api_key as string) || undefined,
        channelId: (hp?.smoobu_channel_id as number) || undefined,
      })
      await supabaseAdmin.from('bookings').update({ smoobu_reservation_id: smoobuId }).eq('id', bookingId)
    } catch (err) {
      console.error('[acceptBooking] Smoobu push failed (non-fatal):', err)
    }
  }

  // Notify guest via chat
  try {
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('booking_id', bookingId)
      .maybeSingle()
    if (conv) {
      await supabaseAdmin.from('messages').insert({
        conversation_id: conv.id,
        sender_id: user.id,
        content: `✅ Deine Buchungsanfrage für "${listing?.title}" wurde bestätigt! Check-in: ${booking.check_in}, Check-out: ${booking.check_out}. Wir freuen uns auf deinen Aufenthalt!`,
      })
      await supabaseAdmin.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conv.id)
    }
  } catch (err) {
    console.error('[acceptBooking] chat notify failed (non-fatal):', err)
  }

  revalidatePath('/dashboard')
}

export async function declineBooking(bookingId: string) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht eingeloggt')

  const { data: booking } = await supabaseAdmin
    .from('bookings')
    .select('*, listings(id, title, host_id)')
    .eq('id', bookingId)
    .single()

  const listing = booking?.listings as unknown as { id: string; title: string; host_id: string } | null
  if (!booking || listing?.host_id !== user.id) throw new Error('Keine Berechtigung')

  await supabaseAdmin
    .from('bookings')
    .update({ status: 'cancelled' })
    .eq('id', bookingId)

  // Notify guest via chat
  try {
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('booking_id', bookingId)
      .maybeSingle()
    if (conv) {
      await supabaseAdmin.from('messages').insert({
        conversation_id: conv.id,
        sender_id: user.id,
        content: `Deine Anfrage für "${listing?.title}" (${booking.check_in} – ${booking.check_out}) wurde leider abgelehnt. Bei Fragen stehe ich dir gerne zur Verfügung.`,
      })
      await supabaseAdmin.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conv.id)
    }
  } catch (err) {
    console.error('[declineBooking] chat notify failed (non-fatal):', err)
  }

  revalidatePath('/dashboard')
}

export async function createListing(formData: {
  title: string
  description: string
  location: string
  price_per_night: number
  max_guests: number
  bedrooms: number
}) {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht eingeloggt')

  const { error } = await supabase.from('listings').insert({
    ...formData,
    host_id: user.id,
    is_active: true,
    images: [],
  })

  if (error) throw new Error(error.message)

  revalidatePath('/dashboard')
  revalidatePath('/')
}
