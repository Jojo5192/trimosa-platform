'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { t, isUiLang, UI_COOKIE, MONTHS_SHORT, type UiLang } from '@/lib/i18n'

interface Listing {
  id: string
  title: string
  location: string
  images?: string[]
  cancellation_policy: string
  cancel_free_days?: number | null
  cancel_free_percent?: number | null
  cancel_partial_days?: number | null
  cancel_partial_percent?: number | null
}

interface Booking {
  id: string
  listing_id: string
  check_in: string
  check_out: string
  adults: number
  children: number
  total_price: number
  status: string
  payment_status: string
  booking_type: string
  created_at: string
  listings: Listing | null
}

const POLICY_TEMPLATES: Record<string, { freeDays: number; freePercent: number; partialDays: number | null; partialPercent: number | null }> = {
  flexibel: { freeDays: 1, freePercent: 100, partialDays: null, partialPercent: null },
  moderat:  { freeDays: 5, freePercent: 100, partialDays: null, partialPercent: null },
  strikt:   { freeDays: 14, freePercent: 50, partialDays: null, partialPercent: null },
}

function buildPolicyText(listing: Listing | null, lang: UiLang = 'de'): string {
  if (!listing) return t(lang, 'Stornierungsbedingungen des Gastgebers gelten.')
  const template = POLICY_TEMPLATES[listing.cancellation_policy] ?? POLICY_TEMPLATES.moderat
  const fd = listing.cancel_free_days ?? template.freeDays
  const fp = listing.cancel_free_percent ?? template.freePercent
  const pd = listing.cancel_partial_days ?? template.partialDays
  const pp = listing.cancel_partial_percent ?? template.partialPercent
  const parts: string[] = []
  if (fp === 100) {
    parts.push(t(lang, 'Kostenlose Stornierung bis {n} {d} vor Check-in.', { n: fd, d: fd === 1 ? t(lang, 'Tag') : t(lang, 'Tage') }))
  } else if (fp > 0) {
    parts.push(t(lang, '{p} % Erstattung bis {n} {d} vor Check-in.', { p: fp, n: fd, d: fd === 1 ? t(lang, 'Tag') : t(lang, 'Tage') }))
  }
  if (pd != null && pp != null && pp > 0) {
    parts.push(t(lang, '{p} % Erstattung bis {n} {d} vor Check-in.', { p: pp, n: pd, d: pd === 1 ? t(lang, 'Tag') : t(lang, 'Tage') }))
  }
  parts.push(t(lang, 'Danach keine Erstattung.'))
  return parts.join(' ')
}

function formatDate(iso: string, lang: UiLang = 'de') {
  if (!iso) if (lang === 'en') return `${months[m - 1]} ${d}, ${y}`
  return ''
  const [y, m, d] = iso.split('-').map(Number)
  const months = lang === 'de' ? ['Jan.','Feb.','Mär.','Apr.','Mai','Jun.','Jul.','Aug.','Sep.','Okt.','Nov.','Dez.'] : MONTHS_SHORT[lang]
  return `${d}. ${months[m - 1]} ${y}`
}

function calcNights(checkIn: string, checkOut: string) {
  return Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000)
}

function canCancel(status: string, paymentStatus: string) {
  return status !== 'cancelled' && (paymentStatus === 'paid' || paymentStatus === 'pending')
}

