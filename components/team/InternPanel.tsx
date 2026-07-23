'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabaseBrowser as supabase } from '@/lib/supabase-browser'
import { useSwipeBack } from '@/components/team/useSwipeBack'

/**
 * 💼 Interner Team-Messenger (Etappe B, §97): Gruppen-Chats fürs Team —
 * strikt getrennt von der Gäste-Kommunikation. Bilder/Videos/PDFs laufen als
 * Direkt-Upload zu Supabase (signierte URL, kein Vercel-Body-Limit).
 * Dazu (19.7.): Gruppen-Info (Tap auf den Namen — umbenennen, Mitglieder,
 * durchsuchbare Medien-Galerie) + 🎙️ Sprachnachrichten (MediaRecorder).
 */

interface TeamChat {
  id: string; name: string; emoji: string; createdBy: string | null
  members: { id: string; name: string; avatar: string | null }[]
  lastAt: string | null; lastPreview: string | null; lastFromMe: boolean; unread: number
}
interface TeamMsg {
  id: string; senderId: string; senderName: string; senderAvatar: string | null
  content: string; attachmentUrl: string | null; attachmentType: 'image' | 'video' | 'pdf' | 'audio' | null
  attachmentName: string | null; createdAt: string
  /** Tapbacks: { "❤️": [userId, …] } */
  reactions?: Record<string, string[]>
  /** ↩︎ Antwort auf diese Nachricht (iMessage-Zitat, §122) */
  replyToId?: string | null
}

/** Push-Mitteilungen dieses Threads aus der Mitteilungszentrale räumen,
    sobald in der App gelesen (Dominik §121.3) — best effort, iOS 16.4+. */
function clearThreadNotifications(tag: string) {
  try {
    navigator.serviceWorker?.ready
      .then((reg) => reg.getNotifications({ tag }))
      .then((ns) => ns.forEach((n) => n.close()))
      .catch(() => {})
  } catch { /* nicht verfügbar */ }
}

/** Kurz-Label einer Nachricht fürs Zitat / die Antwort-Leiste. */
function msgLabel(m: TeamMsg): string {
  if (m.content) return m.content
  return m.attachmentType === 'image' ? '📷 Foto'
    : m.attachmentType === 'video' ? '🎬 Video'
      : m.attachmentType === 'audio' ? '🎙️ Sprachnachricht' : '📄 PDF'
}
interface Directory { id: string; name: string; role: string }

