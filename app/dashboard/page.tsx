import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import NavBar from '@/components/NavBar'
import DashboardNav from '@/components/DashboardNav'
import BookingActions from './BookingActions'
import SmoobuConnect from './SmoobuConnect'
import BookingSettings from './BookingSettings'

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const isHost = user.user_metadata?.role === 'host'

  const { data: profile } = await supabase
    .from('profiles')
    .select('allow_instant_booking, allow_requests, min_request_nights, smoobu_api_key, smoobu_channel_id, markup_pct')
    .eq('id', user.id)
    .maybeSingle()

  const smoobuApiKey = (profile as Record<string, unknown> | null)?.smoobu_api_key as string | null
  const smoobuChannelId = (profile as Record<string, unknown> | null)?.smoobu_channel_id as number | null

  const { data: listings } = await supabase
    .from('listings')
    .select('*')
    .eq('host_id', user.id)
    .order('created_at', { ascending: false })

  const listingIds = listings?.map((l) => l.id) ?? []
  const { data: bookings } = listingIds.length > 0
    ? await supabase
        .from('bookings')
        .select('*, listings(title, location)')
        .in('listing_id', listingIds)
        .order('created_at', { ascending: false })
    : { data: [] }

  // Direct TRIMOSA bookings (source === 'trimosa') are only worth showing
  // once actually paid — otherwise an abandoned/expired Stripe Checkout
  // would show up as a real request or confirmed stay. External bookings
  // synced from Smoobu (other channels) never carry payment_status at all,
  // so they're always shown.
  const isPaidOrExternal = (b: { source: string | null; payment_status: string | null }) =>
    b.source !== 'trimosa' || b.payment_status === 'paid'
  const pendingBookings = bookings?.filter((b) => b.status === 'pending' && isPaidOrExternal(b)) ?? []
  const confirmedBookings = bookings?.filter((b) => b.status === 'confirmed' && isPaidOrExternal(b)) ?? []

  return (
    <main className="min-h-screen" style={{ backgroundColor: '#F5F5F7' }}>
      <NavBar />
      <DashboardNav />

      <div className="max-w-5xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--gold)' }}>
              Gastgeber-Dashboard
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" style={{ color: '#1D1D1F' }}>
              Hallo, {user.user_metadata?.name || user.email?.split('@')[0]}!
            </h1>
          </div>
          <Link
            href="/dashboard/new-listing"
            className="text-sm font-semibold text-white px-5 py-2.5 rounded-full hover:opacity-90 transition-all shadow-sm"
            style={{ background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))' }}
          >
            + Neues Inserat
          </Link>
        </div>

        {/* Setup Banner */}
        <Link href="/dashboard/setup"
          className="flex items-center justify-between mb-6 rounded-2xl px-6 py-4 hover:opacity-90 transition-all shadow-sm"
          style={{ background: 'linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%)', textDecoration: 'none' }}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-0.5" style={{ color: 'rgba(255,255,255,0.75)' }}>
              Neu hier?
            </p>
            <p className="text-base font-bold" style={{ color: '#fff' }}>
              Schritt-für-Schritt Einrichtung →
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.75)' }}>
              Smoobu verbinden · Preise · Abrechnungsdaten
            </p>
          </div>
          <div style={{ fontSize: '2rem' }}>🏠</div>
        </Link>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { value: listings?.length ?? 0, label: 'Inserate', accent: '#1D1D1F', bg: '#fff' },
            { value: pendingBookings.length,  label: 'Offene Anfragen', accent: 'var(--gold)', bg: '#FAF5E4' },
            { value: confirmedBookings.length, label: 'Bestätigt', accent: '#16A34A', bg: '#F0FDF4' },
          ].map((stat) => (
            <div key={stat.label} className="rounded-2xl p-5 shadow-sm" style={{ backgroundColor: stat.bg, border: '1px solid #E5E5EA' }}>
              <p className="text-2xl font-bold" style={{ color: stat.accent }}>{stat.value}</p>
              <p className="text-xs mt-1" style={{ color: '#6E6E73' }}>{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Offene Buchungsanfragen */}
        {pendingBookings.length > 0 && (
          <section className="mb-8">
            <h2 className="text-base font-bold tracking-tight mb-3" style={{ color: '#1D1D1F' }}>Offene Anfragen</h2>
            <div className="space-y-2">
              {pendingBookings.map((booking) => (
                <div key={booking.id} className="bg-white rounded-xl p-4 flex items-center justify-between gap-4 shadow-sm"
                  style={{ border: '1px solid #E8D9A0' }}>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate" style={{ color: '#1D1D1F' }}>
                      {(booking.listings as { title: string })?.title}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: '#6E6E73' }}>
                      {booking.check_in} → {booking.check_out} · € {booking.total_price}
                    </p>
                  </div>
                  <BookingActions bookingId={booking.id} />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Bestätigte Buchungen */}
        {confirmedBookings.length > 0 && (
          <section className="mb-8">
            <h2 className="text-base font-bold tracking-tight mb-3" style={{ color: '#1D1D1F' }}>Bestätigte Buchungen</h2>
            <div className="space-y-2">
              {confirmedBookings.map((booking) => (
                <div key={booking.id} className="bg-white rounded-xl p-4 shadow-sm"
                  style={{ border: '1px solid #D1FAE5' }}>
                  <p className="font-semibold text-sm" style={{ color: '#1D1D1F' }}>
                    {(booking.listings as { title: string })?.title}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: '#6E6E73' }}>
                    {booking.check_in} → {booking.check_out} · € {booking.total_price}
                  </p>
                  <span className="inline-block mt-2 text-xs font-medium px-2.5 py-0.5 rounded-full"
                    style={{ backgroundColor: '#DCFCE7', color: '#16A34A' }}>
                    Bestätigt
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Booking Settings */}
        <section className="mb-8">
          <h2 className="text-base font-bold tracking-tight mb-3" style={{ color: '#1D1D1F' }}>Buchungseinstellungen</h2>
          <BookingSettings
            allowInstant={profile?.allow_instant_booking ?? true}
            allowRequests={profile?.allow_requests ?? true}
            minRequestNights={profile?.min_request_nights ?? 1}
          />
        </section>

        {/* Smoobu */}
        <section className="mb-8">
          <h2 className="text-base font-bold tracking-tight mb-3" style={{ color: '#1D1D1F' }}>Smoobu Integration</h2>
          <SmoobuConnect
            currentApiKey={smoobuApiKey}
            currentChannelId={smoobuChannelId}
            currentMarkup={profile?.markup_pct ?? 0}
          />
        </section>

        {/* Meine Inserate */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold tracking-tight" style={{ color: '#1D1D1F' }}>Meine Inserate</h2>
            <Link href="/dashboard/profile" className="text-xs font-semibold px-3 py-1.5 rounded-full"
              style={{ backgroundColor: '#F5F3EF', color: 'var(--gold)', textDecoration: 'none', border: '1px solid #E8E0D0' }}>
              Gastgeber-Profil bearbeiten →
            </Link>
          </div>
          {listings && listings.length > 0 ? (
            <div className="space-y-2">
              {listings.map((listing) => (
                <div key={listing.id} className="bg-white rounded-xl p-4 shadow-sm"
                  style={{ border: '1px solid #E5E5EA', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="font-semibold text-sm truncate" style={{ color: '#1D1D1F' }}>{listing.title}</p>
                    <p className="text-xs mt-0.5" style={{ color: '#6E6E73' }}>
                      {listing.location} · {listing.max_guests} Gäste · {listing.bedrooms} Schlafzimmer
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs font-medium px-2.5 py-1 rounded-full"
                      style={listing.is_active
                        ? { backgroundColor: '#DCFCE7', color: '#16A34A' }
                        : { backgroundColor: '#FEF9EC', color: '#92400E' }}>
                      {listing.is_active ? 'Aktiv' : 'Entwurf'}
                    </span>
                    <Link href={`/dashboard/listing/${listing.id}`}
                      className="text-xs font-semibold px-3 py-1.5 rounded-full"
                      style={{ backgroundColor: '#111', color: '#fff', textDecoration: 'none' }}>
                      Bearbeiten
                    </Link>
                    <Link href={`/listing/${listing.id}`}
                      className="text-xs font-medium px-3 py-1.5 rounded-full"
                      style={{ backgroundColor: '#F5F3EF', color: '#666', textDecoration: 'none', border: '1px solid #E8E6E0' }}>
                      Ansehen ↗
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-2xl p-10 text-center shadow-sm" style={{ border: '2px dashed #E5E5EA' }}>
              <p className="text-sm mb-4" style={{ color: '#6E6E73' }}>Du hast noch keine Inserate.</p>
              <Link href="/dashboard/new-listing"
                className="text-sm font-semibold text-white px-6 py-2.5 rounded-full hover:opacity-90 transition-all"
                style={{ background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))' }}>
                Erstes Inserat erstellen
              </Link>
            </div>
          )}
        </section>

      </div>
    </main>
  )
}
