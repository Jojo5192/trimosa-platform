'use server'

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'

export async function acceptBooking(bookingId: string) {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht eingeloggt')

  // Sicherstellen dass die Buchung zu einem eigenen Inserat gehört
  const { data: booking } = await supabase
    .from('bookings')
    .select('listing_id, listings(host_id)')
    .eq('id', bookingId)
    .single()

  const listing = booking?.listings as unknown as { host_id: string } | null
  if (!booking || listing?.host_id !== user.id) {
    throw new Error('Keine Berechtigung')
  }

  await supabase
    .from('bookings')
    .update({ status: 'confirmed' })
    .eq('id', bookingId)

  revalidatePath('/dashboard')
}

export async function declineBooking(bookingId: string) {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nicht eingeloggt')

  const { data: booking } = await supabase
    .from('bookings')
    .select('listing_id, listings(host_id)')
    .eq('id', bookingId)
    .single()

  const listing = booking?.listings as unknown as { host_id: string } | null
  if (!booking || listing?.host_id !== user.id) {
    throw new Error('Keine Berechtigung')
  }

  await supabase
    .from('bookings')
    .update({ status: 'cancelled' })
    .eq('id', bookingId)

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
