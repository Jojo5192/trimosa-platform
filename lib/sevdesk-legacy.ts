import { supabaseAdmin } from '@/lib/supabase-admin'

/** Paragraph 300: sevdesk-Rechnung einer Alt-Buchung finden (booking_id, sonst smoobu_reservation_id) und verknuepfen. */
export async function findLegacySevInvoice(bookingId: string, smoobuId: number | null): Promise<{ sevdesk_id: string | null; invoice_number: string | null } | null> {
  const { data: byBooking } = await supabaseAdmin
    .from('sevdesk_invoices').select('sevdesk_id, invoice_number').eq('booking_id', bookingId).not('sevdesk_id', 'is', null).maybeSingle()
  if (byBooking?.sevdesk_id) return byBooking
  if (!smoobuId) return null
  const { data: bySmoobu } = await supabaseAdmin
    .from('sevdesk_invoices').select('id, sevdesk_id, invoice_number, booking_id').eq('smoobu_reservation_id', smoobuId).not('sevdesk_id', 'is', null).limit(1).maybeSingle()
  if (!bySmoobu?.sevdesk_id) return null
  if (!bySmoobu.booking_id) {
    await supabaseAdmin.from('sevdesk_invoices').update({ booking_id: bookingId }).eq('id', bySmoobu.id)
  }
  return { sevdesk_id: bySmoobu.sevdesk_id, invoice_number: bySmoobu.invoice_number }
}