export default function BookingDetailClient({
  booking,
  conversationId,
  userId: _userId,
}: {
  booking: Booking
  conversationId: string | null
  userId: string
}) {
  const [uiLang, setUiLang] = useState<UiLang>('de')
  useEffect(() => {
    const m = document.cookie.match(new RegExp('(?:^|; )' + UI_COOKIE + '=([a-z]{2})'))
    if (m && isUiLang(m[1])) setUiLang(m[1])
  }, [])
  const router = useRouter()
  const listing = booking.listings
  const nights = calcNights(booking.check_in, booking.check_out)
  const policy = listing?.cancellation_policy ?? 'moderat'

  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const [refundedAmount, setRefundedAmount] = useState<number | null>(null)

  const statusMap: Record<string, { label: string; color: string; bg: string }> = {
    confirmed:  { label: t(uiLang, 'Bestätigt'),     color: '#16A34A', bg: '#DCFCE7' },
    pending:    { label: t(uiLang, 'Ausstehend'),    color: '#92400E', bg: '#FEF9EC' },
    cancelled:  { label: t(uiLang, 'Storniert'),     color: '#DC2626', bg: '#FEE2E2' },
    completed:  { label: t(uiLang, 'Abgeschlossen'), color: '#555',    bg: '#F0F0F5' },
  }
  const badge = statusMap[cancelled ? 'cancelled' : booking.status] ?? { label: booking.status, color: '#888', bg: '#F5F5F7' }

  async function handleCancel() {
    setCancelling(true)
    setCancelError('')
    try {
      const res = await fetch('/api/payments/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCancelError(data.error ?? 'Stornierung fehlgeschlagen. Bitte versuche es erneut.')
        setCancelling(false)
        return
      }
      setCancelled(true)
      setRefundedAmount(data.refunded ?? 0)
      setShowConfirm(false)
    } catch {
      setCancelError('Netzwerkfehler. Bitte versuche es erneut.')
    }
    setCancelling(false)
  }

  const chatHref = conversationId ? `/guest/chat?conv=${conversationId}` : '/guest/chat'
  const coverImage = listing?.images?.[0]

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto', padding: '32px 20px 80px' }}>

      {/* Back */}
      <Link href="/guest" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#888', textDecoration: 'none', marginBottom: '20px' }}>
        ← {t(uiLang, 'Meine Reisen')}
      </Link>

      {/* Cover */}
      {coverImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverImage} alt="" style={{ width: '100%', height: '200px', objectFit: 'cover', borderRadius: '20px', marginBottom: '20px' }} />
      ) : (
        <div style={{ width: '100%', height: '140px', borderRadius: '20px', background: 'linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '40px', marginBottom: '20px' }}>🏠</div>
      )}

      {/* Title + status */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '6px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#111', margin: 0 }}>
          {listing?.title ?? 'Unterkunft'}
        </h1>
        <span style={{ fontSize: '12px', fontWeight: 700, padding: '4px 12px', borderRadius: '999px', backgroundColor: badge.bg, color: badge.color, flexShrink: 0, marginTop: '4px' }}>
          {badge.label}
        </span>
      </div>
      <p style={{ fontSize: '13px', color: '#888', margin: '0 0 24px' }}>📍 {listing?.location}</p>

      {/* Details card */}
      <div style={{ background: '#fff', borderRadius: '20px', border: '1px solid #E5E5EA', padding: '20px 24px', marginBottom: '16px' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 16px' }}>{t(uiLang, 'Buchungsdetails')}</p>

        {[
          { label: 'Check-in',    value: formatDate(booking.check_in, uiLang) },
          { label: 'Check-out',   value: formatDate(booking.check_out, uiLang) },
          { label: t(uiLang, 'Nächte'), value: String(nights) },
          { label: t(uiLang, 'Gäste'), value: `${booking.adults} ${t(uiLang, 'Erwachsene')}${booking.children ? `, ${booking.children} ${t(uiLang, 'Kinder')}` : ''}` },
          { label: t(uiLang, 'Buchungsart'), value: booking.booking_type === 'instant' ? `⚡ ${t(uiLang, 'Sofortbuchung')}` : `✉ ${t(uiLang, 'Anfrage')}` },
          { label: t(uiLang, 'Zahlung'), value: booking.payment_status === 'paid' ? `✓ ${t(uiLang, 'Bezahlt')}` : booking.payment_status === 'pending' ? t(uiLang, 'Ausstehend') : booking.payment_status },
          { label: t(uiLang, 'Gesamtpreis'), value: `€ ${booking.total_price}`, bold: true },
        ].map(row => (
          <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #F5F5F7' }}>
            <span style={{ fontSize: '13px', color: '#888' }}>{row.label}</span>
            <span style={{ fontSize: '13px', fontWeight: row.bold ? 700 : 500, color: '#111' }}>{row.value}</span>
          </div>
        ))}
      </div>

      {/* Cancellation policy info */}
      {!cancelled && booking.status !== 'cancelled' && (
        <div style={{ background: '#FFF9EC', borderRadius: '16px', border: '1px solid #F0E5C0', padding: '14px 18px', marginBottom: '16px' }}>
          <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>{t(uiLang, 'Stornierungsbedingungen')}</p>
          <p style={{ fontSize: '12px', color: 'var(--gold-dark)', margin: 0, lineHeight: 1.6 }}>
            🛡 {buildPolicyText(listing, uiLang)}
          </p>
        </div>
      )}

      {/* Cancelled success message */}
      {cancelled && (
        <div style={{ background: '#F0FDF4', borderRadius: '16px', border: '1px solid #BBF7D0', padding: '16px 20px', marginBottom: '16px', textAlign: 'center' }}>
          <p style={{ fontSize: '15px', fontWeight: 700, color: '#16A34A', margin: '0 0 4px' }}>{t(uiLang, 'Buchung storniert')}</p>
          <p style={{ fontSize: '13px', color: '#22C55E', margin: 0 }}>
            {refundedAmount && refundedAmount > 0
              ? t(uiLang, 'Rückerstattung von €{a} wurde veranlasst und erscheint in 5–10 Werktagen.', { a: refundedAmount.toFixed(2) })
              : t(uiLang, 'Gemäß den Stornierungsbedingungen erfolgt keine Rückerstattung.')}
          </p>
        </div>
      )}

      {/* Error */}
      {cancelError && (
        <p style={{ fontSize: '13px', color: '#DC2626', marginBottom: '12px', padding: '10px 14px', background: '#FEF2F2', borderRadius: '10px', border: '1px solid #FECACA' }}>
          {cancelError}
        </p>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <Link href={chatHref}
          style={{ display: 'block', padding: '14px', borderRadius: '14px', background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))', color: '#fff', fontWeight: 700, fontSize: '14px', textDecoration: 'none', textAlign: 'center' }}>
          💬 {t(uiLang, 'Zum Chat')}
        </Link>

        <Link href={`/listing/${booking.listing_id}`}
          style={{ display: 'block', padding: '14px', borderRadius: '14px', border: '1px solid #E0DDD6', color: '#555', fontWeight: 600, fontSize: '14px', textDecoration: 'none', textAlign: 'center' }}>
          {t(uiLang, 'Inserat ansehen ↗')}
        </Link>

        {canCancel(cancelled ? 'cancelled' : booking.status, booking.payment_status) && (
          <>
            {!showConfirm ? (
              <button
                onClick={() => setShowConfirm(true)}
                style={{ display: 'block', width: '100%', padding: '14px', borderRadius: '14px', border: '1.5px solid #FECACA', background: '#FFF', color: '#DC2626', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
                {t(uiLang, 'Buchung stornieren')}
              </button>
            ) : (
              <div style={{ background: '#FEF2F2', borderRadius: '16px', border: '1.5px solid #FECACA', padding: '18px 20px' }}>
                <p style={{ fontSize: '14px', fontWeight: 700, color: '#DC2626', margin: '0 0 8px' }}>{t(uiLang, 'Buchung wirklich stornieren?')}</p>
                <p style={{ fontSize: '12px', color: '#EF4444', margin: '0 0 14px', lineHeight: 1.6 }}>
                  {buildPolicyText(listing, uiLang)}
                </p>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    onClick={() => setShowConfirm(false)}
                    disabled={cancelling}
                    style={{ flex: 1, padding: '11px', borderRadius: '12px', border: '1px solid #E0DDD6', background: '#fff', color: '#555', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>
                    {t(uiLang, 'Abbrechen')}
                  </button>
                  <button
                    onClick={handleCancel}
                    disabled={cancelling}
                    style={{ flex: 1, padding: '11px', borderRadius: '12px', border: 'none', background: '#DC2626', color: '#fff', fontWeight: 700, fontSize: '13px', cursor: cancelling ? 'not-allowed' : 'pointer' }}>
                    {cancelling ? t(uiLang, 'Wird storniert…') : t(uiLang, 'Ja, stornieren')}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

    </div>
  )
}
