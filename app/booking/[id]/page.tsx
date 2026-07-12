import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import NavBar from '@/components/NavBar'
import BookingChat from './BookingChat'

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?redirect=/booking/${id}`)

  const { data: booking } = await supabaseAdmin
    .from('bookings')
    .select('*, listings(id, title, location, price_per_night, host_id)')
    .eq('id', id)
    .single()

  if (!booking) redirect('/')

  const listing = booking.listings as {
    id: string; title: string; location: string; price_per_night: number; host_id: string
  }

  const isHost = listing.host_id === user.id
  const isGuest = booking.guest_id === user.id
  if (!isHost && !isGuest) redirect('/')

  function fmt(iso: string) {
    const [y, m, d] = iso.split('-')
    const months = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez']
    return `${parseInt(d)}. ${months[parseInt(m)-1]} ${y}`
  }

  const statusColors: Record<string, { bg: string; color: string; label: string }> = {
    pending:   { bg: '#FFF7ED', color: '#92400E', label: 'Anfrage eingegangen' },
    confirmed: { bg: '#F0FDF4', color: '#16A34A', label: 'Bestätigt' },
    cancelled: { bg: '#FEF2F2', color: '#DC2626', label: 'Storniert' },
  }
  const statusStyle = statusColors[booking.status] ?? statusColors.pending

  const nights = Math.round((new Date(booking.check_out).getTime() - new Date(booking.check_in).getTime()) / 86400000)

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#ECEEF4' }}>
      <NavBar />

      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '32px 20px 60px' }}>

        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 6px' }}>
            {isHost ? 'Eingehende Buchungsanfrage' : 'Deine Buchungsanfrage'}
          </p>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111', margin: '0 0 8px', letterSpacing: '-0.3px' }}>
            {listing.title}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, padding: '4px 12px', borderRadius: '999px', backgroundColor: statusStyle.bg, color: statusStyle.color }}>
              {statusStyle.label}
            </span>
            <span style={{ fontSize: '12px', color: '#999' }}>{listing.location}</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '20px', alignItems: 'start' }}>

          {/* Chat */}
          <BookingChat bookingId={id} currentUserId={user.id} isHost={isHost} />

          {/* Booking details sidebar */}
          <div style={{ background: '#fff', borderRadius: '20px', padding: '20px', border: '1px solid #E8E6E0' }}>
            <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#111', margin: '0 0 16px' }}>Buchungsdetails</h2>

            {[
              { label: 'Anreise', val: fmt(booking.check_in) },
              { label: 'Abreise', val: fmt(booking.check_out) },
              { label: 'Nächte', val: String(nights) },
              { label: 'Erwachsene', val: String(booking.adults ?? 1) },
              ...(booking.children ? [{ label: 'Kinder', val: String(booking.children) }] : []),
              { label: 'Gesamtpreis', val: `€ ${booking.total_price}` },
            ].map(({ label, val }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #F5F3EF', fontSize: '13px' }}>
                <span style={{ color: '#888' }}>{label}</span>
                <span style={{ fontWeight: 600, color: '#111' }}>{val}</span>
              </div>
            ))}

            {booking.message && (
              <div style={{ marginTop: '14px', padding: '12px', background: '#FAFAF8', borderRadius: '10px', border: '1px solid #EAE8E2' }}>
                <p style={{ fontSize: '10px', fontWeight: 700, color: '#AAA', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>Nachricht des Gastes</p>
                <p style={{ fontSize: '13px', color: '#555', margin: 0, lineHeight: 1.5 }}>{booking.message}</p>
              </div>
            )}

            {booking.smoobu_reservation_id && (
              <p style={{ fontSize: '10px', color: '#BBB', marginTop: '12px' }}>
                Smoobu-ID: {booking.smoobu_reservation_id}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
