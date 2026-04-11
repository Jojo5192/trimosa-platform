import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { redirect } from 'next/navigation'
import NavBar from '@/components/NavBar'
import DashboardNav from '@/components/DashboardNav'
import InvoiceDownload from './InvoiceDownload'

export default async function InvoicesPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: listings } = await supabaseAdmin
    .from('listings').select('id').eq('host_id', user.id)

  const listingIds = listings?.map(l => l.id) ?? []

  const { data: bookings } = listingIds.length > 0
    ? await supabaseAdmin
        .from('bookings')
        .select('id, check_in, check_out, total_price, status, listing_id, listings(title)')
        .in('listing_id', listingIds)
        .in('status', ['confirmed', 'completed'])
        .order('check_in', { ascending: false })
    : { data: [] }

  type BookingRow = { id: string; check_in: string; check_out: string; total_price: number; guests: number; listings: unknown }
  const typedBookings = (bookings ?? []) as unknown as BookingRow[]

  // Group by month (based on check_in)
  const byMonth: Record<string, {
    bookings: BookingRow[]
    totalRevenue: number
    commission: number
    payout: number
  }> = {}

  for (const b of typedBookings) {
    const month = (b.check_in as string).slice(0, 7)
    if (!byMonth[month]) byMonth[month] = { bookings: [], totalRevenue: 0, commission: 0, payout: 0 }
    byMonth[month].bookings!.push(b)
    byMonth[month].totalRevenue += b.total_price ?? 0
    byMonth[month].commission  += (b.total_price ?? 0) * 0.1
    byMonth[month].payout      += (b.total_price ?? 0) * 0.9
  }

  const months = Object.entries(byMonth).sort(([a], [b]) => b.localeCompare(a))

  function fmt(n: number) {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n)
  }

  const monthLabel: Record<string, string> = {
    '01': 'Januar', '02': 'Februar', '03': 'März', '04': 'April',
    '05': 'Mai', '06': 'Juni', '07': 'Juli', '08': 'August',
    '09': 'September', '10': 'Oktober', '11': 'November', '12': 'Dezember',
  }

  return (
    <main style={{ minHeight: '100vh', backgroundColor: '#F5F5F7' }}>
      <NavBar />
      <DashboardNav />

      <div style={{ maxWidth: '860px', margin: '0 auto', padding: '32px 20px 80px' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#A8882A', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 4px' }}>
          Finanzen
        </p>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111', margin: '0 0 8px' }}>Provisionsrechnungen</h1>
        <p style={{ fontSize: '13px', color: '#888', margin: '0 0 28px' }}>
          Monatliche Übersichten deiner Buchungen und Provisionen (10% zzgl. 7% MwSt.). Rechnungen werden am Monatsende automatisch generiert.
        </p>

        {months.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', background: '#fff', borderRadius: '20px', border: '2px dashed #E5E5EA' }}>
            <p style={{ fontSize: '14px', color: '#AAA' }}>Noch keine abgerechneten Buchungen vorhanden.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {months.map(([month, data]) => {
              const mm = month.slice(5, 7)
              const yyyy = month.slice(0, 4)
              const label = `${monthLabel[mm]} ${yyyy}`
              const vatAmount = data.commission * 0.07
              const commissionWithVat = data.commission * 1.07
              return (
                <div key={month} style={{ background: '#fff', borderRadius: '16px', padding: '20px 24px', border: '1px solid #E8E6E0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                    <div>
                      <p style={{ fontSize: '15px', fontWeight: 700, color: '#111', margin: 0 }}>{label}</p>
                      <p style={{ fontSize: '12px', color: '#888', margin: '2px 0 0' }}>
                        {data.bookings!.length} Buchung{data.bookings!.length !== 1 ? 'en' : ''}
                      </p>
                    </div>
                    <InvoiceDownload month={month} monthLabel={label} />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', paddingTop: '14px', borderTop: '1px solid #F0EDE8' }}>
                    {[
                      { label: 'Buchungsumsatz', value: fmt(data.totalRevenue), color: '#111' },
                      { label: `Provision (10% + 7% MwSt.)`, value: fmt(commissionWithVat), color: '#A8882A' },
                      { label: 'Deine Auszahlung', value: fmt(data.payout), color: '#16A34A' },
                    ].map(item => (
                      <div key={item.label}>
                        <p style={{ fontSize: '11px', color: '#888', margin: '0 0 2px', fontWeight: 600 }}>{item.label}</p>
                        <p style={{ fontSize: '15px', fontWeight: 700, color: item.color, margin: 0 }}>{item.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Booking list */}
                  <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {data.bookings!.map((b) => {
                      const listing = b.listings as unknown as { title: string } | null
                      return (
                        <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#666', padding: '4px 0' }}>
                          <span>{listing?.title ?? '—'} · {b.check_in} – {b.check_out}</span>
                          <span style={{ fontWeight: 600 }}>{fmt(b.total_price ?? 0)}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
