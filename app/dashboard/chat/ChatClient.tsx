'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'

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

export default function ChatClient({ userId }: { userId: string }) {
  const searchParams = useSearchParams()
  const initialConvId = searchParams.get('conv')

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConv, setActiveConv] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [newMsg, setNewMsg] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const didAutoSelect = useRef(false)

  // Returns the name of the OTHER party we're chatting with
  function otherName(conv: Conversation): string {
    if (conv.guest_id === userId) return conv.host_name ?? 'Gastgeber'
    return conv.guest_name ?? 'Gast'
  }

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadConversations = useCallback(async () => {
    const res = await fetch('/api/chat')
    if (res.ok) {
      const data: Conversation[] = await res.json()
      setConversations(data)
      // Auto-open conversation from URL param (only once)
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
      // Mark as read in UI
      setConversations(cs => cs.map(c => c.id === convId ? { ...c, unread: 0 } : c))
    }
  }, [])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  // Poll for new messages every 5s
  useEffect(() => {
    if (!activeConv) return
    loadMessages(activeConv.id)
    pollRef.current = setInterval(() => loadMessages(activeConv.id), 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [activeConv, loadMessages])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function selectConv(conv: Conversation) {
    setActiveConv(conv)
    setMessages([])
  }

  async function sendMessage() {
    if (!newMsg.trim() || !activeConv) return
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
    const isToday = d.toDateString() === now.toDateString()
    return isToday
      ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
  }

  const totalUnread = conversations.reduce((s, c) => s + c.unread, 0)

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '24px 20px 40px', height: 'calc(100vh - 130px)', display: 'flex', flexDirection: 'column' }}>

      <div style={{ marginBottom: '16px' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#A8882A', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 2px' }}>
          Kommunikation
        </p>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#111', margin: 0 }}>
          Chat
          {totalUnread > 0 && (
            <span style={{ marginLeft: '10px', fontSize: '13px', fontWeight: 700, background: '#DC2626', color: '#fff', padding: '2px 8px', borderRadius: '99px' }}>
              {totalUnread}
            </span>
          )}
        </h1>
      </div>

      <div style={{ flex: 1, display: 'flex', gap: '12px', minHeight: 0, background: '#fff', borderRadius: '20px', border: '1px solid #E8E6E0', overflow: 'hidden' }}>

        {/* Conversation List */}
        <div style={{ width: '280px', flexShrink: 0, borderRight: '1px solid #F0EDE8', overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: '24px', textAlign: 'center', color: '#AAA', fontSize: '13px' }}>Lädt…</div>
          ) : conversations.length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center' }}>
              <p style={{ fontSize: '14px', color: '#AAA', margin: 0 }}>Noch keine Nachrichten.</p>
              <p style={{ fontSize: '12px', color: '#CCC', marginTop: '8px' }}>Gäste können dich über die Inseratsseite kontaktieren.</p>
            </div>
          ) : (
            conversations.map(conv => (
              <button
                key={conv.id}
                onClick={() => selectConv(conv)}
                style={{
                  width: '100%', textAlign: 'left', padding: '14px 16px',
                  background: activeConv?.id === conv.id ? '#FBF6EC' : 'transparent',
                  border: 'none', borderBottom: '1px solid #F8F5F0',
                  cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: '10px',
                }}
              >
                <div style={{
                  width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
                  background: 'linear-gradient(135deg, #C4A235, #8A6818)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '14px', fontWeight: 700, color: '#fff',
                }}>
                  {otherName(conv)[0].toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <p style={{ fontSize: '13px', fontWeight: conv.unread > 0 ? 700 : 600, color: '#111', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>
                      {otherName(conv)}
                    </p>
                    <span style={{ fontSize: '10px', color: '#AAA', flexShrink: 0 }}>
                      {formatTime(conv.last_message_at)}
                    </span>
                  </div>
                  <p style={{ fontSize: '11px', color: '#888', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {conv.listing_title ?? '—'}
                  </p>
                  {conv.unread > 0 && (
                    <span style={{ display: 'inline-block', marginTop: '4px', fontSize: '10px', fontWeight: 700, background: '#A8882A', color: '#fff', padding: '1px 7px', borderRadius: '99px' }}>
                      {conv.unread} neu
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Message Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {!activeConv ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '32px', margin: '0 0 12px' }}>💬</p>
                <p style={{ fontSize: '14px', color: '#AAA' }}>Wähle eine Unterhaltung aus</p>
              </div>
            </div>
          ) : (
            <>
              {/* Header */}
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #F0EDE8', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '36px', height: '36px', borderRadius: '50%',
                  background: 'linear-gradient(135deg, #C4A235, #8A6818)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '14px', fontWeight: 700, color: '#fff', flexShrink: 0,
                }}>
                  {otherName(activeConv)[0].toUpperCase()}
                </div>
                <div>
                  <p style={{ fontSize: '14px', fontWeight: 700, color: '#111', margin: 0 }}>{otherName(activeConv)}</p>
                  <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>{activeConv.listing_title ?? '—'}</p>
                </div>
              </div>

              {/* Messages */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {messages.length === 0 ? (
                  <p style={{ textAlign: 'center', color: '#CCC', fontSize: '13px', margin: 'auto' }}>Noch keine Nachrichten in dieser Unterhaltung.</p>
                ) : (
                  messages.map(msg => {
                    const isMe = msg.sender_id === userId
                    return (
                      <div key={msg.id} style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
                        <div style={{
                          maxWidth: '70%',
                          padding: '10px 14px',
                          borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                          background: isMe ? 'linear-gradient(135deg, #C4A235, #8A6818)' : '#F5F3EF',
                          color: isMe ? '#fff' : '#111',
                          fontSize: '14px',
                          lineHeight: '1.5',
                        }}>
                          <p style={{ margin: 0 }}>{msg.content}</p>
                          <p style={{ fontSize: '10px', margin: '4px 0 0', opacity: 0.7, textAlign: 'right' }}>
                            {formatTime(msg.created_at)}
                            {isMe && msg.read_at && ' · ✓'}
                          </p>
                        </div>
                      </div>
                    )
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div style={{ padding: '12px 16px', borderTop: '1px solid #F0EDE8', display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                <textarea
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
                    flex: 1, borderRadius: '14px', border: '1.5px solid #E0DDD6',
                    padding: '10px 14px', fontSize: '14px', resize: 'none',
                    outline: 'none', fontFamily: 'inherit', lineHeight: '1.5',
                    maxHeight: '120px', overflowY: 'auto',
                  }}
                />
                <button
                  onClick={sendMessage}
                  disabled={sending || !newMsg.trim()}
                  style={{
                    width: '42px', height: '42px', borderRadius: '50%', border: 'none',
                    background: newMsg.trim() ? 'linear-gradient(135deg, #C4A235, #8A6818)' : '#E0DDD6',
                    color: '#fff', fontSize: '18px', cursor: newMsg.trim() ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {sending ? '…' : '↑'}
                </button>
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  )
}
