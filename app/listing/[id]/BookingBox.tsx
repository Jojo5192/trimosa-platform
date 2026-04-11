'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseBrowser as supabase } from '@/lib/supabase-browser'
import type { SmoobuRateMap } from '@/lib/smoobu'

interface BookingBoxProps {
  listingId: string
  pricePerNight: number
}

const DE_MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
const DE_DAYS_SHORT = ['Mo','Di','Mi','Do','Fr','Sa','So']

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}
function today(): string { return isoDate(new Date()) }

/* ── Mini calendar ─────────────────────────────────────────── */
function CalendarMonth({
  year, month, rates, checkIn, checkOut, selecting,
  onSelectDate, minDate,
}: {
  year: number; month: number
  rates: SmoobuRateMap
  checkIn: string; checkOut: string; selecting: 'in' | 'out'
  onSelectDate: (iso: string) => void
  minDate: string
}) {
  const firstDow = new Date(year, month, 1).getDay() // 0=Sun
  const leadBlanks = firstDow === 0 ? 6 : firstDow - 1 // convert to Mon-based
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  function cellState(day: number) {
    const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
    const rate = rates[iso]
    const isPast = iso < minDate
    const isUnavailable = !isPast && rate?.available === 0
    const isCheckIn = iso === checkIn
    const isCheckOut = iso === checkOut
    const inRange = checkIn && checkOut && iso > checkIn && iso < checkOut
    return { iso, isPast, isUnavailable, isCheckIn, isCheckOut, inRange, price: rate?.price }
  }

  return (
    <div>
      <p style={{ fontSize: '13px', fontWeight: 700, color: '#111', textAlign: 'center', marginBottom: '10px' }}>
        {DE_MONTHS[month]} {year}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '4px' }}>
        {DE_DAYS_SHORT.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: '10px', fontWeight: 600, color: '#999', padding: '2px 0' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
        {Array.from({ length: leadBlanks }).map((_, i) => <div key={`b${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
          const { iso, isPast, isUnavailable, isCheckIn, isCheckOut, inRange } = cellState(day)
          const disabled = isPast || isUnavailable
          const isSelected = isCheckIn || isCheckOut
          return (
            <button
              key={day}
              type="button"
              disabled={disabled}
              onClick={() => !disabled && onSelectDate(iso)}
              style={{
                position: 'relative',
                aspectRatio: '1',
                borderRadius: isCheckIn ? '8px 0 0 8px' : isCheckOut ? '0 8px 8px 0' : inRange ? '0' : '8px',
                border: 'none',
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                fontWeight: isSelected ? 700 : 400,
                transition: 'all 0.1s',
                backgroundColor: isSelected
                  ? '#111'
                  : inRange
                  ? 'rgba(17,17,17,0.08)'
                  : 'transparent',
                color: isSelected ? '#fff' : isPast || isUnavailable ? '#CCC' : '#111',
                textDecoration: isUnavailable && !isPast ? 'line-through' : 'none',
              }}
            >
              {day}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ── Main BookingBox ────────────────────────────────────────── */
export default function BookingBox({ listingId, pricePerNight }: BookingBoxProps) {
  const router = useRouter()
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [selecting, setSelecting] = useState<'in' | 'out'>('in')
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [calMonth, setCalMonth] = useState(new Date())

  const [adults, setAdults] = useState(2)
  const [children, setChildren] = useState(0)
  const [message, setMessage] = useState('')

  const [rates, setRates] = useState<SmoobuRateMap>({})
  const [loadingRates, setLoadingRates] = useState(true)
  const [totalPrice, setTotalPrice] = useState<number | null>(null)
  const [availability, setAvailability] = useState<{ available: boolean; minStayViolation: boolean } | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error' | 'not-logged-in' | 'unavailable'>('idle')

  // Load 6 months of rates on mount
  useEffect(() => {
    const from = today()
    const to = isoDate(new Date(Date.now() + 180 * 86400000))
    fetch(`/api/smoobu/availability?listingId=${listingId}&from=${from}&to=${to}`)
      .then(r => r.json())
      .then(d => { if (d.rates) setRates(d.rates) })
      .catch(() => {})
      .finally(() => setLoadingRates(false))
  }, [listingId])

  // Check availability when both dates are set
  useEffect(() => {
    if (!checkIn || !checkOut) { setTotalPrice(null); setAvailability(null); return }
    fetch('/api/smoobu/availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId, checkIn, checkOut }),
    })
      .then(r => r.json())
      .then(d => {
        setTotalPrice(d.totalPrice ?? null)
        setAvailability({ available: d.available, minStayViolation: d.minStayViolation })
      })
      .catch(() => {})
  }, [listingId, checkIn, checkOut])

  const handleSelectDate = useCallback((iso: string) => {
    if (selecting === 'in') {
      setCheckIn(iso)
      setCheckOut('')
      setSelecting('out')
    } else {
      if (iso <= checkIn) {
        setCheckIn(iso)
        setCheckOut('')
        setSelecting('out')
      } else {
        setCheckOut(iso)
        setSelecting('in')
        setCalendarOpen(false)
      }
    }
  }, [selecting, checkIn])

  function formatDate(iso: string) {
    if (!iso) return ''
    const [, m, d] = iso.split('-')
    const months = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez']
    return `${parseInt(d)}. ${months[parseInt(m)-1]}`
  }

  function calcNights() {
    if (!checkIn || !checkOut) return 0
    return Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000)
  }

  const nights = calcNights()
  const displayPrice = totalPrice !== null ? totalPrice : (pricePerNight * nights || null)

  async function handleSubmit() {
    if (!checkIn || !checkOut || nights <= 0) return
    setSubmitting(true)
    setStatus('idle')

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      setStatus('not-logged-in')
      setSubmitting(false)
      return
    }

    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listingId,
        checkIn,
        checkOut,
        adults,
        children,
        message,
      }),
    })

    const data = await res.json()

    if (res.status === 409) {
      setStatus('unavailable')
    } else if (!res.ok) {
      setStatus('error')
    } else {
      setStatus('success')
      setTimeout(() => router.push(`/booking/${data.bookingId}`), 1200)
    }
    setSubmitting(false)
  }

  const minDate = today()
  const hasBothDates = !!(checkIn && checkOut)
  const canSubmit = hasBothDates && nights > 0 && (!availability || availability.available)

  return (
    <div style={{ background: '#fff', borderRadius: '24px', padding: '24px', boxShadow: '0 8px 40px rgba(0,0,0,0.10)', border: '1px solid #EAEAEA' }}>

      {/* Price header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '20px' }}>
        {loadingRates ? (
          <div style={{ height: '28px', width: '100px', borderRadius: '6px', background: '#F5F5F7' }} />
        ) : (
          <>
            <span style={{ fontSize: '24px', fontWeight: 700, color: '#111' }}>€ {pricePerNight}</span>
            <span style={{ fontSize: '13px', color: '#999' }}>/ Nacht</span>
          </>
        )}
      </div>

      {/* Date picker trigger */}
      <div
        style={{
          borderRadius: '14px',
          border: `1.5px solid ${calendarOpen ? '#111' : '#E0DDD6'}`,
          overflow: 'hidden',
          marginBottom: '12px',
          cursor: 'pointer',
          transition: 'border-color 0.15s',
        }}
        onClick={() => setCalendarOpen(o => !o)}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: calendarOpen ? '1px solid #F0EEE8' : 'none' }}>
          <div style={{ padding: '12px 14px', borderRight: '1px solid #F0EEE8', background: selecting === 'in' && calendarOpen ? '#FAFAFA' : '#fff' }}>
            <p style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', color: '#AAA', textTransform: 'uppercase', margin: '0 0 3px' }}>Anreise</p>
            <p style={{ fontSize: '13px', fontWeight: checkIn ? 600 : 400, color: checkIn ? '#111' : '#BBB', margin: 0 }}>
              {checkIn ? formatDate(checkIn) : 'Datum wählen'}
            </p>
          </div>
          <div style={{ padding: '12px 14px', background: selecting === 'out' && calendarOpen ? '#FAFAFA' : '#fff' }}>
            <p style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', color: '#AAA', textTransform: 'uppercase', margin: '0 0 3px' }}>Abreise</p>
            <p style={{ fontSize: '13px', fontWeight: checkOut ? 600 : 400, color: checkOut ? '#111' : '#BBB', margin: 0 }}>
              {checkOut ? formatDate(checkOut) : 'Datum wählen'}
            </p>
          </div>
        </div>
      </div>

      {/* Calendar */}
      {calendarOpen && (
        <div style={{ marginBottom: '12px', padding: '16px', background: '#FAFAFA', borderRadius: '14px', border: '1px solid #F0EEE8' }}>
          {/* Month nav */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <button
              type="button"
              onClick={() => setCalMonth(m => addMonths(m, -1))}
              style={{ background: 'none', border: '1px solid #E0DDD6', borderRadius: '8px', width: '30px', height: '30px', cursor: 'pointer', fontSize: '14px' }}
            >
              ‹
            </button>
            <span style={{ fontSize: '12px', color: '#888' }}>
              {selecting === 'in' ? 'Anreise wählen' : 'Abreise wählen'}
            </span>
            <button
              type="button"
              onClick={() => setCalMonth(m => addMonths(m, 1))}
              style={{ background: 'none', border: '1px solid #E0DDD6', borderRadius: '8px', width: '30px', height: '30px', cursor: 'pointer', fontSize: '14px' }}
            >
              ›
            </button>
          </div>

          {/* Two-month view */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            <CalendarMonth
              year={calMonth.getFullYear()} month={calMonth.getMonth()}
              rates={rates} checkIn={checkIn} checkOut={checkOut}
              selecting={selecting} onSelectDate={handleSelectDate} minDate={minDate}
            />
            <CalendarMonth
              year={addMonths(calMonth, 1).getFullYear()} month={addMonths(calMonth, 1).getMonth()}
              rates={rates} checkIn={checkIn} checkOut={checkOut}
              selecting={selecting} onSelectDate={handleSelectDate} minDate={minDate}
            />
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: '16px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #F0EEE8' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: '#999' }}>
              <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', background: '#111' }} />
              Ausgewählt
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: '#999' }}>
              <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', background: '#CCC', textDecoration: 'line-through', fontSize: '8px', lineHeight: '12px', textAlign: 'center', color: '#999' }}>–</span>
              Belegt
            </div>
          </div>
        </div>
      )}

      {/* Guests */}
      <div style={{ borderRadius: '14px', border: '1.5px solid #E0DDD6', padding: '12px 14px', marginBottom: '12px' }}>
        <p style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', color: '#AAA', textTransform: 'uppercase', margin: '0 0 10px' }}>Gäste</p>
        {[
          { label: 'Erwachsene', sub: 'ab 13 Jahren', val: adults, set: setAdults, min: 1, max: 16 },
          { label: 'Kinder', sub: 'bis 12 Jahre', val: children, set: setChildren, min: 0, max: 10 },
        ].map(({ label, sub, val, set, min, max }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div>
              <p style={{ fontSize: '13px', fontWeight: 500, color: '#111', margin: 0 }}>{label}</p>
              <p style={{ fontSize: '11px', color: '#999', margin: 0 }}>{sub}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button type="button" onClick={() => set(v => Math.max(min, v - 1))} disabled={val <= min}
                style={{ width: '28px', height: '28px', borderRadius: '50%', border: '1.5px solid #E0DDD6', background: '#fff', cursor: val <= min ? 'not-allowed' : 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: val <= min ? '#DDD' : '#111' }}>
                −
              </button>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#111', minWidth: '16px', textAlign: 'center' }}>{val}</span>
              <button type="button" onClick={() => set(v => Math.min(max, v + 1))} disabled={val >= max}
                style={{ width: '28px', height: '28px', borderRadius: '50%', border: '1.5px solid #E0DDD6', background: '#fff', cursor: val >= max ? 'not-allowed' : 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: val >= max ? '#DDD' : '#111' }}>
                +
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Optional message */}
      <textarea
        value={message}
        onChange={e => setMessage(e.target.value)}
        placeholder="Nachricht an den Gastgeber (optional)"
        rows={2}
        style={{ width: '100%', borderRadius: '14px', border: '1.5px solid #E0DDD6', padding: '10px 14px', fontSize: '13px', color: '#111', resize: 'none', outline: 'none', boxSizing: 'border-box', marginBottom: '12px', fontFamily: 'inherit' }}
      />

      {/* Price breakdown */}
      {hasBothDates && nights > 0 && (
        <div style={{ padding: '12px 0', borderTop: '1px solid #F0EEE8', borderBottom: '1px solid #F0EEE8', marginBottom: '12px' }}>
          {availability?.minStayViolation && (
            <p style={{ fontSize: '11px', color: '#E67E22', marginBottom: '6px' }}>
              ⚠ Mindestaufenthalt nicht erfüllt.
            </p>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#555', marginBottom: '4px' }}>
            <span>€ {pricePerNight} × {nights} {nights === 1 ? 'Nacht' : 'Nächte'}</span>
            <span>≈ € {displayPrice ?? '—'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 700, color: '#111' }}>
            <span>Gesamt</span>
            <span>€ {displayPrice ?? '—'}</span>
          </div>
        </div>
      )}

      {/* Status messages */}
      {status === 'success' && (
        <div style={{ borderRadius: '12px', padding: '12px 14px', background: '#F0FDF4', border: '1px solid #BBF7D0', marginBottom: '12px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#16A34A', margin: 0 }}>✓ Buchungsanfrage gesendet!</p>
          <p style={{ fontSize: '11px', color: '#22C55E', margin: '2px 0 0' }}>Du wirst weitergeleitet…</p>
        </div>
      )}
      {status === 'unavailable' && (
        <div style={{ borderRadius: '12px', padding: '12px 14px', background: '#FEF2F2', border: '1px solid #FECACA', marginBottom: '12px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#DC2626', margin: 0 }}>Diese Daten sind leider nicht verfügbar.</p>
          <p style={{ fontSize: '11px', color: '#EF4444', margin: '2px 0 0' }}>Bitte wähle andere Reisedaten.</p>
        </div>
      )}
      {status === 'error' && (
        <p style={{ fontSize: '12px', color: '#DC2626', marginBottom: '12px' }}>Etwas ist schiefgelaufen. Bitte erneut versuchen.</p>
      )}
      {status === 'not-logged-in' && (
        <div style={{ borderRadius: '12px', padding: '12px 14px', background: '#FFF7ED', border: '1px solid #FED7AA', marginBottom: '12px' }}>
          <p style={{ fontSize: '13px', color: '#92400E', margin: 0 }}>
            Bitte <a href="/login" style={{ fontWeight: 700, textDecoration: 'underline', color: '#92400E' }}>anmelden</a> um eine Anfrage zu senden.
          </p>
        </div>
      )}

      {/* CTA */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting || !canSubmit || status === 'success'}
        style={{
          width: '100%', padding: '14px', borderRadius: '14px', border: 'none',
          background: canSubmit ? 'linear-gradient(135deg, #C4A235, #8A6818)' : '#E5E5E5',
          color: canSubmit ? '#fff' : '#AAA',
          fontSize: '14px', fontWeight: 700,
          cursor: !canSubmit || submitting || status === 'success' ? 'not-allowed' : 'pointer',
          transition: 'all 0.15s',
        }}
      >
        {submitting ? 'Wird gesendet…' : !checkIn ? 'Anreisedatum wählen' : !checkOut ? 'Abreisedatum wählen' : 'Anfrage senden'}
      </button>

      <p style={{ textAlign: 'center', fontSize: '11px', color: '#BBB', marginTop: '8px' }}>
        Noch keine Zahlung — erst Anfrage
      </p>
    </div>
  )
}
