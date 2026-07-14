'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface Conversation {
  id: string; guest_id: string; host_id: string
  guest_name: string | null; host_name: string | null
  listing_title: string | null; last_message_at: string; unread: number
  guest_avatar_url: string | null; host_avatar_url: string | null
  check_in: string | null; check_out: string | null
  /** unified inbox (team mode): thread source + badge data */
  kind?: 'direct' | 'booking'
  platform?: string
  guestStatus?: 'current' | 'upcoming' | 'past' | null
}

/* ── Badges (platform + guest status), team inbox only ── */
const PLATFORM_COLORS: Record<string, string> = {
  TRIMOSA: '#A8862F', Airbnb: '#FF5A5F', 'Booking.com': '#003580', Booking: '#003580',
  'FeWo-direkt': '#245ABC', Vrbo: '#245ABC', Smoobu: '#5A6B7B',
}
function statusInfo(c: Conversation): { dot: string; label: string } | null {
  if (!c.guestStatus) return null
  if (c.guestStatus === 'current') return { dot: '#22C55E', label: 'Vor Ort' }
  if (c.guestStatus === 'upcoming') {
    const days = c.check_in ? Math.ceil((new Date(c.check_in).getTime() - Date.now()) / 86400000) : null
    return { dot: '#3B82F6', label: days != null && days >= 0 ? `Anreise in ${days} Tg.` : 'Kommend' }
  }
  return { dot: '#9CA3AF', label: 'Ehemalig' }
}
function ThreadBadges({ c, size = 10 }: { c: Conversation; size?: number }) {
  if (!c.platform && !c.guestStatus) return null
  const st = statusInfo(c)
  const pc = c.platform ? (PLATFORM_COLORS[c.platform] ?? '#5A6B7B') : null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {c.platform && pc && (
        <span style={{
          fontSize: size, fontWeight: 800, color: '#fff', background: pc,
          padding: '2px 7px', borderRadius: 999, letterSpacing: '0.02em', whiteSpace: 'nowrap',
        }}>{c.platform}</span>
      )}
      {st && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: size, fontWeight: 600, color: '#777', whiteSpace: 'nowrap' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: st.dot, display: 'inline-block' }} />
          {st.label}
        </span>
      )}
    </span>
  )
}
interface Message {
  id: string; conversation_id: string; sender_id: string
  content: string; read_at: string | null; created_at: string
}

/* ── helpers ── */
function ava(name: string) {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'
}
function fmtTime(iso: string) {
  const d = new Date(iso), now = new Date()
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diff === 0) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  if (diff === 1) return 'Gestern'
  if (diff < 7)  return d.toLocaleDateString('de-DE', { weekday: 'short' })
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
}
function fmtDay(iso: string) {
  const d = new Date(iso), now = new Date()
  const dDay      = d.toLocaleDateString('de-DE')
  const today     = now.toLocaleDateString('de-DE')
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toLocaleDateString('de-DE')
  if (dDay === today)     return 'Heute'
  if (dDay === yesterday) return 'Gestern'
  return d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
}
function fmtMsgT(iso: string) {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}
function fmtDateRange(checkIn: string | null, checkOut: string | null) {
  if (!checkIn || !checkOut) return null
  const fmt = (s: string) => new Date(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
  return `${fmt(checkIn)} – ${fmt(checkOut)}`
}

/* ── Avatar ── */
function Av({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  if (src) {
    return (
      <img src={src} alt={name} style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        objectFit: 'cover', border: '2px solid #EDE9E0',
      }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
    )
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'linear-gradient(135deg,var(--gold),var(--gold-dark))',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * .37, fontWeight: 700, color: '#fff', userSelect: 'none',
    }}>{ava(name)}</div>
  )
}

/* ── main ── */
interface Props {
  userId: string
  /** 'overlay' = fixed modal (NavBar), 'page' = inline card (chat pages) */
  variant: 'overlay' | 'page'
  /** overlay only */
  open?: boolean
  onClose?: () => void
  /** page only: pre-select a conversation (?conv= deep link from emails) */
  initialConvId?: string | null
  /** team mode: unified inbox (all guests incl. Airbnb/Booking via Smoobu) */
  team?: boolean
}

