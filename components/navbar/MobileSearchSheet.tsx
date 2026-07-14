'use client'

/**
 * Full-screen mobile/tablet search sheet (extracted from NavBar.tsx).
 * Search state lives in NavBar (shared with the desktop bar); only the
 * calendar's open/month state is local to this sheet.
 */
import { useState, type Dispatch, type SetStateAction } from 'react'
import { CalendarMonth } from './DatePicker'
import { LOCATION_SUGGESTIONS, formatDate } from './search-utils'
import { t, type UiLang } from '@/lib/i18n'

export default function MobileSearchSheet({
  q, setQ, checkin, setCheckin, checkout, setCheckout,
  adults, setAdults, kids, setKids, flexDates, setFlexDates,
  dateSelecting, setDateSelecting, onClose, onSearch, lang = 'de',
}: {
  q: string; setQ: (v: string) => void
  checkin: string; setCheckin: (v: string) => void
  checkout: string; setCheckout: (v: string) => void
  adults: number; setAdults: Dispatch<SetStateAction<number>>
  kids: number; setKids: Dispatch<SetStateAction<number>>
  flexDates: boolean; setFlexDates: (v: boolean) => void
  dateSelecting: 'checkin' | 'checkout'; setDateSelecting: (v: 'checkin' | 'checkout') => void
  onClose: () => void
  onSearch: () => void
  lang?: UiLang
}) {
  const [mobileDateOpen, setMobileDateOpen] = useState(false)
  const [mobileCalMonth, setMobileCalMonth] = useState(() => new Date())

  return (
  <div style={{
    position: 'fixed', inset: 0, zIndex: 200,
    backgroundColor: '#F7F6F3',
    display: 'flex', flexDirection: 'column',
    overflowY: 'auto',
  }}>
    {/* Header */}
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '16px 20px 14px',
      backgroundColor: '#fff',
      borderBottom: '1px solid #F0EEE8',
      position: 'sticky', top: 0, zIndex: 10,
    }}>
      <span style={{ fontSize: '16px', fontWeight: 700, color: '#111' }}>{t(lang, 'Suche')}</span>
      <button
        onClick={onClose}
        style={{ width: '32px', height: '32px', borderRadius: '50%', border: '1px solid #E0DDD6', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', color: '#555' }}
      >✕</button>
    </div>

    {/* Fields */}
    <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>

      {/* Wohin */}
      <div style={{ backgroundColor: '#fff', borderRadius: '18px', padding: '16px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
        <p style={{ fontSize: '10px', fontWeight: 700, color: '#AAA', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 8px' }}>{t(lang, 'Wohin')}</p>
        <input
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={t(lang, 'Ort oder Region suchen…')}
          autoFocus
          style={{ width: '100%', fontSize: '15px', fontWeight: 500, color: '#111', border: 'none', outline: 'none', background: 'transparent', fontFamily: 'inherit' }}
        />
        {q.length >= 1 && (
          <div style={{ marginTop: '12px', borderTop: '1px solid #F0EEE8', paddingTop: '8px' }}>
            {LOCATION_SUGGESTIONS.filter(s =>
              s.label.toLowerCase().includes(q.toLowerCase()) ||
              s.sub.toLowerCase().includes(q.toLowerCase())
            ).slice(0, 5).map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setQ(s.label)}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '8px 0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
              >
                <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: '#F2F0EC', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth={2} strokeLinecap="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                  </svg>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: '#111' }}>{s.label}</p>
                  <p style={{ margin: 0, fontSize: '11px', color: '#999' }}>{s.sub}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Datum */}
      <div style={{ backgroundColor: '#fff', borderRadius: '18px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
        {/* Anreise / Abreise row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          <button
            type="button"
            onClick={() => { setDateSelecting('checkin'); setMobileDateOpen(true) }}
            style={{ padding: '16px 18px', textAlign: 'left', background: dateSelecting === 'checkin' && mobileDateOpen ? '#FAFAFA' : '#fff', border: 'none', cursor: 'pointer', borderRight: '1px solid #F0EEE8' }}
          >
            <p style={{ fontSize: '10px', fontWeight: 700, color: '#AAA', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 4px' }}>{t(lang, 'Anreise')}</p>
            <p style={{ fontSize: '14px', fontWeight: checkin ? 600 : 400, color: checkin ? '#111' : '#BBB', margin: 0 }}>
              {checkin ? formatDate(checkin, lang) : t(lang, 'Datum')}
            </p>
          </button>
          <button
            type="button"
            onClick={() => { setDateSelecting('checkout'); setMobileDateOpen(true) }}
            style={{ padding: '16px 18px', textAlign: 'left', background: dateSelecting === 'checkout' && mobileDateOpen ? '#FAFAFA' : '#fff', border: 'none', cursor: 'pointer' }}
          >
            <p style={{ fontSize: '10px', fontWeight: 700, color: '#AAA', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 4px' }}>{t(lang, 'Abreise')}</p>
            <p style={{ fontSize: '14px', fontWeight: checkout ? 600 : 400, color: checkout ? '#111' : '#BBB', margin: 0 }}>
              {checkout ? formatDate(checkout, lang) : t(lang, 'Datum')}
            </p>
          </button>
        </div>
        {/* Calendar */}
        {mobileDateOpen && (
          <div style={{ padding: '16px', borderTop: '1px solid #F0EEE8', backgroundColor: '#FAFAFA' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <button type="button" onClick={() => {
                const prev = new Date(mobileCalMonth.getFullYear(), mobileCalMonth.getMonth() - 1, 1)
                const now = new Date()
                if (prev.getFullYear() > now.getFullYear() || (prev.getFullYear() === now.getFullYear() && prev.getMonth() >= now.getMonth())) {
                  setMobileCalMonth(prev)
                }
              }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #E5E5EA', background: 'transparent', cursor: 'pointer', fontSize: '15px', color: '#6E6E73', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
              <span style={{ fontSize: '12px', color: '#999' }}>
                {dateSelecting === 'checkin' ? t(lang, 'Anreise wählen') : t(lang, 'Abreise wählen')}
              </span>
              <button type="button" onClick={() => setMobileCalMonth(new Date(mobileCalMonth.getFullYear(), mobileCalMonth.getMonth() + 1, 1))} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #E5E5EA', background: 'transparent', cursor: 'pointer', fontSize: '15px', color: '#6E6E73', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: '8px' }}>
              <button type="button" onClick={() => setMobileDateOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'var(--gold)', fontWeight: 600, padding: 0 }}>{t(lang, 'Fertig')}</button>
            </div>
            {(() => {
              const y0 = mobileCalMonth.getFullYear(), m0 = mobileCalMonth.getMonth()
              const nextM = new Date(y0, m0 + 1, 1)
              const y1 = nextM.getFullYear(), m1 = nextM.getMonth()
              function handleMobileSelect(iso: string) {
                if (!checkin || dateSelecting === 'checkin' || iso < checkin) {
                  setCheckin(iso); setDateSelecting('checkout')
                } else {
                  setCheckout(iso); setMobileDateOpen(false)
                }
              }
              return <>
                <CalendarMonth year={y0} month={m0} checkin={checkin} checkout={checkout} selecting={dateSelecting} onSelect={handleMobileSelect} lang={lang} />
                <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #F0EEE8' }}>
                  <CalendarMonth year={y1} month={m1} checkin={checkin} checkout={checkout} selecting={dateSelecting} onSelect={handleMobileSelect} lang={lang} />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #F0EEE8', cursor: 'pointer', fontSize: '13px', color: '#333', fontWeight: 500 }}>
                  <input type="checkbox" checked={flexDates} onChange={e => setFlexDates(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--gold)' }} />
                  {t(lang, 'An-/Abreise ± 3 Tage flexibel')}
                </label>
              </>
            })()}
          </div>
        )}
      </div>

      {/* Gäste */}
      <div style={{ backgroundColor: '#fff', borderRadius: '18px', padding: '16px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
        <p style={{ fontSize: '10px', fontWeight: 700, color: '#AAA', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 14px' }}>{t(lang, 'Gäste')}</p>
        {[
          { label: t(lang, 'Erwachsene'), sub: t(lang, 'Ab 13 Jahren'), val: adults, set: setAdults, min: 1 },
          { label: t(lang, 'Kinder'), sub: t(lang, '2–12 Jahre'), val: kids, set: setKids, min: 0 },
        ].map(({ label, sub, val, set, min }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div>
              <p style={{ fontSize: '14px', fontWeight: 500, color: '#111', margin: 0 }}>{label}</p>
              <p style={{ fontSize: '12px', color: '#999', margin: 0 }}>{sub}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <button type="button" onClick={() => set(v => Math.max(min, v - 1))} disabled={val <= min}
                style={{ width: '32px', height: '32px', borderRadius: '50%', border: '1.5px solid', borderColor: val <= min ? '#EEE' : '#CCC', background: '#fff', cursor: val <= min ? 'not-allowed' : 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: val <= min ? '#DDD' : '#111', lineHeight: 1 }}>
                −
              </button>
              <span style={{ fontSize: '15px', fontWeight: 600, color: '#111', minWidth: '20px', textAlign: 'center' }}>{val}</span>
              <button type="button" onClick={() => set(v => Math.min(16, v + 1))}
                style={{ width: '32px', height: '32px', borderRadius: '50%', border: '1.5px solid #CCC', background: '#fff', cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#111', lineHeight: 1 }}>
                +
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>

    {/* Submit */}
    <div style={{ padding: '16px 16px 32px', backgroundColor: '#fff', borderTop: '1px solid #F0EEE8', display: 'flex', gap: '10px' }}>
      <button
        type="button"
        onClick={() => { setQ(''); setCheckin(''); setCheckout(''); setAdults(1); setKids(0) }}
        style={{ flex: '0 0 auto', padding: '14px 18px', borderRadius: '999px', border: '1.5px solid #E0DDD6', background: '#fff', color: '#444', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}
      >
        {t(lang, 'Zurücksetzen')}
      </button>
      <button
        type="button"
        onClick={onSearch}
        style={{ flex: 1, padding: '14px', borderRadius: '999px', border: 'none', background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))', color: '#fff', fontSize: '15px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        {t(lang, 'Suchen')}
      </button>
    </div>
  </div>
  )
}
