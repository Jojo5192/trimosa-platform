import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { redirect } from 'next/navigation'
import NavBar from '@/components/NavBar'
import DashboardNav from '@/components/DashboardNav'

export default async function StatsPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: listings } = await supabaseAdmin
    .from('listings')
    .select('id, title')
    .eq('host_id', user.id)

  const listingIds = listings?.map(l => l.id) ?? []

  const { data: bookings } = listingIds.length > 0
    ? await supabaseAdmin
        .from('bookings')
        .select('id, check_in, check_out, total_price, status, listing_id, guests')
        .in('listing_id', listingIds)
        .neq('status', 'cancelled')
    : { data: [] }

  // Aggregate by month
  const byMonth: Record<string, { revenue: number; bookings: number; nights: number }> = {}
  for (const b of bookings ?? []) {
    const month = (b.check_in as string).slice(0, 7)
    if (!byMonth[month]) byMonth[month] = { revenue: 0, bookings: 0, nights: 0 }
    byMonth[month].revenue += b.total_price ?? 0
    byMonth[month].bookings += 1
    const nights = Math.round(
      (new Date(b.check_out).getTime() - new Date(b.check_in).getTime()) / 86400000
    )
    byMonth[month].nights += nights
  }

  const months = Object.entries(byMonth).sort(([a], [b]) => b.localeCompare(a)).slice(0, 12)

  const totalRevenue = (bookings ?? []).reduce((s, b) => s + (b.total_price ?? 0), 0)
  const totalCommission = totalRevenue * 0.1
  const totalPayout = totalRevenue * 0.9
  const avgBooking = bookings?.length ? totalRevenue / bookings.length : 0

  const maxRevenue = Math.max(...months.map(([, v]) => v.revenue), 1)

  function fmt(n: number) {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n)
  }

  const monthNames: Record<string, string> = {
    '01': 'Jan', '02': 'Feb', '03': 'Mär', '04': 'Apr',
    '05': 'Mai', '06': 'Jun', '07': 'Jul', '08': 'Aug',
    '09': 'Sep', '10': 'Okt', '11': 'Nov', '12': 'Dez',
  }

  return (
    <main style={{ minHeight: '100vh', backgroundColor: '#F5F5F7' }}>
      <NavBar />
      <DashboardNav />

      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '32px 20px 80px' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#A8882A', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 4px' }}>
          Auswertungen
        </p>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111', margin: '0 0 28px' }}>Statistiken</h1>

        {/* KPI Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '32px' }}>
          {[
            { label: 'Gesamtumsatz', value: fmt(totalRevenue), sub: 'alle Buchungen', color: '#1D1D1F' },
            { label: 'Provision (10%)', value: fmt(totalCommission), sub: 'an TRIMOSA', color: '#A8882A' },
            { label: 'Dein Anteil', value: fmt(totalPayout), sub: '90% Auszahlung', color: '#16A34A' },
            { label: 'Ø pro Buchung', value: fmt(avgBooking), sub: `${bookings?.length ?? 0} Buchungen gesamt`, color: '#0369A1' },
          ].map(kpi => (
            <div key={kpi.label} style={{ background: '#fff', borderRadius: '16px', padding: '18px 20px', border: '1px solid #E8E6E0' }}>
              <p style={{ fontSize: '11px', color: '#888', margin: '0 0 6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {kpi.label}
              </p>
              <p style={{ fontSize: '22px', fontWeight: 700, color: kpi.color, margin: '0 0 2px' }}>{kpi.value}</p>
              <p style={{ fontSize: '11px', color: '#AAA', margin: 0 }}>{kpi.sub}</p>
            </div>
          ))}
        </div>

        {/* Bar Chart */}
        <div style={{ background: '#fff', borderRadius: '20px', padding: '24px', border: '1px solid #E8E6E0', marginBottom: '24px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#111', margin: '0 0 20px' }}>Monatlicher Umsatz</h2>
          {months.length === 0 ? (
            <p style={{ color: '#AAA', fontSize: '14px', textAlign: 'center', padding: '30px 0' }}>
              Noch keine Buchungen vorhanden.
            </p>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '160px', padding: '0 4px' }}>
              {months.slice().reverse().map(([month, v]) => {
                const mm = month.slice(5, 7)
                const yy = month.slice(2, 4)
                const h = Math.max(4, (v.revenue / maxRevenue) * 140)
                return (
                  <div key={month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                    <span style={{ fontSize: '10px', color: '#888', fontWeight: 600 }}>
                      {fmt(v.revenue).replace('€\u00a0', '').replace(',00', '')}
                    </span>
                    <div
                      title={`${v.bookings} Buchungen · ${fmt(v.revenue)}`}
                      style={{
                        width: '100%', height: `${h}px`,
                        background: 'linear-gradient(180deg, #C4A235, #8A6818)',
                        borderRadius: '6px 6px 2px 2px',
                        transition: 'height 0.3s',
                        minHeight: '4px',
                      }}
                    />
                    <span style={{ fontSize: '10px', color: '#AAA' }}>{monthNames[mm]}&nbsp;{yy}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Per listing breakdown */}
        {listings && listings.length > 0 && (
          <div style={{ background: '#fff', borderRadius: '20px', padding: '24px', border: '1px solid #E8E6E0' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#111', margin: '0 0 16px' }}>Nach Inserat</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {listings.map(l => {
                const lbs = (bookings ?? []).filter(b => b.listing_id === l.id)
                const rev = lbs.reduce((s, b) => s + (b.total_price ?? 0), 0)
                return (
                  <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: '1px solid #F0EDE8' }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: '13px', fontWeight: 600, color: '#111', margin: 0 }}>{l.title}</p>
                      <p style={{ fontSize: '11px', color: '#888', margin: '2px 0 0' }}>{lbs.length} Buchungen</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: '14px', fontWeight: 700, color: '#16A34A', margin: 0 }}>{fmt(rev)}</p>
                      <p style={{ fontSize: '11px', color: '#AAA', margin: '2px 0 0' }}>Umsatz</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
