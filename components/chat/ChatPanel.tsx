'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { t, isUiLang, UI_COOKIE, type UiLang } from '@/lib/i18n'

interface Conversation {
  id: string; guest_id: string; host_id: string
  guest_name: string | null; host_name: string | null
  listing_title: string | null; last_message_at: string; unread: number
  guest_avatar_url: string | null; host_avatar_url: string | null
  check_in: string | null; check_out: string | null
  /** unified inbox (team mode): thread source + badge data */
  kind?: 'direct' | 'booking'
  platform?: string
  guestStatus?: 'current' | 'upcoming' | 'past' | 'cancelled' | null
  lastPreview?: string | null
  lastSender?: 'guest' | 'host' | null
  noReplyNeeded?: boolean
  phoneResolved?: boolean
  guestLang?: string | null
}

type InboxFilter = 'alle' | 'unbeantwortet' | 'ungelesen' | 'vorort' | 'kommend'
const INBOX_FILTERS: { id: InboxFilter; label: string }[] = [
  { id: 'alle', label: 'Alle' },
  { id: 'unbeantwortet', label: 'Unbeantwortet' },
  { id: 'ungelesen', label: 'Ungelesen' },
  { id: 'vorort', label: 'Vor Ort' },
  { id: 'kommend', label: 'Kommend' },
]
function matchesFilter(c: Conversation, f: InboxFilter): boolean {
  if (f === 'unbeantwortet') return c.lastSender === 'guest' && !c.noReplyNeeded && !c.phoneResolved
  if (f === 'ungelesen') return c.unread > 0
  if (f === 'vorort') return c.guestStatus === 'current'
  if (f === 'kommend') return c.guestStatus === 'upcoming'
  return true
}

/* ── Badges (platform + guest status), team inbox only ── */
const PLATFORM_COLORS: Record<string, string> = {
  TRIMOSA: '#A8862F', Airbnb: '#FF5A5F', 'Booking.com': '#003580', Booking: '#003580',
  'FeWo-direkt': '#245ABC', Vrbo: '#245ABC', Smoobu: '#5A6B7B',
}
function statusInfo(c: Conversation): { dot: string; label: string } | null {
  if (!c.guestStatus) return null
  if (c.guestStatus === 'cancelled') return { dot: '#EF4444', label: 'Storniert' }
  if (c.guestStatus === 'current') return { dot: '#22C55E', label: 'Vor Ort' }
  if (c.guestStatus === 'upcoming') {
    const days = c.check_in ? Math.ceil((new Date(c.check_in).getTime() - Date.now()) / 86400000) : null
    return { dot: '#3B82F6', label: days != null && days >= 0 ? `Anreise in ${days} Tg.` : 'Kommend' }
  }
  return { dot: '#9CA3AF', label: 'Ehemalig' }
}
function ThreadBadges({ c, size = 10 }: { c: Conversation; size?: number }) {
  if (!c.platform && !c.guestStatus) return null
  const st = statusInfo(c)
  const pc = c.platform ? (PLATFORM_COLORS[c.platform] ?? '#5A6B7B') : null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {c.platform && pc && (
        <span style={{
          fontSize: size, fontWeight: 800, color: '#fff', background: pc,
          padding: '2px 7px', borderRadius: 999, letterSpacing: '0.02em', whiteSpace: 'nowrap',
        }}>{c.platform}</span>
      )}
      {st && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: size, fontWeight: 600, color: '#777', whiteSpace: 'nowrap' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: st.dot, display: 'inline-block' }} />
          {st.label}
        </span>
      )}
    </span>
  )
}
interface Message {
  id: string; conversation_id: string; sender_id: string
  content: string; read_at: string | null; created_at: string
  /** translation layer: detected/sent language + German version */
  lang?: string | null
  content_de?: string | null
}

const FLAGS: Record<string, string> = {
  de: '🇩🇪', en: '🇬🇧', nl: '🇳🇱', fr: '🇫🇷', es: '🇪🇸', it: '🇮🇹', pl: '🇵🇱',
  da: '🇩🇰', pt: '🇵🇹', ru: '🇷🇺', cs: '🇨🇿', sv: '🇸🇪', tr: '🇹🇷', lb: '🇱🇺',
}
const LANG_LABEL: Record<string, string> = {
  de: 'Deutsch', en: 'Englisch', nl: 'Niederländisch', fr: 'Französisch', es: 'Spanisch',
  it: 'Italienisch', pl: 'Polnisch', da: 'Dänisch', pt: 'Portugiesisch', ru: 'Russisch',
  cs: 'Tschechisch', sv: 'Schwedisch', tr: 'Türkisch', lb: 'Luxemburgisch',
}
const flag = (l?: string | null) => (l ? FLAGS[l] ?? '🌐' : '🌐')

/* ── helpers ── */
function ava(name: string) {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'
}

const CHAT_LOCALE: Record<UiLang, string> = { de: 'de-DE', en: 'en-GB', fr: 'fr-FR', nl: 'nl-NL' }
function fmtTime(iso: string, lang: UiLang = 'de') {
  const d = new Date(iso), now = new Date()
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diff === 0) return d.toLocaleTimeString(CHAT_LOCALE[lang], { hour: '2-digit', minute: '2-digit' })
  if (diff === 1) return t(lang, 'Gestern')
  if (diff < 7)  return d.toLocaleDateString(CHAT_LOCALE[lang], { weekday: 'short' })
  return d.toLocaleDateString(CHAT_LOCALE[lang], { day: '2-digit', month: '2-digit' })
}
function fmtDay(iso: string, lang: UiLang = 'de') {
  const d = new Date(iso), now = new Date()
  const dDay      = d.toLocaleDateString('de-DE')
  const today     = now.toLocaleDateString('de-DE')
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toLocaleDateString('de-DE')
  if (dDay === today)     return t(lang, 'Heute')
  if (dDay === yesterday) return t(lang, 'Gestern')
  return d.toLocaleDateString(CHAT_LOCALE[lang], { weekday: 'long', day: 'numeric', month: 'long' })
}
function fmtMsgT(iso: string, lang: UiLang = 'de') {
  return new Date(iso).toLocaleTimeString(CHAT_LOCALE[lang], { hour: '2-digit', minute: '2-digit' })
}
function fmtDateRange(checkIn: string | null, checkOut: string | null) {
  if (!checkIn || !checkOut) return null
  const fmt = (s: string) => new Date(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
  return `${fmt(checkIn)} – ${fmt(checkOut)}`
}

/* ── Avatar ── */
function Av({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  if (src) {
    return (
      <img src={src} alt={name} style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        objectFit: 'cover', border: '2px solid #EDE9E0',
      }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
    )
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'linear-gradient(135deg,var(--gold),var(--gold-dark))',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * .37, fontWeight: 700, color: '#fff', userSelect: 'none',
    }}>{ava(name)}</div>
  )
}

