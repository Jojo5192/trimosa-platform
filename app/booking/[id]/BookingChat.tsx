'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface Message {
  id: string
  sender_type: 'guest' | 'host' | 'system'
  sender_id?: string
  content: string
  created_at: string
  smoobu_message_id?: string | null
}

interface Props {
  bookingId: string
  currentUserId: string
  isHost: boolean
}

function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function BookingChat({ bookingId, currentUserId, isHost }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/messages/${bookingId}`)
      if (res.ok) {
        const data = await res.json()
        setMessages(data.messages ?? [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [bookingId])

  useEffect(() => {
    fetchMessages()
    // Poll every 30s for new messages (Smoobu has no push webhook for messages)
    pollRef.current = setInterval(fetchMessages, 30000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchMessages])

  // Scroll to bottom when messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend() {
    if (!input.trim() || sending) return
    setSending(true)
    const content = input.trim()
    setInput('')

    // Optimistic update
    const tmpId = `tmp-${Date.now()}`
    const tmpMsg: Message = {
      id: tmpId,
      sender_type: isHost ? 'host' : 'guest',
      sender_id: currentUserId,
      content,
      created_at: new Date().toISOString(),
    }
    setMessages(m => [...m, tmpMsg])

    try {
      const res = await fetch(`/api/messages/${bookingId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (res.ok) {
        const data = await res.json()
        setMessages(m => m.map(msg => msg.id === tmpId ? data.message : msg))
      } else {
        // Revert optimistic update on failure
        setMessages(m => m.filter(msg => msg.id !== tmpId))
        setInput(content)
      }
    } catch {
      setMessages(m => m.filter(msg => msg.id !== tmpId))
      setInput(content)
    }
    setSending(false)
  }

  const myType = isHost ? 'host' : 'guest'

  return (
    <div style={{ background: '#fff', borderRadius: '20px', border: '1px solid #E8E6E0', display: 'flex', flexDirection: 'column', height: '520px' }}>

      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #F0EEE8', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg, #C4A235, #8A6818)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <div>
          <p style={{ fontSize: '13px', fontWeight: 700, color: '#111', margin: 0 }}>
            {isHost ? 'Nachricht an Gast' : 'Nachricht an Gastgeber'}
          </p>
          <p style={{ fontSize: '11px', color: '#999', margin: 0 }}>Antwortet in Smoobu automatisch sichtbar</p>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#BBB', fontSize: '13px' }}>Nachrichten werden geladen…</div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: '32px', marginBottom: '10px' }}>💬</div>
            <p style={{ fontSize: '14px', fontWeight: 600, color: '#111', margin: '0 0 4px' }}>Noch keine Nachrichten</p>
            <p style={{ fontSize: '12px', color: '#999', margin: 0 }}>
              {isHost ? 'Schreibe dem Gast eine erste Nachricht.' : 'Schreibe dem Gastgeber eine Nachricht.'}
            </p>
          </div>
        ) : (
          messages.map(msg => {
            const isMine = msg.sender_type === myType
            const isSystem = msg.sender_type === 'system'

            if (isSystem) return (
              <div key={msg.id} style={{ textAlign: 'center' }}>
                <span style={{ fontSize: '11px', color: '#AAA', background: '#F5F5F5', padding: '3px 10px', borderRadius: '999px' }}>
                  {msg.content}
                </span>
              </div>
            )

            return (
              <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isMine ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '72%',
                  padding: '10px 14px',
                  borderRadius: isMine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: isMine ? 'linear-gradient(135deg, #C4A235, #8A6818)' : '#F5F3EF',
                  color: isMine ? '#fff' : '#111',
                  fontSize: '13px',
                  lineHeight: 1.5,
                  boxShadow: isMine ? '0 2px 8px rgba(168,136,42,0.3)' : 'none',
                }}>
                  {msg.content}
                </div>
                <span style={{ fontSize: '10px', color: '#BBB', marginTop: '3px' }}>
                  {msg.smoobu_message_id ? '↔ Smoobu · ' : ''}{formatTime(msg.created_at)}
                </span>
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid #F0EEE8', display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          placeholder="Nachricht schreiben… (Enter zum Senden)"
          rows={1}
          style={{
            flex: 1,
            borderRadius: '12px',
            border: '1.5px solid #E0DDD6',
            padding: '10px 14px',
            fontSize: '13px',
            color: '#111',
            resize: 'none',
            outline: 'none',
            fontFamily: 'inherit',
            lineHeight: 1.5,
            maxHeight: '100px',
            overflowY: 'auto',
          }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!input.trim() || sending}
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '12px',
            border: 'none',
            background: input.trim() ? 'linear-gradient(135deg, #C4A235, #8A6818)' : '#E5E5E5',
            cursor: input.trim() && !sending ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'all 0.15s',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={input.trim() ? '#fff' : '#AAA'} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  )
}
