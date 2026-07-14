'use client'

import { useState } from 'react'
import { DE_MONTHS, DE_DAYS, dateToIso, formatDate, getDaysInMonth, getFirstDayOfMonth } from './search-utils'
import { t, MONTHS, DAYS_SHORT, type UiLang } from '@/lib/i18n'

/* ─── Mini calendar ─────────────────────────────────────── */
export function CalendarMonth({
  year, month, checkin, checkout, selecting,
  onSelect, lang = 'de',
}: {
  year: number; month: number
  checkin: string; checkout: string; selecting: 'checkin' | 'checkout'
  onSelect: (iso: string) => void
  lang?: UiLang
}) {
  const today = dateToIso(new Date())
  const days = getDaysInMonth(year, month)
  const firstDay = getFirstDayOfMonth(year, month)
  const cells = Array.from({ length: firstDay + days }, (_, i) =>
    i < firstDay ? null : i - firstDay + 1
  )

  return (
    <div style={{ minWidth: '252px' }}>
      <p style={{ textAlign: 'center', fontWeight: 600, fontSize: '13px', color: '#111', marginBottom: '12px' }}>
        {(lang === 'de' ? DE_MONTHS : MONTHS[lang])[month]} {year}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '4px' }}>
        {(lang === 'de' ? DE_DAYS : DAYS_SHORT[lang]).map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: '11px', color: '#999', fontWeight: 600, paddingBottom: '4px' }}>{d}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={i} />
          const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const isPast = iso < today
          const isCheckin = iso === checkin
          const isCheckout = iso === checkout
          const inRange = checkin && checkout && iso > checkin && iso < checkout
          const isSelected = isCheckin || isCheckout

          return (
            <button
              key={i}
              type="button"
              onClick={() => !isPast && onSelect(iso)}
              style={{
                width: '100%',
                aspectRatio: '1',
                borderRadius: '50%',
                border: 'none',
                cursor: isPast ? 'default' : 'pointer',
                fontSize: '12px',
                fontWeight: isSelected ? 700 : 400,
                color: isPast ? '#CCC' : isSelected ? '#fff' : '#111',
                background: isSelected
                  ? 'linear-gradient(135deg, var(--gold), var(--gold))'
                  : inRange
                    ? 'rgba(196,162,53,0.12)'
                    : 'transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => {
                if (!isPast && !isSelected) e.currentTarget.style.background = 'rgba(196,162,53,0.15)'
              }}
              onMouseLeave={(e) => {
                if (!isPast && !isSelected) e.currentTarget.style.background = inRange ? 'rgba(196,162,53,0.12)' : 'transparent'
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

/* ─── Date Picker Popover ─────────────────────────────── */
export function DatePickerPopover({
  checkin, checkout, selecting, onSelectCheckin, onSelectCheckout, onClose, flexDates, onToggleFlex, lang = 'de',
}: {
  checkin: string; checkout: string; selecting: 'checkin' | 'checkout'
  onSelectCheckin: (iso: string) => void
  onSelectCheckout: (iso: string) => void
  onClose: () => void
  flexDates: boolean
  onToggleFlex: (v: boolean) => void
  lang?: UiLang
}) {
  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth())

  const nextMonth = viewMonth === 11 ? 0 : viewMonth + 1
  const nextYear = viewMonth === 11 ? viewYear + 1 : viewYear

  function handleSelect(iso: string) {
    if (!checkin || selecting === 'checkin' || iso < checkin) {
      onSelectCheckin(iso)
    } else {
      onSelectCheckout(iso)
      onClose()
    }
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(100% + 12px)',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: '#fff',
        borderRadius: '24px',
        padding: '24px',
        boxShadow: '0 16px 48px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06)',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
        {(['checkin','checkout'] as const).map(f => (
          <div
            key={f}
            style={{
              padding: '6px 16px',
              borderRadius: '999px',
              fontSize: '12px',
              fontWeight: 600,
              border: '1.5px solid',
              borderColor: selecting === f ? '#111' : '#E0DDD6',
              cursor: 'default',
              background: selecting === f ? '#111' : '#fff',
              color: selecting === f ? '#fff' : '#111',
            } as React.CSSProperties}
          >
            {f === 'checkin' ? (checkin ? formatDate(checkin, lang) : t(lang, 'Anreise')) : (checkout ? formatDate(checkout, lang) : t(lang, 'Abreise'))}
          </div>
        ))}
      </div>

      {/* Two-month grid */}
      <div style={{ display: 'flex', gap: '32px', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <button
              type="button"
              onClick={() => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) } else setViewMonth(m => m - 1) }}
              style={{ background: 'none', border: '1px solid #E0DDD6', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >‹</button>
            <span />
          </div>
          <CalendarMonth year={viewYear} month={viewMonth} checkin={checkin} checkout={checkout} selecting={selecting} onSelect={handleSelect} lang={lang} />
        </div>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span />
            <button
              type="button"
              onClick={() => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) } else setViewMonth(m => m + 1) }}
              style={{ background: 'none', border: '1px solid #E0DDD6', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >›</button>
          </div>
          <CalendarMonth year={nextYear} month={nextMonth} checkin={checkin} checkout={checkout} selecting={selecting} onSelect={handleSelect} lang={lang} />
        </div>
      </div>

      {/* Flexible dates + confirm */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginTop: '6px', paddingTop: '12px', borderTop: '1px solid #F2F0EC' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12.5px', color: '#333', fontWeight: 500 }}>
          <input
            type="checkbox"
            checked={flexDates}
            onChange={e => onToggleFlex(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: 'var(--gold)', cursor: 'pointer' }}
          />
          {t(lang, 'An-/Abreise ± 3 Tage flexibel')}
        </label>
        {checkin && checkout && (
          <button
            type="button"
            onClick={onClose}
            style={{ fontSize: '12px', fontWeight: 600, color: '#fff', background: 'linear-gradient(135deg, var(--gold), var(--gold))', border: 'none', borderRadius: '999px', padding: '8px 20px', cursor: 'pointer', flexShrink: 0 }}
          >
            {t(lang, 'Übernehmen')}
          </button>
        )}
      </div>
    </div>
  )
}
