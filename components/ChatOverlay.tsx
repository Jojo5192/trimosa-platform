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

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0] ?? '').slice(0, 2).join('').toUpperCase()
}

function MiniAvatar({ name }: { name: string }) {
  return (
    <div style={{
      width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
      background: 'linear-gradient(135deg, #C4A235 0%, #7A5410 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, fontWeight: 700, color: '#fff', userSelect: 'none',
    }}>
      {getInitials(name)}
    </div>
  )
}

interface ChatOverlayProps {
  open: boolean
  onClose: () => void
  userId: string
}

export default function ChatOverlay({ open, onClose, userId }: ChatOverlayProps) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConv, setActiveConv] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [newMsg, setNewMsg] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<'list' | 'chat'>('list')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const loadedRef = useRef(false)

  function otherName(conv: Conversation) {
    return conv.guest_id === userId ? (conv.host_name || 'Gastgeber') : (conv.guest_name || 'Gast')
  }

  const loadConversations = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/chat')
    if (res.ok) setConversations(await res.json())
    setLoading(false)
  }, [])

  const loadMessages = useCallback(async (convId: string) => {
    const res = await fetch(`/api/chat?conversationId=${convId}`)
    if (res.ok) {
      setMessages(await res.json())
      setConversations(cs => cs.map(c => c.id === convId ? { ...c, unread: 0 } : c))
    }
  }, [])

  // Load conversations when overlay first opens
  useEffect(() => {
    if (open && !loadedRef.current) {
      loadedRef.current = true
      loadConversations()
    }
    if (open && loadedRef.current) {
      loadConversations()
    }
  }, [open, loadConversations])

  // Poll messages while a conversation is active
  useEffect(() => {
    if (!open || !activeConv) return
    loadMessages(activeConv.id)
    pollRef.current = setInterval(() => loadMessages(activeConv.id), 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [open, activeConv, loadMessages])

  useEffect(() => {
    if (open) return
    // Clean up when closed
    if (pollRef.current) clearInterval(pollRef.current)
  }, [open])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 100) + 'px'
  }, [newMsg])

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  async function selectConv(conv: Conversation) {
    setActiveConv(conv)
    setMessages([])
    setView('chat')
    if (pollRef.current) clearInterval(pollRef.current)
  }

  async function sendMessage() {
    if (!newMsg.trim() || !activeConv || sending) return
    setSending(true)
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: activeConv.id, content: newMsg }),
    })
    if (res.ok) {
      setNewMsg('')
      await loadMessages(activeConv.id)
      loadConversations()
    }
    setSending(false)
  }

  function formatTime(iso: string) {
    const d = new Date(iso)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
    if (diffDays === 0) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    if (diffDays === 1) return 'Gestern'
    if (diffDays < 7) return d.toLocaleDateString('de-DE', { weekday: 'short' })
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
  }

  function formatMsgTime(iso: string) {
    return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  }

  function getDateLabel(iso: string): string {
    const d = new Date(iso)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
    if (diffDays === 0) return 'Heute'
    if (diffDays === 1) return 'Gestern'
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          background: 'rgba(0,0,0,0.3)',
          backdropFilter: 'blur(2px)',
          animation: 'fadeIn 0.2s ease',
        }}
      />

      {/* Overlay panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(420px, 100vw)',
        zIndex: 9999,
        display: 'flex', flexDirection: 'column',
        background: '#fff',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.15)',
        animation: 'slideIn 0.25s cubic-bezier(0.32, 0.72, 0, 1)',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center',
          padding: '0 16px',
          height: '56px',
          borderBottom: '1px solid #EDE9E1',
          background: '#FAFAF8',
          flexShrink: 0,
          gap: '10px',
        }}>
          {view === 'chat' && activeConv ? (
            <>
              <button
                onClick={() => { setView('list'); setActiveConv(null); if (pollRef.current) clearInterval(pollRef.current) }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: '6px',
                  color: '#888', borderRadius: '8px', display: 'flex', alignItems: 'center',
                  flexShrink: 0,
                }}
                title="Zurück"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <MiniAvatar name={otherName(activeConv)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: '14px', fontWeight: 700, color: '#111', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {otherName(activeConv)}
                </p>
                <p style={{ fontSize: '11px', color: '#999', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activeConv.listing_title ?? '—'}
                </p>
              </div>
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C4A235" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span style={{ fontSize: '15px', fontWeight: 700, color: '#111', flex: 1 }}>Nachrichten</span>
            </>
          )}

          {/* Close button */}
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: '50%',
              border: 'none', background: '#EEEAE2',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#555', flexShrink: 0, transition: 'background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#E0DBD0' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#EEEAE2' }}
            title="Schließen (Esc)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

          {/* ── Conversation list ── */}
          {view === 'list' && (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loading ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: '#BBB', fontSize: '13px' }}>Lädt…</div>
              ) : conversations.length === 0 ? (
                <div style={{ padding: '60px 24px', textAlign: 'center' }}>
                  <p style={{ fontSize: '36px', margin: '0 0 12px' }}>💬</p>
                  <p style={{ fontSize: '14px', fontWeight: 600, color: '#555', margin: '0 0 6px' }}>Noch keine Nachrichten</p>
                  <p style={{ fontSize: '12px', color: '#AAA', margin: 0 }}>Gäste können über die Inseratsseite Kontakt aufnehmen.</p>
                </div>
              ) : (
                conversations.map(conv => {
                  const name = otherName(conv)
                  return (
                    <button
                      key={conv.id}
                      onClick={() => selectConv(conv)}
                      style={{
                        width: '100%', textAlign: 'left',
                        padding: '13px 16px',
                        border: 'none', borderBottom: '1px solid #F0ECE4',
                        background: 'transparent', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '12px',
                        transition: 'background 0.12s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#FDF8EF' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                    >
                      <MiniAvatar name={name} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <p style={{ fontSize: '13px', fontWeight: conv.unread > 0 ? 700 : 600, color: '#111', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                            {name}
                          </p>
                          <span style={{ fontSize: '10px', color: '#BBB', flexShrink: 0 }}>
                            {formatTime(conv.last_message_at)}
                          </span>
                        </div>
                        <p style={{ fontSize: '11px', color: '#999', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {conv.listing_title ?? '—'}
                        </p>
                      </div>
                      {conv.unread > 0 && (
                        <span style={{
                          minWidth: '18px', height: '18px', padding: '0 5px',
                          borderRadius: '99px', background: '#C4A235',
                          fontSize: '10px', fontWeight: 800, color: '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0,
                        }}>
                          {conv.unread}
                        </span>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          )}

          {/* ── Message thread ── */}
          {view === 'chat' && activeConv && (
            <>
              <div style={{
                flex: 1, overflowY: 'auto',
                padding: '12px 14px 8px',
                background: '#F9F7F4',
                display: 'flex', flexDirection: 'column',
              }}>
                {messages.length === 0 ? (
                  <div style={{ margin: 'auto', textAlign: 'center' }}>
                    <p style={{ fontSize: '28px', margin: '0 0 8px' }}>👋</p>
                    <p style={{ fontSize: '13px', color: '#AAA' }}>Noch keine Nachrichten.</p>
                  </div>
                ) : (() => {
                  // Build items with date separators
                  const items: React.ReactNode[] = []
                  let lastDateLabel = ''
                  for (let i = 0; i < messages.length; i++) {
                    const msg = messages[i]
                    const label = getDateLabel(msg.created_at)
                    if (label !== lastDateLabel) {
                      lastDateLabel = label
                      items.push(
                        <div key={`d-${msg.id}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '10px 0 6px' }}>
                          <div style={{ flex: 1, height: '1px', background: '#E5E1D8' }} />
                          <span style={{ fontSize: '10px', color: '#AAA', fontWeight: 600, background: '#EDE9E2', padding: '2px 8px', borderRadius: '99px', whiteSpace: 'nowrap' }}>
                            {label}
                          </span>
                          <div style={{ flex: 1, height: '1px', background: '#E5E1D8' }} />
                        </div>
                      )
                    }
                    const isMe = msg.sender_id === userId
                    const prevMsg = messages[i - 1]
                    const nextMsg = messages[i + 1]
                    const samePrev = prevMsg && prevMsg.sender_id === msg.sender_id && getDateLabel(prevMsg.created_at) === label
                    const sameNext = nextMsg && nextMsg.sender_id === msg.sender_id && getDateLabel(nextMsg.created_at) === label
                    const isLast = !sameNext

                    items.push(
                      <div key={msg.id} style={{
                        display: 'flex',
                        flexDirection: isMe ? 'row-reverse' : 'row',
                        alignItems: 'flex-end',
                        gap: '6px',
                        marginBottom: isLast ? '8px' : '2px',
                        marginTop: !samePrev ? '4px' : 0,
                      }}>
                        <div style={{ width: 24, flexShrink: 0 }}>
                          {!isMe && isLast && <MiniAvatar name={otherName(activeConv)} />}
                        </div>
                        <div style={{
                          maxWidth: '78%',
                          display: 'flex', flexDirection: 'column',
                          alignItems: isMe ? 'flex-end' : 'flex-start',
                          gap: '1px',
                        }}>
                          <div style={{
                            padding: '8px 12px',
                            borderRadius: isMe ? '16px 16px 3px 16px' : '3px 16px 16px 16px',
                            background: isMe
                              ? 'linear-gradient(135deg, #D4AE3A 0%, #8A6818 100%)'
                              : '#EDEBE6',
                            color: isMe ? '#fff' : '#1A1A1A',
                            fontSize: '13px', lineHeight: '1.45',
                            wordBreak: 'break-word',
                            boxShadow: isMe ? '0 1px 3px rgba(140,100,20,0.2)' : '0 1px 2px rgba(0,0,0,0.05)',
                          }}>
                            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{msg.content}</p>
                          </div>
                          {isLast && (
                            <span style={{ fontSize: '10px', color: '#AAA', margin: isMe ? '0 2px 0 0' : '0 0 0 2px' }}>
                              {formatMsgTime(msg.created_at)}
                              {isMe && msg.read_at && <span style={{ color: '#C4A235', fontWeight: 700 }}> ✓✓</span>}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  }
                  return items
                })()}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div style={{
                padding: '10px 12px',
                borderTop: '1px solid #EDE9E1',
                display: 'flex', gap: '8px', alignItems: 'flex-end',
                background: '#fff', flexShrink: 0,
              }}>
                <textarea
                  ref={textareaRef}
                  value={newMsg}
                  onChange={e => setNewMsg(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                  placeholder="Nachricht schreiben…"
                  rows={1}
                  style={{
                    flex: 1, borderRadius: '20px',
                    border: '1.5px solid #DDD9D0',
                    padding: '9px 14px', fontSize: '13px',
                    resize: 'none', outline: 'none',
                    fontFamily: 'inherit', lineHeight: '1.45',
                    maxHeight: '100px', overflowY: 'auto',
                    background: '#FAFAF8', color: '#111',
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#C4A235' }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#DDD9D0' }}
                />
                <button
                  onClick={sendMessage}
                  disabled={sending || !newMsg.trim()}
                  style={{
                    width: '38px', height: '38px', borderRadius: '50%', border: 'none',
                    background: newMsg.trim() && !sending
                      ? 'linear-gradient(135deg, #D4AE3A 0%, #8A6818 100%)'
                      : '#E5E2DB',
                    color: '#fff', cursor: newMsg.trim() && !sending ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, transition: 'background 0.15s',
                    boxShadow: newMsg.trim() && !sending ? '0 2px 6px rgba(196,162,53,0.35)' : 'none',
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
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideIn { from { transform: translateX(100%) } to { transform: translateX(0) } }
      `}</style>
    </>
  )
}
