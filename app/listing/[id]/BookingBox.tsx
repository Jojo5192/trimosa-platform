'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseBrowser as supabase } from '@/lib/supabase-browser'
import type { SmoobuRateMap } from '@/lib/smoobu'
import { t, MONTHS, DAYS_SHORT, type UiLang } from '@/lib/i18n'

interface BookingBoxProps {
  listingId: string
  pricePerNight: number
  hostId: string
  allowInstant?: boolean
  allowRequests?: boolean
  minRequestNights?: number
  cancellationPolicy?: string
  initialCheckIn?: string
  initialCheckOut?: string
  initialGuests?: number
  lang?: UiLang
  /** §161-Jupas ②: günstigster Nachtpreis der nächsten 90 Tage (Cache) */
  priceFrom?: number | null
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

const POLICY_LABELS: Record<string, string> = {
  flexibel: 'Kostenlose Stornierung bis 24h vor Check-in',
  moderat:  'Kostenlose Stornierung bis 5 Tage vor Check-in',
  strikt:   'Kostenlose Stornierung innerhalb 48h nach Buchung (mind. 14 Tage vor Check-in)',
}

/* ── Mini calendar ─────────────────────────────────────────── */
function CalendarMonth({
  year, month, rates, checkIn, checkOut, selecting,
  onSelectDate, minDate, lang = 'de',
}: {
  year: number; month: number
  rates: SmoobuRateMap
  checkIn: string; checkOut: string; selecting: 'in' | 'out'
  onSelectDate: (iso: string) => void
  minDate: string
  lang?: UiLang
}) {
  const firstDow = new Date(year, month, 1).getDay()
  const leadBlanks = firstDow === 0 ? 6 : firstDow - 1
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  function cellState(day: number) {
    const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
    const rate = rates[iso]
    const isPast = iso < minDate
    const isUnavailable = !isPast && rate?.available === 0
    // First day of a booked stretch: the NIGHT is taken, but the morning is a
    // valid check-out — show it as bookable (no strikethrough), like Airbnb
    // UTC parsen! Lokale Mitternacht (CEST) minus 24h fiele via toISOString auf VORVORtag.
    const prevIso = new Date(new Date(iso + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10)
    const checkoutEligible = isUnavailable && rates[prevIso]?.available !== 0
    const isCheckIn = iso === checkIn
    const isCheckOut = iso === checkOut
    const inRange = checkIn && checkOut && iso > checkIn && iso < checkOut
    return { iso, isPast, isUnavailable, checkoutEligible, isCheckIn, isCheckOut, inRange, price: rate?.price }
  }

  return (
    <div>
      <p style={{ fontSize: '13px', fontWeight: 700, color: '#111', textAlign: 'center', marginBottom: '10px' }}>
        {(lang === 'de' ? DE_MONTHS : MONTHS[lang])[month]} {year}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '4px' }}>
        {(lang === 'de' ? DE_DAYS_SHORT : DAYS_SHORT[lang]).map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: '10px', fontWeight: 600, color: '#999', padding: '2px 0' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
        {Array.from({ length: leadBlanks }).map((_, i) => <div key={`b${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
          const { iso, isPast, isUnavailable, checkoutEligible, isCheckIn, isCheckOut, inRange } = cellState(day)
          // A day whose NIGHT is booked is still a valid CHECK-OUT day (you
          // leave in the morning) — Airbnb & Co. handle it the same way.
          const checkoutOnly = checkoutEligible && selecting === 'out' && !!checkIn && iso > checkIn
          const disabled = isPast || (isUnavailable && !checkoutOnly)
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
                backgroundColor: isSelected ? '#111' : inRange ? 'rgba(17,17,17,0.08)' : 'transparent',
                color: isSelected ? '#fff' : isPast ? '#CCC' : isUnavailable && !checkoutEligible ? '#CCC' : isUnavailable ? '#777' : '#111',
                textDecoration: isUnavailable && !isPast && !checkoutEligible ? 'line-through' : 'none',
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
export default function BookingBox({
  listingId,
  pricePerNight,
  priceFrom = null,
  allowInstant = true,
  allowRequests = true,
  minRequestNights = 1,
  cancellationPolicy = 'moderat',
  initialCheckIn,
  initialCheckOut,
  initialGuests,
  lang = 'de',
}: BookingBoxProps) {
  const router = useRouter()

  // Mode: 'instant' | 'request'
  const [mode, setMode] = useState<'instant' | 'request'>(allowInstant ? 'instant' : 'request')

  const [checkIn, setCheckIn] = useState(initialCheckIn ?? '')
  const [checkOut, setCheckOut] = useState(initialCheckOut ?? '')
  const [selecting, setSelecting] = useState<'in' | 'out'>(initialCheckIn && !initialCheckOut ? 'out' : 'in')
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [calMonth, setCalMonth] = useState(() => {
    if (initialCheckIn) {
      const [y, m] = initialCheckIn.split('-').map(Number)
      return new Date(y, m - 1, 1)
    }
    return new Date()
  })

  const [adults, setAdults] = useState(initialGuests ?? 2)
  const [children, setChildren] = useState(0)
  const [message, setMessage] = useState('')
  const [priceSuggestion, setPriceSuggestion] = useState('')
  const [bppOpen, setBppOpen] = useState(false)

  // §243af: Gutscheincode — Anzeige-Validierung hier, autoritativ rechnet
  // der Server in /api/bookings mit derselben Rundung
  const [codeOpen, setCodeOpen] = useState(false)
  const [codeInput, setCodeInput] = useState('')
  const [codeChecking, setCodeChecking] = useState(false)
  const [codeError, setCodeError] = useState(false)
  const [discount, setDiscount] = useState<{ code: string; pct: number } | null>(null)

  async function redeemCode() {
    const c = codeInput.trim()
    if (!c || codeChecking) return
    setCodeChecking(true); setCodeError(false)
    try {
      const r = await fetch('/api/discount/validate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: c }),
      })
      const j = await r.json()
      if (j.ok && j.pct) { setDiscount({ code: j.code, pct: j.pct }); setCodeOpen(false); setCodeInput('') }
      else { setDiscount(null); setCodeError(true) }
    } catch { setCodeError(true) } finally { setCodeChecking(false) }
  }

  const [rates, setRates] = useState<SmoobuRateMap>({})
  const [loadingRates, setLoadingRates] = useState(true)
  const [totalPrice, setTotalPrice] = useState<number | null>(null)
  const [availability, setAvailability] = useState<{ available: boolean; minStayViolation: boolean } | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error' | 'unavailable' | 'profile-incomplete' | 'guest-incomplete' | 'email-exists'>('idle')
  // §266d Guest-Checkout: ohne Login klappt beim Buchen-Klick ein
  // Kontaktdaten-Formular auf — das Konto entsteht automatisch beim Buchen.
  const [guestOpen, setGuestOpen] = useState(false)
  const [guest, setGuest] = useState({ email: '', firstName: '', lastName: '', phone: '', street: '', zip: '', city: '', country: 'Deutschland' })
  const [loginHref, setLoginHref] = useState('/login')
  useEffect(() => {
    // Login-Ruecksprung MIT der aktuellen Auswahl (die Listing-Seite liest
    // ?checkin/checkout/guests nativ) — im Effect, nie im Render (SSR/window)
    const qs = new URLSearchParams()
    if (checkIn) qs.set('checkin', checkIn)
    if (checkOut) qs.set('checkout', checkOut)
    qs.set('guests', String(adults + children))
    const q = qs.toString() // .size erst ab Safari 17 — toString() ist überall da
    setLoginHref('/login?next=' + encodeURIComponent(window.location.pathname + (q ? '?' + q : '')))
  }, [checkIn, checkOut, adults, children])

  useEffect(() => {
    const from = today()
    const to = isoDate(new Date(Date.now() + 180 * 86400000))
    fetch(`/api/smoobu/availability?listingId=${listingId}&from=${from}&to=${to}`)
      .then(r => r.json())
      .then(d => { if (d.rates) setRates(d.rates) })
      .catch(() => {})
      .finally(() => setLoadingRates(false))
  }, [listingId])

  /* Listen for date selections from the occupancy calendar */
  useEffect(() => {
    function handleCalendarDates(e: Event) {
      const { checkIn: ci, checkOut: co } = (e as CustomEvent).detail
      if (ci) setCheckIn(ci)
      if (co) { setCheckOut(co); setSelecting('in'); setCalendarOpen(false) }
    }
    window.addEventListener('calendar-dates', handleCalendarDates)
    return () => window.removeEventListener('calendar-dates', handleCalendarDates)
  }, [])

  useEffect(() => {
    if (!checkIn || !checkOut) { setTotalPrice(null); setAvailability(null); return }
    fetch('/api/smoobu/availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // §224: Personenzahl mitschicken — Smoobu-Aufschlag ab 3./4. Person
      body: JSON.stringify({ listingId, checkIn, checkOut, guests: adults + children }),
    })
      .then(r => r.json())
      .then(d => {
        setTotalPrice(d.totalPrice ?? null)
        setAvailability({ available: d.available, minStayViolation: d.minStayViolation })
      })
      .catch(() => {})
  }, [listingId, checkIn, checkOut, adults, children])

  const handleSelectDate = useCallback((iso: string) => {
    if (selecting === 'in') {
      setCheckIn(iso); setCheckOut(''); setSelecting('out')
    } else {
      if (iso <= checkIn) {
        setCheckIn(iso); setCheckOut(''); setSelecting('out')
      } else {
        setCheckOut(iso); setSelecting('in'); setCalendarOpen(false)
      }
    }
  }, [selecting, checkIn])

  function formatDate(iso: string) {
    if (!iso) return ''
    const [, m, d] = iso.split('-')
    const months = lang === 'de' ? ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'] : MONTHS[lang]
    return lang === 'en' ? `${months[parseInt(m)-1].slice(0,3)} ${parseInt(d)}` : `${parseInt(d)}. ${months[parseInt(m)-1].slice(0,4)}`
  }

  function calcNights() {
    if (!checkIn || !checkOut) return 0
    return Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000)
  }

  const nights = calcNights()
  const displayPrice = totalPrice !== null ? totalPrice : (pricePerNight * nights || null)
  // §243af: Endpreis mit Gutschein (gleiche Rundung wie der Server)
  const finalPrice = displayPrice != null && discount
    ? Math.round(displayPrice * (1 - discount.pct / 100))
    : displayPrice
  const hasBothDates = !!(checkIn && checkOut)

  const requestNightsOk = mode === 'request' ? nights >= minRequestNights : true
  const canSubmit = hasBothDates && nights > 0 && (!availability || availability.available) && requestNightsOk

  async function handleSubmit() {
    if (!checkIn || !checkOut || nights <= 0) return
    setSubmitting(true)
    setStatus('idle')

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      // §266d: Erster Klick oeffnet das Kontakt-Formular (deutliches Feedback
      // statt totem Button); zweiter Klick validiert + bucht mit Auto-Konto.
      if (!guestOpen) {
        setGuestOpen(true)
        setStatus('idle')
        setSubmitting(false)
        return
      }
      const g = {
        email: guest.email.trim().toLowerCase(), firstName: guest.firstName.trim(), lastName: guest.lastName.trim(),
        phone: guest.phone.trim(), street: guest.street.trim(), zip: guest.zip.trim(), city: guest.city.trim(),
        country: guest.country.trim() || 'Deutschland',
      }
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(g.email)
      if (!emailOk || !g.firstName || !g.lastName || !g.phone || !g.street || !g.zip || !g.city) {
        setStatus('guest-incomplete')
        setSubmitting(false)
        return
      }
      try {
        const res = await fetch('/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            listingId, checkIn, checkOut, adults, children, message,
            booking_type: mode,
            guest_price_suggestion: mode === 'request' && priceSuggestion ? parseFloat(priceSuggestion) : undefined,
            ...(discount ? { discount_code: discount.code } : {}),
            guest: g,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.status === 409 && data.code === 'email-exists') { setStatus('email-exists'); setSubmitting(false); return }
        if (res.status === 409) { setStatus('unavailable'); setSubmitting(false); return }
        if (!res.ok || !data.checkoutUrl) { setStatus('error'); setSubmitting(false); return }
        window.location.href = data.checkoutUrl
      } catch {
        setStatus('error')
        setSubmitting(false)
      }
      return
    }

    // Check guest profile completeness (name + address required)
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_type, company_name, guest_first_name, guest_last_name, guest_street, guest_city, guest_zip')
      .eq('id', session.user.id)
      .maybeSingle()

    // Business accounts identify via company name — they have NO first/last
    // name, so requiring one locked them out of booking entirely.
    const nameComplete = profile?.account_type === 'business'
      ? !!profile?.company_name
      : !!(profile?.guest_first_name && profile?.guest_last_name)
    const profileComplete = !!(
      nameComplete &&
      profile?.guest_street &&
      profile?.guest_city &&
      profile?.guest_zip
    )

    if (!profileComplete) {
      setStatus('profile-incomplete')
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
        booking_type: mode,
        guest_price_suggestion: mode === 'request' && priceSuggestion ? parseFloat(priceSuggestion) : undefined,
        ...(discount ? { discount_code: discount.code } : {}),
      }),
    })

    const data = await res.json()

    if (res.status === 409) { setStatus('unavailable'); setSubmitting(false); return }
    if (!res.ok) { setStatus('error'); setSubmitting(false); return }

    // Redirect to Stripe payment
    const payRes = await fetch('/api/payments/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: data.bookingId }),
    })
    const payData = await payRes.json()
    if (payData.url) {
      window.location.href = payData.url
    } else {
      setStatus('error')
    }
    setSubmitting(false)
  }

  const minDate = today()
  // §266d: 16px Schrift — iOS zoomt bei Fokus auf Felder <16px automatisch
  const gInput: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', borderRadius: '10px', border: '1.5px solid #E0DDD6',
    padding: '10px 12px', fontSize: '16px', color: '#111', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff',
  }
  const inputStyle: React.CSSProperties = {
    width: '100%', borderRadius: '12px', border: '1.5px solid #E0DDD6',
    padding: '10px 14px', fontSize: '13px', color: '#111',
    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', backgroundColor: '#fff',
  }

  return (
    <div style={{ background: '#fff', borderRadius: '24px', padding: '24px', boxShadow: '0 8px 40px rgba(0,0,0,0.10)', border: '1px solid #EAEAEA' }}>

      {/* Price header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '16px' }}>
        {loadingRates ? (
          <div style={{ height: '28px', width: '100px', borderRadius: '6px', background: '#F5F5F7' }} />
        ) : hasBothDates && displayPrice ? (
          <>
            {discount && finalPrice != null && finalPrice !== displayPrice && (
              <s style={{ fontSize: '15px', color: '#98989E' }}>€ {displayPrice}</s>
            )}
            <span style={{ fontSize: '24px', fontWeight: 700, color: '#111' }}>€ {finalPrice}</span>
            <span style={{ fontSize: '13px', color: '#999' }}>/ {nights} {nights === 1 ? t(lang, 'Nacht') : t(lang, 'Nächte')}</span>
          </>
        ) : pricePerNight > 0 ? (
          <>
            <span style={{ fontSize: '24px', fontWeight: 700, color: '#111' }}>€ {pricePerNight}</span>
            <span style={{ fontSize: '13px', color: '#999' }}>/ Nacht</span>
          </>
        ) : priceFrom ? (
          <>
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#6E6E73' }}>{t(lang, 'ab')}</span>
            <span style={{ fontSize: '24px', fontWeight: 700, color: '#111' }}>€ {priceFrom}</span>
            <span style={{ fontSize: '13px', color: '#999' }}>/ {t(lang, 'Nacht')}</span>
          </>
        ) : (
          <span style={{ fontSize: '14px', fontWeight: 600, color: '#888' }}>{t(lang, 'Zeitraum eingeben für Preisangabe')}</span>
        )}
      </div>

      {/* §168b: Portal-Vergleich — Label + Portalpreis ROT durchgestrichen
          (~7 % = konservative Mitte der realen 5-10-%-Spanne) */}
      {!loadingRates && !(hasBothDates && displayPrice) && pricePerNight <= 0 && priceFrom ? (
        <div style={{ marginTop: '-10px', marginBottom: '16px', fontSize: '12.5px', color: '#98989E' }}>
          {t(lang, 'Durchschnittlicher Portalpreis')}:{' '}
          <s style={{ color: '#DC2626', fontWeight: 700, textDecorationColor: '#DC2626' }}>~€ {Math.round(priceFrom * 1.07)}</s>
        </div>
      ) : null}

      {/* Bestpreis-Garantie — Direktbuchung ohne Portalgebühren */}
      <div style={{ marginBottom: '16px', borderRadius: '12px', border: '1px solid #BBF7D0', background: '#F0FDF4', overflow: 'hidden' }}>
        <button
          type="button"
          onClick={() => setBppOpen(o => !o)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
            padding: '9px 12px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
          }}
        >
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#166534' }}>
            🏷️ {t(lang, 'Bestpreis-Garantie')}
          </span>
          <span style={{ fontSize: '10px', color: '#16A34A', flexShrink: 0 }}>{bppOpen ? '▲' : '▼'}</span>
        </button>
        {bppOpen && (
          <div style={{ padding: '0 12px 10px' }}>
            <p style={{ fontSize: '11.5px', color: '#166534', lineHeight: 1.55, margin: '0 0 6px' }}>
              {t(lang, 'Auf trimosa.de zahlst du keine Vermittlungs- und Servicegebühren: Dieselbe Wohnung kostet dich zum selben Zeitraum auf Airbnb, Booking.com oder FeWo-direkt im Schnitt 5–10 % mehr — du buchst hier direkt bei uns Gastgebern.')}
            </p>
            <p style={{ fontSize: '11.5px', color: '#166534', lineHeight: 1.55, margin: 0, fontWeight: 600 }}>
              {t(lang, 'Findest du denselben Zeitraum dort trotzdem günstiger, gleichen wir den Preis an — schreib uns einfach.')}
            </p>
          </div>
        )}
      </div>

      {/* Mode Toggle */}
      {allowInstant && allowRequests && (
        <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', padding: '4px', background: '#F5F3EF', borderRadius: '12px' }}>
          {([['instant', t(lang, '⚡ Sofort buchen')], ['request', t(lang, '✉ Anfrage stellen')]] as const).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              style={{
                flex: 1, padding: '8px 10px', borderRadius: '9px', border: 'none',
                fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                background: mode === m ? '#fff' : 'transparent',
                color: mode === m ? '#111' : '#888',
                boxShadow: mode === m ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Only instant label if no requests */}
      {allowInstant && !allowRequests && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', marginBottom: '14px', fontSize: '12px', fontWeight: 600, color: '#16A34A', background: '#F0FDF4', padding: '4px 10px', borderRadius: '99px' }}>
          {t(lang, '⚡ Sofortbuchung verfügbar')}
        </div>
      )}

      {/* Only requests label */}
      {!allowInstant && allowRequests && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', marginBottom: '14px', fontSize: '12px', fontWeight: 600, color: '#92400E', background: '#FFF7ED', padding: '4px 10px', borderRadius: '99px' }}>
          {t(lang, '✉ Nur Anfragen möglich')}
        </div>
      )}

      {/* Date picker trigger */}
      <div
        style={{ borderRadius: '14px', border: `1.5px solid ${calendarOpen ? '#111' : '#E0DDD6'}`, overflow: 'hidden', marginBottom: '12px', cursor: 'pointer', transition: 'border-color 0.15s' }}
        onClick={() => setCalendarOpen(o => !o)}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: calendarOpen ? '1px solid #F0EEE8' : 'none' }}>
          <div style={{ padding: '12px 14px', borderRight: '1px solid #F0EEE8', background: selecting === 'in' && calendarOpen ? '#FAFAFA' : '#fff' }}>
            <p style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', color: '#AAA', textTransform: 'uppercase', margin: '0 0 3px' }}>{t(lang, 'Anreise')}</p>
            <p style={{ fontSize: '13px', fontWeight: checkIn ? 600 : 400, color: checkIn ? '#111' : '#BBB', margin: 0 }}>
              {checkIn ? formatDate(checkIn) : t(lang, 'Datum wählen')}
            </p>
          </div>
          <div style={{ padding: '12px 14px', background: selecting === 'out' && calendarOpen ? '#FAFAFA' : '#fff' }}>
            <p style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', color: '#AAA', textTransform: 'uppercase', margin: '0 0 3px' }}>{t(lang, 'Abreise')}</p>
            <p style={{ fontSize: '13px', fontWeight: checkOut ? 600 : 400, color: checkOut ? '#111' : '#BBB', margin: 0 }}>
              {checkOut ? formatDate(checkOut) : t(lang, 'Datum wählen')}
            </p>
          </div>
        </div>
      </div>

      {/* Calendar */}
      {calendarOpen && (
        <div style={{ marginBottom: '12px', padding: '16px', background: '#FAFAFA', borderRadius: '14px', border: '1px solid #F0EEE8' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <button type="button" onClick={() => setCalMonth(m => addMonths(m, -1))}
              style={{ background: 'none', border: '1px solid #E0DDD6', borderRadius: '8px', width: '30px', height: '30px', cursor: 'pointer', fontSize: '14px' }}>‹</button>
            <span style={{ fontSize: '12px', color: '#888' }}>{selecting === 'in' ? t(lang, 'Anreise wählen') : t(lang, 'Abreise wählen')}</span>
            <button type="button" onClick={() => setCalMonth(m => addMonths(m, 1))}
              style={{ background: 'none', border: '1px solid #E0DDD6', borderRadius: '8px', width: '30px', height: '30px', cursor: 'pointer', fontSize: '14px' }}>›</button>
          </div>
          <div className="detail-bb-cal-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            <CalendarMonth lang={lang} year={calMonth.getFullYear()} month={calMonth.getMonth()}
              rates={rates} checkIn={checkIn} checkOut={checkOut}
              selecting={selecting} onSelectDate={handleSelectDate} minDate={minDate} />
            <CalendarMonth lang={lang} year={addMonths(calMonth,1).getFullYear()} month={addMonths(calMonth,1).getMonth()}
              rates={rates} checkIn={checkIn} checkOut={checkOut}
              selecting={selecting} onSelectDate={handleSelectDate} minDate={minDate} />
          </div>
          <div style={{ display: 'flex', gap: '16px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #F0EEE8' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: '#999' }}>
              <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', background: '#111' }} />Ausgewählt
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: '#999' }}>
              <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', background: '#CCC' }} />Belegt
            </div>
          </div>
        </div>
      )}

      {/* Guests */}
      <div style={{ borderRadius: '14px', border: '1.5px solid #E0DDD6', padding: '12px 14px', marginBottom: '12px' }}>
        <p style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', color: '#AAA', textTransform: 'uppercase', margin: '0 0 10px' }}>{t(lang, 'Gäste')}</p>
        {[
          { label: t(lang, 'Erwachsene'), sub: t(lang, 'ab 13 Jahren'), val: adults, set: setAdults, min: 1, max: 16 },
          { label: t(lang, 'Kinder'), sub: t(lang, 'bis 12 Jahre'), val: children, set: setChildren, min: 0, max: 10 },
        ].map(({ label, sub, val, set, min, max }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div>
              <p style={{ fontSize: '13px', fontWeight: 500, color: '#111', margin: 0 }}>{label}</p>
              <p style={{ fontSize: '11px', color: '#999', margin: 0 }}>{sub}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button type="button" onClick={() => set(v => Math.max(min, v-1))} disabled={val <= min}
                style={{ width: '28px', height: '28px', borderRadius: '50%', border: '1.5px solid #E0DDD6', background: '#fff', cursor: val <= min ? 'not-allowed' : 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: val <= min ? '#DDD' : '#111' }}>
                −
              </button>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#111', minWidth: '16px', textAlign: 'center' }}>{val}</span>
              <button type="button" onClick={() => set(v => Math.min(max, v+1))} disabled={val >= max}
                style={{ width: '28px', height: '28px', borderRadius: '50%', border: '1.5px solid #E0DDD6', background: '#fff', cursor: val >= max ? 'not-allowed' : 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: val >= max ? '#DDD' : '#111' }}>
                +
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Request-specific: price suggestion */}
      {mode === 'request' && (
        <div style={{ marginBottom: '12px' }}>
          <p style={{ fontSize: '11px', fontWeight: 700, color: '#888', letterSpacing: '0.05em', textTransform: 'uppercase', margin: '0 0 6px' }}>
            {t(lang, 'Preisvorschlag (optional)')}
          </p>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '13px', color: '#888' }}>€</span>
            <input
              type="number"
              min="0"
              step="1"
              value={priceSuggestion}
              onChange={e => setPriceSuggestion(e.target.value)}
              placeholder={displayPrice ? String(Math.round(displayPrice)) : 'Gesamtpreis vorschlagen'}
              style={{ ...inputStyle, paddingLeft: '26px' }}
            />
          </div>
          <p style={{ fontSize: '11px', color: '#AAA', margin: '4px 0 0' }}>
            Aktueller Listenpreis: € {displayPrice ?? '—'} gesamt
          </p>
        </div>
      )}

      {/* Message */}
      <textarea
        value={message}
        onChange={e => setMessage(e.target.value)}
        placeholder={mode === 'instant' ? t(lang, 'Nachricht an den Gastgeber (optional)') : t(lang, 'Deine Anfrage / Nachricht an den Gastgeber')}
        rows={2}
        style={{ ...inputStyle, resize: 'none', marginBottom: '12px' }}
      />

      {/* Price breakdown */}
      {hasBothDates && nights > 0 && (
        <div style={{ padding: '12px 0', borderTop: '1px solid #F0EEE8', borderBottom: '1px solid #F0EEE8', marginBottom: '12px' }}>
          {availability?.minStayViolation && (
            <p style={{ fontSize: '11px', color: '#E67E22', marginBottom: '6px' }}>{t(lang, '⚠ Mindestaufenthalt nicht erfüllt.')}</p>
          )}
          {mode === 'request' && nights < minRequestNights && (
            <p style={{ fontSize: '11px', color: '#E67E22', marginBottom: '6px' }}>
              {t(lang, '⚠ Anfragen erst ab {n} Nächten möglich.', { n: minRequestNights })}
            </p>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#555', marginBottom: '4px' }}>
            <span>€ {displayPrice != null && nights > 0 ? Math.round(displayPrice / nights) : pricePerNight} × {nights} {nights === 1 ? t(lang, 'Nacht') : t(lang, 'Nächte')}</span>
            <span>≈ € {displayPrice ?? '—'}</span>
          </div>
          {discount && displayPrice != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 600, color: '#16A34A', marginBottom: '4px' }}>
              <span>🏷 {discount.code} (−{discount.pct} %)</span>
              <span>− € {displayPrice - (finalPrice ?? displayPrice)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 700, color: '#111' }}>
            <span>{t(lang, 'Gesamt')}</span>
            <span>€ {finalPrice ?? '—'}</span>
          </div>
        </div>
      )}

      {/* §243af: Gutscheincode */}
      <div style={{ marginBottom: '12px' }}>
        {discount ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '12.5px', color: '#16A34A', fontWeight: 600 }}>
            <span>✓ {t(lang, 'Gutscheincode aktiv:')} {discount.code} (−{discount.pct} %)</span>
            <button onClick={() => setDiscount(null)} style={{ background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: '13px', padding: 0 }}>✕</button>
          </div>
        ) : !codeOpen ? (
          <button onClick={() => { setCodeOpen(true); setCodeError(false) }} style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            fontSize: '12.5px', color: '#8A8578', textDecoration: 'underline',
          }}>🏷 {t(lang, 'Gutscheincode einlösen')}</button>
        ) : (
          <div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={codeInput} onChange={(e) => { setCodeInput(e.target.value.toUpperCase()); setCodeError(false) }}
                onKeyDown={(e) => { if (e.key === 'Enter') redeemCode() }}
                placeholder={t(lang, 'Code')} autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                style={{ flex: 1, minWidth: 0, borderRadius: '10px', border: `1.5px solid ${codeError ? '#FCA5A5' : '#E0DDD6'}`, padding: '9px 12px', fontSize: '16px', textTransform: 'uppercase' }} />
              <button onClick={redeemCode} disabled={codeChecking || !codeInput.trim()} style={{
                borderRadius: '10px', border: 'none', background: '#12222E', color: '#fff',
                fontSize: '13.5px', fontWeight: 700, padding: '0 16px', cursor: 'pointer',
                opacity: codeChecking || !codeInput.trim() ? 0.55 : 1, whiteSpace: 'nowrap',
              }}>{codeChecking ? '…' : t(lang, 'Einlösen')}</button>
            </div>
            {codeError && <p style={{ fontSize: '12px', color: '#DC2626', margin: '6px 0 0' }}>{t(lang, 'Code ungültig oder abgelaufen.')}</p>}
          </div>
        )}
      </div>

      {/* Request disclaimer */}
      {mode === 'request' && (
        <div style={{ marginBottom: '12px', padding: '10px 14px', background: '#FFF7ED', borderRadius: '10px', border: '1px solid #FED7AA' }}>
          <p style={{ fontSize: '12px', color: '#92400E', margin: 0, lineHeight: 1.5 }}>
            ⚠️ <strong>{t(lang, 'Wichtig:')}</strong> {t(lang, 'Der Zeitraum wird erst nach Bestätigung durch den Gastgeber blockiert. Bis dahin können andere Gäste den selben Zeitraum buchen.')}
          </p>
        </div>
      )}

      {/* §266d Guest-Checkout: Kontaktdaten-Formular (nur ohne Login) */}
      {guestOpen && (
        <div style={{ marginBottom: '12px', padding: '14px', background: '#FAF8F2', borderRadius: '12px', border: '1px solid #EFE9D8' }}>
          <p style={{ fontSize: '13.5px', fontWeight: 800, color: '#2A2620', margin: '0 0 2px' }}>{t(lang, 'Fast geschafft — deine Kontaktdaten')}</p>
          <p style={{ fontSize: '11.5px', color: '#8A8065', margin: '0 0 10px', lineHeight: 1.5 }}>
            {t(lang, 'Wir legen dir dabei automatisch ein Gastkonto an: Rechnung online abrufen, Buchung verwalten, direkter Chat. Den Link zum Passwort-Festlegen bekommst du per E-Mail.')}
          </p>
          <input value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} type="email" inputMode="email" autoComplete="email" placeholder={t(lang, 'E-Mail')} style={gInput} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input value={guest.firstName} onChange={(e) => setGuest({ ...guest, firstName: e.target.value })} autoComplete="given-name" placeholder={t(lang, 'Vorname')} style={{ ...gInput, flex: 1, minWidth: 0 }} />
            <input value={guest.lastName} onChange={(e) => setGuest({ ...guest, lastName: e.target.value })} autoComplete="family-name" placeholder={t(lang, 'Nachname')} style={{ ...gInput, flex: 1, minWidth: 0 }} />
          </div>
          <input value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} type="tel" inputMode="tel" autoComplete="tel" placeholder={t(lang, 'Telefon')} style={{ ...gInput, marginTop: 8 }} />
          <input value={guest.street} onChange={(e) => setGuest({ ...guest, street: e.target.value })} autoComplete="street-address" placeholder={t(lang, 'Straße & Hausnummer')} style={{ ...gInput, marginTop: 8 }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input value={guest.zip} onChange={(e) => setGuest({ ...guest, zip: e.target.value })} autoComplete="postal-code" placeholder={t(lang, 'PLZ')} style={{ ...gInput, flex: '0 0 32%' }} />
            <input value={guest.city} onChange={(e) => setGuest({ ...guest, city: e.target.value })} autoComplete="address-level2" placeholder={t(lang, 'Ort')} style={{ ...gInput, flex: 1, minWidth: 0 }} />
          </div>
          <input value={guest.country} onChange={(e) => setGuest({ ...guest, country: e.target.value })} autoComplete="country-name" placeholder={t(lang, 'Land')} style={{ ...gInput, marginTop: 8 }} />
          <p style={{ fontSize: '11.5px', color: '#8A8065', margin: '10px 0 0' }}>
            {t(lang, 'Schon ein Konto?')}{' '}
            <a href={loginHref} style={{ fontWeight: 700, color: 'var(--gold-dark)', textDecoration: 'underline' }}>{t(lang, 'Anmelden')}</a> — {t(lang, 'deine Auswahl bleibt erhalten.')}
          </p>
        </div>
      )}

      {/* Status messages */}
      {status === 'success' && (
        <div style={{ borderRadius: '12px', padding: '12px 14px', background: '#F0FDF4', border: '1px solid #BBF7D0', marginBottom: '12px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#16A34A', margin: 0 }}>
            {mode === 'instant' ? t(lang, '✓ Buchung erfolgreich!') : t(lang, '✓ Anfrage gesendet!')}
          </p>
          <p style={{ fontSize: '11px', color: '#22C55E', margin: '2px 0 0' }}>{t(lang, 'Du wirst weitergeleitet…')}</p>
        </div>
      )}
      {status === 'unavailable' && (
        <div style={{ borderRadius: '12px', padding: '12px 14px', background: '#FEF2F2', border: '1px solid #FECACA', marginBottom: '12px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#DC2626', margin: 0 }}>{t(lang, 'Diese Daten sind leider nicht verfügbar.')}</p>
          <p style={{ fontSize: '11px', color: '#EF4444', margin: '2px 0 0' }}>{t(lang, 'Bitte wähle andere Reisedaten.')}</p>
        </div>
      )}
      {status === 'error' && (
        <p style={{ fontSize: '12px', color: '#DC2626', marginBottom: '12px' }}>{t(lang, 'Etwas ist schiefgelaufen. Bitte erneut versuchen.')}</p>
      )}
      {status === 'guest-incomplete' && (
        <div style={{ borderRadius: '12px', padding: '12px 14px', background: '#FFF7ED', border: '1px solid #FED7AA', marginBottom: '12px' }}>
          <p style={{ fontSize: '13px', color: '#92400E', margin: 0 }}>
            {t(lang, 'Bitte fülle alle Kontaktfelder aus — dann kann es losgehen.')}
          </p>
        </div>
      )}
      {status === 'email-exists' && (
        <div style={{ borderRadius: '12px', padding: '12px 14px', background: '#FFF7ED', border: '1px solid #FED7AA', marginBottom: '12px' }}>
          <p style={{ fontSize: '13px', color: '#92400E', margin: 0 }}>
            {t(lang, 'Mit dieser E-Mail-Adresse gibt es schon ein Konto.')}{' '}
            <a href={loginHref} style={{ fontWeight: 700, textDecoration: 'underline', color: '#92400E' }}>{t(lang, 'Anmelden')}</a> — {t(lang, 'deine Auswahl bleibt erhalten.')}
          </p>
        </div>
      )}
      {status === 'profile-incomplete' && (
        <div style={{ borderRadius: '12px', padding: '12px 14px', background: '#FFF7ED', border: '1px solid #FED7AA', marginBottom: '12px' }}>
          <p style={{ fontSize: '13px', color: '#92400E', margin: '0 0 6px', fontWeight: 700 }}>{t(lang, 'Profil unvollständig')}</p>
          <p style={{ fontSize: '12px', color: '#92400E', margin: '0 0 8px' }}>
            {t(lang, 'Bitte ergänze Vor- und Nachname sowie deine Adresse, um buchen zu können.')}
          </p>
          <a href="/guest/profile" style={{ fontSize: '12px', fontWeight: 700, color: '#92400E', textDecoration: 'underline' }}>{t(lang, 'Profil vervollständigen →')}</a>
        </div>
      )}

      {/* CTA */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting || !canSubmit || status === 'success'}
        style={{
          width: '100%', padding: '14px', borderRadius: '14px', border: 'none',
          background: canSubmit ? 'var(--gold)' : '#E5E5E5',
          color: canSubmit ? '#fff' : '#AAA',
          fontSize: '14px', fontWeight: 700,
          cursor: !canSubmit || submitting || status === 'success' ? 'not-allowed' : 'pointer',
          transition: 'all 0.15s',
        }}
      >
        {submitting
          ? t(lang, 'Wird verarbeitet…')
          : !checkIn ? t(lang, 'Anreisedatum wählen')
          : !checkOut ? t(lang, 'Abreisedatum wählen')
          : mode === 'instant' ? t(lang, '⚡ Jetzt buchen')
          : t(lang, '✉ Anfrage senden')}
      </button>

      {/* Footer info */}
      <div style={{ marginTop: '12px' }}>
        {guestOpen && (
          <p style={{ textAlign: 'center', fontSize: '10.5px', color: '#BBB', margin: '0 0 6px' }}>
            {t(lang, 'Mit deiner Buchung akzeptierst du unsere')}{' '}
            <a href="/agb" target="_blank" rel="noreferrer" style={{ color: '#999', textDecoration: 'underline' }}>{t(lang, 'AGB')}</a>
            {' & '}
            <a href="/datenschutz" target="_blank" rel="noreferrer" style={{ color: '#999', textDecoration: 'underline' }}>{t(lang, 'Datenschutz')}</a>.
          </p>
        )}
        {mode === 'instant' ? (
          <p style={{ textAlign: 'center', fontSize: '11px', color: '#BBB', margin: '0 0 6px' }}>
            {t(lang, 'Sofortige Bestätigung · Keine versteckten Gebühren')}
          </p>
        ) : (
          <p style={{ textAlign: 'center', fontSize: '11px', color: '#BBB', margin: '0 0 6px' }}>
            {t(lang, 'Noch keine Zahlung · Der Gastgeber antwortet in der Regel binnen 24h')}
          </p>
        )}
        {cancellationPolicy && POLICY_LABELS[cancellationPolicy] && (
          <p style={{ textAlign: 'center', fontSize: '11px', color: '#AAA', margin: 0 }}>
            🛡 {t(lang, POLICY_LABELS[cancellationPolicy])}
          </p>
        )}
      </div>
    </div>
  )
}
