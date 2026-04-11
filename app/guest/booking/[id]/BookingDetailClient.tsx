'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Listing {
  id: string
  title: string
  location: string
  images?: string[]
  cancellation_policy: string
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

const POLICY_LABELS: Record<string, string> = {
  flexibel: 'Kostenlose Stornierung bis 24h vor Check-in. Danach keine Erstattung.',
  moderat:  'Kostenlose Stornierung bis 5 Tage vor Check-in. Danach keine Erstattung.',
  strikt:   'Kostenlose Stornierung innerhalb 48h nach Buchung (mind. 14 Tage vor Check-in). Bis 14 Tage vor Check-in 50 % Erstattung. Danach keine Erstattung.',
}

function formatDate(iso: string) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const months = ['Jan.','Feb.','Mär.','Apr.','Mai','Jun.','Jul.','Aug.','Sep.','Okt.','Nov.','Dez.']
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
    confirmed:  { label: 'Bestätigt',     color: '#16A34A', bg: '#DCFCE7' },
    pending:    { label: 'Ausstehend',    color: '#92400E', bg: '#FEF9EC' },
    cancelled:  { label: 'Storniert',     color: '#DC2626', bg: '#FEE2E2' },
    completed:  { label: 'Abgeschlossen', color: '#555',    bg: '#F0F0F5' },
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
        ← Meine Reisen
      </Link>

      {/* Cover */}
      {coverImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverImage} alt="" style={{ width: '100%', height: '200px', objectFit: 'cover', borderRadius: '20px', marginBottom: '20px' }} />
      ) : (
        <div style={{ width: '100%', height: '140px', borderRadius: '20px', background: 'linear-gradient(135deg, #C4A235 0%, #8A6818 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '40px', marginBottom: '20px' }}>🏠</div>
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
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#A8882A', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 16px' }}>Buchungsdetails</p>

        {[
          { label: 'Check-in',    value: formatDate(booking.check_in) },
          { label: 'Check-out',   value: formatDate(booking.check_out) },
          { label: 'Nächte',      value: String(nights) },
          { label: 'Gäste',       value: `${booking.adults} Erwachsene${booking.children ? `, ${booking.children} Kinder` : ''}` },
          { label: 'Buchungsart', value: booking.booking_type === 'instant' ? '⚡ Sofortbuchung' : '✉ Anfrage' },
          { label: 'Zahlung',     value: booking.payment_status === 'paid' ? '✓ Bezahlt' : booking.payment_status === 'pending' ? 'Ausstehend' : booking.payment_status },
          { label: 'Gesamtpreis', value: `€ ${booking.total_price}`, bold: true },
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
          <p style={{ fontSize: '11px', fontWeight: 700, color: '#A8882A', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>Stornierungsbedingungen</p>
          <p style={{ fontSize: '12px', color: '#7A5C1A', margin: 0, lineHeight: 1.6 }}>
            🛡 {POLICY_LABELS[policy] ?? policy}
          </p>
        </div>
      )}

      {/* Cancelled success message */}
      {cancelled && (
        <div style={{ background: '#F0FDF4', borderRadius: '16px', border: '1px solid #BBF7D0', padding: '16px 20px', marginBottom: '16px', textAlign: 'center' }}>
          <p style={{ fontSize: '15px', fontWeight: 700, color: '#16A34A', margin: '0 0 4px' }}>Buchung storniert</p>
          <p style={{ fontSize: '13px', color: '#22C55E', margin: 0 }}>
            {refundedAmount && refundedAmount > 0
              ? `Rückerstattung von €${refundedAmount.toFixed(2)} wurde veranlasst und erscheint in 5–10 Werktagen.`
              : 'Gemäß den Stornierungsbedingungen erfolgt keine Rückerstattung.'}
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
          style={{ display: 'block', padding: '14px', borderRadius: '14px', background: 'linear-gradient(135deg, #C4A235, #8A6818)', color: '#fff', fontWeight: 700, fontSize: '14px', textDecoration: 'none', textAlign: 'center' }}>
          💬 Zum Chat
        </Link>

        <Link href={`/listing/${booking.listing_id}`}
          style={{ display: 'block', padding: '14px', borderRadius: '14px', border: '1px solid #E0DDD6', color: '#555', fontWeight: 600, fontSize: '14px', textDecoration: 'none', textAlign: 'center' }}>
          Inserat ansehen ↗
        </Link>

        {canCancel(cancelled ? 'cancelled' : booking.status, booking.payment_status) && (
          <>
            {!showConfirm ? (
              <button
                onClick={() => setShowConfirm(true)}
                style={{ display: 'block', width: '100%', padding: '14px', borderRadius: '14px', border: '1.5px solid #FECACA', background: '#FFF', color: '#DC2626', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
                Buchung stornieren
              </button>
            ) : (
              <div style={{ background: '#FEF2F2', borderRadius: '16px', border: '1.5px solid #FECACA', padding: '18px 20px' }}>
                <p style={{ fontSize: '14px', fontWeight: 700, color: '#DC2626', margin: '0 0 8px' }}>Buchung wirklich stornieren?</p>
                <p style={{ fontSize: '12px', color: '#EF4444', margin: '0 0 14px', lineHeight: 1.6 }}>
                  {POLICY_LABELS[policy] ?? 'Stornierungsbedingungen des Gastgebers gelten.'}
                </p>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    onClick={() => setShowConfirm(false)}
                    disabled={cancelling}
                    style={{ flex: 1, padding: '11px', borderRadius: '12px', border: '1px solid #E0DDD6', background: '#fff', color: '#555', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>
                    Abbrechen
                  </button>
                  <button
                    onClick={handleCancel}
                    disabled={cancelling}
                    style={{ flex: 1, padding: '11px', borderRadius: '12px', border: 'none', background: '#DC2626', color: '#fff', fontWeight: 700, fontSize: '13px', cursor: cancelling ? 'not-allowed' : 'pointer' }}>
                    {cancelling ? 'Wird storniert…' : 'Ja, stornieren'}
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
