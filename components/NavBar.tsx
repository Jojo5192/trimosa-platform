'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseBrowser as supabase } from '@/lib/supabase-browser'
import type { User } from '@supabase/supabase-js'
import ChatOverlay from '@/components/ChatOverlay'
import OnboardingModal from '@/components/OnboardingModal'
import { LOCATION_SUGGESTIONS, formatDate } from '@/components/navbar/search-utils'
import { DatePickerPopover } from '@/components/navbar/DatePicker'
import GuestPickerPopover from '@/components/navbar/GuestPickerPopover'
import UserMenu from '@/components/navbar/UserMenu'
import MobileSearchSheet from '@/components/navbar/MobileSearchSheet'

interface NavBarProps {
  initialQ?: string
  initialGuests?: string
  initialCheckin?: string
  initialCheckout?: string
  initialFlex?: boolean
}

/* ─── Main NavBar ─────────────────────────────────────── */
export default function NavBar({ initialQ = '', initialGuests = '', initialCheckin = '', initialCheckout = '', initialFlex = false }: NavBarProps) {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [compact, setCompact] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [chatOpen, setChatOpen] = useState(false)
  /* Listen for open-chat events from MobileBookingBar */
  useEffect(() => {
    function handleOpenChat() { setChatOpen(true) }
    window.addEventListener('open-chat', handleOpenChat)
    return () => window.removeEventListener('open-chat', handleOpenChat)
  }, [])
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)

  const [q, setQ] = useState(initialQ)
  const [checkin, setCheckin] = useState(initialCheckin)
  const [checkout, setCheckout] = useState(initialCheckout)
  const [flexDates, setFlexDates] = useState(initialFlex)
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
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user ?? null
      setUser(u)
      if (u) loadProfile(u.id, u.user_metadata)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_ev, s) => {
      const u = s?.user ?? null
      setUser(u)
      if (u) loadProfile(u.id, u.user_metadata)
      else { setAvatarUrl(null); setUnreadCount(0); setShowOnboarding(false) }
    })
    const onScroll = () => {
      const c = window.scrollY > 60
      setCompact(c)
      document.documentElement.style.setProperty('--navbar-h', c ? '64px' : '88px')
    }
    document.documentElement.style.setProperty('--navbar-h', '88px')
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { listener.subscription.unsubscribe(); window.removeEventListener('scroll', onScroll) }
  }, [])

  async function loadProfile(userId: string, userMeta?: Record<string, unknown>) {
    const { data } = await supabase.from('profiles').select('avatar_url, guest_first_name').eq('id', userId).maybeSingle()
    if (data?.avatar_url) setAvatarUrl(data.avatar_url)

    // Show onboarding modal if guest hasn't filled in personal data
    const role = userMeta?.role as string | undefined
    const isGuest = !role || role === 'guest'
    if (isGuest && !data?.guest_first_name) {
      setShowOnboarding(true)
    }
  }

  // Poll for unread chat messages + browser notifications when new message arrives
  useEffect(() => {
    if (!user) return
    let prevCount = -1 // -1 = first run, skip notification on initial load

    async function checkUnread() {
      const res = await fetch('/api/chat')
      if (!res.ok) return
      const convs: Array<{ unread: number; guest_name?: string; host_name?: string }> = await res.json()
      const count = convs.reduce((sum, c) => sum + (c.unread ?? 0), 0)
      setUnreadCount(count)

      // Browser notification when new message arrives and chat overlay is closed
      if (prevCount >= 0 && count > prevCount && !chatOpen) {
        if (typeof window !== 'undefined' && 'Notification' in window) {
          if (Notification.permission === 'granted') {
            const newConv = convs.find(c => c.unread > 0)
            new Notification('Neue Nachricht – Trimosa', {
              body: newConv
                ? `${newConv.guest_name || newConv.host_name || 'Jemand'} hat dir geschrieben`
                : `${count} ungelesene Nachricht${count > 1 ? 'en' : ''}`,
              icon: '/favicon.ico',
            })
          } else if (Notification.permission === 'default') {
            Notification.requestPermission()
          }
        }
      }
      prevCount = count
    }

    checkUnread()
    // Poll every 10s when tab visible, skip when hidden to save resources
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'hidden') {
        checkUnread()
      }
    }, 10000)
    return () => clearInterval(id)
  }, [user, chatOpen])

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

  function submitSearch() {
    const params = new URLSearchParams()
    if (q.trim()) params.set('q', q.trim())
    if (totalGuests > 1) params.set('guests', String(totalGuests))
    if (checkin) params.set('checkin', checkin)
    if (checkout) params.set('checkout', checkout)
    if (flexDates && checkin && checkout) params.set('flex', '3')
    router.push(params.toString() ? `/?${params}` : '/')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setActiveField(null)
    submitSearch()
  }

  const isHost = user?.user_metadata?.role === 'host'
  const initials = (user?.user_metadata?.name || user?.email || 'U')[0].toUpperCase()
  const chatHref = isHost ? '/dashboard/chat' : '/guest/chat'
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
        <div className="nav-inner" style={{ padding: '0 20px', display: 'flex', alignItems: 'center', gap: '16px', height: '100%', width: '100%' }}>

          {/* Logo */}
          <Link href="/" className="nav-logo" style={{ flexShrink: 0, textDecoration: 'none' }}>
            <Image src="/logo.png" alt="TRIMOSA" width={2924} height={354} priority style={{ height: logoH, width: 'auto', transition: 'height 0.3s ease' }} />
          </Link>

          {/* ── Mobile Search Trigger (hidden on md+) ── */}
          <button
            className="flex lg:hidden"
            onClick={() => setMobileSearchOpen(true)}
            style={{
              flex: 1, margin: '0 4px', height: '44px', borderRadius: '999px',
              backgroundColor: '#F7F5F2', border: '1px solid #E8E4DC',
              alignItems: 'center', padding: '0 14px', gap: '10px',
              cursor: 'pointer', textAlign: 'left', minWidth: 0,
              boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: q ? '#111' : '#555', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {q || 'Wohin?'}
              </p>
              <p style={{ margin: 0, fontSize: '11px', color: '#999', lineHeight: 1 }}>
                {checkin && checkout
                  ? `${formatDate(checkin)} – ${formatDate(checkout)}${adults + kids > 1 ? ` · ${adults + kids} Gäste` : ''}`
                  : checkin
                    ? `Ab ${formatDate(checkin)}`
                    : adults + kids > 1
                      ? `${adults + kids} Gäste`
                      : 'Datum · Gäste'}
              </p>
            </div>
          </button>

          {/* Search Bar — desktop only */}
          <div className="hidden lg:flex" style={{ flex: 1, justifyContent: 'center', minWidth: 0, maxWidth: '700px', margin: '0 auto' }}>
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
                className="hidden lg:flex"
                style={fieldStyle('date', { flex: '1.1', padding: '0 12px', minWidth: 0 })}
                onClick={() => { setActiveField('date'); setDateSelecting('checkin') }}
              >
                <FieldLabel text="Anreise" />
                <FieldValue value={checkin ? formatDate(checkin) : ''} placeholder={compact ? 'Anreise' : 'Datum wählen'} />
              </div>

              <Divider />

              {/* ── Abreise ── */}
              <div
                className="hidden lg:flex"
                style={fieldStyle('date', { flex: '1.1', padding: '0 12px', minWidth: 0 })}
                onClick={() => { setActiveField('date'); setDateSelecting('checkout') }}
              >
                <FieldLabel text="Abreise" />
                <FieldValue value={checkout ? formatDate(checkout) : ''} placeholder={compact ? 'Abreise' : 'Datum wählen'} />
              </div>

              <Divider />

              {/* ── Gäste ── */}
              <div
                className="hidden lg:flex"
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
                  flexDates={flexDates}
                  onToggleFlex={setFlexDates}
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
                    background: 'linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%)',
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
                {/* Chat icon + Meine Reisen — nur auf Desktop sichtbar */}
                <div className="hidden md:flex" style={{ alignItems: 'center', gap: '8px' }}>
                  {/* Chat icon with unread badge — opens overlay */}
                  <button
                    onClick={() => setChatOpen(true)}
                    style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '38px', height: '38px', borderRadius: '50%', border: '1px solid #E0DDD6', backgroundColor: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.05)', flexShrink: 0, cursor: 'pointer', color: '#555' }}
                    title="Nachrichten"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    {unreadCount > 0 && (
                      <span style={{ position: 'absolute', top: '-4px', right: '-4px', width: '18px', height: '18px', borderRadius: '50%', background: '#EF4444', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, color: '#fff', lineHeight: 1 }}>
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    )}
                  </button>

                  {/* Direkter Dashboard / Trips Button */}
                  <Link
                    href={isHost ? '/dashboard' : '/guest'}
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
                    {isHost ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
                      </svg>
                    ) : (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
                      </svg>
                    )}
                    {!compact && (isHost ? 'Dashboard' : 'Meine Reisen')}
                  </Link>
                </div>

                <UserMenu
                  user={user}
                  isHost={isHost}
                  avatarUrl={avatarUrl}
                  initials={initials}
                  open={menuOpen}
                  onToggle={() => setMenuOpen(o => !o)}
                  onClose={() => setMenuOpen(false)}
                  onLogout={() => { supabase.auth.signOut(); setMenuOpen(false) }}
                />
              </>
            ) : (
              <>
                {/* Desktop: beide Buttons */}
                <div className="hidden md:flex" style={{ alignItems: 'center', gap: '8px' }}>
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
                    style={{ fontSize: '13px', fontWeight: 600, color: '#fff', padding: '10px 20px', borderRadius: '999px', background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))', textDecoration: 'none', boxShadow: '0 2px 8px rgba(196,162,53,0.3)' }}
                  >
                    Registrieren
                  </Link>
                </div>
                {/* Mobile: nur kompakter Anmelden-Button */}
                <Link
                  href="/login"
                  className="flex md:hidden"
                  style={{ alignItems: 'center', justifyContent: 'center', width: '38px', height: '38px', borderRadius: '50%', border: '1px solid #E0DDD6', backgroundColor: '#fff', textDecoration: 'none', color: '#555', boxShadow: '0 1px 4px rgba(0,0,0,0.05)', flexShrink: 0 }}
                  title="Anmelden"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Global chat overlay — rendered outside header to avoid stacking context from backdrop-filter */}
      {user && <ChatOverlay open={chatOpen} onClose={() => setChatOpen(false)} userId={user.id} />}

      {(menuOpen || activeField) && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => { setMenuOpen(false); setActiveField(null) }}
        />
      )}

      {/* Onboarding modal for guests who haven't filled in their personal data */}
      {showOnboarding && user && (
        <OnboardingModal
          userId={user.id}
          userName={user.user_metadata?.name || user.user_metadata?.full_name || ''}
          initialAccountType={user.user_metadata?.account_type === 'business' ? 'business' : 'person'}
          onComplete={() => setShowOnboarding(false)}
        />
      )}

      {/* Mobile/Tablet full-screen search sheet */}
      {mobileSearchOpen && (
        <MobileSearchSheet
          q={q} setQ={setQ}
          checkin={checkin} setCheckin={setCheckin}
          checkout={checkout} setCheckout={setCheckout}
          adults={adults} setAdults={setAdults}
          kids={kids} setKids={setKids}
          flexDates={flexDates} setFlexDates={setFlexDates}
          dateSelecting={dateSelecting} setDateSelecting={setDateSelecting}
          onClose={() => setMobileSearchOpen(false)}
          onSearch={() => { setMobileSearchOpen(false); submitSearch() }}
        />
      )}

      {/* ══════════════════════════════════════════════════════
          FAB CHAT BUTTON — fixed, always visible when logged in
      ══════════════════════════════════════════════════════ */}
      {user && !chatOpen && (
        <button
          className="mobile-fab"
          onClick={() => setChatOpen(true)}
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '20px',
            width: '54px',
            height: '54px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            zIndex: 80,
            boxShadow: '0 4px 20px rgba(164,130,40,0.5), 0 2px 8px rgba(0,0,0,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)'; e.currentTarget.style.boxShadow = '0 6px 28px rgba(164,130,40,0.6), 0 2px 8px rgba(0,0,0,0.15)' }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(164,130,40,0.5), 0 2px 8px rgba(0,0,0,0.15)' }}
          title="Nachrichten"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {unreadCount > 0 && (
            <span style={{
              position: 'absolute', top: '-3px', right: '-3px',
              minWidth: '20px', height: '20px', borderRadius: '10px',
              background: '#EF4444', border: '2px solid #fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '11px', fontWeight: 700, color: '#fff', lineHeight: 1,
              padding: '0 4px',
            }}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      )}
    </>
  )
}
