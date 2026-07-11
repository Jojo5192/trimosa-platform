import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * Sends the "booking request received" email to the guest via Resend.
 * Uses supabaseAdmin (service role) rather than a cookie-bound client so
 * it can be called directly from server routes/actions without needing
 * an incoming request's session.
 */
export async function sendBookingEmail(bookingId: string) {
  const { data: booking } = await supabaseAdmin
    .from('bookings')
    .select('*, listings(title, location)')
    .eq('id', bookingId)
    .single()

  if (!booking) return { ok: false, error: 'Buchung nicht gefunden' }

  const { data: guestData } = await supabaseAdmin.auth.admin.getUserById(booking.guest_id)

  const listing = booking.listings as { title: string; location: string }
  const guestEmail = guestData?.user?.email
  if (!guestEmail) return { ok: false, error: 'Keine Gast-E-Mail gefunden' }

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.log('[E-Mail] RESEND_API_KEY nicht gesetzt — E-Mail wird nicht versendet.')
    console.log(`[E-Mail] An Gast: ${guestEmail}`)
    console.log(`[E-Mail] Buchung: ${listing.title}, ${booking.check_in} → ${booking.check_out}`)
    return { ok: true, note: 'RESEND_API_KEY fehlt, E-Mail nicht gesendet' }
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resendKey}`,
    },
    body: JSON.stringify({
      // Absender-Domain muss in Resend verifiziert sein.
      from: 'TRIMOSA <buchung@trimosa.de>',
      to: guestEmail,
      subject: `Deine Buchungsanfrage: ${listing.title}`,
      html: `
        <h2>Buchungsanfrage eingegangen</h2>
        <p>Hallo,</p>
        <p>deine Anfrage für <strong>${listing.title}</strong> (${listing.location}) wurde empfangen.</p>
        <p><strong>Anreise:</strong> ${booking.check_in}<br>
           <strong>Abreise:</strong> ${booking.check_out}<br>
           <strong>Gesamtpreis:</strong> € ${booking.total_price}</p>
        <p>Der Gastgeber meldet sich in Kürze bei dir.</p>
        <p>Viele Grüße,<br>TRIMOSA</p>
      `,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    console.error('[E-Mail] Resend-Versand fehlgeschlagen:', err)
    return { ok: false, error: 'E-Mail-Versand fehlgeschlagen' }
  }

  return { ok: true }
}