/* ── main ── */
interface Props {
  userId: string
  /** 'overlay' = fixed modal (NavBar) · 'page' = inline card (chat pages)
      · 'app' = full-bleed PWA shell (/team — nothing but chat) */
  variant: 'overlay' | 'page' | 'app'
  /** overlay only */
  open?: boolean
  onClose?: () => void
  /** page only: pre-select a conversation (?conv= deep link from emails) */
  initialConvId?: string | null
  /** team mode: unified inbox (all guests incl. Airbnb/Booking via Smoobu) */
  team?: boolean
}

export default function ChatPanel({ userId, variant, open = true, onClose, initialConvId, team = false }: Props) {
  const [convs, setConvs]       = useState<Conversation[]>([])
  const [bookingHintFor, setBookingHintFor] = useState<string | null>(null)
  const [authExpired, setAuthExpired] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [active, setActive]     = useState<Conversation | null>(null)
  const [msgs, setMsgs]         = useState<Message[]>([])
  const [draft, setDraft]       = useState('')
  const [busy, setBusy]         = useState(false)
  const [aiBusy, setAiBusy]     = useState(false)

  // "✨" reply suggestion (hosts only) — lands in the composer as an editable
  // draft, never auto-sent. History is loaded server-side by the API.
  // Thread-Markierungen auf der jeweils LETZTEN Nachricht — eine spätere
  // Gast-Nachricht macht den Thread automatisch wieder unbeantwortet.
  //  ✓  "Keine Antwort erforderlich"
  //  📞 "Per Telefonat geklärt" (zählt im Wochenbericht als telefonisch beantwortet)
  async function toggleMark(field: 'no_reply' | 'phone') {
    if (!active) return
    const key = field === 'phone' ? 'phoneResolved' as const : 'noReplyNeeded' as const
    const value = !active[key]
    setConvs(cs => cs.map(c => c.id === active.id ? { ...c, [key]: value } : c))
    setActive(a => (a ? { ...a, [key]: value } : a))
    // Booking.com wertet die Antwortquote separat — dort muss der Haken
    // weiterhin in der Booking-App gesetzt werden (Smoobu reicht ihn nicht durch)
    if (value && /booking/i.test(active.platform ?? '')) {
      setBookingHintFor(active.id)
      setTimeout(() => setBookingHintFor((cur) => (cur === active.id ? null : cur)), 8000)
    } else {
      setBookingHintFor(null)
    }
    try {
      await fetch('/api/chat/inbox', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: active.kind ?? 'direct', id: active.id, value, field }),
      })
    } catch { /* Anzeige bleibt optimistisch; nächster Inbox-Load korrigiert */ }
  }

  async function suggestReply() {
    if (!active || aiBusy) return
    setAiBusy(true)
    try {
      const res = await fetch('/api/ai/chat-suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(active.kind === 'booking' ? { bookingId: active.id } : { conversationId: active.id }),
      })
      const data = await res.json()
      if (res.ok && data.suggestion) setDraft(data.suggestion)
    } catch { /* silent — composer stays untouched */ }
    finally { setAiBusy(false) }
  }
  const [loading, setLoading]   = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [showOriginal, setShowOriginal] = useState<Record<string, boolean>>({})
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('alle')
  const [pushState, setPushState] = useState<'unknown' | 'off' | 'on' | 'unsupported'>('unknown')

  /* ── PWA push: register SW + reflect subscription state (team only) ── */
  useEffect(() => {
    if (!team || typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { setPushState('unsupported'); return }
    navigator.serviceWorker.register('/sw.js').then(async (reg) => {
      const sub = await reg.pushManager.getSubscription()
      setPushState(sub ? 'on' : 'off')
    }).catch(() => setPushState('unsupported'))
  }, [team])

  async function togglePush() {
    if (pushState === 'unsupported') return
    try {
      const reg = await navigator.serviceWorker.ready
      const existing = await reg.pushManager.getSubscription()
      if (existing) {
        await fetch('/api/push', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: existing.endpoint }) })
        await existing.unsubscribe()
        setPushState('off')
        return
      }
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') return
      const keyRes = await fetch('/api/push')
      const { publicKey, error } = await keyRes.json()
      if (!publicKey) { alert(error ?? 'Push ist noch nicht konfiguriert.'); return }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey })
      const res = await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) })
      setPushState(res.ok ? 'on' : 'off')
    } catch (e) {
      // iOS Safari outside an installed PWA cannot subscribe
      alert('Push konnte nicht aktiviert werden. Auf dem iPhone: Seite über „Teilen → Zum Home-Bildschirm" installieren und dort erneut versuchen.')
      console.error('[push] subscribe failed:', e)
    }
  }
  const [pendingSend, setPendingSend] = useState<{ original: string; translated: string; lang: string } | null>(null)
  const [translating, setTranslating] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [refining, setRefining] = useState(false)
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list')

  const bottomRef     = useRef<HTMLDivElement>(null)
  // Visitor UI language (guest side; the team keeps the German cookie anyway)
  const [uiLang, setUiLang] = useState<UiLang>('de')
  useEffect(() => {
    const m = document.cookie.match(new RegExp('(?:^|; )' + UI_COOKIE + '=([a-z]{2})'))
    if (m && isUiLang(m[1])) setUiLang(m[1])
  }, [])
  const taRef         = useRef<HTMLTextAreaElement>(null)
  const timer         = useRef<ReturnType<typeof setInterval> | null>(null)
  const mobileShellRef = useRef<HTMLDivElement>(null)

  const isHost   = (c: Conversation) => c.host_id === userId
  const partner  = (c: Conversation) => isHost(c) ? (c.guest_name || 'Gast') : (c.host_name || 'Gastgeber')
  const partnerAvatar = (c: Conversation) => isHost(c) ? c.guest_avatar_url : c.host_avatar_url

  /* ── mobile detection ── */
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 680)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  /* ── data fetching ── */
  const CACHE_KEY = team ? 'trimosa-inbox-v1' : 'trimosa-chats-v1'
  const getConvs = useCallback(async () => {
    if (team) {
      const r = await fetch('/api/chat/inbox')
      if (r.status === 401 || r.status === 403) { setAuthExpired(true); return null }
      if (!r.ok) return null
      const { threads } = await r.json()
      const data: Conversation[] = (threads ?? []).map((t: Record<string, unknown>) => ({
        id: t.id, kind: t.kind, guest_id: '', host_id: userId,
        guest_name: t.guestName, host_name: null,
        listing_title: t.listingTitle, last_message_at: t.lastMessageAt,
        unread: t.unread ?? 0,
        guest_avatar_url: t.guestAvatar ?? null, host_avatar_url: null,
        check_in: t.checkIn ?? null, check_out: t.checkOut ?? null,
        platform: t.platform, guestStatus: t.guestStatus,
        lastPreview: t.lastPreview ?? null, lastSender: t.lastSender ?? null,
        noReplyNeeded: t.noReplyNeeded ?? false,
        phoneResolved: t.phoneResolved ?? false,
        guestLang: t.guestLang ?? null,
      }))
      setConvs(data)
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(data.slice(0, 60))) } catch { /* quota */ }
      return data
    }
    const r = await fetch('/api/chat')
    if (!r.ok) return null
    const data: Conversation[] = await r.json()
    setConvs(data)
    return data
  }, [team, userId])

  const getMsgs = useCallback(async (id: string, kind?: 'direct' | 'booking') => {
    if (kind === 'booking') {
      const r = await fetch(`/api/messages/${id}`)
      if (r.ok) {
        const { messages } = await r.json()
        // Map booking messages (sender_type guest/host/system) onto the
        // shared shape: everything from our side renders as "me".
        setMsgs((messages ?? []).map((m: Record<string, unknown>) => ({
          id: m.id, conversation_id: id,
          sender_id: m.sender_type === 'guest' ? 'guest' : userId,
          content: m.content, read_at: m.read_at ?? null, created_at: m.created_at,
          lang: m.lang ?? null, content_de: m.content_de ?? null,
        })))
        setConvs(cs => cs.map(c => c.id === id ? { ...c, unread: 0 } : c))
      }
      return
    }
    const r = await fetch(`/api/chat?conversationId=${id}`)
    if (r.ok) {
      setMsgs(await r.json())
      setConvs(cs => cs.map(c => c.id === id ? { ...c, unread: 0 } : c))
    }
  }, [userId])

  useEffect(() => {
    if (!open) return
    // Instant paint from the local cache — the fresh list replaces it silently
    try {
      const cached = localStorage.getItem(CACHE_KEY)
      if (cached && convs.length === 0) setConvs(JSON.parse(cached))
    } catch { /* ignore */ }
    setLoading(convs.length === 0 && !localStorage.getItem(CACHE_KEY))
    getConvs().then(data => {
      if (!data || data.length === 0 || active) return
      // Deep link (?conv= from notification emails) wins; otherwise desktop
      // auto-opens the newest conversation, mobile stays on the list.
      const target = initialConvId ? data.find(c => c.id === initialConvId) : undefined
      if (target) {
        setActive(target)
        if (window.innerWidth < 680) setMobileView('chat')
      } else if (window.innerWidth >= 680) {
        setActive(data[0])
      }
    }).finally(() => setLoading(false))
  }, [open, getConvs, initialConvId]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Thread switch: the composer belongs to ONE conversation — reset it */
  useEffect(() => {
    setDraft('')
    setPendingSend(null)
    setInstruction('')
    setShowOriginal({})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id])

  useEffect(() => {
    if (timer.current) clearInterval(timer.current)
    if (!open || !active) return
    getMsgs(active.id, active.kind)
    timer.current = setInterval(() => getMsgs(active.id, active.kind), 5000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [open, active, getMsgs])

  useEffect(() => { if (!open && timer.current) clearInterval(timer.current) }, [open])

  /* Auto-draft: when a team member opens a thread whose LAST message is from
     the guest, the ✨ suggestion is generated proactively (once per thread &
     session) — the reply is ready before you even ask. Never auto-sent. */
  const autoSuggested = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!team || !active || msgs.length === 0 || aiBusy) return
    const last = msgs[msgs.length - 1]
    if (last.sender_id === userId) return
    if (draft.trim() || pendingSend || autoSuggested.current.has(active.id)) return
    autoSuggested.current.add(active.id)
    suggestReply()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs, active?.id, team])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])
  useEffect(() => {
    const ta = taRef.current; if (!ta) return
    const maxH = Math.max(160, Math.round(window.innerHeight * 0.4))
    ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, maxH) + 'px'
  }, [draft])
  useEffect(() => {
    if (variant !== 'overlay' || !onClose) return
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [variant, onClose])

  /* ── mobile: switch to chat when conversation selected ── */
  function selectConv(c: Conversation) {
    setActive(c)
    if (isMobile) setMobileView('chat')
  }

  /* ── guest language of the active thread (latest detected guest message) ── */
  const guestLang = (() => {
    if (!team || !active) return null
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m.sender_id !== userId && m.lang) return m.lang
    }
    return null
  })()
  const needsTranslation = team && guestLang != null && guestLang !== 'de'

  /* ── refine the draft with an instruction (two-step AI workshop) ── */
  async function refineDraft() {
    if (!active || !draft.trim() || !instruction.trim() || refining) return
    setRefining(true)
    try {
      const res = await fetch('/api/ai/chat-suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(active.kind === 'booking' ? { bookingId: active.id } : { conversationId: active.id }),
          instruction, currentDraft: draft,
        }),
      })
      const data = await res.json()
      if (res.ok && data.suggestion) { setDraft(data.suggestion); setInstruction('') }
    } catch { /* draft stays */ }
    finally { setRefining(false) }
  }

  /* ── send (with translation preview when the guest speaks another language) ── */
  async function reallySend(content: string, contentDe?: string, lang?: string) {
    if (!active) return
    setBusy(true)
    setSendError(null)
    try {
      const payload = active.kind === 'booking'
        ? { content, ...(contentDe ? { contentDe, lang } : {}) }
        : { conversationId: active.id, content, ...(contentDe ? { contentDe, lang } : {}) }
      const url = active.kind === 'booking' ? `/api/messages/${active.id}` : '/api/chat'
      const r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (r.ok) {
        setDraft(''); setPendingSend(null)
        await getMsgs(active.id, active.kind); getConvs()
      } else if (r.status === 401 || r.status === 403) {
        setAuthExpired(true)
      } else {
        const d = await r.json().catch(() => null)
        setSendError(d?.error ?? `Senden fehlgeschlagen (${r.status}) — Entwurf bleibt erhalten.`)
      }
    } catch {
      setSendError('Keine Verbindung — Entwurf bleibt erhalten, bitte erneut versuchen.')
    } finally {
      setBusy(false)
    }
  }

  async function send() {
    if (!draft.trim() || !active || busy || translating) return
    if (needsTranslation && guestLang) {
      // Step 1: translate + show the preview — nothing is sent yet
      setTranslating(true)
      try {
        const res = await fetch('/api/ai/translate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: draft, targetLang: guestLang }),
        })
        const data = await res.json()
        if (res.ok && data.translation) {
          setPendingSend({ original: draft, translated: data.translation, lang: guestLang })
        } else {
          // Translation down → offer sending the German original via preview
          setPendingSend({ original: draft, translated: draft, lang: 'de' })
        }
      } finally { setTranslating(false) }
      return
    }
    await reallySend(draft)
  }

  if (!open) return null

  /* ── group messages by day ── */
  const grouped: { day: string; items: Message[] }[] = []
  for (const m of msgs) {
    const d = fmtDay(m.created_at, uiLang)
    if (!grouped.length || grouped[grouped.length - 1].day !== d) grouped.push({ day: d, items: [m] })
    else grouped[grouped.length - 1].items.push(m)
  }

  const unread = convs.reduce((s, c) => s + c.unread, 0)
  const dateRange = active ? fmtDateRange(active.check_in, active.check_out) : null

  /* ═══════════════════════════════════════════════════════════
     CONVERSATION LIST (shared between mobile list view + desktop sidebar)
  ═══════════════════════════════════════════════════════════ */
  function ConvList({ fullWidth = false }: { fullWidth?: boolean }) {
    const filtered = team ? convs.filter(c => matchesFilter(c, inboxFilter)) : convs
    return (
      <div style={{
        width: fullWidth ? '100%' : 270,
        flexShrink: fullWidth ? undefined : 0,
        background: '#fff',
        borderRight: fullWidth ? 'none' : '1px solid rgba(60,60,67,0.12)',
        overflowY: 'auto',
        display: 'flex', flexDirection: 'column',
        flex: fullWidth ? 1 : undefined,
      }}>
        {team && (
          <div style={{ display: 'flex', gap: 6, padding: '10px 12px 8px', overflowX: 'auto', flexShrink: 0, borderBottom: '0.5px solid rgba(60,60,67,0.15)', background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(16px) saturate(1.6)', WebkitBackdropFilter: 'blur(16px) saturate(1.6)', position: 'sticky', top: 0, zIndex: 2 }}>
            {INBOX_FILTERS.map(f => {
              const count = f.id === 'alle' ? convs.length : convs.filter(c => matchesFilter(c, f.id)).length
              const activeF = inboxFilter === f.id
              if (f.id !== 'alle' && count === 0 && !activeF) return null
              return (
                <button key={f.id} onClick={() => setInboxFilter(f.id)} style={{
                  flexShrink: 0, padding: '5px 11px', borderRadius: 999, cursor: 'pointer',
                  fontSize: 11.5, fontWeight: 700,
                  border: activeF ? '1px solid transparent' : '1px solid #E5E1D6',
                  background: activeF ? 'linear-gradient(135deg,var(--gold),var(--gold-dark))' : '#fff',
                  color: activeF ? '#fff' : '#6B6455',
                }}>
                  {f.label}{count > 0 && f.id !== 'alle' ? ` ${count}` : ''}
                </button>
              )
            })}
            {pushState !== 'unsupported' && pushState !== 'unknown' && (
              <button onClick={togglePush} title={pushState === 'on' ? 'Push-Mitteilungen aktiv — tippen zum Deaktivieren' : 'Push-Mitteilungen aktivieren'} style={{
                flexShrink: 0, marginLeft: 'auto', width: 28, height: 28, borderRadius: '50%',
                border: '1px solid #E5E1D6', background: pushState === 'on' ? '#FAF5E4' : '#fff',
                cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: pushState === 'on' ? 1 : 0.55,
              }}>{pushState === 'on' ? '🔔' : '🔕'}</button>
            )}
          </div>
        )}
        {loading && (
          <div style={{ padding: 32, textAlign: 'center', color: '#999', fontSize: 13 }}>Lädt…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div style={{ padding: '64px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>💬</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#555' }}>{t(uiLang, 'Keine Nachrichten')}</div>
            <div style={{ fontSize: 13, color: '#AAA', marginTop: 6, lineHeight: 1.5 }}>
              Gäste können über die Inseratsseite schreiben.
            </div>
          </div>
        )}
        {filtered.map(c => {
          const isSel = !isMobile && active?.id === c.id
          return (
            <button key={c.id} onClick={() => selectConv(c)} style={{
              width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
              padding: fullWidth ? '13px 16px' : '12px 14px',
              borderBottom: 'none',
              boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.15)',
              borderLeft: isSel ? '3px solid var(--gold)' : '3px solid transparent',
              background: isSel ? 'rgba(174,141,45,0.08)' : 'transparent',
              display: 'flex', alignItems: 'center', gap: 12,
              transition: 'background .12s',
            }}
              onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = '#F3F0EA' }}
              onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}
            >
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <Av name={partner(c)} src={partnerAvatar(c)} size={fullWidth ? 48 : 42} />
                {c.unread > 0 && (
                  <span style={{
                    position: 'absolute', top: -2, right: -2,
                    minWidth: 18, height: 18, padding: '0 4px', borderRadius: 9,
                    background: 'var(--gold)', border: '2px solid #fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 800, color: '#fff',
                  }}>
                    {c.unread > 9 ? '9+' : c.unread}
                  </span>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <span style={{ fontSize: fullWidth ? 15 : 13, fontWeight: c.unread ? 700 : 500, color: '#1A1814', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: fullWidth ? 200 : 130 }}>
                    {partner(c)}
                  </span>
                  <span style={{ fontSize: 11, color: '#AAA', flexShrink: 0, marginLeft: 8 }}>
                    {c.last_message_at
                      ? fmtTime(c.last_message_at, uiLang)
                      : c.check_in
                        ? `ab ${new Date(c.check_in).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`
                        : ''}
                  </span>
                </div>
                {c.lastPreview && (
                  <div style={{ fontSize: fullWidth ? 12.5 : 11.5, color: c.unread ? '#3A3427' : '#8A857B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: c.unread ? 600 : 400, marginBottom: 2 }}>
                    {c.lastSender === 'guest' && c.noReplyNeeded && <span title="Keine Antwort erforderlich" style={{ color: '#34A853', fontWeight: 700 }}>✓ </span>}
                    {c.lastSender === 'guest' && c.phoneResolved && <span title="Per Telefonat geklärt" style={{ fontSize: 11 }}>📞 </span>}
                    {c.lastSender === 'host' && <span style={{ color: '#B5A97F' }}>Du: </span>}
                    {c.lastPreview}
                  </div>
                )}
                <div style={{ fontSize: fullWidth ? 12 : 10.5, color: '#A9A499', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.listing_title ?? '—'}
                  {fmtDateRange(c.check_in, c.check_out) && <span style={{ color: '#B5A97F' }}> · {fmtDateRange(c.check_in, c.check_out)}</span>}
                </div>
                {(c.platform || c.guestStatus || (c.guestLang && c.guestLang !== 'de')) && (
                  <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ThreadBadges c={c} />
                    {c.guestLang && c.guestLang !== 'de' && (
                      <span title={`Gast schreibt ${LANG_LABEL[c.guestLang] ?? c.guestLang}`} style={{ fontSize: 12 }}>{flag(c.guestLang)}</span>
                    )}
                  </div>
                )}
              </div>
              {fullWidth && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#CCC" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              )}
            </button>
          )
        })}
      </div>
    )
  }

  /* ═══════════════════════════════════════════════════════════
     MESSAGE PANEL (shared between mobile chat view + desktop right panel)
  ═══════════════════════════════════════════════════════════ */
  function MessagePanel({ showBack = false }: { showBack?: boolean }) {
    if (!active) return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, color: '#CCC', background: '#fff' }}>
        <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span style={{ fontSize: 14, color: '#BBB' }}>Unterhaltung auswählen</span>
      </div>
    )

    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden', background: '#fff' }}>
        {/* Chat header: back button on mobile; on the page variant the
            desktop thread shows it too (the overlay has it in its own bar) */}
        {(showBack || variant !== 'overlay') && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 14px', background: 'rgba(255,255,255,0.85)',
            backdropFilter: 'blur(16px) saturate(1.6)', WebkitBackdropFilter: 'blur(16px) saturate(1.6)',
            borderBottom: '0.5px solid rgba(60,60,67,0.15)', flexShrink: 0,
          }}>
            {showBack && (
            <button
              onClick={() => setMobileView('list')}
              style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', background: '#F2EFE8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', flexShrink: 0 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            )}
            <Av name={partner(active)} src={partnerAvatar(active)} size={36} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1A1814', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {partner(active)}
              </div>
              <div style={{ fontSize: 11, color: '#AAA', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {active.listing_title}
                {dateRange && <span style={{ color: 'var(--gold)', fontWeight: 600 }}> · {dateRange}</span>}
              </div>
            </div>
            {(active.platform || active.guestStatus || guestLang) && (
              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                {guestLang && guestLang !== 'de' && (
                  <span title={`Gast schreibt ${LANG_LABEL[guestLang] ?? guestLang}`} style={{ fontSize: 15 }}>{flag(guestLang)}</span>
                )}
                <ThreadBadges c={active} size={10.5} />
                {team && active.lastSender === 'guest' && (
                  <>
                    <button
                      onClick={() => toggleMark('phone')}
                      title={active.phoneResolved ? 'Telefon-Markierung entfernen' : 'Per Telefonat geklärt'}
                      style={{
                        width: 30, height: 30, borderRadius: '50%', border: 'none', cursor: 'pointer',
                        background: active.phoneResolved ? 'linear-gradient(135deg, #2E7CF6, #1D5FD1)' : 'rgba(118,118,128,0.12)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        fontSize: 13, transition: 'all .15s',
                        filter: active.phoneResolved ? 'none' : 'grayscale(1) opacity(0.6)',
                      }}
                    >📞</button>
                    <button
                      onClick={() => toggleMark('no_reply')}
                      title={active.noReplyNeeded ? 'Wieder als unbeantwortet zählen' : 'Keine Antwort erforderlich'}
                      style={{
                        width: 30, height: 30, borderRadius: '50%', border: 'none', cursor: 'pointer',
                        background: active.noReplyNeeded ? 'linear-gradient(135deg, #34A853, #2C8C46)' : 'rgba(118,118,128,0.12)',
                        color: active.noReplyNeeded ? '#fff' : '#8A8578',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        fontSize: 14, fontWeight: 700, transition: 'all .15s',
                      }}
                    >✓</button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        {sendError && (
          <div style={{
            padding: '9px 14px', fontSize: 12.5, lineHeight: 1.5, flexShrink: 0,
            background: '#FEF2F2', borderBottom: '0.5px solid rgba(220,38,38,0.25)', color: '#B91C1C',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ flex: 1 }}>⚠️ {sendError}</span>
            <button onClick={() => setSendError(null)} style={{ border: 'none', background: 'none', color: '#B91C1C', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>✕</button>
          </div>
        )}
        {bookingHintFor === active?.id && (
          <div style={{
            padding: '9px 14px', fontSize: 12.5, lineHeight: 1.5, flexShrink: 0,
            background: '#EBF2FE', borderBottom: '0.5px solid rgba(46,124,246,0.25)', color: '#1D4FA3',
          }}>
            ✓ Erledigt — <strong>denk dran:</strong> Bei Booking.com-Gästen den Haken „Keine Antwort nötig" zusätzlich in der Booking-App setzen (zählt für eure Antwortquote).
          </div>
        )}

        {/* Message feed */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px 8px', display: 'flex', flexDirection: 'column', background: '#fff' }}>
          {msgs.length === 0 && (
            <div style={{ margin: 'auto', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>👋</div>
              <div style={{ fontSize: 13, color: '#AAA' }}>{t(uiLang, 'Noch keine Nachrichten')}</div>
            </div>
          )}
          {grouped.map(({ day, items }) => (
            <div key={day}>
              {/* day divider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 12px' }}>
                <div style={{ flex: 1, height: 1, background: '#E0DCD2' }} />
                <span style={{ fontSize: 11, color: '#999', fontWeight: 600, background: '#EDE9E0', padding: '2px 10px', borderRadius: 99, whiteSpace: 'nowrap' }}>
                  {day}
                </span>
                <div style={{ flex: 1, height: 1, background: '#E0DCD2' }} />
              </div>

              {items.map((msg, i) => {
                const isMe     = msg.sender_id === userId
                const prevSame = i > 0 && items[i - 1].sender_id === msg.sender_id
                const nextSame = i < items.length - 1 && items[i + 1].sender_id === msg.sender_id
                const isLast   = !nextSame

                /* iMessage-style corner radii */
                const R = '18px'
                const r = '4px'
                const borderRadius = isMe
                  ? (prevSame ? `${R} ${r} ${r} ${R}` : `${R} ${R} ${r} ${R}`)
                  : (prevSame ? `${r} ${R} ${R} ${R}` : `${r} ${R} ${R} ${R}`)

                return (
                  <div key={msg.id} style={{
                    display: 'flex',
                    flexDirection: isMe ? 'row-reverse' : 'row',
                    alignItems: 'flex-end', gap: 8,
                    marginBottom: isLast ? 10 : 2,
                    marginTop: prevSame ? 0 : 6,
                  }}>
                    {/* avatar placeholder for alignment */}
                    <div style={{ width: 30, flexShrink: 0 }}>
                      {!isMe && isLast && <Av name={partner(active)} src={partnerAvatar(active)} size={28} />}
                    </div>

                    <div style={{ maxWidth: '72%', display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', gap: 3 }}>
                      {/* bubble */}
                      <div style={{
                        padding: '10px 14px',
                        borderRadius,
                        background: isMe
                          ? 'linear-gradient(135deg, var(--gold), var(--gold-dark))'
                          : '#E9E9EB',
                        color: isMe ? '#fff' : '#111',
                        fontSize: 15.5, lineHeight: 1.4,
                        boxShadow: 'none',
                        wordBreak: 'break-word',
                      }}>
                        <span style={{ whiteSpace: 'pre-wrap' }}>
                          {team && msg.content_de && !showOriginal[msg.id] ? msg.content_de : msg.content}
                        </span>
                      </div>
                      {team && msg.lang && msg.lang !== 'de' && msg.content_de && (
                        <button
                          type="button"
                          onClick={() => setShowOriginal(so => ({ ...so, [msg.id]: !so[msg.id] }))}
                          style={{
                            border: 'none', background: 'none', cursor: 'pointer', padding: '0 3px',
                            fontSize: 10.5, color: '#9A8F6E', fontWeight: 600,
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                          }}
                        >
                          {flag(msg.lang)} {isMe
                            ? `gesendet auf ${LANG_LABEL[msg.lang] ?? msg.lang}`
                            : `Original: ${LANG_LABEL[msg.lang] ?? msg.lang}`}
                          {' · '}{showOriginal[msg.id] ? 'Übersetzung zeigen' : (isMe ? 'Gesendetes zeigen' : 'Original zeigen')}
                        </button>
                      )}

                      {isLast && (
                        <span style={{ fontSize: 10.5, color: '#AAA', paddingLeft: isMe ? 0 : 3, paddingRight: isMe ? 3 : 0 }}>
                          {fmtMsgT(msg.created_at, uiLang)}
                          {isMe && msg.read_at && <span style={{ color: 'var(--gold)', marginLeft: 4, fontWeight: 700 }}>✓✓</span>}
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

        {/* Translation send preview — nothing goes out until confirmed */}
        {pendingSend && (
          <div style={{ borderTop: '1px solid #E8E4DB', background: '#FDFAF0', padding: '12px 14px', flexShrink: 0 }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--gold-dark)', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 7px' }}>
              {flag(pendingSend.lang)} Wird auf {LANG_LABEL[pendingSend.lang] ?? pendingSend.lang} gesendet — bitte prüfen
            </p>
            <textarea
              value={pendingSend.translated}
              onChange={e => setPendingSend(ps => ps ? { ...ps, translated: e.target.value } : ps)}
              rows={3}
              style={{
                width: '100%', boxSizing: 'border-box', resize: 'vertical', outline: 'none',
                border: '1.5px solid #E6C15A', borderRadius: 12, padding: '9px 12px',
                fontSize: 14, lineHeight: 1.5, fontFamily: 'inherit', background: '#fff', color: '#1A1814',
              }}
            />
            <p style={{ fontSize: 11, color: '#9A8F6E', margin: '6px 0 8px' }}>🇩🇪 Dein Original: {pendingSend.original.slice(0, 160)}{pendingSend.original.length > 160 ? '…' : ''}</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => reallySend(pendingSend.translated, pendingSend.lang !== 'de' ? pendingSend.original : undefined, pendingSend.lang !== 'de' ? pendingSend.lang : undefined)} disabled={busy} style={{
                padding: '8px 20px', borderRadius: 999, border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))', color: '#fff', fontSize: 13, fontWeight: 700,
              }}>{busy ? 'Sendet…' : 'Jetzt senden'}</button>
              <button onClick={() => setPendingSend(null)} style={{
                padding: '8px 14px', borderRadius: 999, border: '1px solid #E0DCD2', background: '#fff',
                color: '#777', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>Zurück zum Entwurf</button>
            </div>
          </div>
        )}

        {/* AI instruction field (two-step workshop): refine the current draft */}
        {team && draft.trim().length > 0 && !pendingSend && (
          <div style={{ borderTop: '1px solid #F0ECE2', background: '#FDFCF8', padding: '8px 14px', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <span style={{ fontSize: 13, flexShrink: 0 }}>✏️</span>
            <input
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); refineDraft() } }}
              placeholder="Anweisung an Claude… (z. B. „kürzer“ oder „biete Late-Checkout an“) — 🎤 über die Tastatur diktierbar"
              style={{
                flex: 1, border: '1px solid #EBE5D5', borderRadius: 999, padding: '7px 14px',
                fontSize: 12.5, outline: 'none', background: '#fff', color: '#1A1814', fontFamily: 'inherit',
              }}
            />
            <button onClick={refineDraft} disabled={refining || !instruction.trim()} style={{
              padding: '7px 14px', borderRadius: 999, border: 'none', flexShrink: 0,
              background: instruction.trim() && !refining ? 'linear-gradient(135deg, var(--gold), var(--gold-dark))' : '#EDE9E0',
              color: instruction.trim() && !refining ? '#fff' : '#BBB',
              fontSize: 12, fontWeight: 700, cursor: instruction.trim() && !refining ? 'pointer' : 'default',
            }}>{refining ? '⏳' : 'Anpassen'}</button>
          </div>
        )}

        {/* Input bar */}
        <div style={{
          borderTop: '0.5px solid rgba(60,60,67,0.15)', background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          padding: '8px 12px',
          // In der Tab-Shell (app) übernimmt die Tab-Leiste die Safe-Area
          paddingBottom: variant === 'app' ? 8 : 'max(8px, env(safe-area-inset-bottom))',
          display: 'flex', gap: 10, alignItems: 'flex-end', flexShrink: 0,
        }}>
          {active && isHost(active) && msgs.length > 0 && (
            <button
              onClick={suggestReply}
              disabled={aiBusy}
              title="Antwort von Claude vorschlagen lassen"
              style={{
                width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                border: 'none', background: 'rgba(118,118,128,0.12)',
                cursor: aiBusy ? 'wait' : 'pointer', fontSize: 15,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: aiBusy ? 0.5 : 1, transition: 'opacity .15s',
                marginBottom: 1,
              }}
            >
              {aiBusy ? '⏳' : '✨'}
            </button>
          )}
          {/* iMessage-style field: rounded bubble, send button INSIDE, grows upward, Enter = newline */}
          <div style={{
            flex: 1, position: 'relative', display: 'flex',
            border: '1px solid rgba(60,60,67,0.28)', borderRadius: 18,
            background: '#fff', minHeight: 36,
          }}>
            <textarea
              ref={taRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              enterKeyHint="enter"
              placeholder={needsTranslation ? `Deutsch → ${flag(guestLang)} ${LANG_LABEL[guestLang!] ?? guestLang}` : t(uiLang, 'Nachricht')}
              rows={1}
              style={{
                flex: 1, resize: 'none', outline: 'none', border: 'none',
                borderRadius: 18, padding: draft.trim() ? '7px 62px 7px 13px' : '7px 13px',
                fontSize: 17, lineHeight: '22px', fontFamily: 'inherit',
                background: 'transparent', color: '#111',
                maxHeight: '40dvh', overflowY: 'auto',
              }}
            />
            {draft.trim().length > 0 && (
              <>
                <button
                  onClick={() => { setDraft(''); setInstruction('') }}
                  title="Entwurf verwerfen"
                  style={{
                    position: 'absolute', right: 36, bottom: 7, width: 22, height: 22,
                    borderRadius: '50%', border: 'none', background: 'rgba(118,118,128,0.28)',
                    color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                  }}
                >✕</button>
                <button
                  onClick={send}
                  disabled={busy}
                  title="Senden"
                  style={{
                    position: 'absolute', right: 4, bottom: 4, width: 28, height: 28,
                    borderRadius: '50%', border: 'none', padding: 0,
                    background: busy ? '#EDE9E0' : 'linear-gradient(135deg,var(--gold),var(--gold-dark))',
                    color: '#fff', cursor: busy ? 'default' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  /* ═══════════════════════════════════════════════════════════
     RENDER — 'page': inline card (chat pages) · 'overlay': fixed modal
  ═══════════════════════════════════════════════════════════ */
  // Session expired: fixed banner with one-tap relogin (returns to this page)
  const authBanner = authExpired ? (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9500,
      padding: '12px 16px', paddingTop: 'max(12px, env(safe-area-inset-top))',
      background: '#B45309', color: '#fff', display: 'flex', alignItems: 'center', gap: 10,
      fontSize: 13.5, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
    }}>
      <span style={{ flex: 1 }}>Sitzung abgelaufen — bitte neu anmelden.</span>
      <button
        onClick={() => { window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname + window.location.search) }}
        style={{ border: 'none', borderRadius: 999, padding: '8px 16px', background: '#fff', color: '#92400E', fontWeight: 700, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}
      >Neu anmelden</button>
    </div>
  ) : null

  if (variant === 'page' || variant === 'app') {
    const isApp = variant === 'app'
    return (
      <div style={{
        maxWidth: isApp ? undefined : '1100px', margin: '0 auto',
        padding: isApp ? 0 : isMobile ? '10px 10px 16px' : '20px 20px 32px',
        // app: füllt den Content-Bereich der Tab-Shell (die setzt die Höhe)
        height: isApp ? '100%' : 'calc(100vh - 130px)',
        display: 'flex', flexDirection: 'column',
      }}>
        {authBanner}
        {/* Page header (hidden in app shell — nothing but chat) */}
        <div style={{ marginBottom: '12px', display: isApp ? 'none' : 'flex', alignItems: 'center', gap: '10px' }}>
          {isMobile && mobileView === 'chat' ? null : (
            <div>
              <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 2px' }}>
                {t(uiLang, 'Kommunikation')}
              </p>
              <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#111', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                {t(uiLang, 'Nachrichten')}
                {unread > 0 && (
                  <span style={{ fontSize: '12px', fontWeight: 700, background: 'var(--gold)', color: '#fff', padding: '2px 9px', borderRadius: '99px', lineHeight: '20px' }}>
                    {unread}
                  </span>
                )}
              </h1>
            </div>
          )}
        </div>

        {/* Card */}
        <div style={{
          flex: 1, display: 'flex', minHeight: 0,
          background: '#fff', borderRadius: isApp ? 0 : '18px',
          border: '1px solid #E8E4DC',
          boxShadow: '0 2px 20px rgba(0,0,0,0.06)',
          overflow: 'hidden',
        }}>
          {isMobile ? (
            mobileView === 'list' ? ConvList({ fullWidth: true }) : MessagePanel({ showBack: true })
          ) : (
            <>
              {ConvList({ fullWidth: false })}
              {MessagePanel({ showBack: false })}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <style>{`
        @keyframes cfade { from{opacity:0} to{opacity:1} }
        @keyframes crise { from{opacity:0;transform:translateX(-50%) scale(.97)} to{opacity:1;transform:translateX(-50%) scale(1)} }
        @keyframes cslideup { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      {/* backdrop */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,.35)', backdropFilter: 'blur(4px)',
        animation: 'cfade .18s ease',
      }} />

      {/* ── MOBILE LAYOUT ── */}
      {isMobile ? (
        <div ref={mobileShellRef} style={{
          position: 'fixed', inset: 0,
          zIndex: 9001,
          display: 'flex', flexDirection: 'column',
          background: '#fff',
          animation: 'cslideup .22s cubic-bezier(.34,1.1,.64,1)',
        }}>
          {/* Mobile header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '14px 16px', height: 56, flexShrink: 0,
            background: '#FFFFFF', borderBottom: '1px solid #EDEBE4',
          }}>
            {mobileView === 'list' ? (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <span style={{ flex: 1, fontWeight: 700, fontSize: 17, color: '#1A1814' }}>
                  {t(uiLang, 'Nachrichten')}
                  {unread > 0 && (
                    <span style={{ marginLeft: 8, background: 'var(--gold)', color: '#fff', fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 99 }}>
                      {unread}
                    </span>
                  )}
                </span>
                <button onClick={onClose} style={{
                  width: 32, height: 32, borderRadius: '50%', border: 'none',
                  background: '#F2EFE8', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888',
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </>
            ) : (
              /* In chat view, header is rendered inside MessagePanel's showBack */
              <button onClick={onClose} style={{
                marginLeft: 'auto', width: 32, height: 32, borderRadius: '50%', border: 'none',
                background: '#F2EFE8', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888',
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>

          {/* Mobile body */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {mobileView === 'list'
              ? ConvList({ fullWidth: true })
              : MessagePanel({ showBack: true })
            }
          </div>
        </div>
      ) : (
        /* ── DESKTOP LAYOUT ── */
        <div style={{
          position: 'fixed',
          top: 'calc(var(--navbar-h, 88px) + 12px)',
          left: '50%', transform: 'translateX(-50%)',
          zIndex: 9001,
          width: 'min(880px,93vw)', height: 'calc(100vh - var(--navbar-h, 88px) - 24px)',
          display: 'flex', flexDirection: 'column',
          background: '#FFFFFF',
          borderRadius: 16,
          boxShadow: '0 24px 80px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.06)',
          overflow: 'hidden',
          animation: 'crise .22s cubic-bezier(.34,1.3,.64,1)',
        }}>
          {/* Desktop header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '0 18px', height: 52, flexShrink: 0,
            background: '#FFFFFF', borderBottom: '1px solid #EDEBE4',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <span style={{ flex: 1, fontWeight: 700, fontSize: 15, color: '#1A1814' }}>
              {t(uiLang, 'Nachrichten')}
              {unread > 0 && (
                <span style={{ marginLeft: 8, background: 'var(--gold)', color: '#fff', fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 99 }}>
                  {unread}
                </span>
              )}
            </span>
            {active && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 8 }}>
                <Av name={partner(active)} src={partnerAvatar(active)} size={28} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#3D3A32', lineHeight: 1.2 }}>{partner(active)}</span>
                  <span style={{ fontSize: 10.5, color: '#999', lineHeight: 1.2 }}>
                    {active.listing_title}
                    {dateRange && <> · <strong style={{ color: 'var(--gold)' }}>{dateRange}</strong></>}
                  </span>
                </div>
              </div>
            )}
            <button onClick={onClose} style={{
              width: 30, height: 30, borderRadius: '50%', border: 'none',
              background: '#F2EFE8', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888',
            }}
              onMouseEnter={e => { (e.target as HTMLElement).style.background = '#E8E3D8' }}
              onMouseLeave={e => { (e.target as HTMLElement).style.background = '#F2EFE8' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          {/* Desktop body: sidebar + messages */}
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {ConvList({ fullWidth: false })}
            {MessagePanel({ showBack: false })}
          </div>
        </div>
      )}
    </>
  )
}
