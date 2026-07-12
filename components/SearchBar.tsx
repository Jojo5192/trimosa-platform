'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  initialQ?: string
  initialGuests?: string
  initialCheckin?: string
  initialCheckout?: string
}

export default function SearchBar({ initialQ = '', initialGuests = '', initialCheckin = '', initialCheckout = '' }: Props) {
  const router = useRouter()
  const [q, setQ] = useState(initialQ)
  const [guests, setGuests] = useState(initialGuests)
  const [checkin, setCheckin] = useState(initialCheckin)
  const [checkout, setCheckout] = useState(initialCheckout)
  const [activeField, setActiveField] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setActiveField(null)
    const params = new URLSearchParams()
    if (q.trim()) params.set('q', q.trim())
    if (guests) params.set('guests', guests)
    if (checkin) params.set('checkin', checkin)
    if (checkout) params.set('checkout', checkout)
    const qs = params.toString()
    router.push(qs ? `/?${qs}` : '/')
  }

  const fieldStyle = (name: string): React.CSSProperties => ({
    backgroundColor: activeField === name ? '#fff' : 'transparent',
    borderRadius: '999px',
    transition: 'all 0.2s ease',
    boxShadow: activeField === name ? '0 2px 16px rgba(0,0,0,0.12)' : 'none',
  })

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="relative flex items-center w-full"
      style={{
        borderRadius: '999px',
        backgroundColor: '#F0EEEA',
        border: '1px solid #E0DDD6',
        height: '62px',
        transition: 'box-shadow 0.3s ease',
        boxShadow: activeField
          ? '0 6px 20px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)'
          : '0 1px 6px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.02)',
      }}
    >
      {/* Wohin */}
      <div
        className="flex-[2.5] h-full flex flex-col justify-center cursor-pointer min-w-0"
        style={{ ...fieldStyle('q'), paddingLeft: '28px', paddingRight: '12px' }}
        onClick={() => {
          setActiveField('q')
          formRef.current?.querySelector<HTMLInputElement>('input[name="q"]')?.focus()
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 700, color: '#1A1A1A', letterSpacing: '0.03em', lineHeight: 1 }}>
          Wohin
        </span>
        <input
          name="q"
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setActiveField('q')}
          onBlur={() => setActiveField(null)}
          placeholder="Ort suchen..."
          autoComplete="off"
          style={{
            fontSize: '14px',
            color: '#1A1A1A',
            outline: 'none',
            border: 'none',
            background: 'transparent',
            width: '100%',
            marginTop: '2px',
            lineHeight: 1.2,
          }}
          className="placeholder-gray-400 truncate"
        />
      </div>

      {/* Divider */}
      <div style={{ width: '1px', height: '28px', backgroundColor: '#D5D1CA', flexShrink: 0 }} />

      {/* Anreise */}
      <div
        className="flex-1 h-full hidden sm:flex flex-col justify-center cursor-pointer min-w-0"
        style={{ ...fieldStyle('checkin'), padding: '0 14px' }}
        onClick={() => {
          setActiveField('checkin')
          formRef.current?.querySelector<HTMLInputElement>('input[name="checkin"]')?.showPicker?.()
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 700, color: '#1A1A1A', letterSpacing: '0.03em', lineHeight: 1 }}>
          Anreise
        </span>
        <input
          name="checkin"
          type="date"
          value={checkin}
          onChange={(e) => setCheckin(e.target.value)}
          onFocus={() => setActiveField('checkin')}
          onBlur={() => setActiveField(null)}
          style={{
            fontSize: '14px',
            color: checkin ? '#1A1A1A' : '#9A9590',
            outline: 'none',
            border: 'none',
            background: 'transparent',
            width: '100%',
            marginTop: '2px',
            lineHeight: 1.2,
          }}
        />
      </div>

      {/* Divider */}
      <div className="hidden sm:block" style={{ width: '1px', height: '28px', backgroundColor: '#D5D1CA', flexShrink: 0 }} />

      {/* Abreise */}
      <div
        className="flex-1 h-full hidden sm:flex flex-col justify-center cursor-pointer min-w-0"
        style={{ ...fieldStyle('checkout'), padding: '0 14px' }}
        onClick={() => {
          setActiveField('checkout')
          formRef.current?.querySelector<HTMLInputElement>('input[name="checkout"]')?.showPicker?.()
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 700, color: '#1A1A1A', letterSpacing: '0.03em', lineHeight: 1 }}>
          Abreise
        </span>
        <input
          name="checkout"
          type="date"
          value={checkout}
          onChange={(e) => setCheckout(e.target.value)}
          onFocus={() => setActiveField('checkout')}
          onBlur={() => setActiveField(null)}
          style={{
            fontSize: '14px',
            color: checkout ? '#1A1A1A' : '#9A9590',
            outline: 'none',
            border: 'none',
            background: 'transparent',
            width: '100%',
            marginTop: '2px',
            lineHeight: 1.2,
          }}
        />
      </div>

      {/* Divider */}
      <div className="hidden sm:block" style={{ width: '1px', height: '28px', backgroundColor: '#D5D1CA', flexShrink: 0 }} />

      {/* Gäste */}
      <div
        className="hidden sm:flex flex-col justify-center cursor-pointer min-w-0"
        style={{ ...fieldStyle('guests'), padding: '0 14px', width: '110px', height: '100%', flexShrink: 0 }}
        onClick={() => {
          setActiveField('guests')
          formRef.current?.querySelector<HTMLSelectElement>('select[name="guests"]')?.focus()
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 700, color: '#1A1A1A', letterSpacing: '0.03em', lineHeight: 1 }}>
          Gäste
        </span>
        <select
          name="guests"
          value={guests}
          onChange={(e) => setGuests(e.target.value)}
          onFocus={() => setActiveField('guests')}
          onBlur={() => setActiveField(null)}
          style={{
            fontSize: '14px',
            color: guests ? '#1A1A1A' : '#9A9590',
            outline: 'none',
            border: 'none',
            background: 'transparent',
            width: '100%',
            marginTop: '2px',
            lineHeight: 1.2,
            appearance: 'none',
            WebkitAppearance: 'none',
          }}
        >
          <option value="">Beliebig</option>
          {[1,2,3,4,5,6,7,8].map(n => (
            <option key={n} value={String(n)}>{n} {n === 1 ? 'Gast' : 'Gäste'}</option>
          ))}
        </select>
      </div>

      {/* Search Button */}
      <div style={{ padding: '0 8px 0 4px', flexShrink: 0 }}>
        <button
          type="submit"
          className="search-btn"
          style={{
            width: '46px',
            height: '46px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            background: 'linear-gradient(135deg, var(--gold) 0%, var(--gold) 50%, var(--gold-dark) 100%)',
            boxShadow: '0 2px 8px rgba(176, 145, 43, 0.35)',
            transition: 'all 0.25s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.08)'
            e.currentTarget.style.boxShadow = '0 4px 16px rgba(176, 145, 43, 0.5)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)'
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(176, 145, 43, 0.35)'
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
      </div>
    </form>
  )
}
