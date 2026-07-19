'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseBrowser as supabase } from '@/lib/supabase-browser'

/**
 * 💼 Interner Team-Messenger (Etappe B, §97): Gruppen-Chats fürs Team —
 * strikt getrennt von der Gäste-Kommunikation. Bilder/Videos/PDFs laufen als
 * Direkt-Upload zu Supabase (signierte URL, kein Vercel-Body-Limit).
 */

interface TeamChat {
  id: string; name: string; emoji: string; createdBy: string | null
  members: { id: string; name: string; avatar: string | null }[]
  lastAt: string | null; lastPreview: string | null; lastFromMe: boolean; unread: number
}
interface TeamMsg {
  id: string; senderId: string; senderName: string; senderAvatar: string | null
  content: string; attachmentUrl: string | null; attachmentType: 'image' | 'video' | 'pdf' | null
  attachmentName: string | null; createdAt: string
}
interface Directory { id: string; name: string; role: string }

const HAIR = '0.5px solid rgba(60,60,67,0.15)'

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
}
function fmtDay(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yest = new Date(Date.now() - 86400_000)
  if (d.toDateString() === today.toDateString()) return 'Heute'
  if (d.toDateString() === yest.toDateString()) return 'Gestern'
  return d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
}

async function compressImage(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', 0.82))
  } catch {
    return file
  }
}

function Av({ name, src, size = 34 }: { name: string; src: string | null; size?: number }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'linear-gradient(135deg, var(--gold, #AE8D2D), #8A7020)', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.42, fontWeight: 700,
    }}>{(name || '?').slice(0, 1).toUpperCase()}</div>
  )
}

