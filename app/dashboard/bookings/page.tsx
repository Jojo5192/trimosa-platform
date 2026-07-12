import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import NavBar from '@/components/NavBar'
import DashboardNav from '@/components/DashboardNav'
import BookingDetail from './BookingDetail'

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ listing?: string; status?: string }>
}) {
  const { listing: filterListing, status: filterStatus } = await searchParams

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: listings } = await supabaseAdmin
    .from('listings')
    .select('id, title')
    .eq('host_id', user.id)
    .order('title')

  const listingIds = listings?.map(l => l.id) ?? []

  let query = supabaseAdmin
    .from('bookings')
    .select('*, listings(id, title, location, images)')
    .in('listing_id', listingIds.length > 0 ? listingIds : ['00000000-0000-0000-0000-000000000000'])
    .order('check_in', { ascending: false })

  if (filterListing) query = query.eq('listing_id', filterListing)
  if (filterStatus)  query = query.eq('status', filterStatus)

  const { data: bookings } = await query

  const today = new Date().toISOString().split('T')[0]

  const past    = bookings?.filter(b => b.check_out < today) ?? []
  const current = bookings?.filter(b => b.check_in <= today && b.check_out >= today) ?? []
  const upcoming = bookings?.filter(b => b.check_in > today) ?? []

  const statusLabel: Record<string, string> = {
    pending: 'Anfrage',
    confirmed: 'Bestätigt',
    cancelled: 'Storniert',
    completed: 'Abgeschlossen',
  }
  const statusColor: Record<string, { bg: string; color: string }> = {
    pending:   { bg: '#FFF7E6', color: '#92400E' },
    confirmed: { bg: '#DCFCE7', color: '#16A34A' },
    cancelled: { bg: '#FEE2E2', color: '#DC2626' },
    completed: { bg: '#F0F9FF', color: '#0369A1' },
  }

  function BookingCard({ booking }: { booking: Record<string, unknown> }) {
    const listing = booking.listings as { title: string; location: string; images?: string[] } | null
    const st = booking.status as string
    const sc = statusColor[st] ?? { bg: '#F5F5F5', color: '#666' }
    const nights = Math.round(
      (new Date(booking.check_out as string).getTime() - new Date(booking.check_in as string).getTime())
      / 86400000
    )
    return (
      <div style={{
        background: '#fff', borderRadius: '14px', padding: '16px 18px',
        border: '1px solid #E8E6E0', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        display: 'flex', alignItems: 'flex-start', gap: '14px',
      }}>
        {listing?.images?.[0] && (
          <img src={listing.images[0]} alt="" style={{ width: '64px', height: '48px', objectFit: 'cover', borderRadius: '8px', flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
            <p style={{ fontSize: '13px', fontWeight: 700, color: '#111', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {listing?.title ?? 'Unbekannte Unterkunft'}
            </p>
            <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '99px', ...sc }}>
              {statusLabel[st] ?? st}
            </span>
          </div>
          <p style={{ fontSize: '12px', color: '#666', margin: '0 0 4px' }}>
            {booking.check_in as string} → {booking.check_out as string} · {nights} Nacht{nights !== 1 ? 'e' : ''}
          </p>
          <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>
            {booking.guests as number} Gäste · € {(booking.total_price as number)?.toFixed(2)}
          </p>
        </div>
        <div style={{ flexShrink: 0 }}>
          <BookingDetail bookingId={booking.id as string} />
        </div>
      </div>
    )
  }

  function Section({ title, bookings: bks, empty }: { title: string; bookings: Record<string, unknown>[]; empty: string }) {
    return (
      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#1D1D1F', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {title}
          <span style={{ fontSize: '12px', fontWeight: 500, color: '#999', background: '#F5F5F7', padding: '2px 8px', borderRadius: '99px' }}>
            {bks.length}
          </span>
        </h2>
        {bks.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {bks.map(b => <BookingCard key={b.id as string} booking={b} />)}
          </div>
        ) : (
          <p style={{ fontSize: '13px', color: '#AAA', padding: '16px 0' }}>{empty}</p>
        )}
      </section>
    )
  }

  return (
    <main style={{ minHeight: '100vh', backgroundColor: '#F5F5F7' }}>
      <NavBar />
      <DashboardNav />

      <div style={{ maxWidth: '860px', margin: '0 auto', padding: '32px 20px 80px' }}>

        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 4px' }}>
            Buchungsübersicht
          </p>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111', margin: 0 }}>Alle Buchungen</h1>
        </div>

        {/* Filter bar */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '24px' }}>
          <Link href="/dashboard/bookings" style={{
            fontSize: '12px', fontWeight: 600, padding: '6px 14px', borderRadius: '99px',
            background: !filterListing && !filterStatus ? '#111' : '#fff',
            color: !filterListing && !filterStatus ? '#fff' : '#555',
            border: '1.5px solid #E0DDD6', textDecoration: 'none',
          }}>
            Alle
          </Link>
          {listings?.map(l => (
            <Link key={l.id} href={`/dashboard/bookings?listing=${l.id}`} style={{
              fontSize: '12px', fontWeight: 600, padding: '6px 14px', borderRadius: '99px',
              background: filterListing === l.id ? '#111' : '#fff',
              color: filterListing === l.id ? '#fff' : '#555',
              border: '1.5px solid #E0DDD6', textDecoration: 'none',
              maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {l.title}
            </Link>
          ))}
        </div>

        {listingIds.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#AAA' }}>
            <p style={{ fontSize: '14px' }}>Noch keine Inserate vorhanden.</p>
          </div>
        ) : (
          <>
            <Section title="🟢 Aktuell" bookings={current as Record<string, unknown>[]} empty="Keine aktiven Buchungen." />
            <Section title="📅 Bevorstehend" bookings={upcoming as Record<string, unknown>[]} empty="Keine zukünftigen Buchungen." />
            <Section title="🕐 Vergangen" bookings={past as Record<string, unknown>[]} empty="Noch keine vergangenen Buchungen." />
          </>
        )}
      </div>
    </main>
  )
}
