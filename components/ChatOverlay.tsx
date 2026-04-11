'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface Conversation {
  id: string; guest_id: string; host_id: string
  guest_name: string | null; host_name: string | null
  listing_title: string | null; last_message_at: string; unread: number
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
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diff === 0) return 'Heute'
  if (diff === 1) return 'Gestern'
  return d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
}
function fmtMsgT(iso: string) {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

/* ── Avatar ── */
function Av({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'linear-gradient(135deg,#C4A235,#8A6D1B)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * .37, fontWeight: 700, color: '#fff', userSelect: 'none',
    }}>{ava(name)}</div>
  )
}

/* ── main ── */
interface Props { open: boolean; onClose: () => void; userId: string }

export default function ChatOverlay({ open, onClose, userId }: Props) {
  const [convs, setConvs]     = useState<Conversation[]>([])
  const [active, setActive]   = useState<Conversation | null>(null)
  const [msgs, setMsgs]       = useState<Message[]>([])
  const [draft, setDraft]     = useState('')
  const [busy, setBusy]       = useState(false)
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const taRef     = useRef<HTMLTextAreaElement>(null)
  const timer     = useRef<ReturnType<typeof setInterval> | null>(null)

  const me = (c: Conversation) => c.guest_id === userId ? (c.host_name||'Gastgeber') : (c.guest_name||'Gast')

  const getConvs = useCallback(async () => {
    const r = await fetch('/api/chat')
    if (r.ok) setConvs(await r.json())
  }, [])

  const getMsgs = useCallback(async (id: string) => {
    const r = await fetch(`/api/chat?conversationId=${id}`)
    if (r.ok) { setMsgs(await r.json()); setConvs(cs => cs.map(c => c.id===id?{...c,unread:0}:c)) }
  }, [])

  useEffect(() => {
    if (!open) return
    setLoading(true); getConvs().finally(() => setLoading(false))
  }, [open, getConvs])

  useEffect(() => {
    if (timer.current) clearInterval(timer.current)
    if (!open || !active) return
    getMsgs(active.id)
    timer.current = setInterval(() => getMsgs(active.id), 5000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [open, active, getMsgs])

  useEffect(() => { if (!open && timer.current) clearInterval(timer.current) }, [open])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])
  useEffect(() => {
    const ta = taRef.current; if (!ta) return
    ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 96) + 'px'
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
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: active.id, content: draft }),
    })
    if (r.ok) { setDraft(''); await getMsgs(active.id); getConvs() }
    setBusy(false)
  }

  if (!open) return null

  // group by day
  const grouped: { day: string; items: Message[] }[] = []
  for (const m of msgs) {
    const d = fmtDay(m.created_at)
    if (!grouped.length || grouped[grouped.length-1].day !== d) grouped.push({ day: d, items: [m] })
    else grouped[grouped.length-1].items.push(m)
  }

  const unread = convs.reduce((s, c) => s + c.unread, 0)

  return (
    <>
      <style>{`
        @keyframes cfade { from{opacity:0} to{opacity:1} }
        @keyframes crise { from{opacity:0;transform:translate(-50%,-48%) scale(.97)} to{opacity:1;transform:translate(-50%,-50%) scale(1)} }
        .cconv:hover { background: #F3EFE6 !important; }
      `}</style>

      {/* backdrop */}
      <div onClick={onClose} style={{
        position:'fixed', inset:0, zIndex:9000,
        background:'rgba(0,0,0,.35)', backdropFilter:'blur(4px)',
        animation:'cfade .18s ease',
      }}/>

      {/* modal */}
      <div style={{
        position:'fixed',
        top:'calc(50% + 44px)',
        left:'50%',
        transform:'translate(-50%,-50%)',
        zIndex:9001,
        width:'min(880px,93vw)', height:'min(620px,calc(90vh - 88px))',
        display:'flex', flexDirection:'column',
        background:'#FFFFFF',
        borderRadius:16,
        boxShadow:'0 24px 80px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.06)',
        overflow:'hidden',
        animation:'crise .22s cubic-bezier(.34,1.3,.64,1)',
      }}>

        {/* ── header ── */}
        <div style={{
          display:'flex', alignItems:'center', gap:10,
          padding:'0 18px', height:52, flexShrink:0,
          background:'#FFFFFF',
          borderBottom:'1px solid #E8E4DB',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A08B3A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span style={{ flex:1, fontWeight:700, fontSize:15, color:'#2C2A25', letterSpacing:'.01em' }}>
            Nachrichten
            {unread > 0 && (
              <span style={{ marginLeft:8, background:'#C4A235', color:'#fff', fontSize:10, fontWeight:800, padding:'2px 7px', borderRadius:99 }}>
                {unread}
              </span>
            )}
          </span>
          {active && (
            <div style={{ display:'flex', alignItems:'center', gap:8, marginRight:8 }}>
              <Av name={me(active)} size={24}/>
              <span style={{ fontSize:13, fontWeight:600, color:'#3D3A32' }}>{me(active)}</span>
              <span style={{ fontSize:11, color:'#999', marginLeft:2 }}>{active.listing_title}</span>
            </div>
          )}
          <button onClick={onClose} style={{
            width:30, height:30, borderRadius:'50%', border:'none',
            background:'#F2EFE8', cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center', color:'#888', flexShrink:0,
            transition:'background .12s',
          }}
          onMouseEnter={e => { (e.target as HTMLElement).style.background='#E8E3D8' }}
          onMouseLeave={e => { (e.target as HTMLElement).style.background='#F2EFE8' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* ── body ── */}
        <div style={{ flex:1, display:'flex', minHeight:0 }}>

          {/* left: conversation list */}
          <div style={{
            width:270, flexShrink:0,
            background:'#FAF9F6',
            borderRight:'1px solid #E8E4DB',
            overflowY:'auto', display:'flex', flexDirection:'column',
          }}>
            {loading && (
              <div style={{ padding:32, textAlign:'center', color:'#999', fontSize:12 }}>Lädt…</div>
            )}
            {!loading && convs.length === 0 && (
              <div style={{ padding:'48px 20px', textAlign:'center' }}>
                <div style={{ fontSize:32, marginBottom:10 }}>💬</div>
                <div style={{ fontSize:13, fontWeight:600, color:'#777' }}>Keine Nachrichten</div>
                <div style={{ fontSize:11, color:'#AAA', marginTop:6 }}>
                  Gäste können über die Inseratsseite schreiben.
                </div>
              </div>
            )}
            {convs.map(c => {
              const isSel = active?.id === c.id
              return (
                <button key={c.id} className="cconv" onClick={() => setActive(c)} style={{
                  width:'100%', textAlign:'left', border:'none', cursor:'pointer',
                  padding:'12px 14px',
                  borderBottom:'1px solid #EDE9E0',
                  borderLeft: isSel ? '3px solid #C4A235' : '3px solid transparent',
                  background: isSel ? '#F0EBE0' : 'transparent',
                  display:'flex', alignItems:'center', gap:10,
                  transition:'background .12s',
                }}>
                  <Av name={me(c)} size={40}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <span style={{ fontSize:13, fontWeight: c.unread ? 700 : 500, color:'#2C2A25', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:130 }}>
                        {me(c)}
                      </span>
                      <span style={{ fontSize:10, color:'#AAA', flexShrink:0 }}>{fmtTime(c.last_message_at)}</span>
                    </div>
                    <div style={{ fontSize:11, color:'#999', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {c.listing_title ?? '—'}
                    </div>
                    {c.unread > 0 && (
                      <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', marginTop:4, minWidth:18, height:18, padding:'0 5px', borderRadius:99, background:'#C4A235', fontSize:10, fontWeight:800, color:'#fff' }}>
                        {c.unread}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          {/* right: messages */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, background:'#F6F4EF' }}>
            {!active ? (
              <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, color:'#CCC' }}>
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <span style={{ fontSize:13, color:'#BBB' }}>Unterhaltung auswählen</span>
              </div>
            ) : (
              <>
                {/* message feed */}
                <div style={{ flex:1, overflowY:'auto', padding:'20px 20px 8px', display:'flex', flexDirection:'column' }}>
                  {msgs.length === 0 && (
                    <div style={{ margin:'auto', textAlign:'center' }}>
                      <div style={{ fontSize:28, marginBottom:8 }}>👋</div>
                      <div style={{ fontSize:13, color:'#AAA' }}>Noch keine Nachrichten</div>
                    </div>
                  )}

                  {grouped.map(({ day, items }) => (
                    <div key={day}>
                      {/* day separator */}
                      <div style={{ display:'flex', alignItems:'center', gap:8, margin:'12px 0 10px' }}>
                        <div style={{ flex:1, height:1, background:'#E0DCD2' }}/>
                        <span style={{ fontSize:10.5, color:'#999', fontWeight:600, background:'#EDE9E0', padding:'2px 10px', borderRadius:99, whiteSpace:'nowrap' }}>
                          {day}
                        </span>
                        <div style={{ flex:1, height:1, background:'#E0DCD2' }}/>
                      </div>

                      {items.map((msg, i) => {
                        const isMe    = msg.sender_id === userId
                        const prevSame = i > 0 && items[i-1].sender_id === msg.sender_id
                        const nextSame = i < items.length-1 && items[i+1].sender_id === msg.sender_id
                        const isLast  = !nextSame

                        return (
                          <div key={msg.id} style={{
                            display:'flex',
                            flexDirection: isMe ? 'row-reverse' : 'row',
                            alignItems:'flex-end', gap:7,
                            marginBottom: isLast ? 12 : 2,
                            marginTop: prevSame ? 0 : 6,
                          }}>
                            {/* avatar placeholder */}
                            <div style={{ width:28, flexShrink:0 }}>
                              {!isMe && isLast && <Av name={me(active)} size={28}/>}
                            </div>

                            <div style={{ maxWidth:'68%', display:'flex', flexDirection:'column', alignItems: isMe ? 'flex-end' : 'flex-start', gap:3 }}>
                              {/* sender label */}
                              {!isMe && !prevSame && (
                                <span style={{ fontSize:11, fontWeight:600, color:'#A08B3A', paddingLeft:3 }}>
                                  {me(active)}
                                </span>
                              )}

                              {/* bubble */}
                              <div style={{
                                padding:'9px 14px',
                                borderRadius: isMe
                                  ? (prevSame ? '16px 4px 4px 16px' : '16px 16px 4px 16px')
                                  : (prevSame ? '4px 16px 16px 16px' : '4px 16px 16px 16px'),
                                background: isMe
                                  ? 'linear-gradient(135deg,#C4A235,#8A6D1B)'
                                  : '#FFFFFF',
                                color: isMe ? '#fff' : '#2C2A25',
                                fontSize:13.5, lineHeight:1.5,
                                boxShadow: isMe
                                  ? '0 2px 8px rgba(196,162,53,.25)'
                                  : '0 1px 3px rgba(0,0,0,.08)',
                                wordBreak:'break-word',
                              }}>
                                <span style={{ whiteSpace:'pre-wrap' }}>{msg.content}</span>
                              </div>

                              {isLast && (
                                <span style={{ fontSize:10, color:'#AAA', paddingLeft: isMe?0:3, paddingRight: isMe?3:0 }}>
                                  {fmtMsgT(msg.created_at)}
                                  {isMe && msg.read_at && <span style={{ color:'#C4A235', marginLeft:3, fontWeight:700 }}>✓✓</span>}
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                  <div ref={bottomRef}/>
                </div>

                {/* input */}
                <div style={{ borderTop:'1px solid #E8E4DB', background:'#FFFFFF', padding:'12px 16px', display:'flex', gap:10, alignItems:'flex-end', flexShrink:0 }}>
                  <textarea
                    ref={taRef}
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                    placeholder="Nachricht schreiben…"
                    rows={1}
                    style={{
                      flex:1, resize:'none', outline:'none',
                      border:'1.5px solid #E0DCD2',
                      borderRadius:20, padding:'9px 14px',
                      fontSize:13.5, lineHeight:1.5, fontFamily:'inherit',
                      background:'#FAF9F6', color:'#2C2A25',
                      maxHeight:96, overflowY:'auto', transition:'border-color .15s',
                    }}
                    onFocus={e => { e.target.style.borderColor='#C4A235' }}
                    onBlur={e => { e.target.style.borderColor='#E0DCD2' }}
                  />
                  <button
                    onClick={send}
                    disabled={busy || !draft.trim()}
                    style={{
                      width:40, height:40, borderRadius:'50%', border:'none', flexShrink:0,
                      background: draft.trim()&&!busy ? 'linear-gradient(135deg,#C4A235,#8A6D1B)' : '#EDE9E0',
                      color: draft.trim()&&!busy ? '#fff' : '#CCC',
                      cursor: draft.trim()&&!busy ? 'pointer' : 'default',
                      display:'flex', alignItems:'center', justifyContent:'center',
                      boxShadow: draft.trim()&&!busy ? '0 2px 10px rgba(196,162,53,.3)' : 'none',
                      transition:'all .15s',
                    }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                    </svg>
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
