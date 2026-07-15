'use client'

import { useState, useEffect, useCallback } from 'react'
import { t, MONTHS, type UiLang } from '@/lib/i18n'

/* ── 4. Occupancy Calendar — 2 months, clickable → BookingBox ─ */
const DE_MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
const DE_DAYS_SHORT = ['Mo','Di','Mi','Do','Fr','Sa','So']

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function CalendarMonthGrid({ year, month, rates, todayStr, checkIn, checkOut, onClickDay, lang = 'de' }: {
  year: number; month: number
  rates: Record<string, { available: number }>
  todayStr: string
  checkIn: string; checkOut: string
  onClickDay: (iso: string) => void
  lang?: UiLang
}) {
  const firstDow = new Date(year, month, 1).getDay()
  const leadBlanks = firstDow === 0 ? 6 : firstDow - 1
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  return (
    <div>
      <div style={{ textAlign: 'center', fontSize: '14px', fontWeight: 700, color: '#1D1D1F', marginBottom: '10px' }}>
        {(lang === 'de' ? DE_MONTHS : MONTHS[lang])[month]} {year}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px', marginBottom: '3px' }}>
        {DE_DAYS_SHORT.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: '10px', fontWeight: 600, color: '#999', padding: '3px 0' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px' }}>
        {Array.from({ length: leadBlanks }).map((_, i) => <div key={`b${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
          const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const isPast = iso < todayStr
          const rate = rates[iso]
          const isBooked = !isPast && rate?.available === 0
          const isSelected = iso === checkIn || iso === checkOut
          const inRange = checkIn && checkOut && iso > checkIn && iso < checkOut
          // First day of a booked stretch = still a valid check-out morning
          const prevIso = new Date(new Date(iso + 'T00:00:00').getTime() - 86400000).toISOString().slice(0, 10)
          const checkoutEligible = isBooked && rates[prevIso]?.available !== 0
          const checkoutOnly = checkoutEligible && !!checkIn && !checkOut && iso > checkIn
          const clickable = !isPast && (!isBooked || checkoutOnly)

          let bg = '#F0FDF4'; let color = '#16A34A'; let border = '1px solid #BBF7D0'
          if (isPast) { bg = '#F9FAFB'; color = '#D1D5DB'; border = '1px solid #F3F4F6' }
          else if (checkoutEligible) { bg = 'linear-gradient(135deg, #F0FDF4 50%, #FEF2F2 50%)'; color = '#B45309'; border = '1px solid #FDE0B2' }
          else if (isBooked) { bg = '#FEF2F2'; color = '#DC2626'; border = '1px solid #FECACA' }
          if (isSelected) { bg = '#111'; color = '#fff'; border = '1px solid #111' }
          else if (inRange) { bg = 'rgba(17,17,17,0.08)'; color = '#1D1D1F'; border = '1px solid rgba(17,17,17,0.12)' }

          return (
            <button
              key={day}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onClickDay(iso)}
              style={{
                aspectRatio: '1', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '12px', fontWeight: isSelected ? 700 : isPast ? 400 : 600,
                background: bg, color, border,
                cursor: clickable ? 'pointer' : 'default',
                transition: 'all 0.1s',
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

export function OccupancyCalendar({ listingId, lang = 'de' }: { listingId: string; lang?: UiLang }) {
  const [viewDate, setViewDate] = useState(new Date())
  const [rates, setRates] = useState<Record<string, { available: number }>>({})
  const [loading, setLoading] = useState(true)
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [selecting, setSelecting] = useState<'in' | 'out'>('in')

  useEffect(() => {
    setLoading(true)
    const from = isoDate(new Date())
    const to = isoDate(new Date(Date.now() + 365 * 86400000))
    fetch(`/api/smoobu/availability?listingId=${listingId}&from=${from}&to=${to}`)
      .then(r => r.json())
      .then(d => { if (d.rates) setRates(d.rates) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [listingId])

  const todayStr = isoDate(new Date())

  const handleClickDay = useCallback((iso: string) => {
    if (selecting === 'in') {
      setCheckIn(iso); setCheckOut(''); setSelecting('out')
    } else {
      if (iso <= checkIn) {
        setCheckIn(iso); setCheckOut(''); setSelecting('out')
      } else {
        setCheckOut(iso); setSelecting('in')
      }
    }
  }, [selecting, checkIn])

  /* When both dates selected, scroll BookingBox into view and update its fields via custom event */
  useEffect(() => {
    if (checkIn && checkOut) {
      window.dispatchEvent(new CustomEvent('calendar-dates', { detail: { checkIn, checkOut } }))
      // Scroll booking box into view on mobile
      const box = document.querySelector('.detail-booking-col')
      if (box && window.innerWidth < 769) {
        box.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
  }, [checkIn, checkOut])

  function prev() { setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1)) }
  function next() { setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1)) }

  const month2 = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1)

  return (
    <div id="occupancy-calendar" style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '16px' }}>{t(lang, 'Belegungskalender')}</h2>
      <div>
        {/* Month navigation */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <button type="button" onClick={prev} style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid #E5E5EA', background: 'transparent', cursor: 'pointer', fontSize: '15px', color: '#6E6E73' }}>‹</button>
          <span style={{ fontSize: '12px', color: '#999' }}>
            {selecting === 'in' ? t(lang, 'Anreise wählen') : t(lang, 'Abreise wählen')}
          </span>
          <button type="button" onClick={next} style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid #E5E5EA', background: 'transparent', cursor: 'pointer', fontSize: '15px', color: '#6E6E73' }}>›</button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#999', fontSize: '13px' }}>{t(lang, 'Laden…')}</div>
        ) : (
          <div className="detail-calendar-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            <CalendarMonthGrid
              lang={lang}
              year={viewDate.getFullYear()} month={viewDate.getMonth()}
              rates={rates} todayStr={todayStr}
              checkIn={checkIn} checkOut={checkOut}
              onClickDay={handleClickDay}
            />
            <CalendarMonthGrid
              lang={lang}
              year={month2.getFullYear()} month={month2.getMonth()}
              rates={rates} todayStr={todayStr}
              checkIn={checkIn} checkOut={checkOut}
              onClickDay={handleClickDay}
            />
          </div>
        )}

        {/* Legend + selection info */}
        <div className="detail-calendar-legend" style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', marginTop: '14px', paddingTop: '10px', borderTop: '1px solid #F0EEE8', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#999' }}>
            <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', background: '#F0FDF4', border: '1px solid #BBF7D0' }} />Frei
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#999' }}>
            <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', background: '#FEF2F2', border: '1px solid #FECACA' }} />Belegt
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#999' }}>
            <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', background: '#111', border: '1px solid #111' }} />Ausgewählt
          </div>
          {checkIn && (
            <div style={{ marginLeft: 'auto', fontSize: '12px', color: '#1D1D1F', fontWeight: 600 }}>
              {checkIn}{checkOut ? ` → ${checkOut}` : ' → ?'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