export default function ChatPanel({ userId, variant, open = true, onClose, initialConvId, team = false }: Props) {
  const [convs, setConvs]       = useState<Conversation[]>([])
  const [active, setActive]     = useState<Conversation | null>(null)
  const [msgs, setMsgs]         = useState<Message[]>([])
  const [draft, setDraft]       = useState('')
  const [busy, setBusy]         = useState(false)
  const [aiBusy, setAiBusy]     = useState(false)

  // "✨" reply suggestion (hosts only) — lands in the composer as an editable
  // draft, never auto-sent. History is loaded server-side by the API.
  async function suggestReply() {
    if (!active || aiBusy) return
    setAiBusy(true)
    try {
      const res = await fetch('/api/ai/chat-suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(active.kind === 'booking' ? { bookingId: active.id } : { conversationId: active.id }),
      })
      const data = await res.json()
      if (res.ok && data.suggestion) setDraft(data.suggestion)
    } catch { /* silent — composer stays untouched */ }
    finally { setAiBusy(false) }
  }
  const [loading, setLoading]   = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list')

  const bottomRef     = useRef<HTMLDivElement>(null)
  const taRef         = useRef<HTMLTextAreaElement>(null)
  const timer         = useRef<ReturnType<typeof setInterval> | null>(null)
  const mobileShellRef = useRef<HTMLDivElement>(null)

  const isHost   = (c: Conversation) => c.host_id === userId
  const partner  = (c: Conversation) => isHost(c) ? (c.guest_name || 'Gast') : (c.host_name || 'Gastgeber')
  const partnerAvatar = (c: Conversation) => isHost(c) ? c.guest_avatar_url : c.host_avatar_url

  /* ── mobile detection ── */
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 680)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  /* ── data fetching ── */
  const getConvs = useCallback(async () => {
    if (team) {
      const r = await fetch('/api/chat/inbox')
      if (!r.ok) return null
      const { threads } = await r.json()
      const data: Conversation[] = (threads ?? []).map((t: Record<string, unknown>) => ({
        id: t.id, kind: t.kind, guest_id: '', host_id: userId,
        guest_name: t.guestName, host_name: null,
        listing_title: t.listingTitle, last_message_at: t.lastMessageAt,
        unread: t.unread ?? 0,
        guest_avatar_url: t.guestAvatar ?? null, host_avatar_url: null,
        check_in: t.checkIn ?? null, check_out: t.checkOut ?? null,
        platform: t.platform, guestStatus: t.guestStatus,
      }))
      setConvs(data)
      return data
    }
    const r = await fetch('/api/chat')
    if (!r.ok) return null
    const data: Conversation[] = await r.json()
    setConvs(data)
    return data
  }, [team, userId])

  const getMsgs = useCallback(async (id: string, kind?: 'direct' | 'booking') => {
    if (kind === 'booking') {
      const r = await fetch(`/api/messages/${id}`)
      if (r.ok) {
        const { messages } = await r.json()
        // Map booking messages (sender_type guest/host/system) onto the
        // shared shape: everything from our side renders as "me".
        setMsgs((messages ?? []).map((m: Record<string, unknown>) => ({
          id: m.id, conversation_id: id,
          sender_id: m.sender_type === 'guest' ? 'guest' : userId,
          content: m.content, read_at: m.read_at ?? null, created_at: m.created_at,
        })))
        setConvs(cs => cs.map(c => c.id === id ? { ...c, unread: 0 } : c))
      }
      return
    }
    const r = await fetch(`/api/chat?conversationId=${id}`)
    if (r.ok) {
      setMsgs(await r.json())
      setConvs(cs => cs.map(c => c.id === id ? { ...c, unread: 0 } : c))
    }
  }, [userId])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    getConvs().then(data => {
      if (!data || data.length === 0 || active) return
      // Deep link (?conv= from notification emails) wins; otherwise desktop
      // auto-opens the newest conversation, mobile stays on the list.
      const target = initialConvId ? data.find(c => c.id === initialConvId) : undefined
      if (target) {
        setActive(target)
        if (window.innerWidth < 680) setMobileView('chat')
      } else if (window.innerWidth >= 680) {
        setActive(data[0])
      }
    }).finally(() => setLoading(false))
  }, [open, getConvs, initialConvId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (timer.current) clearInterval(timer.current)
    if (!open || !active) return
    getMsgs(active.id, active.kind)
    timer.current = setInterval(() => getMsgs(active.id, active.kind), 5000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [open, active, getMsgs])

  useEffect(() => { if (!open && timer.current) clearInterval(timer.current) }, [open])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])
  useEffect(() => {
    const ta = taRef.current; if (!ta) return
    ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 96) + 'px'
  }, [draft])
  useEffect(() => {
    if (variant !== 'overlay' || !onClose) return
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [variant, onClose])

  /* ── mobile: switch to chat when conversation selected ── */
  function selectConv(c: Conversation) {
    setActive(c)
    if (isMobile) setMobileView('chat')
  }

  /* ── send ── */
  async function send() {
    if (!draft.trim() || !active || busy) return
    setBusy(true)
    const r = active.kind === 'booking'
      ? await fetch(`/api/messages/${active.id}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: draft }),
        })
      : await fetch('/api/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: active.id, content: draft }),
        })
    if (r.ok) { setDraft(''); await getMsgs(active.id, active.kind); getConvs() }
    setBusy(false)
  }

  if (!open) return null

  /* ── group messages by day ── */
  const grouped: { day: string; items: Message[] }[] = []
  for (const m of msgs) {
    const d = fmtDay(m.created_at)
    if (!grouped.length || grouped[grouped.length - 1].day !== d) grouped.push({ day: d, items: [m] })
    else grouped[grouped.length - 1].items.push(m)
  }

  const unread = convs.reduce((s, c) => s + c.unread, 0)
  const dateRange = active ? fmtDateRange(active.check_in, active.check_out) : null

  /* ═══════════════════════════════════════════════════════════
     CONVERSATION LIST (shared between mobile list view + desktop sidebar)
  ═══════════════════════════════════════════════════════════ */
  function ConvList({ fullWidth = false }: { fullWidth?: boolean }) {
    return (
      <div style={{
        width: fullWidth ? '100%' : 270,
        flexShrink: fullWidth ? undefined : 0,
        background: '#FAFAF8',
        borderRight: fullWidth ? 'none' : '1px solid #EDEBE4',
        overflowY: 'auto',
        display: 'flex', flexDirection: 'column',
        flex: fullWidth ? 1 : undefined,
      }}>
        {loading && (
          <div style={{ padding: 32, textAlign: 'center', color: '#999', fontSize: 13 }}>Lädt…</div>
        )}
        {!loading && convs.length === 0 && (
          <div style={{ padding: '64px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>💬</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#555' }}>Keine Nachrichten</div>
            <div style={{ fontSize: 13, color: '#AAA', marginTop: 6, lineHeight: 1.5 }}>
              Gäste können über die Inseratsseite schreiben.
            </div>
          </div>
        )}
        {convs.map(c => {
          const isSel = !isMobile && active?.id === c.id
          return (
            <button key={c.id} onClick={() => selectConv(c)} style={{
              width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
              padding: fullWidth ? '14px 20px' : '12px 14px',
              borderBottom: '1px solid #EDEBE4',
              borderLeft: isSel ? '3px solid var(--gold)' : '3px solid transparent',
              background: isSel ? '#F5EFE2' : 'transparent',
              display: 'flex', alignItems: 'center', gap: 12,
              transition: 'background .12s',
            }}
              onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = '#F3F0EA' }}
              onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}
            >
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <Av name={partner(c)} src={partnerAvatar(c)} size={fullWidth ? 48 : 42} />
                {c.unread > 0 && (
                  <span style={{
                    position: 'absolute', top: -2, right: -2,
                    minWidth: 18, height: 18, padding: '0 4px', borderRadius: 9,
                    background: 'var(--gold)', border: '2px solid #FAFAF8',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 800, color: '#fff',
                  }}>
                    {c.unread > 9 ? '9+' : c.unread}
                  </span>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <span style={{ fontSize: fullWidth ? 15 : 13, fontWeight: c.unread ? 700 : 500, color: '#1A1814', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: fullWidth ? 200 : 130 }}>
                    {partner(c)}
                  </span>
                  <span style={{ fontSize: 11, color: '#AAA', flexShrink: 0, marginLeft: 8 }}>{fmtTime(c.last_message_at)}</span>
                </div>
                <div style={{ fontSize: fullWidth ? 13 : 11, color: c.unread ? '#5A4A1A' : '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: c.unread ? 500 : 400 }}>
                  {c.listing_title ?? '—'}
                  {fmtDateRange(c.check_in, c.check_out) && <span style={{ color: '#B5A97F' }}> · {fmtDateRange(c.check_in, c.check_out)}</span>}
                </div>
                {(c.platform || c.guestStatus) && (
                  <div style={{ marginTop: 4 }}><ThreadBadges c={c} /></div>
                )}
              </div>
              {fullWidth && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#CCC" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              )}
            </button>
          )
        })}
      </div>
    )
  }

  /* ═══════════════════════════════════════════════════════════
     MESSAGE PANEL (shared between mobile chat view + desktop right panel)
  ═══════════════════════════════════════════════════════════ */
  function MessagePanel({ showBack = false }: { showBack?: boolean }) {
    if (!active) return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, color: '#CCC', background: '#F6F4EF' }}>
        <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span style={{ fontSize: 14, color: '#BBB' }}>Unterhaltung auswählen</span>
      </div>
    )

    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden', background: '#F6F4EF' }}>
        {/* Chat header: back button on mobile; on the page variant the
            desktop thread shows it too (the overlay has it in its own bar) */}
        {(showBack || variant === 'page') && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 16px', background: '#fff',
            borderBottom: '1px solid #EDEBE4', flexShrink: 0,
          }}>
            {showBack && (
            <button
              onClick={() => setMobileView('list')}
              style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', background: '#F2EFE8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', flexShrink: 0 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            )}
            <Av name={partner(active)} src={partnerAvatar(active)} size={36} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1A1814', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {partner(active)}
              </div>
              <div style={{ fontSize: 11, color: '#AAA', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {active.listing_title}
                {dateRange && <span style={{ color: 'var(--gold)', fontWeight: 600 }}> · {dateRange}</span>}
              </div>
            </div>
            {(active.platform || active.guestStatus) && (
              <div style={{ flexShrink: 0 }}><ThreadBadges c={active} size={10.5} /></div>
            )}
          </div>
        )}

        {/* Message feed */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px', display: 'flex', flexDirection: 'column' }}>
          {msgs.length === 0 && (
            <div style={{ margin: 'auto', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>👋</div>
              <div style={{ fontSize: 13, color: '#AAA' }}>Noch keine Nachrichten</div>
            </div>
          )}
          {grouped.map(({ day, items }) => (
            <div key={day}>
              {/* day divider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 12px' }}>
                <div style={{ flex: 1, height: 1, background: '#E0DCD2' }} />
                <span style={{ fontSize: 11, color: '#999', fontWeight: 600, background: '#EDE9E0', padding: '2px 10px', borderRadius: 99, whiteSpace: 'nowrap' }}>
                  {day}
                </span>
                <div style={{ flex: 1, height: 1, background: '#E0DCD2' }} />
              </div>

              {items.map((msg, i) => {
                const isMe     = msg.sender_id === userId
                const prevSame = i > 0 && items[i - 1].sender_id === msg.sender_id
                const nextSame = i < items.length - 1 && items[i + 1].sender_id === msg.sender_id
                const isLast   = !nextSame

                /* iMessage-style corner radii */
                const R = '18px'
                const r = '4px'
                const borderRadius = isMe
                  ? (prevSame ? `${R} ${r} ${r} ${R}` : `${R} ${R} ${r} ${R}`)
                  : (prevSame ? `${r} ${R} ${R} ${R}` : `${r} ${R} ${R} ${R}`)

                return (
                  <div key={msg.id} style={{
                    display: 'flex',
                    flexDirection: isMe ? 'row-reverse' : 'row',
                    alignItems: 'flex-end', gap: 8,
                    marginBottom: isLast ? 10 : 2,
                    marginTop: prevSame ? 0 : 6,
                  }}>
                    {/* avatar placeholder for alignment */}
                    <div style={{ width: 30, flexShrink: 0 }}>
                      {!isMe && isLast && <Av name={partner(active)} src={partnerAvatar(active)} size={28} />}
                    </div>

                    <div style={{ maxWidth: '72%', display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', gap: 3 }}>
                      {/* bubble */}
                      <div style={{
                        padding: '10px 14px',
                        borderRadius,
                        background: isMe
                          ? 'linear-gradient(135deg, var(--gold), var(--gold-dark))'
                          : '#FFFFFF',
                        color: isMe ? '#fff' : '#1A1814',
                        fontSize: 15, lineHeight: 1.45,
                        boxShadow: isMe
                          ? '0 2px 10px rgba(196,162,53,.28)'
                          : '0 1px 4px rgba(0,0,0,.09)',
                        wordBreak: 'break-word',
                      }}>
                        <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                      </div>

                      {isLast && (
                        <span style={{ fontSize: 10.5, color: '#AAA', paddingLeft: isMe ? 0 : 3, paddingRight: isMe ? 3 : 0 }}>
                          {fmtMsgT(msg.created_at)}
                          {isMe && msg.read_at && <span style={{ color: 'var(--gold)', marginLeft: 4, fontWeight: 700 }}>✓✓</span>}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div style={{
          borderTop: '1px solid #E8E4DB', background: '#FFFFFF',
          padding: '10px 14px',
          paddingBottom: 'max(10px, env(safe-area-inset-bottom))',
          display: 'flex', gap: 10, alignItems: 'flex-end', flexShrink: 0,
        }}>
          {active && isHost(active) && msgs.length > 0 && (
            <button
              onClick={suggestReply}
              disabled={aiBusy}
              title="Antwort von Claude vorschlagen lassen"
              style={{
                width: 42, height: 42, borderRadius: '50%', flexShrink: 0,
                border: '1.5px solid #E8D9A0', background: '#FDFAF0',
                cursor: aiBusy ? 'wait' : 'pointer', fontSize: 17,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: aiBusy ? 0.5 : 1, transition: 'opacity .15s',
              }}
            >
              {aiBusy ? '⏳' : '✨'}
            </button>
          )}
          <textarea
            ref={taRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder="Nachricht schreiben…"
            rows={1}
            style={{
              flex: 1, resize: 'none', outline: 'none',
              border: '1.5px solid #E0DCD2',
              borderRadius: 22, padding: '10px 16px',
              fontSize: 16, lineHeight: 1.45, fontFamily: 'inherit',
              background: '#FAF9F6', color: '#1A1814',
              maxHeight: 96, overflowY: 'auto', transition: 'border-color .15s',
            }}
            onFocus={e => { e.target.style.borderColor = 'var(--gold)' }}
            onBlur={e => { e.target.style.borderColor = '#E0DCD2' }}
          />
          <button
            onClick={send}
            disabled={busy || !draft.trim()}
            style={{
              width: 42, height: 42, borderRadius: '50%', border: 'none', flexShrink: 0,
              background: draft.trim() && !busy ? 'linear-gradient(135deg,var(--gold),var(--gold-dark))' : '#EDE9E0',
              color: draft.trim() && !busy ? '#fff' : '#CCC',
              cursor: draft.trim() && !busy ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: draft.trim() && !busy ? '0 2px 12px rgba(196,162,53,.35)' : 'none',
              transition: 'all .15s',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
    )
  }

  /* ═══════════════════════════════════════════════════════════
     RENDER — 'page': inline card (chat pages) · 'overlay': fixed modal
  ═══════════════════════════════════════════════════════════ */
  if (variant === 'page') {
    return (
      <div style={{
        maxWidth: '1100px', margin: '0 auto',
        padding: isMobile ? '10px 10px 16px' : '20px 20px 32px',
        height: 'calc(100vh - 130px)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Page header */}
        <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          {isMobile && mobileView === 'chat' ? null : (
            <div>
              <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 2px' }}>
                Kommunikation
              </p>
              <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#111', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                Nachrichten
                {unread > 0 && (
                  <span style={{ fontSize: '12px', fontWeight: 700, background: 'var(--gold)', color: '#fff', padding: '2px 9px', borderRadius: '99px', lineHeight: '20px' }}>
                    {unread}
                  </span>
                )}
              </h1>
            </div>
          )}
        </div>

        {/* Card */}
        <div style={{
          flex: 1, display: 'flex', minHeight: 0,
          background: '#fff', borderRadius: '18px',
          border: '1px solid #E8E4DC',
          boxShadow: '0 2px 20px rgba(0,0,0,0.06)',
          overflow: 'hidden',
        }}>
          {isMobile ? (
            mobileView === 'list' ? ConvList({ fullWidth: true }) : MessagePanel({ showBack: true })
          ) : (
            <>
              {ConvList({ fullWidth: false })}
              {MessagePanel({ showBack: false })}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <style>{`
        @keyframes cfade { from{opacity:0} to{opacity:1} }
        @keyframes crise { from{opacity:0;transform:translateX(-50%) scale(.97)} to{opacity:1;transform:translateX(-50%) scale(1)} }
        @keyframes cslideup { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      {/* backdrop */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,.35)', backdropFilter: 'blur(4px)',
        animation: 'cfade .18s ease',
      }} />

      {/* ── MOBILE LAYOUT ── */}
      {isMobile ? (
        <div ref={mobileShellRef} style={{
          position: 'fixed', inset: 0,
          zIndex: 9001,
          display: 'flex', flexDirection: 'column',
          background: '#FAFAF8',
          animation: 'cslideup .22s cubic-bezier(.34,1.1,.64,1)',
        }}>
          {/* Mobile header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '14px 16px', height: 56, flexShrink: 0,
            background: '#FFFFFF', borderBottom: '1px solid #EDEBE4',
          }}>
            {mobileView === 'list' ? (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <span style={{ flex: 1, fontWeight: 700, fontSize: 17, color: '#1A1814' }}>
                  Nachrichten
                  {unread > 0 && (
                    <span style={{ marginLeft: 8, background: 'var(--gold)', color: '#fff', fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 99 }}>
                      {unread}
                    </span>
                  )}
                </span>
                <button onClick={onClose} style={{
                  width: 32, height: 32, borderRadius: '50%', border: 'none',
                  background: '#F2EFE8', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888',
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </>
            ) : (
              /* In chat view, header is rendered inside MessagePanel's showBack */
              <button onClick={onClose} style={{
                marginLeft: 'auto', width: 32, height: 32, borderRadius: '50%', border: 'none',
                background: '#F2EFE8', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888',
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>

          {/* Mobile body */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {mobileView === 'list'
              ? ConvList({ fullWidth: true })
              : MessagePanel({ showBack: true })
            }
          </div>
        </div>
      ) : (
        /* ── DESKTOP LAYOUT ── */
        <div style={{
          position: 'fixed',
          top: 'calc(var(--navbar-h, 88px) + 12px)',
          left: '50%', transform: 'translateX(-50%)',
          zIndex: 9001,
          width: 'min(880px,93vw)', height: 'calc(100vh - var(--navbar-h, 88px) - 24px)',
          display: 'flex', flexDirection: 'column',
          background: '#FFFFFF',
          borderRadius: 16,
          boxShadow: '0 24px 80px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.06)',
          overflow: 'hidden',
          animation: 'crise .22s cubic-bezier(.34,1.3,.64,1)',
        }}>
          {/* Desktop header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '0 18px', height: 52, flexShrink: 0,
            background: '#FFFFFF', borderBottom: '1px solid #EDEBE4',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <span style={{ flex: 1, fontWeight: 700, fontSize: 15, color: '#1A1814' }}>
              Nachrichten
              {unread > 0 && (
                <span style={{ marginLeft: 8, background: 'var(--gold)', color: '#fff', fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 99 }}>
                  {unread}
                </span>
              )}
            </span>
            {active && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 8 }}>
                <Av name={partner(active)} src={partnerAvatar(active)} size={28} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#3D3A32', lineHeight: 1.2 }}>{partner(active)}</span>
                  <span style={{ fontSize: 10.5, color: '#999', lineHeight: 1.2 }}>
                    {active.listing_title}
                    {dateRange && <> · <strong style={{ color: 'var(--gold)' }}>{dateRange}</strong></>}
                  </span>
                </div>
              </div>
            )}
            <button onClick={onClose} style={{
              width: 30, height: 30, borderRadius: '50%', border: 'none',
              background: '#F2EFE8', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888',
            }}
              onMouseEnter={e => { (e.target as HTMLElement).style.background = '#E8E3D8' }}
              onMouseLeave={e => { (e.target as HTMLElement).style.background = '#F2EFE8' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          {/* Desktop body: sidebar + messages */}
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {ConvList({ fullWidth: false })}
            {MessagePanel({ showBack: false })}
          </div>
        </div>
      )}
    </>
  )
}
