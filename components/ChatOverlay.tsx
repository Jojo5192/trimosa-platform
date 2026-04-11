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

/* ─── Helpers ──────────────────────────────────────────────── */

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

function fmtListTime(iso: string) {
  const d = new Date(iso), now = new Date()
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (days === 0) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  if (days === 1) return 'Gestern'
  if (days < 7) return d.toLocaleDateString('de-DE', { weekday: 'short' })
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
}

function fmtMsgTime(iso: string) {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

function fmtDayLabel(iso: string) {
  const d = new Date(iso), now = new Date()
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (days === 0) return 'Heute'
  if (days === 1) return 'Gestern'
  return d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
}

/* ─── Avatar ─────────────────────────────────────────────── */
function Ava({ name, size = 38 }: { name: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'linear-gradient(140deg,#D4AE3A,#7A5410)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.37, fontWeight: 700, color: '#fff', userSelect: 'none',
      letterSpacing: '0.5px',
    }}>
      {initials(name)}
    </div>
  )
}

/* ─── Props ──────────────────────────────────────────────── */
interface Props { open: boolean; onClose: () => void; userId: string }

/* ─── Component ──────────────────────────────────────────── */
export default function ChatOverlay({ open, onClose, userId }: Props) {
  const [screen, setScreen] = useState<'list' | 'msgs'>('list')
  const [convs, setConvs]   = useState<Conversation[]>([])
  const [active, setActive] = useState<Conversation | null>(null)
  const [msgs, setMsgs]     = useState<Message[]>([])
  const [draft, setDraft]   = useState('')
  const [busy, setBusy]     = useState(false)
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const taRef     = useRef<HTMLTextAreaElement>(null)
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null)

  const otherName = (c: Conversation) =>
    c.guest_id === userId ? (c.host_name || 'Gastgeber') : (c.guest_name || 'Gast')

  /* fetch convs */
  const fetchConvs = useCallback(async () => {
    const r = await fetch('/api/chat')
    if (r.ok) setConvs(await r.json())
  }, [])

  /* fetch messages */
  const fetchMsgs = useCallback(async (id: string) => {
    const r = await fetch(`/api/chat?conversationId=${id}`)
    if (r.ok) {
      const data: Message[] = await r.json()
      setMsgs(data)
      setConvs(cs => cs.map(c => c.id === id ? { ...c, unread: 0 } : c))
    }
  }, [])

  /* open → load convs */
  useEffect(() => {
    if (!open) { if (timerRef.current) clearInterval(timerRef.current); return }
    setLoading(true)
    fetchConvs().finally(() => setLoading(false))
  }, [open, fetchConvs])

  /* active conv → poll messages */
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (!open || !active) return
    fetchMsgs(active.id)
    timerRef.current = setInterval(() => fetchMsgs(active.id), 5000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [open, active, fetchMsgs])

  /* scroll to bottom when messages change */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs])

  /* textarea auto-height */
  useEffect(() => {
    if (!taRef.current) return
    taRef.current.style.height = 'auto'
    taRef.current.style.height = Math.min(taRef.current.scrollHeight, 96) + 'px'
  }, [draft])

  /* Escape */
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  function openConv(c: Conversation) {
    setActive(c)
    setMsgs([])
    setScreen('msgs')
  }

  function goBack() {
    if (timerRef.current) clearInterval(timerRef.current)
    setActive(null)
    setScreen('list')
    fetchConvs()
  }

  async function send() {
    if (!draft.trim() || !active || busy) return
    setBusy(true)
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
    setBusy(false)
  }

  if (!open) return null

  const unread = convs.reduce((s, c) => s + c.unread, 0)

  /* ─── group messages by day for separators ── */
  type Grouped = { day: string; items: Message[] }[]
  const grouped: Grouped = []
  for (const m of msgs) {
    const day = fmtDayLabel(m.created_at)
    if (!grouped.length || grouped[grouped.length - 1].day !== day) {
      grouped.push({ day, items: [m] })
    } else {
      grouped[grouped.length - 1].items.push(m)
    }
  }

  /* ─── Shared styles ── */
  const panel: React.CSSProperties = {
    position: 'fixed', top: 0, right: 0, bottom: 0,
    width: 420,
    zIndex: 9001,
    display: 'flex', flexDirection: 'column',
    background: '#fff',
    boxShadow: '-2px 0 24px rgba(0,0,0,0.14)',
    animation: 'chatSlide 0.26s cubic-bezier(0.25,0.8,0.25,1)',
  }

  return (
    <>
      <style>{`
        @keyframes chatSlide { from{transform:translateX(100%)} to{transform:translateX(0)} }
        @keyframes chatFade  { from{opacity:0} to{opacity:1} }
      `}</style>

      {/* backdrop */}
      <div
        onClick={onClose}
        style={{ position:'fixed', inset:0, zIndex:9000, background:'rgba(0,0,0,0.4)', backdropFilter:'blur(2px)', animation:'chatFade 0.2s ease' }}
      />

      <div style={panel}>
        {/* ── Header ── */}
        <div style={{ height:56, borderBottom:'1px solid #E9E5DC', background:'#fff', display:'flex', alignItems:'center', gap:10, padding:'0 14px', flexShrink:0 }}>
          {screen === 'msgs' && active ? (
            <>
              <button onClick={goBack} style={{ background:'none',border:'none',padding:'6px 2px',cursor:'pointer',color:'#888',display:'flex',borderRadius:6 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <Ava name={otherName(active)} size={32} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:14, fontWeight:700, color:'#111', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{otherName(active)}</div>
                <div style={{ fontSize:11, color:'#999', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{active.listing_title ?? ''}</div>
              </div>
            </>
          ) : (
            <>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#C4A235" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <span style={{ flex:1, fontSize:15, fontWeight:700, color:'#111' }}>
                Nachrichten {unread > 0 && <span style={{ marginLeft:6, fontSize:11, fontWeight:800, background:'#EF4444', color:'#fff', padding:'1px 7px', borderRadius:99 }}>{unread}</span>}
              </span>
            </>
          )}

          <button
            onClick={onClose}
            title="Schließen (Esc)"
            style={{ width:30, height:30, borderRadius:'50%', border:'none', background:'#F0EDE6', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'#666', flexShrink:0 }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* ── Conversation list ── */}
        {screen === 'list' && (
          <div style={{ flex:1, overflowY:'auto', background:'#FAFAF8' }}>
            {loading && (
              <div style={{ padding:40, textAlign:'center', color:'#CCC', fontSize:13 }}>Lädt…</div>
            )}
            {!loading && convs.length === 0 && (
              <div style={{ padding:'64px 24px', textAlign:'center' }}>
                <div style={{ fontSize:40, marginBottom:12 }}>💬</div>
                <div style={{ fontSize:14, fontWeight:600, color:'#555' }}>Keine Nachrichten</div>
                <div style={{ fontSize:12, color:'#AAA', marginTop:6 }}>Gäste können über die Inseratsseite schreiben.</div>
              </div>
            )}
            {convs.map(c => (
              <button
                key={c.id}
                onClick={() => openConv(c)}
                style={{ width:'100%', textAlign:'left', padding:'13px 16px', border:'none', borderBottom:'1px solid #EEEAE2', background:'transparent', cursor:'pointer', display:'flex', alignItems:'center', gap:12 }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background='#FDF8EE' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background='transparent' }}
              >
                <Ava name={otherName(c)} size={44} />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                    <span style={{ fontSize:13.5, fontWeight: c.unread > 0 ? 700 : 600, color:'#111', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:200 }}>{otherName(c)}</span>
                    <span style={{ fontSize:11, color:'#BBB', flexShrink:0 }}>{fmtListTime(c.last_message_at)}</span>
                  </div>
                  <div style={{ fontSize:12, color:'#999', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.listing_title ?? '—'}</div>
                </div>
                {c.unread > 0 && (
                  <span style={{ minWidth:20, height:20, padding:'0 6px', borderRadius:99, background:'#C4A235', fontSize:11, fontWeight:800, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{c.unread}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* ── Messages ── */}
        {screen === 'msgs' && active && (
          <>
            {/* message area */}
            <div style={{ flex:1, overflowY:'auto', padding:'16px 14px 8px', background:'#F4F1EB', display:'flex', flexDirection:'column', gap:0 }}>
              {msgs.length === 0 && (
                <div style={{ margin:'auto', textAlign:'center' }}>
                  <div style={{ fontSize:32, marginBottom:8 }}>👋</div>
                  <div style={{ fontSize:13, color:'#AAA' }}>Noch keine Nachrichten</div>
                </div>
              )}

              {grouped.map(({ day, items }) => (
                <div key={day}>
                  {/* Day separator */}
                  <div style={{ display:'flex', alignItems:'center', gap:8, margin:'12px 0 8px' }}>
                    <div style={{ flex:1, height:1, background:'#DDD8CE' }} />
                    <span style={{ fontSize:11, color:'#999', fontWeight:600, background:'#E8E4DC', padding:'2px 10px', borderRadius:99, whiteSpace:'nowrap' }}>{day}</span>
                    <div style={{ flex:1, height:1, background:'#DDD8CE' }} />
                  </div>

                  {items.map((msg, i) => {
                    const isMe = msg.sender_id === userId
                    const prevSame = i > 0 && items[i - 1].sender_id === msg.sender_id
                    const nextSame = i < items.length - 1 && items[i + 1].sender_id === msg.sender_id
                    const isLast = !nextSame

                    return (
                      <div
                        key={msg.id}
                        style={{
                          display:'flex',
                          flexDirection: isMe ? 'row-reverse' : 'row',
                          alignItems:'flex-end',
                          gap:6,
                          marginBottom: isLast ? 10 : 2,
                          marginTop: prevSame ? 0 : 4,
                        }}
                      >
                        {/* Avatar slot — always 28px wide for alignment */}
                        <div style={{ width:28, flexShrink:0 }}>
                          {!isMe && isLast && <Ava name={otherName(active)} size={28} />}
                        </div>

                        <div style={{ maxWidth:'72%', display:'flex', flexDirection:'column', alignItems: isMe ? 'flex-end' : 'flex-start', gap:2 }}>
                          {/* Bubble */}
                          <div style={{
                            padding:'8px 13px',
                            borderRadius: isMe
                              ? (prevSame ? '16px 4px 4px 16px' : '16px 16px 4px 16px')
                              : (prevSame ? '4px 16px 16px 4px' : '4px 16px 16px 16px'),
                            background: isMe
                              ? 'linear-gradient(135deg,#D4AE3A,#8A6818)'
                              : '#fff',
                            color: isMe ? '#fff' : '#1a1a1a',
                            fontSize:13.5,
                            lineHeight:1.45,
                            boxShadow: isMe
                              ? '0 1px 4px rgba(140,100,20,0.22)'
                              : '0 1px 3px rgba(0,0,0,0.08)',
                            wordBreak:'break-word',
                          }}>
                            <span style={{ whiteSpace:'pre-wrap' }}>{msg.content}</span>
                          </div>

                          {/* Time + read receipt */}
                          {isLast && (
                            <span style={{ fontSize:10.5, color:'#AAA', paddingLeft: isMe ? 0 : 2, paddingRight: isMe ? 2 : 0 }}>
                              {fmtMsgTime(msg.created_at)}
                              {isMe && msg.read_at && <span style={{ color:'#C4A235', marginLeft:3, fontWeight:700 }}>✓✓</span>}
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
            <div style={{ borderTop:'1px solid #E9E5DC', background:'#fff', padding:'10px 12px', display:'flex', gap:8, alignItems:'flex-end', flexShrink:0 }}>
              <textarea
                ref={taRef}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder="Nachricht schreiben…"
                rows={1}
                style={{ flex:1, resize:'none', outline:'none', border:'1.5px solid #DDD9D0', borderRadius:20, padding:'9px 14px', fontSize:13.5, lineHeight:1.45, fontFamily:'inherit', background:'#FAFAF8', color:'#111', maxHeight:96, overflowY:'auto', transition:'border-color 0.15s' }}
                onFocus={e => { e.target.style.borderColor='#C4A235' }}
                onBlur={e => { e.target.style.borderColor='#DDD9D0' }}
              />
              <button
                onClick={send}
                disabled={busy || !draft.trim()}
                style={{
                  width:40, height:40, borderRadius:'50%', border:'none', flexShrink:0,
                  background: draft.trim() && !busy ? 'linear-gradient(135deg,#D4AE3A,#8A6818)' : '#E5E1D8',
                  color:'#fff', cursor: draft.trim() && !busy ? 'pointer' : 'default',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  boxShadow: draft.trim() && !busy ? '0 2px 8px rgba(196,162,53,0.35)' : 'none',
                  transition:'all 0.15s',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
