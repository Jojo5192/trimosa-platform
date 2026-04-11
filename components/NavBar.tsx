'use client'

import Link from 'next/link'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseBrowser as supabase } from '@/lib/supabase-browser'
import type { User } from '@supabase/supabase-js'

interface NavBarProps {
  initialQ?: string
  initialGuests?: string
  initialCheckin?: string
  initialCheckout?: string
}

const LOCATION_SUGGESTIONS = [
  { label: 'Trier', sub: 'Rheinland-Pfalz' },
  { label: 'Bitburg', sub: 'Eifel' },
  { label: 'Raum Trier', sub: 'Rheinland-Pfalz' },
  { label: 'Südeifel', sub: 'Rheinland-Pfalz' },
  { label: 'Eifel', sub: 'Rheinland-Pfalz' },
  { label: 'Mosel', sub: 'Rheinland-Pfalz' },
  { label: 'Wittlich', sub: 'Rheinland-Pfalz' },
  { label: 'Koblenz', sub: 'Rheinland-Pfalz' },
  { label: 'Schliersee', sub: 'Bayern' },
  { label: 'Tegernsee', sub: 'Bayern' },
  { label: 'Garmisch-Partenkirchen', sub: 'Bayern' },
  { label: 'Füssen', sub: 'Bayern' },
  { label: 'Berchtesgaden', sub: 'Bayern' },
  { label: 'München', sub: 'Bayern' },
  { label: 'Augsburg', sub: 'Bayern' },
  { label: 'Nürnberg', sub: 'Bayern' },
  { label: 'Köln', sub: 'Nordrhein-Westfalen' },
  { label: 'Düsseldorf', sub: 'Nordrhein-Westfalen' },
  { label: 'Frankfurt', sub: 'Hessen' },
  { label: 'Stuttgart', sub: 'Baden-Württemberg' },
  { label: 'Hamburg', sub: 'Hamburg' },
  { label: 'Berlin', sub: 'Berlin' },
  { label: 'Leipzig', sub: 'Sachsen' },
  { label: 'Dresden', sub: 'Sachsen' },
  { label: 'Salzburg', sub: 'Österreich' },
  { label: 'Wien', sub: 'Österreich' },
  { label: 'Innsbruck', sub: 'Österreich' },
  { label: 'Luxemburg', sub: 'Luxemburg' },
]

const DE_MONTHS_SHORT = ['Jan.','Feb.','Mär.','Apr.','Mai','Jun.','Jul.','Aug.','Sep.','Okt.','Nov.','Dez.']
const DE_MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
const DE_DAYS = ['Mo','Di','Mi','Do','Fr','Sa','So']

function formatDate(iso: string): string {
  if (!iso) return ''
  const [, m, d] = iso.split('-')
  return `${parseInt(d)}. ${DE_MONTHS_SHORT[parseInt(m) - 1]}`
}

function isoToDate(iso: string): Date | null {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function dateToIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year: number, month: number) {
  // 0=Sun → convert to Mon-based index
  const d = new Date(year, month, 1).getDay()
  return d === 0 ? 6 : d - 1
}