export default function InternPanel({ userId, onUnread, onMobileThread }: {
  userId: string
  onUnread?: (n: number) => void
  /** meldet der Shell, ob mobil ein Thread offen ist (Tab-Bar verstecken) */
  onMobileThread?: (open: boolean) => void
}) {
  const [chats, setChats] = useState<TeamChat[]>([])
  const [directory, setDirectory] = useState<Directory[]>([])
  const [canCreate, setCanCreate] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<TeamChat | null>(null)
  const [msgs, setMsgs] = useState<TeamMsg[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list')
  const [showCreate, setShowCreate] = useState(false)
  const [prefs, setPrefs] = useState<{ guestChats: boolean; teamChats: boolean } | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 680)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  /* Mobil + Thread offen → Shell versteckt die Tab-Bar (WhatsApp-Verhalten) */
  useEffect(() => {
    onMobileThread?.(isMobile && mobileView === 'chat')
  }, [isMobile, mobileView, onMobileThread])

  const loadChats = useCallback(async () => {
    try {
      const r = await fetch('/api/team-chat', { cache: 'no-store' })
      if (!r.ok) { setError(`Laden fehlgeschlagen (HTTP ${r.status})`); return }
      const d = await r.json()
      setChats(d.chats ?? [])
      setDirectory(d.directory ?? [])
      setCanCreate(!!d.canCreate)
      setError(null)
      onUnread?.((d.chats ?? []).reduce((s: number, c: TeamChat) => s + (c.unread ?? 0), 0))
    } catch {
      setError('Keine Verbindung.')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadMsgs = useCallback(async (chatId: string) => {
    const r = await fetch(`/api/team-chat/${chatId}`, { cache: 'no-store' })
    if (!r.ok) return
    const d = await r.json()
    setMsgs(d.messages ?? [])
  }, [])

  useEffect(() => {
    loadChats()
    fetch('/api/push/prefs', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setPrefs({ guestChats: d.guestChats, teamChats: d.teamChats }) })
      .catch(() => {})
    const id = setInterval(loadChats, 20000)
    return () => clearInterval(id)
  }, [loadChats])

  useEffect(() => {
    if (timer.current) clearInterval(timer.current)
    if (!active) return
    loadMsgs(active.id)
    timer.current = setInterval(() => loadMsgs(active.id), 5000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [active, loadMsgs])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  function openChat(c: TeamChat) {
    setActive(c)
    setChats((cs) => cs.map((x) => (x.id === c.id ? { ...x, unread: 0 } : x)))
    if (isMobile) setMobileView('chat')
  }

  async function sendText() {
    if (!active || !draft.trim() || busy) return
    setBusy(true)
    try {
      const r = await fetch(`/api/team-chat/${active.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft.trim() }),
      })
      if (r.ok) { setDraft(''); await loadMsgs(active.id); loadChats() }
    } finally { setBusy(false) }
  }

  async function sendFile(file: File) {
    if (!active || uploading) return
    if (file.size > 50 * 1024 * 1024) { alert('Datei zu groß (max. 50 MB).') ; return }
    setUploading(true)
    try {
      const isImage = file.type.startsWith('image/')
      const blob = isImage ? await compressImage(file) : file
      const fileType = isImage ? 'image/jpeg' : file.type
      const r = await fetch(`/api/team-chat/${active.id}/upload`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileType, fileName: file.name }),
      })
      const d = await r.json()
      if (!r.ok) { alert(d.error ?? 'Upload fehlgeschlagen.'); return }
      const { error: upErr } = await supabase.storage
        .from(d.bucket)
        .uploadToSignedUrl(d.path, d.token, blob, { contentType: fileType })
      if (upErr) { alert('Upload fehlgeschlagen: ' + upErr.message); return }
      await fetch(`/api/team-chat/${active.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: draft.trim(),
          attachmentUrl: d.publicUrl, attachmentType: d.attachmentType, attachmentName: file.name,
        }),
      })
      setDraft('')
      await loadMsgs(active.id)
      loadChats()
    } finally { setUploading(false) }
  }

  async function togglePref(key: 'guestChats' | 'teamChats') {
    if (!prefs) return
    const next = { ...prefs, [key]: !prefs[key] }
    setPrefs(next)
    await fetch('/api/push/prefs', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: next[key] }),
    }).catch(() => {})
  }

  /* ── Gruppen-Dialog ── */
  function CreateDialog() {
    const [name, setName] = useState('')
    const [emoji, setEmoji] = useState('💬')
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [saving, setSaving] = useState(false)
    async function create() {
      if (!name.trim() || saving) return
      setSaving(true)
      try {
        const r = await fetch('/api/team-chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, emoji, memberIds: [...selected] }),
        })
        if (r.ok) { setShowCreate(false); loadChats() }
        else { const d = await r.json().catch(() => ({})); alert(d.error ?? 'Anlegen fehlgeschlagen.') }
      } finally { setSaving(false) }
    }
    return (
      <div onClick={() => setShowCreate(false)} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div onClick={(e) => e.stopPropagation()} style={{
          width: '100%', maxWidth: 480, background: '#F7F7F8', borderRadius: '18px 18px 0 0',
          padding: '18px 18px calc(18px + env(safe-area-inset-bottom))', maxHeight: '85dvh', overflowY: 'auto', overscrollBehavior: 'contain',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: '#1A1814' }}>Neue Gruppe</span>
            <button onClick={() => setShowCreate(false)} style={{ border: 'none', background: 'rgba(120,120,128,0.12)', width: 30, height: 30, borderRadius: '50%', fontSize: 14, color: '#3C3C43', cursor: 'pointer' }}>✕</button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} style={{ width: 54, textAlign: 'center', borderRadius: 12, border: '1.5px solid #E0DDD6', padding: '10px 0', fontSize: 17, background: '#fff' }} />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Gruppenname (z. B. Handwerker)" autoFocus style={{ flex: 1, borderRadius: 12, border: '1.5px solid #E0DDD6', padding: '10px 14px', fontSize: 14, background: '#fff', outline: 'none' }} />
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#8A8578', letterSpacing: '0.06em', margin: '4px 0 8px' }}>MITGLIEDER</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
            {directory.filter((d) => d.id !== userId).map((d) => (
              <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 12, background: '#fff', border: '1px solid #EDEAE2', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={selected.has(d.id)}
                  onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n })}
                  style={{ width: 17, height: 17, accentColor: 'var(--gold, #AE8D2D)' }}
                />
                <span style={{ fontSize: 13.5, fontWeight: 600, color: '#333', flex: 1 }}>{d.name}</span>
                <span style={{ fontSize: 11, color: '#A8A292' }}>{d.role}</span>
              </label>
            ))}
          </div>
          <button onClick={create} disabled={!name.trim() || saving} style={{
            width: '100%', padding: '13px 0', borderRadius: 999, border: 'none',
            background: name.trim() && !saving ? 'linear-gradient(135deg, var(--gold), var(--gold-dark, #8A7020))' : '#E5E1D6',
            color: name.trim() && !saving ? '#fff' : '#999', fontSize: 14.5, fontWeight: 700, cursor: 'pointer',
          }}>{saving ? 'Erstellt…' : 'Gruppe erstellen'}</button>
        </div>
      </div>
    )
  }

  /* ── Chat-Liste ── */
  const List = (
    <div style={{ width: isMobile ? '100%' : 290, flexShrink: 0, borderRight: isMobile ? 'none' : '1px solid rgba(60,60,67,0.12)', overflowY: 'auto', background: '#fff', display: 'flex', flexDirection: 'column', flex: isMobile ? 1 : undefined }}>
      {/* Push-Präferenzen */}
      {prefs && (
        <div style={{ padding: '10px 14px', borderBottom: HAIR, display: 'flex', gap: 14, alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#8A8578', letterSpacing: '0.04em' }}>PUSH:</span>
          {([['guestChats', 'Gäste'], ['teamChats', 'Intern']] as const).map(([key, label]) => (
            <button key={key} onClick={() => togglePref(key)} style={{
              display: 'flex', alignItems: 'center', gap: 5, border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 700, color: prefs[key] ? '#16A34A' : '#B0AA9C', padding: 0,
            }}>{prefs[key] ? '🔔' : '🔕'} {label}</button>
          ))}
        </div>
      )}
      {loading && <div style={{ padding: 30, textAlign: 'center', color: '#999', fontSize: 13 }}>Lädt…</div>}
      {error && !loading && (
        <div style={{ margin: 12, padding: '10px 12px', borderRadius: 10, background: '#FEF2F2', color: '#B91C1C', fontSize: 12.5 }}>
          ⚠️ {error} <button onClick={() => { setLoading(true); loadChats() }} style={{ border: 'none', background: 'none', color: '#B91C1C', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>Erneut</button>
        </div>
      )}
      {!loading && !error && chats.length === 0 && (
        <div style={{ padding: '54px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 38, marginBottom: 10 }}>💼</div>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: '#555' }}>Noch keine internen Gruppen</div>
          <div style={{ fontSize: 12.5, color: '#AAA', marginTop: 6, lineHeight: 1.5 }}>
            {canCreate ? 'Lege unten die erste Gruppe an — z. B. „Geschäftsführung" oder „Handwerker".' : 'Sobald dich jemand zu einer Gruppe hinzufügt, erscheint sie hier.'}
          </div>
        </div>
      )}
      {chats.map((c) => (
        <button key={c.id} onClick={() => openChat(c)} style={{
          display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px', border: 'none', textAlign: 'left',
          background: !isMobile && active?.id === c.id ? 'rgba(174,141,45,0.08)' : '#fff',
          boxShadow: `inset 0 -0.5px 0 rgba(60,60,67,0.12)`, cursor: 'pointer',
        }}>
          <div style={{ width: 42, height: 42, borderRadius: '50%', background: '#F2EFE8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 21, flexShrink: 0 }}>{c.emoji}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 14.5, fontWeight: 700, color: '#1A1814', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
              {c.lastAt && <span style={{ fontSize: 11, color: '#A9A499', flexShrink: 0 }}>{fmtTime(c.lastAt)}</span>}
            </div>
            <div style={{ fontSize: 12, color: '#8A857B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
              {c.lastPreview ? `${c.lastFromMe ? 'Du: ' : ''}${c.lastPreview}` : c.members.map((m) => m.name).join(', ')}
            </div>
          </div>
          {c.unread > 0 && (
            <span style={{ minWidth: 20, height: 20, borderRadius: 10, background: 'var(--gold, #AE8D2D)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px', flexShrink: 0 }}>{c.unread}</span>
          )}
        </button>
      ))}
      {canCreate && !loading && (
        <button onClick={() => setShowCreate(true)} style={{
          margin: 14, padding: '11px 0', borderRadius: 12, border: '2px dashed #D8D2C4', background: '#FCFBF7',
          color: '#8A7020', fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
        }}>+ Neue Gruppe</button>
      )}
    </div>
  )

  /* ── Thread ── */
  const grouped: { day: string; items: TeamMsg[] }[] = []
  for (const m of msgs) {
    const d = fmtDay(m.createdAt)
    if (!grouped.length || grouped[grouped.length - 1].day !== d) grouped.push({ day: d, items: [m] })
    else grouped[grouped.length - 1].items.push(m)
  }

  const Thread = !active ? (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#BBB', fontSize: 14, background: '#fff' }}>
      Gruppe auswählen
    </div>
  ) : (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, background: '#fff' }}>
      {/* Kopf */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 14px', borderBottom: HAIR, flexShrink: 0, background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}>
        {isMobile && (
          <button onClick={() => setMobileView('list')} style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', background: '#F2EFE8', cursor: 'pointer', color: '#555', flexShrink: 0, fontSize: 15 }}>‹</button>
        )}
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#F2EFE8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{active.emoji}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1A1814' }}>{active.name}</div>
          <div style={{ fontSize: 11, color: '#AAA', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {active.members.map((m) => m.name).join(', ')}
          </div>
        </div>
      </div>

      {/* Nachrichten */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 12px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {grouped.map((g) => (
          <div key={g.day}>
            <div style={{ textAlign: 'center', margin: '10px 0' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#A9A499', background: '#F5F3EE', borderRadius: 999, padding: '3px 11px' }}>{g.day}</span>
            </div>
            {g.items.map((m) => {
              const mine = m.senderId === userId
              return (
                <div key={m.id} style={{ display: 'flex', gap: 8, justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 7, alignItems: 'flex-end' }}>
                  {!mine && <Av name={m.senderName} src={m.senderAvatar} size={26} />}
                  <div style={{ maxWidth: '76%' }}>
                    {!mine && <div style={{ fontSize: 10.5, fontWeight: 700, color: '#8A7020', margin: '0 0 2px 4px' }}>{m.senderName}</div>}
                    <div style={{
                      borderRadius: 18, padding: m.attachmentUrl && !m.content ? 4 : '8px 13px',
                      background: mine ? 'linear-gradient(135deg, var(--gold, #AE8D2D), #8A7020)' : '#E9E9EB',
                      color: mine ? '#fff' : '#1A1814', overflow: 'hidden',
                    }}>
                      {m.attachmentType === 'image' && m.attachmentUrl && (
                        <a href={m.attachmentUrl} target="_blank" rel="noopener noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={m.attachmentUrl} alt="" style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 14, display: 'block' }} />
                        </a>
                      )}
                      {m.attachmentType === 'video' && m.attachmentUrl && (
                        <video src={m.attachmentUrl} controls playsInline style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 14, display: 'block' }} />
                      )}
                      {m.attachmentType === 'pdf' && m.attachmentUrl && (
                        <a href={m.attachmentUrl} target="_blank" rel="noopener noreferrer" style={{
                          display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', textDecoration: 'none',
                          color: mine ? '#fff' : '#1A1814',
                        }}>
                          <span style={{ fontSize: 21 }}>📄</span>
                          <span style={{ fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>{m.attachmentName ?? 'Dokument.pdf'}</span>
                        </a>
                      )}
                      {m.content && (
                        <div style={{ fontSize: 15, lineHeight: 1.45, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: m.attachmentUrl ? '6px 9px 4px' : 0 }}>{m.content}</div>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: '#B5B0A6', margin: mine ? '2px 4px 0 0' : '2px 0 0 4px', textAlign: mine ? 'right' : 'left' }}>
                      {new Date(m.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Composer — bei versteckter Tab-Bar übernimmt er die Safe-Area */}
      <div style={{
        display: 'flex', gap: 9, alignItems: 'flex-end', padding: '8px 12px', borderTop: HAIR, flexShrink: 0,
        background: 'rgba(255,255,255,0.92)',
        paddingBottom: isMobile && mobileView === 'chat' ? 'max(8px, env(safe-area-inset-bottom))' : 8,
      }}>
        <label title="Bild, Video oder PDF anhängen" style={{
          width: 34, height: 34, borderRadius: '50%', background: 'rgba(118,118,128,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
          fontSize: 16, color: '#8A8578', opacity: uploading ? 0.5 : 1,
        }}>
          {uploading ? '⏳' : '📎'}
          <input type="file" accept="image/*,video/mp4,video/quicktime,video/webm,application/pdf" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) sendFile(f); e.target.value = '' }} />
        </label>
        <div style={{ flex: 1, position: 'relative', display: 'flex', border: '1px solid rgba(60,60,67,0.28)', borderRadius: 18, background: '#fff', minHeight: 36 }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={1}
            placeholder="Nachricht"
            style={{ flex: 1, resize: 'none', outline: 'none', border: 'none', borderRadius: 18, padding: draft.trim() ? '7px 40px 7px 13px' : '7px 13px', fontSize: 16, lineHeight: '22px', fontFamily: 'inherit', background: 'transparent', color: '#111', maxHeight: 160, overflowY: 'auto' }}
          />
          {draft.trim().length > 0 && (
            <button onClick={sendText} disabled={busy} title="Senden" style={{
              position: 'absolute', right: 4, bottom: 4, width: 28, height: 28, borderRadius: '50%', border: 'none', padding: 0,
              background: busy ? '#EDE9E0' : 'linear-gradient(135deg,var(--gold),var(--gold-dark))', color: '#fff', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ height: '100%', display: 'flex', background: '#fff', overflow: 'hidden' }}>
      {isMobile ? (mobileView === 'list' ? List : Thread) : (<>{List}{Thread}</>)}
      {showCreate && <CreateDialog />}
    </div>
  )
}
