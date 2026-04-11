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
  return name
    .split(' ')
    .map(w => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function Avatar({ name, size = 38 }: { name: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'linear-gradient(135deg, #C4A235 0%, #7A5410 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.37, fontWeight: 700, color: '#fff',
      letterSpacing: '0.02em', userSelect: 'none',
    }}>
      {getInitials(name)}
    </div>
  )
}

export default function ChatClient({ userId, initialConvId }: { userId: string; initialConvId?: string | null }) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConv, setActiveConv] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [newMsg, setNewMsg] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const didAutoSelect = useRef(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function otherName(conv: Conversation): string {
    if (conv.guest_id === userId) return conv.host_name || 'Gastgeber'
    return conv.guest_name || 'Gast'
  }

  function myName(conv: Conversation): string {
    if (conv.guest_id === userId) return conv.guest_name || 'Ich'
    return conv.host_name || 'Ich'
  }

  const loadConversations = useCallback(async () => {
    const res = await fetch('/api/chat')
    if (res.ok) {
      const data: Conversation[] = await res.json()
      setConversations(data)
      if (initialConvId && !didAutoSelect.current && data.length > 0) {
        const target = data.find(c => c.id === initialConvId)
        if (target) {
          didAutoSelect.current = true
          setActiveConv(target)
          setMessages([])
        }
      }
    }
    setLoading(false)
  }, [initialConvId])

  const loadMessages = useCallback(async (convId: string) => {
    const res = await fetch(`/api/chat?conversationId=${convId}`)
    if (res.ok) {
      const data = await res.json()
      setMessages(data)
      setConversations(cs => cs.map(c => c.id === convId ? { ...c, unread: 0 } : c))
    }
  }, [])

  useEffect(() => { loadConversations() }, [loadConversations])

  useEffect(() => {
    if (!activeConv) return
    loadMessages(activeConv.id)
    pollRef.current = setInterval(() => loadMessages(activeConv.id), 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [activeConv, loadMessages])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
  }, [newMsg])

  async function selectConv(conv: Conversation) {
    setActiveConv(conv)
    setMessages([])
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

  function formatConvTime(iso: string) {
    const d = new Date(iso)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
    if (diffDays === 0) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    if (diffDays === 1) return 'Gestern'
    if (diffDays < 7) return d.toLocaleDateString('de-DE', { weekday: 'short' })
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
  }

  function formatMsgTime(iso: string) {
    const d = new Date(iso)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    return isToday
      ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' · ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  }

  // Group messages by date for date separators
  function getDateLabel(iso: string): string {
    const d = new Date(iso)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
    if (diffDays === 0) return 'Heute'
    if (diffDays === 1) return 'Gestern'
    return d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' })
  }

  const totalUnread = conversations.reduce((s, c) => s + c.unread, 0)

  // Build message list with date separators
  type MsgItem = {
    type: 'date'
    label: string
    key: string
  } | {
    type: 'msg'
    msg: Message
    showAvatar: boolean
    isFirstInGroup: boolean
    isLastInGroup: boolean
  }

  const msgItems: MsgItem[] = []
  let lastDateLabel = ''
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const label = getDateLabel(msg.created_at)
    if (label !== lastDateLabel) {
      msgItems.push({ type: 'date', label, key: `date-${msg.id}` })
      lastDateLabel = label
    }
    const isMe = msg.sender_id === userId
    const prevMsg = messages[i - 1]
    const nextMsg = messages[i + 1]
    const sameSenderAsPrev = prevMsg && prevMsg.sender_id === msg.sender_id && getDateLabel(prevMsg.created_at) === label
    const sameSenderAsNext = nextMsg && nextMsg.sender_id === msg.sender_id && getDateLabel(nextMsg.created_at) === label

    void isMe // used in render below
    msgItems.push({
      type: 'msg',
      msg,
      showAvatar: !isMe && !sameSenderAsNext,
      isFirstInGroup: !sameSenderAsPrev,
      isLastInGroup: !sameSenderAsNext,
    })
  }

  return (
    <div style={{
      maxWidth: '1100px', margin: '0 auto',
      padding: '20px 20px 32px',
      height: 'calc(100vh - 120px)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Page header */}
      <div style={{ marginBottom: '14px', display: 'flex', alignItems: 'baseline', gap: '10px' }}>
        <div>
          <p style={{ fontSize: '11px', fontWeight: 700, color: '#B8922A', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 2px' }}>
            Kommunikation
          </p>
          <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#111', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            Nachrichten
            {totalUnread > 0 && (
              <span style={{
                fontSize: '12px', fontWeight: 700, background: '#DC2626', color: '#fff',
                padding: '2px 9px', borderRadius: '99px', lineHeight: '20px',
              }}>
                {totalUnread}
              </span>
            )}
          </h1>
        </div>
      </div>

      {/* Main panel */}
      <div style={{
        flex: 1, display: 'flex', gap: 0, minHeight: 0,
        background: '#fff', borderRadius: '18px',
        border: '1px solid #E8E4DC',
        boxShadow: '0 2px 20px rgba(0,0,0,0.06)',
        overflow: 'hidden',
      }}>

        {/* ── Sidebar: Conversation list ── */}
        <div style={{
          width: '300px', flexShrink: 0,
          borderRight: '1px solid #EDE9E1',
          display: 'flex', flexDirection: 'column',
          background: '#FAFAF8',
        }}>
          <div style={{
            padding: '16px 16px 10px',
            borderBottom: '1px solid #EDE9E1',
          }}>
            <p style={{ fontSize: '13px', fontWeight: 700, color: '#333', margin: 0 }}>
              Unterhaltungen
            </p>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: '32px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: '13px', color: '#BBB' }}>Lädt…</div>
              </div>
            ) : conversations.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                <p style={{ fontSize: '32px', margin: '0 0 10px' }}>💬</p>
                <p style={{ fontSize: '13px', color: '#AAA', margin: 0 }}>Noch keine Nachrichten</p>
                <p style={{ fontSize: '11px', color: '#CCC', marginTop: '6px' }}>Gäste können dich über die Inseratsseite kontaktieren.</p>
              </div>
            ) : (
              conversations.map(conv => {
                const isActive = activeConv?.id === conv.id
                const name = otherName(conv)
                return (
                  <button
                    key={conv.id}
                    onClick={() => selectConv(conv)}
                    style={{
                      width: '100%', textAlign: 'left',
                      padding: '12px 14px',
                      background: isActive ? '#FDF6E8' : 'transparent',
                      border: 'none',
                      borderBottom: '1px solid #F0ECE4',
                      borderLeft: isActive ? '3px solid #C4A235' : '3px solid transparent',
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '11px',
                      transition: 'background 0.15s',
                    }}
                  >
                    <Avatar name={name} size={40} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                        <p style={{
                          fontSize: '13px',
                          fontWeight: conv.unread > 0 ? 700 : 600,
                          color: '#1A1A1A', margin: 0,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {name}
                        </p>
                        <span style={{ fontSize: '10px', color: '#AAA', flexShrink: 0, fontWeight: 500 }}>
                          {formatConvTime(conv.last_message_at)}
                        </span>
                      </div>
                      <p style={{
                        fontSize: '11px', color: '#999', margin: '2px 0 0',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {conv.listing_title ?? '—'}
                      </p>
                      {conv.unread > 0 && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          marginTop: '4px',
                          minWidth: '18px', height: '18px',
                          fontSize: '10px', fontWeight: 800,
                          background: '#C4A235', color: '#fff',
                          padding: '0 6px', borderRadius: '99px',
                        }}>
                          {conv.unread}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* ── Main: Message area ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: '#fff' }}>
          {!activeConv ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '44px', margin: '0 0 14px' }}>💬</p>
                <p style={{ fontSize: '16px', fontWeight: 600, color: '#555', margin: '0 0 6px' }}>Wähle eine Unterhaltung</p>
                <p style={{ fontSize: '13px', color: '#AAA' }}>Klicke links auf eine Konversation, um die Nachrichten anzuzeigen.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Header */}
              <div style={{
                padding: '14px 20px',
                borderBottom: '1px solid #EDE9E1',
                display: 'flex', alignItems: 'center', gap: '12px',
                background: '#fff',
              }}>
                <Avatar name={otherName(activeConv)} size={40} />
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: '15px', fontWeight: 700, color: '#111', margin: 0 }}>
                    {otherName(activeConv)}
                  </p>
                  <p style={{ fontSize: '12px', color: '#888', margin: '2px 0 0' }}>
                    {activeConv.listing_title ?? '—'}
                  </p>
                </div>
              </div>

              {/* Messages */}
              <div style={{
                flex: 1, overflowY: 'auto',
                padding: '20px 20px 8px',
                display: 'flex', flexDirection: 'column', gap: 0,
                background: '#F9F7F4',
              }}>
                {messages.length === 0 ? (
                  <div style={{ margin: 'auto', textAlign: 'center' }}>
                    <p style={{ fontSize: '30px', margin: '0 0 10px' }}>👋</p>
                    <p style={{ fontSize: '13px', color: '#AAA' }}>Noch keine Nachrichten in dieser Unterhaltung.</p>
                    <p style={{ fontSize: '12px', color: '#CCC', marginTop: '4px' }}>Schreibe die erste Nachricht!</p>
                  </div>
                ) : (
                  msgItems.map((item, idx) => {
                    if (item.type === 'date') {
                      return (
                        <div key={item.key} style={{
                          display: 'flex', alignItems: 'center', gap: '10px',
                          margin: '16px 0 10px',
                        }}>
                          <div style={{ flex: 1, height: '1px', background: '#E8E4DC' }} />
                          <span style={{
                            fontSize: '11px', fontWeight: 600, color: '#AAA',
                            padding: '3px 10px',
                            background: '#EEEAE2',
                            borderRadius: '99px',
                            whiteSpace: 'nowrap',
                          }}>
                            {item.label}
                          </span>
                          <div style={{ flex: 1, height: '1px', background: '#E8E4DC' }} />
                        </div>
                      )
                    }

                    const { msg, showAvatar, isFirstInGroup, isLastInGroup } = item
                    const isMe = msg.sender_id === userId
                    const otherN = otherName(activeConv)

                    // Border-radius shaping for message groups
                    let borderRadius: string
                    if (isMe) {
                      borderRadius = isFirstInGroup && isLastInGroup
                        ? '18px 18px 4px 18px'
                        : isFirstInGroup
                          ? '18px 18px 4px 18px'
                          : isLastInGroup
                            ? '18px 18px 4px 18px'
                            : '18px 4px 4px 18px'
                    } else {
                      borderRadius = isFirstInGroup && isLastInGroup
                        ? '18px 18px 18px 4px'
                        : isFirstInGroup
                          ? '4px 18px 18px 4px'
                          : isLastInGroup
                            ? '4px 18px 18px 4px'
                            : '4px 18px 18px 4px'
                    }

                    return (
                      <div
                        key={msg.id}
                        style={{
                          display: 'flex',
                          flexDirection: isMe ? 'row-reverse' : 'row',
                          alignItems: 'flex-end',
                          gap: '8px',
                          marginBottom: isLastInGroup ? '10px' : '2px',
                          marginTop: isFirstInGroup && idx > 0 ? '6px' : 0,
                        }}
                      >
                        {/* Avatar placeholder for alignment */}
                        <div style={{ width: 32, flexShrink: 0 }}>
                          {!isMe && showAvatar && (
                            <Avatar name={otherN} size={32} />
                          )}
                        </div>

                        {/* Bubble */}
                        <div style={{
                          maxWidth: '68%',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: isMe ? 'flex-end' : 'flex-start',
                          gap: '2px',
                        }}>
                          {/* Sender name (only for first in group, from the other side) */}
                          {!isMe && isFirstInGroup && (
                            <span style={{
                              fontSize: '11px', fontWeight: 700,
                              color: '#8A6818',
                              marginLeft: '4px',
                            }}>
                              {otherN}
                            </span>
                          )}

                          <div style={{
                            padding: '9px 13px',
                            borderRadius,
                            background: isMe
                              ? 'linear-gradient(135deg, #D4AE3A 0%, #8A6818 100%)'
                              : '#EDEBE6',
                            color: isMe ? '#fff' : '#1A1A1A',
                            fontSize: '14px',
                            lineHeight: '1.5',
                            wordBreak: 'break-word',
                            boxShadow: isMe
                              ? '0 1px 4px rgba(140, 100, 20, 0.2)'
                              : '0 1px 3px rgba(0,0,0,0.06)',
                          }}>
                            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{msg.content}</p>
                          </div>

                          {/* Timestamp + read receipt */}
                          {isLastInGroup && (
                            <div style={{
                              fontSize: '10px',
                              color: isMe ? '#AAA' : '#BBB',
                              marginLeft: isMe ? 0 : '4px',
                              marginRight: isMe ? '2px' : 0,
                              display: 'flex', alignItems: 'center', gap: '4px',
                            }}>
                              {formatMsgTime(msg.created_at)}
                              {isMe && msg.read_at && (
                                <span style={{ color: '#C4A235', fontWeight: 700 }}>✓✓</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div style={{
                padding: '12px 16px',
                borderTop: '1px solid #EDE9E1',
                display: 'flex', gap: '10px', alignItems: 'flex-end',
                background: '#fff',
              }}>
                <textarea
                  ref={textareaRef}
                  value={newMsg}
                  onChange={e => setNewMsg(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendMessage()
                    }
                  }}
                  placeholder="Nachricht schreiben…"
                  rows={1}
                  style={{
                    flex: 1,
                    borderRadius: '22px',
                    border: '1.5px solid #DDD9D0',
                    padding: '10px 16px',
                    fontSize: '14px',
                    resize: 'none',
                    outline: 'none',
                    fontFamily: 'inherit',
                    lineHeight: '1.5',
                    maxHeight: '120px',
                    overflowY: 'auto',
                    background: '#FAFAF8',
                    color: '#111',
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#C4A235' }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#DDD9D0' }}
                />
                <button
                  onClick={sendMessage}
                  disabled={sending || !newMsg.trim()}
                  style={{
                    width: '44px', height: '44px',
                    borderRadius: '50%',
                    border: 'none',
                    background: newMsg.trim() && !sending
                      ? 'linear-gradient(135deg, #D4AE3A 0%, #8A6818 100%)'
                      : '#E5E2DB',
                    color: '#fff',
                    fontSize: '20px',
                    cursor: newMsg.trim() && !sending ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'background 0.15s, transform 0.1s',
                    transform: sending ? 'scale(0.95)' : 'scale(1)',
                    boxShadow: newMsg.trim() && !sending ? '0 2px 8px rgba(196, 162, 53, 0.4)' : 'none',
                  }}
                  title="Senden (Enter)"
                >
                  {sending ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
                      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round">
                        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
                      </path>
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
