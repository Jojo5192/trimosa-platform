import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { stripe } from '@/lib/stripe'
import { createReservation } from '@/lib/smoobu'
import Link from 'next/link'

export default async function BookingSuccessPage({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const params = await searchParams
  const sessionId = params.session_id

  let booking: Record<string, unknown> | null = null
  let listing: { title: string; location: string; smoobu_id: string | null } | null = null
  let conversationId: string | null = null

  if (sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId)
      const bookingId = session.metadata?.bookingId
      const bookingType = session.metadata?.bookingType ?? 'request'

      if (bookingId) {
        // Load booking with listing details
        const { data } = await supabaseAdmin
          .from('bookings')
          .select('*, listings(title, location, smoobu_id, host_id, cancellation_policy)')
          .eq('id', bookingId)
          .maybeSingle()

        if (data) {
          booking = data
          const l = data.listings as { title: string; location: string; smoobu_id: string | null; host_id: string } | null
          listing = l

          // ─── Smoobu fallback ──────────────────────────────────────────
          // If the Stripe webhook hasn't been set up yet (or failed), the booking
          // might be paid but not yet pushed to Smoobu. We fix that here.
          if (
            bookingType === 'instant' &&
            l?.smoobu_id &&
            !data.smoobu_reservation_id &&
            data.payment_status === 'paid'
          ) {
            try {
              const supabase = await createSupabaseServerClient()
              const { data: { user } } = await supabase.auth.getUser()
              if (user) {
                const { data: guestProfile } = await supabaseAdmin
                  .from('profiles')
                  .select('guest_first_name, guest_last_name, display_name')
                  .eq('id', user.id)
                  .maybeSingle()
                const fullName = (guestProfile?.display_name ?? 'Gast').split(' ')
                const smoobuId = await createReservation({
                  smoobuApartmentId: parseInt(l.smoobu_id),
                  arrivalDate: data.check_in as string,
                  departureDate: data.check_out as string,
                  firstName: guestProfile?.guest_first_name ?? fullName[0] ?? 'Gast',
                  lastName: (guestProfile?.guest_last_name ?? fullName.slice(1).join(' ')) || '-',
                  email: user.email ?? '',
                  adults: (data.adults as number) ?? 1,
                  children: (data.children as number) ?? 0,
                  price: data.total_price as number,
                  notice: 'Sofortbuchung über TRIMOSA',
                })
                await supabaseAdmin
                  .from('bookings')
                  .update({ smoobu_reservation_id: smoobuId })
                  .eq('id', bookingId)
              }
            } catch (err) {
              console.error('[SuccessPage] Smoobu fallback failed:', err)
            }
          }

          // ─── Also ensure booking is confirmed if webhook missed it ────
          if (bookingType === 'instant' && data.status !== 'confirmed' && data.payment_status === 'paid') {
            await supabaseAdmin
              .from('bookings')
              .update({ status: 'confirmed' })
              .eq('id', bookingId)
          }

          // ─── Find the conversation for the chat deep-link ─────────────
          const { data: conv } = await supabaseAdmin
            .from('conversations')
            .select('id')
            .eq('booking_id', bookingId)
            .maybeSingle()
          if (conv) conversationId = conv.id
        }
      }
    } catch (err) {
      console.error('[SuccessPage] error:', err)
    }
  }

  const chatHref = conversationId ? `/guest/chat?conv=${conversationId}` : '/guest/chat'

  return (
    <main style={{ minHeight: '100vh', backgroundColor: '#F5F5F7', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: '#fff', borderRadius: '24px', padding: '48px 40px', maxWidth: '480px', width: '100%', textAlign: 'center', boxShadow: '0 8px 40px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>
          {booking?.booking_type === 'instant' ? '🎉' : '✅'}
        </div>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111', margin: '0 0 8px' }}>
          {booking?.booking_type === 'instant' ? 'Buchung bestätigt!' : 'Anfrage gesendet!'}
        </h1>
        <p style={{ fontSize: '14px', color: '#888', margin: '0 0 24px', lineHeight: 1.6 }}>
          {booking?.booking_type === 'instant'
            ? 'Deine Zahlung wurde erfolgreich verarbeitet. Der Gastgeber freut sich auf deinen Aufenthalt!'
            : 'Zahlung erfolgreich. Sobald der Gastgeber deine Anfrage bestätigt, erhältst du eine Nachricht im Chat.'}
        </p>

        {listing && booking && (
          <div style={{ background: '#F9F7F3', borderRadius: '16px', padding: '16px 20px', marginBottom: '24px', textAlign: 'left' }}>
            <p style={{ fontWeight: 700, fontSize: '14px', color: '#111', margin: '0 0 4px' }}>{listing.title}</p>
            <p style={{ fontSize: '12px', color: '#888', margin: '0 0 8px' }}>📍 {listing.location}</p>
            <p style={{ fontSize: '12px', color: '#555', margin: 0 }}>
              {booking.check_in as string} – {booking.check_out as string} · €{booking.total_price as number}
            </p>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <Link href={chatHref} style={{ display: 'block', padding: '13px', borderRadius: '14px', background: 'linear-gradient(135deg, #C4A235, #8A6818)', color: '#fff', fontWeight: 700, fontSize: '14px', textDecoration: 'none' }}>
            💬 Zum Chat
          </Link>
          <Link href="/guest" style={{ display: 'block', padding: '13px', borderRadius: '14px', border: '1px solid #E0DDD6', color: '#555', fontWeight: 600, fontSize: '14px', textDecoration: 'none' }}>
            Meine Reisen
          </Link>
          <Link href="/" style={{ display: 'block', padding: '13px', borderRadius: '14px', color: '#AAA', fontWeight: 500, fontSize: '13px', textDecoration: 'none' }}>
            Zurück zur Startseite
          </Link>
        </div>
      </div>
    </main>
  )
}