/* ─── Mini calendar ─────────────────────────────────────── */
function CalendarMonth({
  year, month, checkin, checkout, selecting,
  onSelect,
}: {
  year: number; month: number
  checkin: string; checkout: string; selecting: 'checkin' | 'checkout'
  onSelect: (iso: string) => void
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
        {DE_MONTHS[month]} {year}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '4px' }}>
        {DE_DAYS.map(d => (
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
                  ? 'linear-gradient(135deg, #C4A235, #A8882A)'
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
function DatePickerPopover({
  checkin, checkout, selecting, onSelectCheckin, onSelectCheckout, onClose
}: {
  checkin: string; checkout: string; selecting: 'checkin' | 'checkout'
  onSelectCheckin: (iso: string) => void
  onSelectCheckout: (iso: string) => void
  onClose: () => void
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
            {f === 'checkin' ? (checkin ? formatDate(checkin) : 'Anreise') : (checkout ? formatDate(checkout) : 'Abreise')}
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
          <CalendarMonth year={viewYear} month={viewMonth} checkin={checkin} checkout={checkout} selecting={selecting} onSelect={handleSelect} />
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
          <CalendarMonth year={nextYear} month={nextMonth} checkin={checkin} checkout={checkout} selecting={selecting} onSelect={handleSelect} />
        </div>
      </div>

      {checkin && checkout && (
        <button
          type="button"
          onClick={onClose}
          style={{ alignSelf: 'flex-end', marginTop: '4px', fontSize: '12px', fontWeight: 600, color: '#fff', background: 'linear-gradient(135deg, #C4A235, #A8882A)', border: 'none', borderRadius: '999px', padding: '8px 20px', cursor: 'pointer' }}
        >
          Übernehmen
        </button>
      )}
    </div>
  )
}

/* ─── Guest Picker Popover ────────────────────────────── */
function GuestPickerPopover({
  adults, children: kids, onChangeAdults, onChangeKids, onClose
}: {
  adults: number; children: number
  onChangeAdults: (n: number) => void
  onChangeKids: (n: number) => void
  onClose: () => void
}) {
  function Counter({ label, sub, value, onChange, min = 0 }: { label: string; sub: string; value: number; onChange: (n: number) => void; min?: number }) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0', borderBottom: '1px solid #F2F0EC' }}>
        <div>
          <p style={{ fontSize: '14px', fontWeight: 500, color: '#111', margin: 0 }}>{label}</p>
          <p style={{ fontSize: '12px', color: '#888', margin: '2px 0 0' }}>{sub}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            type="button"
            onClick={() => onChange(Math.max(min, value - 1))}
            disabled={value <= min}
            style={{
              width: 28, height: 28, borderRadius: '50%', border: '1.5px solid',
              borderColor: value <= min ? '#DDD' : '#888',
              background: 'none', cursor: value <= min ? 'default' : 'pointer',
              fontSize: '16px', color: value <= min ? '#CCC' : '#333',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              lineHeight: 1,
            }}
          >−</button>
          <span style={{ fontSize: '14px', fontWeight: 500, color: '#111', width: '16px', textAlign: 'center' }}>{value}</span>
          <button
            type="button"
            onClick={() => onChange(Math.min(16, value + 1))}
            style={{
              width: 28, height: 28, borderRadius: '50%', border: '1.5px solid #888',
              background: 'none', cursor: 'pointer', fontSize: '16px', color: '#333',
              display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
            }}
          >+</button>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(100% + 12px)',
        right: 0,
        width: '300px',
        backgroundColor: '#fff',
        borderRadius: '24px',
        padding: '8px 24px 20px',
        boxShadow: '0 16px 48px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06)',
        zIndex: 100,
      }}
    >
      <Counter label="Erwachsene" sub="Ab 13 Jahren" value={adults} onChange={onChangeAdults} min={1} />
      <Counter label="Kinder" sub="2–12 Jahre" value={kids} onChange={onChangeKids} />
      <button
        type="button"
        onClick={onClose}
        style={{ display: 'block', width: '100%', marginTop: '16px', fontSize: '13px', fontWeight: 600, color: '#fff', background: 'linear-gradient(135deg, #C4A235, #A8882A)', border: 'none', borderRadius: '999px', padding: '10px', cursor: 'pointer' }}
      >
        Fertig
      </button>
    </div>
  )
}

