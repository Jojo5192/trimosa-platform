import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { stripe } from '@/lib/stripe'
import Link from 'next/link'

export default async function BookingSuccessPage({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const params = await searchParams
  const sessionId = params.session_id

  let booking = null
  let listing = null

  if (sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId)
      const bookingId = session.metadata?.bookingId
      if (bookingId) {
        const supabase = await createSupabaseServerClient()
        const { data } = await supabaseAdmin
          .from('bookings')
          .select('*, listings(title, location)')
          .eq('id', bookingId)
          .maybeSingle()
        if (data) {
          booking = data
          listing = data.listings as { title: string; location: string } | null
        }
      }
    } catch {
      // ignore
    }
  }

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
              {booking.check_in} – {booking.check_out} · €{booking.total_price}
            </p>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <Link href="/guest/chat" style={{ display: 'block', padding: '13px', borderRadius: '14px', background: 'linear-gradient(135deg, #C4A235, #8A6818)', color: '#fff', fontWeight: 700, fontSize: '14px', textDecoration: 'none' }}>
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
