import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { t, MONTHS_SHORT, type UiLang } from '@/lib/i18n'
import { getUiLang } from '@/lib/i18n-server'

function formatDate(iso: string, lang: UiLang = 'de') {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const months = lang === 'de' ? ['Jan.','Feb.','Mär.','Apr.','Mai','Jun.','Jul.','Aug.','Sep.','Okt.','Nov.','Dez.'] : MONTHS_SHORT[lang]
  return lang === 'en' ? `${months[m - 1]} ${d}, ${y}` : `${d}. ${months[m - 1]} ${y}`
}

function tripStatus(checkIn: string, checkOut: string): 'upcoming' | 'current' | 'past' {
  const today = new Date().toISOString().split('T')[0]
  if (checkOut < today) return 'past'
  if (checkIn <= today) return 'current'
  return 'upcoming'
}

export default async function GuestPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const lang = await getUiLang()
  if (user.user_metadata?.role === 'host') redirect('/dashboard')

  const { data: bookings } = await supabase
    .from('bookings')
    .select('*, listings(title, location, images)')
    .eq('guest_id', user.id)
    .order('check_in', { ascending: false })

  const upcoming = (bookings ?? []).filter(b => tripStatus(b.check_in, b.check_out) === 'upcoming')
  const current  = (bookings ?? []).filter(b => tripStatus(b.check_in, b.check_out) === 'current')
  const past     = (bookings ?? []).filter(b => tripStatus(b.check_in, b.check_out) === 'past')

  const statusBadge = (status: string) => {
    if (status === 'confirmed')  return { label: t(lang, 'Bestätigt'),    bg: '#DCFCE7', color: '#16A34A' }
    if (status === 'pending')    return { label: t(lang, 'Anfrage'),      bg: '#FEF9EC', color: '#92400E' }
    if (status === 'cancelled')  return { label: t(lang, 'Storniert'),    bg: '#FEE2E2', color: '#DC2626' }
    if (status === 'completed')  return { label: t(lang, 'Abgeschlossen'),bg: '#F0F0F5', color: '#555' }
    return { label: status, bg: '#F5F5F7', color: '#888' }
  }

  function TripCard({ booking }: { booking: Record<string, unknown> }) {
    const listing = booking.listings as { title: string; location: string; images?: string[] } | null
    const badge = statusBadge(booking.status as string)
    const firstImage = listing?.images?.[0]
    return (
      <Link href={`/guest/booking/${booking.id as string}`} style={{ textDecoration: 'none', background: '#fff', borderRadius: '20px', overflow: 'hidden', border: '1px solid #E5E5EA', boxShadow: '0 1px 6px rgba(0,0,0,0.04)', display: 'flex', gap: 0, transition: 'box-shadow 0.15s' }}>
        {firstImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={firstImage} alt="" style={{ width: '120px', objectFit: 'cover', flexShrink: 0 }} />
        ) : (
          <div style={{ width: '120px', flexShrink: 0, background: 'linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px' }}>🏠</div>
        )}
        <div style={{ flex: 1, padding: '16px 20px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
            <p style={{ fontWeight: 700, fontSize: '14px', color: '#111', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {listing?.title ?? t(lang, 'Unterkunft')}
            </p>
            <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '999px', backgroundColor: badge.bg, color: badge.color, flexShrink: 0 }}>
              {badge.label}
            </span>
          </div>
          <p style={{ fontSize: '12px', color: '#888', margin: '0 0 8px' }}>📍 {listing?.location}</p>
          <p style={{ fontSize: '12px', color: '#555', margin: 0 }}>
            {formatDate(booking.check_in as string, lang)} – {formatDate(booking.check_out as string, lang)}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '10px' }}>
            <span style={{ fontSize: '11px', color: 'var(--gold)', fontWeight: 600 }}>
              {t(lang, 'Details & Stornierung')} →
            </span>
            {tripStatus(booking.check_in as string, booking.check_out as string) === 'past' && (booking.status === 'confirmed' || booking.status === 'completed') && (
              <span
                onClick={(e) => {
                  e.preventDefault()
                  window.location.href = `/listing/${booking.listing_id as string}?review=true#reviews-section`
                }}
                style={{ fontSize: '11px', color: '#16A34A', fontWeight: 600, cursor: 'pointer' }}
              >
                ⭐ Bewerten
              </span>
            )}
          </div>
        </div>
      </Link>
    )
  }

  const Section = ({ title, items, emptyText }: { title: string; items: Record<string, unknown>[]; emptyText: string }) => (
    items.length > 0 ? (
      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#111', margin: '0 0 12px' }}>{title}</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {items.map(b => <TripCard key={b.id as string} booking={b} />)}
        </div>
      </section>
    ) : (
      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#111', margin: '0 0 12px' }}>{title}</h2>
        <div style={{ background: '#fff', borderRadius: '16px', padding: '28px', textAlign: 'center', border: '2px dashed #E5E5EA' }}>
          <p style={{ fontSize: '13px', color: '#AAA', margin: 0 }}>{emptyText}</p>
        </div>
      </section>
    )
  )

  return (
    <div style={{ maxWidth: '700px', margin: '0 auto', padding: '32px 20px 80px' }}>
      {/* Header */}
      <div style={{ marginBottom: '28px' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 6px' }}>{t(lang, 'Mein Bereich')}</p>
        <h1 style={{ fontSize: '26px', fontWeight: 700, color: '#111', margin: 0 }}>
          {t(lang, 'Hallo')}, {user.user_metadata?.name?.split(' ')[0] || '👋'}! 👋
        </h1>
        <p style={{ fontSize: '13px', color: '#888', margin: '4px 0 0' }}>{t(lang, 'Hier findest du alle deine Reisen.')}</p>
      </div>

      {/* Quick stats */}
      {bookings && bookings.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '28px' }}>
          {[
            { value: upcoming.length,  label: t(lang, 'Bevorstehend'),   accent: 'var(--gold)', bg: '#FAF5E4' },
            { value: current.length,   label: t(lang, 'Aktuelle Reise'), accent: '#16A34A', bg: '#F0FDF4' },
            { value: past.length,      label: t(lang, 'Vergangen'),      accent: '#6E6E73', bg: '#F9F9F9' },
          ].map(s => (
            <div key={s.label} style={{ borderRadius: '16px', padding: '16px', backgroundColor: s.bg, border: '1px solid #E5E5EA' }}>
              <p style={{ fontSize: '22px', fontWeight: 700, color: s.accent, margin: 0 }}>{s.value}</p>
              <p style={{ fontSize: '11px', color: '#888', margin: '2px 0 0' }}>{s.label}</p>
            </div>
          ))}
        </div>
      )}

      <Section title={t(lang, 'Aktuelle Reise')} items={current} emptyText={t(lang, 'Keine laufende Reise.')} />
      <Section title={t(lang, 'Bevorstehende Reisen')} items={upcoming} emptyText={t(lang, 'Noch keine Buchungen. Entdecke tolle Unterkünfte!')} />
      <Section title={t(lang, 'Vergangene Reisen')} items={past} emptyText={t(lang, 'Noch keine Reisen.')} />

      {bookings?.length === 0 && (
        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <Link href="/"
            style={{ display: 'inline-block', padding: '14px 32px', borderRadius: '999px', background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))', color: '#fff', fontWeight: 700, fontSize: '14px', textDecoration: 'none', boxShadow: '0 4px 20px rgba(168,136,42,0.3)' }}>
            {t(lang, 'Unterkunft suchen →')}
          </Link>
        </div>
      )}
    </div>
  )
}