/* ─── Main NavBar ─────────────────────────────────────── */
export default function NavBar({ initialQ = '', initialGuests = '', initialCheckin = '', initialCheckout = '' }: NavBarProps) {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [compact, setCompact] = useState(false)

  const [q, setQ] = useState(initialQ)
  const [checkin, setCheckin] = useState(initialCheckin)
  const [checkout, setCheckout] = useState(initialCheckout)
  const [adults, setAdults] = useState(Math.max(1, parseInt(initialGuests) || 1))
  const [kids, setKids] = useState(0)

  const [activeField, setActiveField] = useState<'q' | 'date' | 'guests' | null>(null)
  const [dateSelecting, setDateSelecting] = useState<'checkin' | 'checkout'>('checkin')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const headerRef = useRef<HTMLElement>(null)

  const suggestions = q.length >= 1
    ? LOCATION_SUGGESTIONS.filter(s =>
        s.label.toLowerCase().includes(q.toLowerCase()) ||
        s.sub.toLowerCase().includes(q.toLowerCase())
      ).slice(0, 6)
    : LOCATION_SUGGESTIONS.slice(0, 6)

  const totalGuests = adults + kids
  const guestLabel = totalGuests === 1 ? '1 Gast' : `${totalGuests} Gäste`

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null))
    const { data: listener } = supabase.auth.onAuthStateChange((_ev, s) => setUser(s?.user ?? null))
    const onScroll = () => {
      const c = window.scrollY > 60
      setCompact(c)
      document.documentElement.style.setProperty('--navbar-h', c ? '64px' : '88px')
    }
    document.documentElement.style.setProperty('--navbar-h', '88px')
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { listener.subscription.unsubscribe(); window.removeEventListener('scroll', onScroll) }
  }, [])

  // Close popover on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setActiveField(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setActiveField(null)
    const params = new URLSearchParams()
    if (q.trim()) params.set('q', q.trim())
    if (totalGuests > 1) params.set('guests', String(totalGuests))
    if (checkin) params.set('checkin', checkin)
    if (checkout) params.set('checkout', checkout)
    router.push(params.toString() ? `/?${params}` : '/')
  }

  const isHost = user?.user_metadata?.role === 'host'
  const initials = (user?.user_metadata?.name || user?.email || 'U')[0].toUpperCase()
  const headerH = compact ? 64 : 88
  const barH = compact ? 46 : 60
  const logoH = compact ? '24px' : '32px'

  /* ── Divider ── */
  const Divider = () => (
    <div style={{ width: '1px', height: '24px', backgroundColor: '#E0DDD6', flexShrink: 0 }} />
  )

  /* ── Field wrapper style ── */
  function fieldStyle(id: string, extra?: React.CSSProperties): React.CSSProperties {
    const active = activeField === id
    return {
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      cursor: 'pointer',
      borderRadius: '999px',
      transition: 'background 0.15s ease',
      backgroundColor: active ? '#fff' : 'transparent',
      boxShadow: active ? '0 2px 16px rgba(0,0,0,0.08)' : 'none',
      position: 'relative',
      ...extra,
    }
  }

  /* ── Label/value display ── */
  function FieldLabel({ text }: { text: string }) {
    if (compact) return null
    return <span style={{ fontSize: '10px', fontWeight: 700, color: '#111', letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1 }}>{text}</span>
  }

  function FieldValue({ value, placeholder }: { value: string; placeholder: string }) {
    return (
      <span style={{
        fontSize: compact ? '13px' : '13px',
        color: value ? '#111' : '#999',
        fontWeight: value ? 500 : 400,
        lineHeight: 1.2,
        marginTop: compact ? 0 : '3px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {value || placeholder}
      </span>
    )
  }

  return (
    <>
      <header
        ref={headerRef}
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          height: `${headerH}px`,
          transition: 'height 0.3s cubic-bezier(0.4,0,0.2,1), box-shadow 0.3s ease',
          backgroundColor: 'rgba(255,255,255,0.97)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          boxShadow: compact
            ? '0 1px 0 rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.04)'
            : '0 1px 0 rgba(0,0,0,0.06)',
        }}
      >
        <div style={{ padding: '0 20px', display: 'flex', alignItems: 'center', gap: '16px', height: '100%', width: '100%' }}>

          {/* Logo */}
          <Link href="/" style={{ flexShrink: 0, textDecoration: 'none' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="TRIMOSA" style={{ height: logoH, width: 'auto', transition: 'height 0.3s ease' }} />
          </Link>

          {/* Search Bar */}
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0, maxWidth: '700px', margin: '0 auto' }}>
            <form
              onSubmit={handleSubmit}
              style={{
                maxWidth: compact ? '560px' : '680px',
                width: '100%',
                height: `${barH}px`,
                borderRadius: '999px',
                backgroundColor: '#F7F5F2',
                border: '1px solid',
                borderColor: activeField ? '#C8C4BC' : '#E8E4DC',
                transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)',
                boxShadow: activeField
                  ? '0 4px 24px rgba(0,0,0,0.08)'
                  : '0 1px 4px rgba(0,0,0,0.04)',
                display: 'flex',
                alignItems: 'center',
                position: 'relative',
                overflow: 'visible',
              }}
            >
              {/* ── Wohin ── */}
              <div
                style={fieldStyle('q', { flex: '2', paddingLeft: '20px', paddingRight: '12px', minWidth: 0 })}
                onClick={() => { setActiveField('q'); setShowSuggestions(true) }}
              >
                <FieldLabel text="Wohin" />
                <input
                  name="q" type="text" value={q}
                  onChange={(e) => { setQ(e.target.value); setShowSuggestions(true) }}
                  onFocus={() => { setActiveField('q'); setShowSuggestions(true) }}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 180)}
                  placeholder={compact && !q ? 'Wohin?' : 'Ort suchen…'}
                  autoComplete="off"
                  style={{
                    fontSize: '13px',
                    color: '#111',
                    outline: 'none', border: 'none', background: 'transparent',
                    marginTop: compact ? 0 : '3px',
                    width: '100%',
                    fontFamily: 'inherit',
                  }}
                />
                {/* Suggestions dropdown */}
                {showSuggestions && activeField === 'q' && suggestions.length > 0 && (
                  <div style={{
                    position: 'absolute',
                    top: 'calc(100% + 10px)',
                    left: '-8px',
                    width: '280px',
                    background: '#fff',
                    borderRadius: '20px',
                    boxShadow: '0 12px 40px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.05)',
                    overflow: 'hidden',
                    zIndex: 100,
                  }}>
                    {suggestions.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setQ(s.label)
                          setShowSuggestions(false)
                          setActiveField('date')
                          setDateSelecting('checkin')
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          width: '100%',
                          padding: '12px 16px',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          textAlign: 'left',
                          borderBottom: i < suggestions.length - 1 ? '1px solid #F5F3EF' : 'none',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#F7F5F2' }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                      >
                        <div style={{ width: '32px', height: '32px', borderRadius: '10px', background: '#F2F0EC', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth={2} strokeLinecap="round">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                            <circle cx="12" cy="10" r="3" />
                          </svg>
                        </div>
                        <div>
                          <p style={{ fontSize: '13px', fontWeight: 600, color: '#111', margin: 0, lineHeight: 1.2 }}>{s.label}</p>
                          <p style={{ fontSize: '11px', color: '#999', margin: '2px 0 0', lineHeight: 1 }}>{s.sub}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <Divider />

              {/* ── Anreise ── */}
              <div
                className="hidden md:flex"
                style={fieldStyle('date', { flex: '1.1', padding: '0 12px', minWidth: 0 })}
                onClick={() => { setActiveField('date'); setDateSelecting('checkin') }}
              >
                <FieldLabel text="Anreise" />
                <FieldValue value={checkin ? formatDate(checkin) : ''} placeholder={compact ? 'Anreise' : 'Datum wählen'} />
              </div>

              <Divider />

              {/* ── Abreise ── */}
              <div
                className="hidden md:flex"
                style={fieldStyle('date', { flex: '1.1', padding: '0 12px', minWidth: 0 })}
                onClick={() => { setActiveField('date'); setDateSelecting('checkout') }}
              >
                <FieldLabel text="Abreise" />
                <FieldValue value={checkout ? formatDate(checkout) : ''} placeholder={compact ? 'Abreise' : 'Datum wählen'} />
              </div>

              <Divider />

              {/* ── Gäste ── */}
              <div
                className="hidden md:flex"
                style={fieldStyle('guests', { flexShrink: 0, width: compact ? '96px' : '110px', padding: '0 12px' })}
                onClick={() => setActiveField(activeField === 'guests' ? null : 'guests')}
              >
                <FieldLabel text="Gäste" />
                <FieldValue value={totalGuests > 1 || adults > 1 ? guestLabel : ''} placeholder={compact ? 'Gäste' : 'Hinzufügen'} />

                {/* Guest Picker Popover */}
                {activeField === 'guests' && (
                  <GuestPickerPopover
                    adults={adults}
                    children={kids}
                    onChangeAdults={setAdults}
                    onChangeKids={setKids}
                    onClose={() => setActiveField(null)}
                  />
                )}
              </div>

              {/* ── Date Picker Popover ── */}
              {activeField === 'date' && (
                <DatePickerPopover
                  checkin={checkin}
                  checkout={checkout}
                  selecting={dateSelecting}
                  onSelectCheckin={(iso) => { setCheckin(iso); setDateSelecting('checkout') }}
                  onSelectCheckout={(iso) => setCheckout(iso)}
                  onClose={() => setActiveField(null)}
                />
              )}

              {/* Hidden inputs for form submission */}
              <input type="hidden" name="checkin" value={checkin} />
              <input type="hidden" name="checkout" value={checkout} />
              <input type="hidden" name="guests" value={totalGuests > 1 ? String(totalGuests) : ''} />

              {/* ── Search Button ── */}
              <div style={{ padding: '0 5px 0 3px', flexShrink: 0 }}>
                <button
                  type="submit"
                  aria-label="Suchen"
                  style={{
                    width: compact ? '38px' : '44px',
                    height: compact ? '38px' : '44px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                    background: 'linear-gradient(135deg, #C4A235 0%, #9A7820 100%)',
                    boxShadow: '0 2px 10px rgba(164,130,40,0.4)',
                    transition: 'all 0.2s ease',
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.06)'
                    e.currentTarget.style.boxShadow = '0 4px 16px rgba(164,130,40,0.55)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)'
                    e.currentTarget.style.boxShadow = '0 2px 10px rgba(164,130,40,0.4)'
                  }}
                >
                  <svg width={compact ? 15 : 17} height={compact ? 15 : 17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </button>
              </div>
            </form>
          </div>

          {/* ── Right: Menu ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {user ? (
              <>
                {/* Direkter Dashboard-Button */}
                <Link
                  href="/dashboard"
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    fontSize: '13px', fontWeight: 600, color: '#111',
                    padding: compact ? '7px 14px' : '9px 16px',
                    borderRadius: '999px',
                    border: '1px solid #E0DDD6',
                    backgroundColor: '#fff',
                    textDecoration: 'none',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.1)'; e.currentTarget.style.borderColor = '#CCC' }}
                  onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.05)'; e.currentTarget.style.borderColor = '#E0DDD6' }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
                  </svg>
                  {!compact && 'Dashboard'}
                </Link>

                {/* Avatar + Dropdown */}
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={() => setMenuOpen(!menuOpen)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      borderRadius: '999px', padding: '6px 6px 6px 14px',
                      border: '1px solid #E0DDD6', backgroundColor: '#fff',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                      cursor: 'pointer', transition: 'box-shadow 0.2s ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.1)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.05)' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth={2} strokeLinecap="round">
                      <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
                    </svg>
                    <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: 'linear-gradient(135deg, #C4A235, #8A6818)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '12px', fontWeight: 700 }}>
                      {initials}
                    </div>
                  </button>

                  {menuOpen && (
                    <div style={{ position: 'absolute', right: 0, top: '52px', width: '220px', background: '#fff', borderRadius: '18px', padding: '6px 0', zIndex: 100, boxShadow: '0 12px 40px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.05)' }}>
                      <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid #F2F0EC' }}>
                        <p style={{ fontSize: '13px', fontWeight: 600, color: '#111', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.user_metadata?.name || 'Nutzer'}</p>
                        <p style={{ fontSize: '11px', color: '#999', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</p>
                      </div>
                      <MenuItem href="/dashboard" onClick={() => setMenuOpen(false)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" style={{ display: 'inline', verticalAlign: 'middle', marginRight: '8px' }}>
                          <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
                        </svg>
                        Dashboard
                      </MenuItem>
                      <MenuItem href="/dashboard" onClick={() => setMenuOpen(false)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" style={{ display: 'inline', verticalAlign: 'middle', marginRight: '8px' }}>
                          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
                        </svg>
                        Meine Inserate
                      </MenuItem>
                      <MenuItem href="/bookings" onClick={() => setMenuOpen(false)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" style={{ display: 'inline', verticalAlign: 'middle', marginRight: '8px' }}>
                          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                        Meine Buchungen
                      </MenuItem>
                      <div style={{ borderTop: '1px solid #F2F0EC', marginTop: '4px', paddingTop: '4px' }}>
                        <button
                          onClick={() => { supabase.auth.signOut(); setMenuOpen(false) }}
                          style={{ width: '100%', textAlign: 'left', padding: '10px 18px', fontSize: '13px', color: '#666', background: 'none', border: 'none', cursor: 'pointer', borderRadius: '12px' }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#F7F5F2' }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                        >
                          Abmelden
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Link
                  href="/login"
                  style={{ fontSize: '13px', fontWeight: 500, color: '#111', padding: '9px 16px', borderRadius: '999px', textDecoration: 'none', transition: 'background 0.15s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#F2F0EC' }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                >
                  Anmelden
                </Link>
                <Link
                  href="/register"
                  style={{ fontSize: '13px', fontWeight: 600, color: '#fff', padding: '10px 20px', borderRadius: '999px', background: 'linear-gradient(135deg, #C4A235, #9A7820)', textDecoration: 'none', boxShadow: '0 2px 8px rgba(196,162,53,0.3)' }}
                >
                  Registrieren
                </Link>
              </div>
            )}
          </div>
        </div>
      </header>

      {(menuOpen || activeField) && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => { setMenuOpen(false); setActiveField(null) }}
        />
      )}
    </>
  )
}

function MenuItem({ href, onClick, children }: { href: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      style={{ display: 'block', padding: '10px 18px', fontSize: '13px', color: '#111', textDecoration: 'none', borderRadius: '12px' }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#F7F5F2' }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
    >
      {children}
    </Link>
  )
}