/** iMessage-Tapback-Auswahl (muss zur Server-Whitelist passen) */
const REACTION_SET = ['❤️', '👍', '👎', '😂', '‼️', '❓']

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
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<TeamChat | null>(null)
  const [msgs, setMsgs] = useState<TeamMsg[]>([])
  const [replyTo, setReplyTo] = useState<TeamMsg | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list')
  // §157: iMessage-Swipe vom linken Rand → zurück zur Gruppen-Liste (mobil)
  const swipe = useSwipeBack(() => setMobileView('list'))
  const [showCreate, setShowCreate] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [reactFor, setReactFor] = useState<string | null>(null)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [recording, setRecording] = useState(false)
  const [recSec, setRecSec] = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  // Schaut der Nutzer den Thread gerade wirklich an? (Basis des markRead-Gates)
  const viewingRef = useRef(true)
  useEffect(() => { viewingRef.current = !isMobile || mobileView === 'chat' }, [isMobile, mobileView])
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const recChunks = useRef<Blob[]>([])
  const recMime = useRef('')
  const recSend = useRef(false)
  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  // 🗒️ Live-Transkription (iMessage-Stil): Web Speech API läuft best-effort
  // PARALLEL zur Aufnahme mit — Transkript wird als content mitgesendet
  const recTranscript = useRef('')
  const recRecog = useRef<{ stop: () => void; onend: (() => void) | null } | null>(null)

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
      setIsAdmin(!!d.isAdmin)
      setError(null)
      // Threads statt Nachrichten zählen (konsistent mit App-Badge, Pascal 19.7.)
      onUnread?.((d.chats ?? []).filter((c: TeamChat) => (c.unread ?? 0) > 0).length)
    } catch {
      setError('Keine Verbindung.')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Poll-Diffing (Ruckel-Fix 19.7.): setMsgs NUR bei echter Änderung — sonst
  // re-rendert das 5s-Polling den ganzen Thread und der Scroll-Effect feuert
  // mitten in Gesten (Long-Press „fror ein")
  const msgsSigRef = useRef('')
  const loadMsgs = useCallback(async (chatId: string) => {
    // Nur als GELESEN markieren, wenn die App sichtbar ist UND der Thread
    // wirklich angeschaut wird — Hintergrund-Polls der suspendierten PWA
    // fraßen sonst den Ungelesen-Badge weg (Dominik §121.2)
    const markRead = typeof document === 'undefined' || (document.visibilityState === 'visible' && viewingRef.current)
    const r = await fetch(`/api/team-chat/${chatId}${markRead ? '' : '?peek=1'}`, { cache: 'no-store' })
    if (!r.ok) return
    if (markRead) clearThreadNotifications(`intern-${chatId}`)
    const d = await r.json()
    const list: TeamMsg[] = d.messages ?? []
    const sig = chatId + '§' + list.map((m) =>
      m.id + ':' + Object.entries(m.reactions ?? {}).map(([e, u]) => e + u.length).join(',')
    ).join('|')
    if (sig === msgsSigRef.current) return
    msgsSigRef.current = sig
    setMsgs(list)
  }, [])

  useEffect(() => {
    loadChats()
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

  // Nur bei NEUER letzter Nachricht ans Ende scrollen — nicht bei
  // Reaktions-Updates oder Poll-Refreshes (Ruckel-Fix 19.7.). Beim ÖFFNEN
  // eines Threads: INSTANT ans Ende + Nachläufer, weil Bilder/Audio-Player
  // das Layout nachträglich strecken (Pascal: „Chat beginnt oben").
  const lastMsgIdRef = useRef('')
  const scrolledChatRef = useRef('')
  useEffect(() => {
    const last = msgs[msgs.length - 1]
    if (!last || !active) return
    // msgs können beim Wechsel noch zum ALTEN Thread gehören (Signatur prüfen)
    if (!msgsSigRef.current.startsWith(active.id + '§')) return
    const freshThread = scrolledChatRef.current !== active.id
    if (!freshThread && last.id === lastMsgIdRef.current) return
    lastMsgIdRef.current = last.id
    if (freshThread) {
      scrolledChatRef.current = active.id
      bottomRef.current?.scrollIntoView({ behavior: 'auto' })
      const t1 = setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'auto' }), 250)
      const t2 = setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'auto' }), 800)
      return () => { clearTimeout(t1); clearTimeout(t2) }
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, active])

  // Auto-Grow des Schreibfelds als Effect (Pascal: „passt sich nicht an") —
  // deckt Tippen, iOS-Diktat UND programmatisches Leeren gleichermaßen ab
  useEffect(() => {
    const el = composerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [draft])

  function openChat(c: TeamChat) {
    if (recording) stopRec(false) // laufende Aufnahme beim Thread-Wechsel verwerfen
    scrolledChatRef.current = '' // jedes Öffnen scrollt frisch ans Ende (mobil remountet der Feed)
    setReplyTo(null)
    clearThreadNotifications(`intern-${c.id}`)
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
        body: JSON.stringify({ content: draft.trim(), replyToId: replyTo?.id }),
      })
      if (r.ok) {
        setDraft('')
        setReplyTo(null)
        if (composerRef.current) composerRef.current.style.height = 'auto'
        await loadMsgs(active.id)
        loadChats()
      }
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
          content: draft.trim(), replyToId: replyTo?.id,
          attachmentUrl: d.publicUrl, attachmentType: d.attachmentType, attachmentName: file.name,
        }),
      })
      setDraft('')
      setReplyTo(null)
      await loadMsgs(active.id)
      loadChats()
    } finally { setUploading(false) }
  }

  /* ── ❤️ Tapbacks (iMessage): eine Reaktion pro Person, Toggle ──
     Auslöser: Long-Press (mit Wackel-Toleranz — iOS-Finger bewegen sich
     immer minimal) ODER Doppeltipp (iMessage kennt beides, Doppeltipp ist
     auf iOS am robustesten) ODER Desktop-Rechtsklick. */
  const pressPos = useRef<{ x: number; y: number } | null>(null)
  const lastTap = useRef<{ id: string; t: number } | null>(null)

  function handleBubbleTap(msgId: string) {
    const now = Date.now()
    if (lastTap.current && lastTap.current.id === msgId && now - lastTap.current.t < 320) {
      lastTap.current = null
      window.getSelection?.()?.removeAllRanges()
      setReactFor(msgId)
      return
    }
    lastTap.current = { id: msgId, t: now }
  }

  function toggleReaction(msgId: string, emoji: string) {
    if (!active) return
    setReactFor(null)
    // Optimistisch spiegeln (gleiche Logik wie der Server)
    setMsgs((ms) => ms.map((m) => {
      if (m.id !== msgId) return m
      const next: Record<string, string[]> = {}
      let hadThis = false
      for (const [e, users] of Object.entries(m.reactions ?? {})) {
        if (e === emoji && users.includes(userId)) hadThis = true
        const rest = users.filter((u) => u !== userId)
        if (rest.length) next[e] = rest
      }
      if (!hadThis) next[emoji] = [...(next[emoji] ?? []), userId]
      return { ...m, reactions: next }
    }))
    fetch(`/api/team-chat/${active.id}/react`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: msgId, emoji }),
    }).catch(() => {})
  }

  const startPress = (msgId: string, e: React.TouchEvent) => {
    if (pressTimer.current) clearTimeout(pressTimer.current)
    const t = e.touches[0]
    pressPos.current = t ? { x: t.clientX, y: t.clientY } : null
    pressTimer.current = setTimeout(() => {
      window.getSelection?.()?.removeAllRanges()
      setReactFor(msgId)
    }, 420)
  }
  const movePress = (e: React.TouchEvent) => {
    // Nur bei ECHTER Bewegung (>12px = Scrollen) abbrechen — minimales
    // Finger-Wackeln beim Long-Press darf den Timer nicht killen
    const t = e.touches[0]
    const p = pressPos.current
    if (t && p && Math.hypot(t.clientX - p.x, t.clientY - p.y) > 12) cancelPress()
  }
  const cancelPress = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null }
  }

  /* ── 🎙️ Sprachnachrichten (MediaRecorder; iOS = audio/mp4, Chrome = webm) ── */
  async function startRec() {
    if (recording || uploading || !active) return
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaStream = stream // non-null für die Callbacks (TS-Narrowing)
      const mime = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      recMime.current = (rec.mimeType || mime || 'audio/webm').split(';')[0]
      recChunks.current = []
      recSend.current = false
      // Parallel-Transkription (best-effort — scheitert sie, geht die
      // Sprachnachricht einfach ohne Text raus)
      recTranscript.current = ''
      try {
        type SRResult = { isFinal: boolean; 0: { transcript: string } }
        type SR = {
          lang: string; continuous: boolean; interimResults: boolean
          onresult: ((e: { resultIndex: number; results: ArrayLike<SRResult> }) => void) | null
          onend: (() => void) | null; onerror: (() => void) | null
          start: () => void; stop: () => void
        }
        const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }
        const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
        if (Ctor) {
          const sr = new Ctor()
          sr.lang = 'de-DE'
          sr.continuous = true
          sr.interimResults = false
          sr.onresult = (e) => {
            for (let i = e.resultIndex; i < e.results.length; i++) {
              const res = e.results[i]
              if (res.isFinal && res[0]?.transcript) {
                recTranscript.current += (recTranscript.current ? ' ' : '') + res[0].transcript.trim()
              }
            }
          }
          sr.onerror = () => {}
          sr.start()
          recRecog.current = sr
        }
      } catch { /* keine Transkription verfügbar */ }
      rec.ondataavailable = (e) => { if (e.data.size) recChunks.current.push(e.data) }
      rec.onstop = () => {
        mediaStream.getTracks().forEach((t) => t.stop())
        if (recTimer.current) clearInterval(recTimer.current)
        setRecording(false)
        // Der Erkennung kurz Zeit geben, den letzten Satz zu finalisieren
        const finish = () => {
          if (recSend.current && recChunks.current.length) {
            const blob = new Blob(recChunks.current, { type: recMime.current })
            if (blob.size > 200) sendVoice(blob, recTranscript.current.trim())
          }
        }
        const sr = recRecog.current
        recRecog.current = null
        if (sr) {
          let done = false
          const go = () => { if (!done) { done = true; finish() } }
          sr.onend = go
          try { sr.stop() } catch { go() }
          setTimeout(go, 1500)
        } else {
          finish()
        }
      }
      recRef.current = rec
      rec.start()
      setRecSec(0)
      setRecording(true)
      let sec = 0
      recTimer.current = setInterval(() => {
        sec++
        setRecSec(sec)
        if (sec >= 300) stopRec(true) // Sicherheits-Limit 5 Min
      }, 1000)
    } catch {
      // Pascal-Bug 19.7.: Stream unbedingt freigeben, sonst bleibt das Mikro
      // an, obwohl keine Aufnahme-UI erscheint („kann nicht beenden")
      stream?.getTracks().forEach((t) => t.stop())
      if (recTimer.current) clearInterval(recTimer.current)
      setRecording(false)
      alert('Mikrofon-Zugriff nicht möglich — bitte in den Einstellungen erlauben.')
    }
  }

  function stopRec(send: boolean) {
    recSend.current = send
    try { recRef.current?.stop() } catch { setRecording(false) }
    // Failsafe: feuert onstop nicht (iOS-Zicken), UI trotzdem freigeben —
    // wenn onstop normal lief, ist recording längst false (idempotent)
    setTimeout(() => setRecording(false), 2500)
  }

  async function sendVoice(blob: Blob, transcript = '') {
    if (!active) return
    setUploading(true)
    try {
      const mime = recMime.current || 'audio/webm'
      const ext = mime === 'audio/mp4' ? 'm4a' : mime.split('/')[1] ?? 'webm'
      const fileName = `Sprachnachricht.${ext}`
      const r = await fetch(`/api/team-chat/${active.id}/upload`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileType: mime, fileName }),
      })
      const d = await r.json()
      if (!r.ok) { alert(d.error ?? 'Upload fehlgeschlagen.'); return }
      const { error: upErr } = await supabase.storage
        .from(d.bucket)
        .uploadToSignedUrl(d.path, d.token, blob, { contentType: mime })
      if (upErr) { alert('Upload fehlgeschlagen: ' + upErr.message); return }
      await fetch(`/api/team-chat/${active.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: transcript.slice(0, 1000), replyToId: replyTo?.id,
          attachmentUrl: d.publicUrl, attachmentType: d.attachmentType, attachmentName: fileName,
        }),
      })
      setReplyTo(null)
      await loadMsgs(active.id)
      loadChats()
    } finally { setUploading(false) }
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
    <div
      ref={isMobile ? swipe.ref : undefined}
      onTouchStart={isMobile ? swipe.onTouchStart : undefined}
      onTouchMove={isMobile ? swipe.onTouchMove : undefined}
      onTouchEnd={isMobile ? swipe.onTouchEnd : undefined}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, background: '#fff' }}
    >
      {/* Kopf */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 14px', borderBottom: HAIR, flexShrink: 0, background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}>
        {isMobile && (
          <button onClick={() => setMobileView('list')} style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', background: '#F2EFE8', cursor: 'pointer', color: '#555', flexShrink: 0, fontSize: 15 }}>‹</button>
        )}
        {/* Tap auf Emoji/Name → Gruppen-Info (umbenennen, Mitglieder, Medien) */}
        <button onClick={() => setShowInfo(true)} style={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 11,
          border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
        }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#F2EFE8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{active.emoji}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1A1814' }}>
              {active.name} <span style={{ color: '#C7C7CC', fontSize: 13, fontWeight: 400 }}>›</span>
            </div>
            <div style={{ fontSize: 11, color: '#AAA', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {active.members.map((m) => m.name).join(', ')}
            </div>
          </div>
        </button>
      </div>

      {/* Nachrichten — imsg-noselect auf dem GANZEN Feed: Long-Press für
          Tapbacks markierte sonst auf manchen iPhones den kompletten Chat
          (Dominik §133.10; die Klasse nur auf den Bubbles reichte nicht) */}
      <div className="imsg-noselect" style={{ flex: 1, overflowY: 'auto', padding: '14px 12px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {grouped.map((g) => (
          <div key={g.day}>
            <div style={{ textAlign: 'center', margin: '10px 0' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#A9A499', background: '#F5F3EE', borderRadius: 999, padding: '3px 11px' }}>{g.day}</span>
            </div>
            {g.items.map((m, idx) => {
              const mine = m.senderId === userId
              // iMessage-Gruppierung: aufeinanderfolgende Nachrichten desselben
              // Absenders — Name nur über der ersten, Avatar + Sprechblasen-
              // Schwänzchen nur an der letzten, kleine Ecken dazwischen
              const firstOfRun = idx === 0 || g.items[idx - 1].senderId !== m.senderId
              const lastOfRun = idx === g.items.length - 1 || g.items[idx + 1].senderId !== m.senderId
              const radius = mine
                ? `18px ${firstOfRun ? 18 : 5}px ${lastOfRun ? 18 : 5}px 18px`
                : `${firstOfRun ? 18 : 5}px 18px 18px ${lastOfRun ? 18 : 5}px`
              const reactions = Object.entries(m.reactions ?? {}).filter(([, u]) => u.length)
              return (
                <div key={m.id} id={`tmsg-${m.id}`} style={{ display: 'flex', gap: 8, justifyContent: mine ? 'flex-end' : 'flex-start', marginTop: reactions.length ? 12 : 0, marginBottom: lastOfRun ? 8 : 2, alignItems: 'flex-end' }}>
                  {!mine && (lastOfRun
                    ? <Av name={m.senderName} src={m.senderAvatar} size={26} />
                    : <span style={{ width: 26, flexShrink: 0 }} />)}
                  <div style={{ maxWidth: '76%' }}>
                    {!mine && firstOfRun && <div style={{ fontSize: 10.5, fontWeight: 700, color: '#8A7020', margin: '0 0 2px 4px' }}>{m.senderName}</div>}
                    <div
                      className={`imsg-noselect${lastOfRun ? (mine ? ' imsg-tail-out' : ' imsg-tail-in') : ''}`}
                      style={{ position: 'relative', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
                      onTouchStart={(e) => startPress(m.id, e)}
                      onTouchMove={movePress}
                      onTouchEnd={cancelPress}
                      onTouchCancel={cancelPress}
                      onClick={() => handleBubbleTap(m.id)}
                      onContextMenu={(e) => { e.preventDefault(); setReactFor(m.id) }}
                    >
                    {/* Tapback-Picker (Long-Press / Rechtsklick) */}
                    {reactFor === m.id && (
                      <div style={{
                        position: 'absolute', top: -48, ...(mine ? { right: 0 } : { left: 0 }), zIndex: 6,
                        display: 'flex', gap: 2, background: '#fff', borderRadius: 999, padding: '5px 7px',
                        boxShadow: '0 6px 20px rgba(0,0,0,0.18), inset 0 0 0 0.5px rgba(60,60,67,0.1)',
                      }}>
                        {REACTION_SET.map((e) => {
                          const mineHas = (m.reactions?.[e] ?? []).includes(userId)
                          return (
                            <button key={e} onClick={(ev) => { ev.stopPropagation(); toggleReaction(m.id, e) }} style={{
                              width: 34, height: 34, borderRadius: '50%', border: 'none', padding: 0,
                              background: mineHas ? '#FAF5E4' : 'none', fontSize: 19, cursor: 'pointer',
                            }}>{e}</button>
                          )
                        })}
                        {/* ↩︎ Antworten (iMessage-Zitat, Dominik §121.1) */}
                        <button title="Antworten" onClick={(ev) => { ev.stopPropagation(); setReactFor(null); setReplyTo(m); composerRef.current?.focus() }} style={{
                          width: 34, height: 34, borderRadius: '50%', border: 'none', padding: 0,
                          background: 'rgba(118,118,128,0.1)', fontSize: 16, cursor: 'pointer', color: '#3C3C43',
                        }}>↩︎</button>
                      </div>
                    )}
                    {/* Reaktions-Badges an der oberen Ecke (zur Bildschirm-Mitte) */}
                    {reactions.length > 0 && (
                      <div style={{ position: 'absolute', top: -11, ...(mine ? { left: -6 } : { right: -6 }), zIndex: 2, display: 'flex', gap: 3 }}>
                        {reactions.map(([e, users]) => {
                          const mineHas = users.includes(userId)
                          return (
                            <button key={e} onClick={(ev) => { ev.stopPropagation(); toggleReaction(m.id, e) }} style={{
                              display: 'inline-flex', alignItems: 'center', gap: 3, borderRadius: 999,
                              padding: '3px 7px', fontSize: 12, border: 'none', background: '#fff', cursor: 'pointer',
                              boxShadow: mineHas
                                ? '0 1px 4px rgba(0,0,0,0.15), inset 0 0 0 1.5px var(--gold, #AE8D2D)'
                                : '0 1px 4px rgba(0,0,0,0.15), inset 0 0 0 0.5px rgba(60,60,67,0.2)',
                            }}>
                              {e}{users.length > 1 && <span style={{ fontSize: 10.5, fontWeight: 700, color: '#6B7280' }}>{users.length}</span>}
                            </button>
                          )
                        })}
                      </div>
                    )}
                    <div style={{
                      borderRadius: radius, padding: m.attachmentUrl && !m.content ? 4 : '8px 13px',
                      background: mine ? 'linear-gradient(135deg, var(--gold, #AE8D2D), #8A7020)' : '#E9E9EB',
                      color: mine ? '#fff' : '#1A1814', overflow: 'hidden', position: 'relative',
                    }}>
                      {/* ↩︎ Zitat der beantworteten Nachricht — Tap springt zum Original */}
                      {m.replyToId && (() => {
                        const q = msgs.find((x) => x.id === m.replyToId)
                        return (
                          <button
                            onClick={(ev) => {
                              ev.stopPropagation()
                              if (q) document.getElementById(`tmsg-${q.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                            }}
                            style={{
                              display: 'block', width: '100%', textAlign: 'left', border: 'none',
                              cursor: q ? 'pointer' : 'default', fontFamily: 'inherit',
                              margin: m.attachmentUrl && !m.content ? '2px 2px 4px' : '0 0 6px',
                              padding: '5px 9px', borderRadius: 10,
                              background: mine ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.055)',
                              borderLeft: `3px solid ${mine ? 'rgba(255,255,255,0.65)' : 'var(--gold, #AE8D2D)'}`,
                            }}>
                            <span style={{ display: 'block', fontSize: 10.5, fontWeight: 800, color: mine ? 'rgba(255,255,255,0.9)' : '#8A7020' }}>
                              {q?.senderName ?? 'Nachricht'}
                            </span>
                            <span style={{
                              display: 'block', fontSize: 12, lineHeight: 1.35,
                              color: mine ? 'rgba(255,255,255,0.85)' : '#55524A',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 230,
                            }}>{q ? msgLabel(q).slice(0, 120) : 'Ursprüngliche Nachricht'}</span>
                          </button>
                        )
                      })()}
                      {m.attachmentType === 'image' && m.attachmentUrl && (
                        <a href={m.attachmentUrl} target="_blank" rel="noopener noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={m.attachmentUrl} alt="" style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 14, display: 'block' }} />
                        </a>
                      )}
                      {m.attachmentType === 'video' && m.attachmentUrl && (
                        <video src={m.attachmentUrl} controls playsInline style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 14, display: 'block' }} />
                      )}
                      {m.attachmentType === 'audio' && m.attachmentUrl && (
                        <audio controls preload="metadata" src={m.attachmentUrl} style={{ width: 224, maxWidth: '100%', height: 40, display: 'block' }} />
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
                        <div style={{
                          fontSize: m.attachmentType === 'audio' ? 13 : 15, lineHeight: 1.45,
                          whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                          padding: m.attachmentUrl ? '6px 9px 4px' : 0,
                          // Transkript einer Sprachnachricht: dezent wie bei iMessage
                          fontStyle: m.attachmentType === 'audio' ? 'italic' : undefined,
                          opacity: m.attachmentType === 'audio' ? 0.85 : 1,
                          maxWidth: m.attachmentType === 'audio' ? 224 : undefined,
                        }}>{m.content}</div>
                      )}
                    </div>
                    </div>
                    {lastOfRun && (
                      <div style={{ fontSize: 10, color: '#B5B0A6', margin: mine ? '3px 4px 0 0' : '3px 0 0 4px', textAlign: mine ? 'right' : 'left' }}>
                        {new Date(m.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Composer — bei versteckter Tab-Bar übernimmt er die Safe-Area;
          während einer Sprachaufnahme wird er zur Aufnahme-Zeile */}
      {recording ? (
        <div style={{
          display: 'flex', gap: 12, alignItems: 'center', padding: '10px 14px', borderTop: HAIR, flexShrink: 0,
          background: 'rgba(255,255,255,0.96)',
          paddingBottom: isMobile && mobileView === 'chat' ? 'max(10px, env(safe-area-inset-bottom))' : 10,
        }}>
          <span className="rec-pulse" style={{ width: 12, height: 12, borderRadius: '50%', background: '#DC2626', flexShrink: 0 }} />
          <span style={{ fontSize: 15, fontWeight: 700, color: '#1A1814', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
            {Math.floor(recSec / 60)}:{String(recSec % 60).padStart(2, '0')}
          </span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: '#8A8578', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Aufnahme läuft…</span>
          <button onClick={() => stopRec(false)} title="Verwerfen" style={{
            width: 36, height: 36, borderRadius: '50%', border: 'none', background: 'rgba(120,120,128,0.12)',
            color: '#3C3C43', fontSize: 15, cursor: 'pointer', flexShrink: 0,
          }}>✕</button>
          <button onClick={() => stopRec(true)} title="Senden" style={{
            width: 36, height: 36, borderRadius: '50%', border: 'none', padding: 0, flexShrink: 0,
            background: 'linear-gradient(135deg,var(--gold),var(--gold-dark))', color: '#fff', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
            </svg>
          </button>
        </div>
      ) : (
      <div style={{ flexShrink: 0 }}>
      {/* ↩︎ Antwort-Leiste: worauf gerade geantwortet wird (iMessage-Stil) */}
      {replyTo && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 9, padding: '7px 14px',
          background: 'rgba(255,255,255,0.96)', borderTop: HAIR,
        }}>
          <span style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: 'var(--gold, #AE8D2D)', flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 11, fontWeight: 800, color: '#8A7020' }}>Antwort an {replyTo.senderName}</span>
            <span style={{ display: 'block', fontSize: 12.5, color: '#55524A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {msgLabel(replyTo).slice(0, 120)}
            </span>
          </span>
          <button onClick={() => setReplyTo(null)} title="Antwort verwerfen" style={{
            width: 26, height: 26, borderRadius: '50%', border: 'none', background: 'rgba(120,120,128,0.12)',
            color: '#3C3C43', fontSize: 13, cursor: 'pointer', flexShrink: 0,
          }}>✕</button>
        </div>
      )}
      <div style={{
        display: 'flex', gap: 9, alignItems: 'flex-end', padding: '8px 12px', borderTop: replyTo ? 'none' : HAIR,
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
            ref={composerRef}
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
        {!draft.trim() && (
          <button onClick={startRec} disabled={uploading} title="Sprachnachricht aufnehmen" style={{
            width: 34, height: 34, borderRadius: '50%', border: 'none', flexShrink: 0, padding: 0,
            background: 'rgba(118,118,128,0.12)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: uploading ? 0.5 : 1,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A8578" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>
            </svg>
          </button>
        )}
      </div>
      </div>
      )}
    </div>
  )

  return (
    <div style={{ height: '100%', display: 'flex', background: '#fff', overflow: 'hidden' }}>
      {isMobile ? (mobileView === 'list' ? List : Thread) : (<>{List}{Thread}</>)}
      {/* Tipp daneben schließt den Tapback-Picker (Portal: fixed nie in Touch-Scroller) */}
      {reactFor && typeof document !== 'undefined' && createPortal(
        <div onClick={() => setReactFor(null)} style={{ position: 'fixed', inset: 0, zIndex: 5 }} />,
        document.body
      )}
      {showCreate && <CreateDialog />}
      {showInfo && active && (
        <GroupInfo
          chat={active}
          isAdmin={isAdmin || active.createdBy === userId}
          directory={directory}
          userId={userId}
          onClose={() => setShowInfo(false)}
          onUpdate={(patch) => {
            setActive((a) => (a ? { ...a, ...patch } : a))
            loadChats()
          }}
          onDeleted={() => {
            setShowInfo(false)
            setActive(null)
            setMobileView('list')
            loadChats()
          }}
        />
      )}
    </div>
  )
}

/* ═══════════ Gruppen-Info: umbenennen · Mitglieder · Medien-Galerie ═══════════ */

const MEDIA_TABS = [
  ['alle', 'Alle'], ['image', '📷 Fotos'], ['video', '🎬 Videos'], ['audio', '🎙️ Audio'], ['pdf', '📄 Dokumente'],
] as const

function GroupInfo({ chat, isAdmin, directory, userId, onClose, onUpdate, onDeleted }: {
  chat: TeamChat
  isAdmin: boolean
  directory: Directory[]
  userId: string
  onClose: () => void
  onUpdate: (patch: Partial<TeamChat>) => void
  onDeleted: () => void
}) {
  const [editName, setEditName] = useState(false)
  const [name, setName] = useState(chat.name)
  const [emoji, setEmoji] = useState(chat.emoji)
  const [editMembers, setEditMembers] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set(chat.members.map((m) => m.id)))
  const [saving, setSaving] = useState(false)
  const [media, setMedia] = useState<TeamMsg[] | null>(null)
  const [tab, setTab] = useState<(typeof MEDIA_TABS)[number][0]>('alle')
  const [q, setQ] = useState('')

  useEffect(() => {
    fetch(`/api/team-chat/${chat.id}?media=1`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMedia(d?.messages ?? []))
      .catch(() => setMedia([]))
  }, [chat.id])

  async function saveName() {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      const r = await fetch(`/api/team-chat/${chat.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), emoji: emoji.trim() || '💬' }),
      })
      if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error ?? 'Speichern fehlgeschlagen.'); return }
      onUpdate({ name: name.trim(), emoji: emoji.trim() || '💬' })
      setEditName(false)
    } finally { setSaving(false) }
  }

  async function saveMembers() {
    if (saving) return
    if (!selected.has(userId) && !confirm('Du entfernst dich selbst aus der Gruppe — fortfahren?')) return
    setSaving(true)
    try {
      const r = await fetch(`/api/team-chat/${chat.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberIds: [...selected] }),
      })
      if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error ?? 'Speichern fehlgeschlagen.'); return }
      const byId = new Map(directory.map((d) => [d.id, d]))
      onUpdate({ members: [...selected].map((id) => ({ id, name: byId.get(id)?.name ?? '—', avatar: null })) })
      setEditMembers(false)
    } finally { setSaving(false) }
  }

  async function removeGroup() {
    if (!confirm(`Gruppe „${chat.name}" mit allen Nachrichten endgültig löschen?`)) return
    const r = await fetch(`/api/team-chat/${chat.id}`, { method: 'DELETE' })
    if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error ?? 'Löschen fehlgeschlagen.'); return }
    onDeleted()
  }

  const needle = q.trim().toLowerCase()
  const filtered = (media ?? []).filter((m) => {
    if (tab !== 'alle' && m.attachmentType !== tab) return false
    if (!needle) return true
    return [m.attachmentName, m.content, m.senderName].some((s) => (s ?? '').toLowerCase().includes(needle))
  })

  const sectionLabel = (t: string) => (
    <div style={{ fontSize: 11.5, fontWeight: 700, color: '#8A8578', letterSpacing: '0.05em', margin: '18px 2px 8px' }}>{t}</div>
  )

  const overlay = (
    <div className="team-shell" style={{
      position: 'fixed', inset: 0, zIndex: 85, background: '#F7F7F8',
      display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top)',
    }}>
      <div style={{
        padding: '12px 16px', background: 'rgba(255,255,255,0.92)', flexShrink: 0,
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.15)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'rgba(120,120,128,0.12)', cursor: 'pointer', color: '#3C3C43', fontSize: 15, flexShrink: 0 }}>‹</button>
        <div style={{ fontSize: 16.5, fontWeight: 800, color: '#111' }}>Gruppen-Info</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', padding: '18px 16px 34px' }}>
        {/* Kopf: Emoji + Name (+ umbenennen für Admins) */}
        <div style={{ textAlign: 'center' }}>
          {editName ? (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
              <input value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4}
                style={{ width: 56, textAlign: 'center', borderRadius: 12, border: '1.5px solid #E0DDD6', padding: '10px 0', fontSize: 18, background: '#fff' }} />
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
                style={{ flex: '1 1 160px', maxWidth: 260, borderRadius: 12, border: '1.5px solid #E0DDD6', padding: '10px 14px', fontSize: 15, fontWeight: 700, background: '#fff', outline: 'none' }} />
              <button onClick={saveName} disabled={saving || !name.trim()} style={{
                padding: '10px 16px', borderRadius: 999, border: 'none', fontSize: 13, fontWeight: 700,
                background: 'linear-gradient(135deg,var(--gold),var(--gold-dark))', color: '#fff', cursor: 'pointer',
              }}>{saving ? '…' : 'OK'}</button>
              <button onClick={() => { setEditName(false); setName(chat.name); setEmoji(chat.emoji) }} style={{ border: 'none', background: 'none', color: '#8A8578', fontWeight: 700, cursor: 'pointer' }}>✕</button>
            </div>
          ) : (
            <>
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#F2EFE8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34, margin: '0 auto 10px' }}>{chat.emoji}</div>
              <div style={{ fontSize: 19, fontWeight: 800, color: '#111' }}>{chat.name}</div>
              {isAdmin && (
                <button onClick={() => setEditName(true)} style={{
                  marginTop: 8, padding: '6px 14px', borderRadius: 999, border: 'none', fontSize: 12, fontWeight: 700,
                  background: 'rgba(120,120,128,0.12)', color: '#3C3C43', cursor: 'pointer',
                }}>✏️ Umbenennen</button>
              )}
            </>
          )}
        </div>

        {/* Mitglieder */}
        {sectionLabel(`MITGLIEDER (${chat.members.length})`)}
        <div style={{ borderRadius: 14, overflow: 'hidden', boxShadow: '0 0 0 0.5px rgba(60,60,67,0.12)', background: '#fff' }}>
          {editMembers ? (
            <div style={{ padding: '10px 12px' }}>
              {directory.map((d) => (
                <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={selected.has(d.id)}
                    onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n })}
                    style={{ width: 17, height: 17, accentColor: 'var(--gold, #AE8D2D)' }} />
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: '#333', flex: 1 }}>{d.name}</span>
                  <span style={{ fontSize: 11, color: '#A8A292' }}>{d.role}</span>
                </label>
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={saveMembers} disabled={saving || selected.size === 0} style={{
                  flex: 1, padding: '10px 0', borderRadius: 999, border: 'none', fontSize: 13, fontWeight: 700,
                  background: selected.size ? 'linear-gradient(135deg,var(--gold),var(--gold-dark))' : '#E5E1D6',
                  color: selected.size ? '#fff' : '#999', cursor: 'pointer',
                }}>{saving ? 'Speichert…' : 'Speichern'}</button>
                <button onClick={() => { setEditMembers(false); setSelected(new Set(chat.members.map((m) => m.id))) }} style={{
                  padding: '10px 16px', borderRadius: 999, border: 'none', fontSize: 13, fontWeight: 700,
                  background: 'rgba(120,120,128,0.12)', color: '#3C3C43', cursor: 'pointer',
                }}>Abbrechen</button>
              </div>
            </div>
          ) : (
            <>
              {chat.members.map((m, i) => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 13px', boxShadow: i < chat.members.length - 1 ? `inset 0 -0.5px 0 rgba(60,60,67,0.12)` : 'none' }}>
                  <Av name={m.name} src={m.avatar} size={30} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{m.name}{m.id === userId ? ' (du)' : ''}</span>
                </div>
              ))}
              {isAdmin && directory.length > 0 && (
                <button onClick={() => setEditMembers(true)} style={{
                  width: '100%', padding: '11px 13px', border: 'none', background: 'none', textAlign: 'left',
                  fontSize: 13.5, fontWeight: 700, color: '#8A7020', cursor: 'pointer',
                  boxShadow: 'inset 0 0.5px 0 rgba(60,60,67,0.12)',
                }}>＋ Mitglieder verwalten</button>
              )}
            </>
          )}
        </div>

        {/* Medien */}
        {sectionLabel(`MEDIEN${media ? ` (${media.length})` : ''}`)}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 4 }}>
          {MEDIA_TABS.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              padding: '5px 12px', borderRadius: 999, border: 'none', fontSize: 12, fontWeight: 700, flexShrink: 0,
              background: tab === id ? '#1A1814' : 'rgba(120,120,128,0.12)',
              color: tab === id ? '#fff' : '#3C3C43', cursor: 'pointer', whiteSpace: 'nowrap',
            }}>{label}</button>
          ))}
        </div>
        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Medien durchsuchen (Name, Text, Absender)"
          style={{ width: '100%', boxSizing: 'border-box', margin: '8px 0 10px', border: '1px solid #E0DDD6', borderRadius: 12, padding: '9px 12px', fontSize: 14, background: '#fff', color: '#111', outline: 'none' }}
        />
        {media === null ? (
          <p style={{ textAlign: 'center', color: '#8E8E93', fontSize: 13, padding: 20 }}>Lädt…</p>
        ) : filtered.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#8E8E93', fontSize: 13, padding: 20 }}>
            {media.length === 0 ? 'Noch keine Medien in dieser Gruppe.' : 'Keine Treffer.'}
          </p>
        ) : tab === 'image' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {filtered.map((m) => (
              <a key={m.id} href={m.attachmentUrl!} target="_blank" rel="noopener noreferrer" style={{ display: 'block', aspectRatio: '1', borderRadius: 10, overflow: 'hidden' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.attachmentUrl!} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </a>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {filtered.map((m) => (
              <div key={m.id} style={{ background: '#fff', borderRadius: 12, padding: '9px 12px', boxShadow: '0 0 0 0.5px rgba(60,60,67,0.12)', display: 'flex', alignItems: 'center', gap: 10 }}>
                {m.attachmentType === 'image' ? (
                  <a href={m.attachmentUrl!} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.attachmentUrl!} alt="" loading="lazy" style={{ width: 46, height: 46, borderRadius: 8, objectFit: 'cover', display: 'block' }} />
                  </a>
                ) : (
                  <span style={{ width: 40, height: 40, borderRadius: 10, background: '#F2EFE8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                    {m.attachmentType === 'video' ? '🎬' : m.attachmentType === 'audio' ? '🎙️' : '📄'}
                  </span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {m.attachmentType === 'audio' ? (
                    <audio controls preload="metadata" src={m.attachmentUrl!} style={{ width: '100%', maxWidth: 260, height: 36, display: 'block' }} />
                  ) : (
                    <a href={m.attachmentUrl!} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13.5, fontWeight: 600, color: '#111', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.attachmentName ?? (m.attachmentType === 'video' ? 'Video' : 'Datei')}
                    </a>
                  )}
                  <div style={{ fontSize: 11, color: '#8E8E93', marginTop: 2 }}>
                    {m.senderName} · {fmtTime(m.createdAt)}{m.content ? ` · ${m.content.slice(0, 60)}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Gefahrenzone */}
        {isAdmin && (
          <>
            {sectionLabel('VERWALTUNG')}
            <button onClick={removeGroup} style={{
              width: '100%', padding: '12px 0', borderRadius: 14, border: 'none',
              background: '#FEF2F2', color: '#B91C1C', fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
            }}>🗑 Gruppe löschen</button>
          </>
        )}
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(overlay, document.body) : null
}
