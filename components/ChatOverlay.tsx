'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface Conversation {
  id: string
  guest_id: string
  host_id: string
  guest_name: string | null
  host_name: string | null
  listing_title: string | null
  last_message_at: string
  unread: number
}

interface Message {
  id: string
  conversation_id: string
  sender_id: string
  content: string
  read_at: string | null
  created_at: string
}

function initials(name: string) {
  return name.split(' ').map(w => w[0] ?? '').slice(0, 2).join('').toUpperCase()
}

function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'linear-gradient(135deg, #C4A235, #7A5410)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 700, color: '#fff', userSelect: 'none',
    }}>
      {initials(name)}
    </div>
  )
}

function timeLabel(iso: string) {
  const d = new Date(iso), now = new Date()
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diff === 0) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  if (diff === 1) return 'Gestern'
  if (diff < 7) return d.toLocaleDateString('de-DE', { weekday: 'short' })
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
}

function dateLabel(iso: string) {
  const d = new Date(iso), now = new Date()
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diff === 0) return 'Heute'
  if (diff === 1) return 'Gestern'
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: 'long' })
}

function msgTime(iso: string) {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

// ── Message bubbles renderer ──────────────────────────────────
function MessageList({ messages, userId, otherN }: { messages: Message[]; userId: string; otherN: string }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (messages.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, padding: 24 }}>
        <span style={{ fontSize: 36 }}>💬</span>
        <p style={{ fontSize: 13, color: '#AAA', margin: 0 }}>Noch keine Nachrichten</p>
      </div>
    )
  }

  const nodes: React.ReactNode[] = []
  let lastDay = ''

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const day = dateLabel(msg.created_at)
    const isMe = msg.sender_id === userId

    if (day !== lastDay) {
      lastDay = day
      nodes.push(
        <div key={`sep-${msg.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 4px' }}>
          <div style={{ flex: 1, height: 1, background: '#E5E1D8' }} />
          <span style={{ fontSize: 10, color: '#AAA', fontWeight: 600, background: '#EDE9E2', padding: '2px 8px', borderRadius: 99, whiteSpace: 'nowrap' }}>
            {day}
          </span>
          <div style={{ flex: 1, height: 1, background: '#E5E1D8' }} />
        </div>
      )
    }

    const prev = messages[i - 1]
    const next = messages[i + 1]
    const samePrev = prev && prev.sender_id === msg.sender_id
    const sameNext = next && next.sender_id === msg.sender_id && dateLabel(next.created_at) === day
    const isLast = !sameNext

    nodes.push(
      <div
        key={msg.id}
        style={{
          display: 'flex',
          flexDirection: isMe ? 'row-reverse' : 'row',
          alignItems: 'flex-end',
          gap: 6,
          marginBottom: isLast ? 10 : 2,
          marginTop: !samePrev ? 6 : 0,
        }}
      >
        {/* Avatar slot */}
        <div style={{ width: 28, flexShrink: 0, paddingBottom: 2 }}>
          {!isMe && isLast && <Avatar name={otherN} size={28} />}
        </div>

        {/* Bubble + meta */}
        <div style={{ maxWidth: '75%', display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', gap: 2 }}>
          <div style={{
            padding: '9px 13px',
            borderRadius: isMe ? '18px 18px 4px 18px' : '4px 18px 18px 18px',
            background: isMe
              ? 'linear-gradient(135deg, #D4AE3A 0%, #8A6818 100%)'
              : '#FFFFFF',
            color: isMe ? '#fff' : '#1A1A1A',
            fontSize: 13.5,
            lineHeight: 1.45,
            wordBreak: 'break-word',
            boxShadow: isMe
              ? '0 1px 4px rgba(140,100,20,0.25)'
              : '0 1px 3px rgba(0,0,0,0.1)',
          }}>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{msg.content}</p>
          </div>
          {isLast && (
            <span style={{ fontSize: 10, color: '#B0ACA5', paddingLeft: isMe ? 0 : 2, paddingRight: isMe ? 2 : 0 }}>
              {msgTime(msg.created_at)}
              {isMe && msg.read_at && <span style={{ color: '#C4A235', fontWeight: 700 }}> ✓✓</span>}
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 4px', background: '#F5F3EF', display: 'flex', flexDirection: 'column' }}>
      {nodes}
      <div ref={bottomRef} style={{ height: 4 }} />
    </div>
  )
}

// ── Main overlay ──────────────────────────────────────────────
interface Props { open: boolean; onClose: () => void; userId: string }

export default function ChatOverlay({ open, onClose, userId }: Props) {
  const [convs, setConvs] = useState<Conversation[]>([])
  const [active, setActive] = useState<Conversation | null>(null)
  const [msgs, setMsgs] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<'list' | 'chat'>('list')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  function otherName(c: Conversation) {
    return c.guest_id === userId ? (c.host_name || 'Gastgeber') : (c.guest_name || 'Gast')
  }

  const fetchConvs = useCallback(async () => {
    const r = await fetch('/api/chat')
    if (r.ok) setConvs(await r.json())
  }, [])

  const fetchMsgs = useCallback(async (id: string) => {
    const r = await fetch(`/api/chat?conversationId=${id}`)
    if (r.ok) {
      setMsgs(await r.json())
      setConvs(cs => cs.map(c => c.id === id ? { ...c, unread: 0 } : c))
    }
  }, [])

  // Load convs on open
  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetchConvs().finally(() => setLoading(false))
  }, [open, fetchConvs])

  // Poll messages when in chat view
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (!open || !active) return
    fetchMsgs(active.id)
    pollRef.current = setInterval(() => fetchMsgs(active.id), 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [open, active, fetchMsgs])

  // Cleanup on close
  useEffect(() => {
    if (open) return
    if (pollRef.current) clearInterval(pollRef.current)
  }, [open])

  // Auto-resize textarea
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 96) + 'px'
  }, [draft])

  // Escape key
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [onClose])

  function openConv(c: Conversation) {
    if (pollRef.current) clearInterval(pollRef.current)
    setActive(c)
    setMsgs([])
    setView('chat')
  }

  function goBack() {
    if (pollRef.current) clearInterval(pollRef.current)
    setActive(null)
    setView('list')
    fetchConvs()
  }

  async function send() {
    if (!draft.trim() || !active || sending) return
    setSending(true)
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: active.id, content: draft }),
    })
    if (r.ok) {
      setDraft('')
      await fetchMsgs(active.id)
      fetchConvs()
    }
    setSending(false)
  }

  if (!open) return null

  const totalUnread = convs.reduce((s, c) => s + c.unread, 0)

  return (
    <>
      <style>{`
        @keyframes overlayFade { from { opacity:0 } to { opacity:1 } }
        @keyframes panelSlide  { from { transform:translateX(100%) } to { transform:translateX(0) } }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 9000,
          background: 'rgba(0,0,0,0.35)',
          backdropFilter: 'blur(3px)',
          animation: 'overlayFade 0.2s ease',
        }}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'clamp(320px, 42vw, 460px)',
        zIndex: 9001,
        display: 'flex', flexDirection: 'column',
        background: '#FAFAF8',
        boxShadow: '-4px 0 32px rgba(0,0,0,0.18)',
        animation: 'panelSlide 0.28s cubic-bezier(0.32, 0.72, 0, 1)',
        overflow: 'hidden',
      }}>

        {/* ── Top bar ── */}
        <div style={{
          height: 58,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '0 14px',
          background: '#fff',
          borderBottom: '1px solid #EDE9E0',
          flexShrink: 0,
        }}>
          {view === 'chat' && active ? (
            <>
              <button onClick={goBack} style={{ background: 'none', border: 'none', padding: '6px 4px', cursor: 'pointer', color: '#888', display: 'flex', borderRadius: 8 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <Avatar name={otherName(active)} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {otherName(active)}
                </p>
                <p style={{ margin: 0, fontSize: 11, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {active.listing_title ?? '—'}
                </p>
              </div>
            </>
          ) : (
            <>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#C4A235" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: '#111' }}>
                Nachrichten
                {totalUnread > 0 && (
                  <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 800, background: '#EF4444', color: '#fff', padding: '1px 7px', borderRadius: 99 }}>
                    {totalUnread}
                  </span>
                )}
              </span>
            </>
          )}

          <button
            onClick={onClose}
            title="Schließen (Esc)"
            style={{
              width: 30, height: 30, borderRadius: '50%',
              border: 'none', background: '#EEEBE4',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#666', flexShrink: 0,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Conversation list ── */}
        {view === 'list' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#CCC', fontSize: 13 }}>Lädt…</div>
            ) : convs.length === 0 ? (
              <div style={{ padding: '60px 24px', textAlign: 'center' }}>
                <p style={{ fontSize: 38, margin: '0 0 12px' }}>💬</p>
                <p style={{ fontSize: 14, fontWeight: 600, color: '#555', margin: '0 0 6px' }}>Noch keine Nachrichten</p>
                <p style={{ fontSize: 12, color: '#AAA', margin: 0 }}>Gäste können über die Inseratsseite Kontakt aufnehmen.</p>
              </div>
            ) : convs.map(c => {
              const name = otherName(c)
              return (
                <button
                  key={c.id}
                  onClick={() => openConv(c)}
                  style={{
                    width: '100%', textAlign: 'left',
                    padding: '13px 16px',
                    border: 'none', borderBottom: '1px solid #EEEBE3',
                    background: 'transparent', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 12,
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#FDF7EC' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                >
                  <Avatar name={name} size={42} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontSize: 13.5, fontWeight: c.unread > 0 ? 700 : 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                        {name}
                      </span>
                      <span style={{ fontSize: 10.5, flexShrink: 0, color: '#BBB' }}>
                        {timeLabel(c.last_message_at)}
                      </span>
                    </div>
                    <p style={{ margin: '3px 0 0', fontSize: 12, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.listing_title ?? '—'}
                    </p>
                  </div>
                  {c.unread > 0 && (
                    <span style={{
                      minWidth: 20, height: 20, padding: '0 6px',
                      borderRadius: 99, background: '#C4A235',
                      fontSize: 11, fontWeight: 800, color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      {c.unread}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* ── Chat view ── */}
        {view === 'chat' && active && (
          <>
            <MessageList messages={msgs} userId={userId} otherN={otherName(active)} />

            {/* Input bar */}
            <div style={{
              padding: '10px 12px',
              borderTop: '1px solid #EDE9E0',
              background: '#fff',
              display: 'flex', gap: 8, alignItems: 'flex-end',
              flexShrink: 0,
            }}>
              <textarea
                ref={taRef}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder="Nachricht schreiben…"
                rows={1}
                style={{
                  flex: 1, borderRadius: 22,
                  border: '1.5px solid #DDD8CE',
                  padding: '9px 14px',
                  fontSize: 13.5, lineHeight: 1.45,
                  resize: 'none', outline: 'none',
                  fontFamily: 'inherit',
                  maxHeight: 96, overflowY: 'auto',
                  background: '#F9F7F4', color: '#111',
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => { (e.target as HTMLTextAreaElement).style.borderColor = '#C4A235' }}
                onBlur={e => { (e.target as HTMLTextAreaElement).style.borderColor = '#DDD8CE' }}
              />
              <button
                onClick={send}
                disabled={sending || !draft.trim()}
                style={{
                  width: 40, height: 40, borderRadius: '50%',
                  border: 'none', flexShrink: 0,
                  background: draft.trim() && !sending
                    ? 'linear-gradient(135deg, #D4AE3A, #8A6818)'
                    : '#E5E1D8',
                  color: '#fff',
                  cursor: draft.trim() && !sending ? 'pointer' : 'default',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: draft.trim() && !sending ? '0 2px 8px rgba(196,162,53,0.35)' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
