import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

// E-Mail-Versand via Resend (https://resend.com)
// 1. npm install resend
// 2. RESEND_API_KEY in .env.local eintragen
// 3. Absender-Domain in Resend verifizieren

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()

  // Auth prüfen
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 })
  }

  const { bookingId } = await request.json()
  if (!bookingId) {
    return NextResponse.json({ error: 'bookingId fehlt' }, { status: 400 })
  }

  // Buchungsdetails laden
  const { data: booking } = await supabase
    .from('bookings')
    .select('*, listings(title, location, host_id)')
    .eq('id', bookingId)
    .single()

  if (!booking) {
    return NextResponse.json({ error: 'Buchung nicht gefunden' }, { status: 404 })
  }

  // Gast-E-Mail laden
  const { data: guestData } = await supabase.auth.admin.getUserById(booking.guest_id)

  const listing = booking.listings as { title: string; location: string; host_id: string }
  const guestEmail = guestData?.user?.email ?? 'unbekannt'

  // Resend-Integration (aktivieren sobald RESEND_API_KEY gesetzt ist)
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.log('[E-Mail] RESEND_API_KEY nicht gesetzt — E-Mail wird nicht versendet.')
    console.log(`[E-Mail] An Gast: ${guestEmail}`)
    console.log(`[E-Mail] Buchung: ${listing.title}, ${booking.check_in} → ${booking.check_out}`)
    return NextResponse.json({ ok: true, note: 'RESEND_API_KEY fehlt, E-Mail nicht gesendet' })
  }

  // E-Mail an Gast senden
  const guestRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resendKey}`,
    },
    body: JSON.stringify({
      from: 'TRIMOSA Ferienplattform <buchung@deine-domain.de>',
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
        <p>Viele Grüße,<br>TRIMOSA Ferienplattform</p>
      `,
    }),
  })

  if (!guestRes.ok) {
    const err = await guestRes.json()
    return NextResponse.json({ error: 'E-Mail-Versand fehlgeschlagen', details: err }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
