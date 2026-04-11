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
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'
}
function fmtConvTime(iso: string) {
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

function Ava({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'linear-gradient(140deg, #D4AE3A, #7A5410)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.36, fontWeight: 700, color: '#fff', userSelect: 'none',
    }}>
      {initials(name)}
    </div>
  )
}

interface Props { open: boolean; onClose: () => void; userId: string }

export default function ChatOverlay({ open, onClose, userId }: Props) {
  const [convs, setConvs]       = useState<Conversation[]>([])
  const [active, setActive]     = useState<Conversation | null>(null)
  const [msgs, setMsgs]         = useState<Message[]>([])
  const [draft, setDraft]       = useState('')
  const [busy, setBusy]         = useState(false)
  const [loadingConvs, setLoadingConvs] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const taRef     = useRef<HTMLTextAreaElement>(null)
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null)

  const other = (c: Conversation) =>
    c.guest_id === userId ? (c.host_name || 'Gastgeber') : (c.guest_name || 'Gast')

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

  useEffect(() => {
    if (!open) return
    setLoadingConvs(true)
    fetchConvs().finally(() => setLoadingConvs(false))
  }, [open, fetchConvs])

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (!open || !active) return
    fetchMsgs(active.id)
    timerRef.current = setInterval(() => fetchMsgs(active.id), 5000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [open, active, fetchMsgs])

  useEffect(() => {
    if (!open && timerRef.current) clearInterval(timerRef.current)
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs])

  useEffect(() => {
    const ta = taRef.current; if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 96) + 'px'
  }, [draft])

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [onClose])

  async function send() {
    if (!draft.trim() || !active || busy) return
    setBusy(true)
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: active.id, content: draft }),
    })
    if (r.ok) { setDraft(''); await fetchMsgs(active.id); fetchConvs() }
    setBusy(false)
  }

  if (!open) return null

  // Group messages by day
  const groups: { day: string; msgs: Message[] }[] = []
  for (const m of msgs) {
    const day = fmtDayLabel(m.created_at)
    if (!groups.length || groups[groups.length - 1].day !== day) groups.push({ day, msgs: [m] })
    else groups[groups.length - 1].msgs.push(m)
  }

  const totalUnread = convs.reduce((s, c) => s + c.unread, 0)

  return (
    <>
      <style>{`
        @keyframes coFadeIn  { from{opacity:0} to{opacity:1} }
        @keyframes coScaleIn { from{opacity:0;transform:translate(-50%,-50%) scale(0.95)} to{opacity:1;transform:translate(-50%,-50%) scale(1)} }
        .co-conv-row:hover { background:#FDF8EE !important; }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position:'fixed', inset:0, zIndex:9000, background:'rgba(10,8,4,0.55)', backdropFilter:'blur(4px)', animation:'coFadeIn 0.2s ease' }}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 9001,
        width: 'min(900px, 92vw)',
        height: 'min(660px, 88vh)',
        background: '#fff',
        borderRadius: 20,
        boxShadow: '0 24px 80px rgba(0,0,0,0.28), 0 0 0 1px rgba(0,0,0,0.06)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        animation: 'coScaleIn 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}>

        {/* ── Top bar ── */}
        <div style={{ display:'flex', alignItems:'center', padding:'0 20px', height:52, borderBottom:'1px solid #EEEAE1', background:'#FAFAF7', flexShrink:0, gap:12 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#C4A235" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span style={{ fontWeight:700, fontSize:14.5, color:'#111', flex:1 }}>
            Nachrichten
            {totalUnread > 0 && (
              <span style={{ marginLeft:8, fontSize:11, fontWeight:800, background:'#EF4444', color:'#fff', padding:'1px 7px', borderRadius:99 }}>
                {totalUnread}
              </span>
            )}
          </span>
          {active && (
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <Ava name={other(active)} size={26} />
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:'#111', lineHeight:1.2 }}>{other(active)}</div>
                <div style={{ fontSize:11, color:'#999', lineHeight:1.2 }}>{active.listing_title}</div>
              </div>
            </div>
          )}
          <button
            onClick={onClose}
            style={{ marginLeft:8, width:30, height:30, borderRadius:'50%', border:'none', background:'#EEEAE1', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'#666', flexShrink:0 }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* ── Body: 2-pane ── */}
        <div style={{ flex:1, display:'flex', minHeight:0 }}>

          {/* Left pane: conversation list */}
          <div style={{ width:280, flexShrink:0, borderRight:'1px solid #EEEAE1', overflowY:'auto', background:'#FAFAF7' }}>
            {loadingConvs && (
              <div style={{ padding:32, textAlign:'center', fontSize:12, color:'#CCC' }}>Lädt…</div>
            )}
            {!loadingConvs && convs.length === 0 && (
              <div style={{ padding:'48px 20px', textAlign:'center' }}>
                <div style={{ fontSize:36, marginBottom:10 }}>💬</div>
                <div style={{ fontSize:13, fontWeight:600, color:'#666' }}>Keine Nachrichten</div>
                <div style={{ fontSize:11, color:'#AAA', marginTop:6 }}>Gäste schreiben über die Inseratsseite.</div>
              </div>
            )}
            {convs.map(c => {
              const isActive = active?.id === c.id
              return (
                <button
                  key={c.id}
                  className="co-conv-row"
                  onClick={() => setActive(c)}
                  style={{
                    width:'100%', textAlign:'left', border:'none', cursor:'pointer',
                    padding:'11px 14px', borderBottom:'1px solid #F0EDE6',
                    borderLeft: isActive ? '3px solid #C4A235' : '3px solid transparent',
                    background: isActive ? '#FDF5E4' : 'transparent',
                    display:'flex', alignItems:'center', gap:10, transition:'background 0.12s',
                  }}
                >
                  <Ava name={other(c)} size={38} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <span style={{ fontSize:13, fontWeight: c.unread ? 700 : 600, color:'#111', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:130 }}>
                        {other(c)}
                      </span>
                      <span style={{ fontSize:10.5, color:'#BBB', flexShrink:0, marginLeft:4 }}>
                        {fmtConvTime(c.last_message_at)}
                      </span>
                    </div>
                    <div style={{ fontSize:11.5, color:'#999', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {c.listing_title ?? '—'}
                    </div>
                    {c.unread > 0 && (
                      <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', marginTop:3, minWidth:18, height:18, padding:'0 5px', borderRadius:99, background:'#C4A235', fontSize:10.5, fontWeight:800, color:'#fff' }}>
                        {c.unread}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Right pane: messages */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, background:'#fff' }}>
            {!active ? (
              <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:10, color:'#CCC' }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity:0.35 }}>
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <span style={{ fontSize:13, color:'#AAA' }}>Unterhaltung auswählen</span>
              </div>
            ) : (
              <>
                {/* Messages */}
                <div style={{ flex:1, overflowY:'auto', padding:'18px 20px 8px', background:'#F6F3ED', display:'flex', flexDirection:'column' }}>
                  {msgs.length === 0 && (
                    <div style={{ margin:'auto', textAlign:'center' }}>
                      <div style={{ fontSize:32, marginBottom:8 }}>👋</div>
                      <div style={{ fontSize:13, color:'#AAA' }}>Noch keine Nachrichten</div>
                    </div>
                  )}

                  {groups.map(({ day, msgs: dayMsgs }) => (
                    <div key={day}>
                      {/* Day separator */}
                      <div style={{ display:'flex', alignItems:'center', gap:8, margin:'14px 0 10px' }}>
                        <div style={{ flex:1, height:1, background:'#DDD8CE' }} />
                        <span style={{ fontSize:11, color:'#AAA', fontWeight:600, background:'#EAE6DE', padding:'2px 10px', borderRadius:99, whiteSpace:'nowrap' }}>{day}</span>
                        <div style={{ flex:1, height:1, background:'#DDD8CE' }} />
                      </div>

                      {dayMsgs.map((msg, i) => {
                        const isMe = msg.sender_id === userId
                        const prevSame = i > 0 && dayMsgs[i - 1].sender_id === msg.sender_id
                        const nextSame = i < dayMsgs.length - 1 && dayMsgs[i + 1].sender_id === msg.sender_id
                        const isLast = !nextSame

                        const br = isMe
                          ? (prevSame ? '18px 4px 4px 18px' : '18px 18px 4px 18px')
                          : (prevSame ? '4px 18px 18px 18px' : '4px 18px 18px 18px')

                        return (
                          <div
                            key={msg.id}
                            style={{
                              display:'flex',
                              flexDirection: isMe ? 'row-reverse' : 'row',
                              alignItems:'flex-end',
                              gap:7,
                              marginBottom: isLast ? 12 : 2,
                              marginTop: prevSame ? 0 : 6,
                            }}
                          >
                            {/* Avatar column */}
                            <div style={{ width:30, flexShrink:0 }}>
                              {!isMe && isLast && <Ava name={other(active)} size={28} />}
                            </div>

                            <div style={{ maxWidth:'68%', display:'flex', flexDirection:'column', alignItems: isMe ? 'flex-end' : 'flex-start', gap:3 }}>
                              {/* Sender name for first in group (not me) */}
                              {!isMe && !prevSame && (
                                <span style={{ fontSize:11, fontWeight:700, color:'#9A7C25', paddingLeft:2 }}>
                                  {other(active)}
                                </span>
                              )}

                              {/* Bubble */}
                              <div style={{
                                padding:'9px 14px',
                                borderRadius: br,
                                background: isMe
                                  ? 'linear-gradient(135deg, #D4AE3A 0%, #8A6818 100%)'
                                  : '#fff',
                                color: isMe ? '#fff' : '#1a1a1a',
                                fontSize:14,
                                lineHeight:1.5,
                                boxShadow: isMe
                                  ? '0 1px 6px rgba(140,100,20,0.25)'
                                  : '0 1px 3px rgba(0,0,0,0.09)',
                                wordBreak:'break-word',
                              }}>
                                <span style={{ whiteSpace:'pre-wrap' }}>{msg.content}</span>
                              </div>

                              {/* Time */}
                              {isLast && (
                                <span style={{ fontSize:10.5, color:'#BBB', paddingLeft: isMe ? 0 : 2, paddingRight: isMe ? 2 : 0 }}>
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

                {/* Input */}
                <div style={{ borderTop:'1px solid #EEEAE1', background:'#fff', padding:'12px 16px', display:'flex', gap:10, alignItems:'flex-end', flexShrink:0 }}>
                  <textarea
                    ref={taRef}
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                    placeholder="Nachricht schreiben… (Enter zum Senden, Shift+Enter für neue Zeile)"
                    rows={1}
                    style={{ flex:1, resize:'none', outline:'none', border:'1.5px solid #DDD8CE', borderRadius:22, padding:'10px 16px', fontSize:14, lineHeight:1.5, fontFamily:'inherit', background:'#FAFAF7', color:'#111', maxHeight:96, overflowY:'auto', transition:'border-color 0.15s' }}
                    onFocus={e => { e.target.style.borderColor = '#C4A235' }}
                    onBlur={e => { e.target.style.borderColor = '#DDD8CE' }}
                  />
                  <button
                    onClick={send}
                    disabled={busy || !draft.trim()}
                    style={{
                      width:42, height:42, borderRadius:'50%', border:'none', flexShrink:0,
                      background: draft.trim() && !busy ? 'linear-gradient(135deg,#D4AE3A,#8A6818)' : '#E5E1D8',
                      color:'#fff', cursor: draft.trim() && !busy ? 'pointer' : 'default',
                      display:'flex', alignItems:'center', justifyContent:'center',
                      boxShadow: draft.trim() && !busy ? '0 2px 10px rgba(196,162,53,0.4)' : 'none',
                      transition:'all 0.15s',
                    }}
                  >
                    {busy
                      ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round"/></svg>
                      : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    }
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
