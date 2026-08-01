import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { redirect } from 'next/navigation'
import BookingDetailClient from './BookingDetailClient'
import { SEV_ENGINE_STICHTAG } from '@/lib/sevdesk-engine'

export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: booking } = await supabaseAdmin
    .from('bookings')
    .select('*, listings(id, title, location, images, cancellation_policy, cancel_free_days, cancel_free_percent, cancel_partial_days, cancel_partial_percent, smoobu_id)')
    .eq('id', id)
    .eq('guest_id', user.id) // security: only own bookings
    .maybeSingle()

  if (!booking) redirect('/guest')

  // Find the conversation for this booking
  const { data: conv } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('booking_id', id)
    .maybeSingle()

  // §160-Ergänzung: existiert eine Rechnung, kann der Gast sie direkt
  // ansehen (Token-Link streamt das PDF live, inline). §235: Anreisen ab
  // Stichtag liegen in sevdesk, ältere in lexoffice.
  let invoiceUrl: string | null = null
  const token = (booking as { portal_token?: string | null }).portal_token
  if (token) {
    if (String((booking as { check_in?: string }).check_in) >= SEV_ENGINE_STICHTAG) {
      const { data: inv } = await supabaseAdmin
        .from('sevdesk_invoices').select('sevdesk_id').eq('booking_id', id).maybeSingle()
      if (inv?.sevdesk_id) invoiceUrl = `/api/rechnung/${token}`
    } else {
      const { data: inv } = await supabaseAdmin
        .from('lexoffice_invoices').select('lexoffice_id').eq('booking_id', id).maybeSingle()
      if (inv?.lexoffice_id) invoiceUrl = `/api/rechnung/${token}`
    }
  }

  return (
    <BookingDetailClient
      booking={booking}
      conversationId={conv?.id ?? null}
      userId={user.id}
      invoiceUrl={invoiceUrl}
    />
  )
}
