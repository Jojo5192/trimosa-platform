'use client'

/**
 * Die Team-App-Shell — §276 Design-System (Pascals JUPAS-Referenz, 9.9.2026):
 *  · Glas-Kopfleiste auf jedem Bildschirm: Wortmarke klein, Bereichs-Name
 *    groß, Sync-Stand, Lupe + Aktualisieren als runde Icon-Knöpfe
 *  · schwebende Tab-Leiste unten (Glas, Strich-Icons, aktive Pille), der
 *    Inhalt scrollt dahinter durch (--tm-nav-pad in den Panel-Scrollern)
 *  · am Rechner (≥1000px) wird die Leiste zur Seitenleiste links
 *  · Ladestreifen oben während eines Abgleichs, Toast-Host, Such-Ebene
 * Tabs (§277): 🏠 Heute · 💬 Inbox · 📅 Belegung · ✅ Aufgaben · ⋯ Mehr.
 *   Die Inbox vereint Gäste-Chat und Intern-Messenger: Segment-Pille
 *   „Gäste · n | Intern · n" unter der Kopfleiste, Wahl wird gemerkt
 *   (localStorage), beim Betreten landet man auf der Seite mit Ungelesenem.
 *   Dienstleister sehen in der Inbox nur Intern (kein Segment).
 * ChatPanel/InternPanel bleiben gemountet (Polling/State), die anderen Tabs
 * werden per display umgeschaltet — Tab-Wechsel fühlt sich instant an.
 * Der frühere Reiter „Offen" (Karten-Stapel, §155) lebt weiter unter Mehr.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import ChatPanel from '@/components/chat/ChatPanel'
import { haptic, tmToast, TabStrokeIcon, IconSearch, IconRefresh, isStandalonePwa } from '@/components/team/ux'
import { useOnline, useOutboxCount, noteInteraction, flushOutbox, ensureOwner } from '@/lib/offline'
import { applyTheme, useIsDark } from '@/lib/theme'
import OffenPanel from '@/components/team/OffenPanel'
import InternPanel from '@/components/team/InternPanel'
import TasksPanel from '@/components/team/TasksPanel'
import CalendarPanel from '@/components/team/CalendarPanel'
import SettingsPanel from '@/components/team/SettingsPanel'
import SearchOverlay from '@/components/team/SearchOverlay'
import HeutePanel from '@/components/team/HeutePanel'

type Tab = 'heute' | 'inbox' | 'offen' | 'aufgaben' | 'kalender' | 'einstellungen'
/** Inbox-Segment: Gäste-Chat (ChatPanel) oder Intern-Messenger (InternPanel) */
type Seg = 'gaeste' | 'intern'
const SEG_KEY = 'trimosa-inbox-seg'

/** Reiter der Leiste (Reihenfolge = Pascal-Spec, „Offen" ist kein Reiter mehr) */
const TABS: { id: Tab; label: string }[] = [
  { id: 'heute', label: 'Heute' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'kalender', label: 'Kalender' },
  { id: 'aufgaben', label: 'Aufgaben' },
  { id: 'einstellungen', label: 'Mehr' },
]
/** Bereichs-Name in der Kopfleiste (springt beim Reiterwechsel um) */
const TITLES: Record<Tab, string> = {
  heute: 'Heute', inbox: 'Inbox', offen: 'Offen', aufgaben: 'Aufgaben', kalender: 'Belegung', einstellungen: 'Mehr',
}
/** Alt-Reiter-Namen (Deep-Links, Events, Suche) → Inbox-Segment */
const segFor = (id: string): Seg | null => id === 'chat' ? 'gaeste' : id === 'intern' ? 'intern' : null

function fmtSync(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `Sync ${p(d.getDate())}.${p(d.getMonth() + 1)}., ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Wortmarke: Gold-Emblem (= Markenteil in Akzentfarbe) + TRIMOSA gesperrt */
function Wordmark({ big = false }: { big?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: big ? 7 : 5, lineHeight: 1 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.png" alt="" width={big ? 16 : 11} height={big ? 16 : 11} style={{ display: 'block' }} />
      <span style={{
        fontSize: big ? 13 : 10.5, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase',
        color: 'var(--tm-muted)',
      }}>TRIMOSA</span>
    </span>
  )
}

export default function TeamShell({ userId, role, initialConvId, initialTab, initialInternChatId, initialTaskId }: {
  userId: string
  role: 'team' | 'provider'
  initialConvId: string | null
  initialTab?: string
  initialInternChatId?: string | null
  /** §274: /team?task=<id> (Push-Deep-Link der Überbuchungs-Aufgabe) */
  initialTaskId?: string | null
}) {
  const tabs = TABS
  /** Reiter-Name (auch Alt-Namen chat/intern → inbox) → gültiger Tab oder null */
  const normTab = (id: string): Tab | null => {
    if (segFor(id)) return 'inbox'
    if (tabs.some((t) => t.id === id) || (role === 'team' && id === 'offen')) return id as Tab
    return null
  }
  // Die App startet immer auf „Heute" (Pascal-Spec) — außer ein Deep-Link
  // (Push-Tap: ?conv= / ?chat= / ?task=) verlangt ein Ziel
  const fallback: Tab = 'heute'
  // Paragraph 308: Update-Streifen
  const [updating, setUpdating] = useState(false)
  // Paragraph 310: In-App-Link-Sheet (Standalone-PWA hat keine Browser-Leiste -> kein Zurueck)
  const [linkSheet, setLinkSheet] = useState<{ url: string; title: string } | null>(null)
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ url: string; title?: string }>).detail
      if (d?.url) setLinkSheet({ url: d.url, title: d.title || '' })
    }
    // Klicks auf Links mit target=_blank (z. B. Links in Nachrichten) im Standalone-Modus abfangen
    const onClick = (e: MouseEvent) => {
      if (!isStandalonePwa()) return
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.getAttribute('target') !== '_blank') return
      const href = a.href
      if (!/^https?:/i.test(href)) return
      e.preventDefault()
      setLinkSheet({ url: href, title: a.textContent?.trim().slice(0, 60) || '' })
    }
    window.addEventListener('trimosa-open-link', onOpen)
    document.addEventListener('click', onClick, true)
    return () => { window.removeEventListener('trimosa-open-link', onOpen); document.removeEventListener('click', onClick, true) }
  }, [])

  const [tab, setTab] = useState<Tab>(
    initialTaskId ? 'aufgaben'
      : initialConvId || initialInternChatId ? 'inbox'
      : (initialTab && normTab(initialTab)) || fallback
  )
  // Inbox-Segment: Deep-Link gewinnt, sonst die gemerkte Wahl (wird nach dem
  // Mount aus localStorage gelesen — SSR kennt keinen Speicher); Dienstleister
  // haben nur Intern.
  const [seg, setSegState] = useState<Seg>(() =>
    role === 'provider' || initialInternChatId ? 'intern'
      : initialConvId ? 'gaeste'
      : (initialTab && segFor(initialTab)) || 'gaeste'
  )
  const setSeg = useCallback((s: Seg) => {
    setSegState(s)
    try { localStorage.setItem(SEG_KEY, s) } catch { /* privater Modus */ }
  }, [])
  useEffect(() => {
    if (role !== 'team' || initialConvId || initialInternChatId || (initialTab && segFor(initialTab))) return
    try {
      const v = localStorage.getItem(SEG_KEY)
      if (v === 'gaeste' || v === 'intern') setSegState(v)
    } catch { /* egal */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [internUnread, setInternUnread] = useState(0)
  const [guestUnread, setGuestUnread] = useState(0)
  const [offenCount, setOffenCount] = useState(0)
  const [heuteCount, setHeuteCount] = useState(0)
  // Mobil in einem Thread: Kopfleiste + Tab-Bar versteckt (WhatsApp-Verhalten, §98)
  const [chatThread, setChatThread] = useState(false)
  const [internThread, setInternThread] = useState(false)
  const navHidden = tab === 'inbox' && (seg === 'gaeste' && role === 'team' ? chatThread : internThread)

  // Pascal-Spec: Beim Betreten der Inbox landet man im gemerkten Segment —
  // hat nur EINE Seite Ungelesenes, dort. (Nur beim Betreten, nie während
  // des Lesens — sonst springt die Ansicht unter den Fingern um.)
  const unreadRef = useRef({ g: 0, i: 0 })
  unreadRef.current = { g: guestUnread, i: internUnread }
  const skipAutoPick = useRef(!!(initialConvId || initialInternChatId))
  useEffect(() => {
    if (tab !== 'inbox' || role !== 'team') return
    if (skipAutoPick.current) { skipAutoPick.current = false; return }
    const { g, i } = unreadRef.current
    if (g > 0 && i === 0) setSegState('gaeste')
    else if (i > 0 && g === 0) setSegState('intern')
  }, [tab, role])

  // Rechner (≥1000px): Seitenleiste statt schwebender Tab-Leiste
  const [isDesktop, setIsDesktop] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1000px)')
    const apply = () => setIsDesktop(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  // §162: Klick auf eine Aufgabe im Kalender → Aufgaben-Tab öffnen und die
  // Aufgabe fokussieren (Event aus CalendarPanel; TasksPanel ist nur bei
  // aktivem Tab gemountet, darum vermittelt die Shell per Prop)
  const [taskFocus, setTaskFocus] = useState<string | null>(initialTaskId ?? null)
  useEffect(() => {
    const onOpenTask = (e: Event) => {
      const id = (e as CustomEvent<{ id: string | null }>).detail?.id ?? null
      setTaskFocus(id)
      setTab('aufgaben')
    }
    // Mehr → „Offen"-Karten-Stapel (kein Reiter mehr, §276); Heute → „chat"
    // landet in der Inbox auf dem Gäste-Segment (§277)
    const onOpenTab = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      const sg = segFor(id)
      if (sg) setSeg(sg)
      const t = normTab(id)
      if (t) setTab(t)
    }
    window.addEventListener('trimosa-open-task', onOpenTask)
    window.addEventListener('trimosa-open-tab', onOpenTab)
    return () => {
      window.removeEventListener('trimosa-open-task', onOpenTask)
      window.removeEventListener('trimosa-open-tab', onOpenTab)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── Sync-Stand, Ladestreifen, Aktualisieren ── */
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const [syncing, setSyncing] = useState(true)
  const [spin, setSpin] = useState(0)
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const onSynced = () => {
      setLastSync(new Date())
      setSyncing(false)
      if (syncTimer.current) { clearTimeout(syncTimer.current); syncTimer.current = null }
    }
    window.addEventListener('trimosa-synced', onSynced)
    // Start-Abgleich: spätestens nach 4 s ist der Streifen weg (Panels ohne Event)
    syncTimer.current = setTimeout(() => setSyncing(false), 4000)
    return () => {
      window.removeEventListener('trimosa-synced', onSynced)
      if (syncTimer.current) clearTimeout(syncTimer.current)
    }
  }, [])
  const refresh = useCallback(() => {
    haptic()
    setSpin((k) => k + 1)
    setSyncing(true)
    window.dispatchEvent(new Event('trimosa-refresh'))
    if (syncTimer.current) clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(() => setSyncing(false), 3000)
  }, [])

  /* ── Toast-Host (tmToast aus ux.tsx) ── */
  const [toast, setToast] = useState<string | null>(null)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    const onToast = (e: Event) => {
      const text = (e as CustomEvent<{ text: string }>).detail?.text
      if (!text) return
      setToast(text)
      if (t) clearTimeout(t)
      t = setTimeout(() => setToast(null), 2000)
    }
    window.addEventListener('trimosa-toast', onToast)
    return () => { window.removeEventListener('trimosa-toast', onToast); if (t) clearTimeout(t) }
  }, [])

  /* ── Suche (Lupe · ⌘K) ── */
  const [searchOpen, setSearchOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // App-Icon-Badge ZENTRAL — §291 (Pascal 9.9. 15:12): dieselbe Zahl wie am Heute-Reiter
  // (Sofort-Aufgaben + heute geplante Aufgaben + offene Gast-Nachrichten + Anreisen mit
  // fehlendem Häkchen). Die frühere Kopplung an die Push-Einstellungen (19.7.) entfällt;
  // Intern-Ungelesenes zeigt der Inbox-Reiter, Push-Mitteilungen kommen weiterhin.
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    try {
      if (heuteCount > 0) nav.setAppBadge?.(heuteCount)?.catch(() => {})
      else nav.clearAppBadge?.()?.catch(() => {})
    } catch { /* Badging API nicht verfügbar */ }
  }, [heuteCount])

  // Tastatur-Pinning (iOS-26-fest): iOS verschiebt bei offener Tastatur den
  // sichtbaren Ausschnitt — je nach Build via window-Scroll ODER visualViewport-
  // Pan (vv.pageTop deckt BEIDE ab: offsetTop + scrollY). Statt gegen iOS zu
  // scrollen, folgt die Shell dem sichtbaren Bereich: height = vv.height,
  // top = vv.pageTop. Imperativ per ref (keine Re-Renders des ganzen Baums
  // während der Tastatur-Animation); position:relative bewusst, KEIN transform
  // (würde fixed-Sheets neu verankern). focusout-Nachläufer, weil iOS 26 die
  // Viewport-Werte beim Schließen teils verspätet/gar nicht zurücksetzt.
  const shellRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const vv = window.visualViewport
    const el = shellRef.current
    if (!vv || !el) return
    let raf = 0
    const apply = () => {
      const kb = window.innerHeight - vv.height
      const off = Math.round(vv.pageTop)
      if (kb > 100 || off > 40) {
        el.style.height = `${Math.round(vv.height)}px`
        el.style.top = `${off}px`
      } else {
        el.style.height = '100dvh'
        el.style.top = '0px'
      }
    }
    const sync = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(apply) }
    const onFocusOut = () => { setTimeout(sync, 250); setTimeout(sync, 650) }
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)
    window.addEventListener('scroll', sync)
    window.addEventListener('focusout', onFocusOut)
    return () => {
      cancelAnimationFrame(raf)
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
      window.removeEventListener('scroll', sync)
      window.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  // iOS 26: Statusbar-Farbe = Seiten-Hintergrund — zusätzlich zum CSS-:has()
  // hart auf den App-Hintergrund setzen (Gürtel + Hosenträger, §98/§276)
  // 🌗 §284: Klasse tm-dark + Seitenhintergrund + theme-color nach Modus —
  // folgt auch dem System-Wechsel (useIsDark abonniert die Media Query)
  const isDark = useIsDark()
  useEffect(() => { applyTheme() }, [isDark])

  // Service Worker früh registrieren (Push-Empfang + §280 Offline-Cache) — die
  // Einstellungen dazu liegen im ⚙️-Tab; so bekommen auch Dienstleister ohne
  // Chat-Tab Push. ensureOwner: Nutzerwechsel auf demselben Gerät räumt
  // Snapshots/Warteschlange/Cache vorher weg.
  useEffect(() => {
    ensureOwner(userId)
    if (!('serviceWorker' in navigator)) return
    // Paragraph 308 (Pascal): neue App-Version -> Goldstreifen laeuft oben durch, nach Aktivierung Toast
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing
        if (!w || !navigator.serviceWorker.controller) return
        setUpdating(true)
        w.addEventListener('statechange', () => {
          if (w.state === 'activated' || w.state === 'redundant') setTimeout(() => setUpdating(false), 2500)
        })
      })
    }).catch(() => {})
    const onChange = () => tmToast('✨ App aktualisiert')
    navigator.serviceWorker.addEventListener('controllerchange', onChange)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onChange)
  }, [userId])

  /* §280 Offline: Leiste unter der Kopfleiste, Warteschlange automatisch
   * senden und den Reiter neu laden, sobald Netz zurück ist; Bedienung
   * merken (Polling wird nach 10 Min ohne Bedienung seltener). */
  const online = useOnline()
  const outboxCount = useOutboxCount()
  const [backOnline, setBackOnline] = useState(false)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    const onOnline = () => {
      setBackOnline(true)
      void flushOutbox()
      window.dispatchEvent(new Event('trimosa-refresh'))
      if (t) clearTimeout(t)
      t = setTimeout(() => setBackOnline(false), 3500)
    }
    const onOffline = () => setSyncing(false)
    const onTouch = () => noteInteraction()
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('pointerdown', onTouch, { passive: true })
    window.addEventListener('keydown', onTouch, { passive: true })
    window.addEventListener('scroll', onTouch, { passive: true, capture: true })
    if (navigator.onLine !== false) void flushOutbox()
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('pointerdown', onTouch)
      window.removeEventListener('keydown', onTouch)
      window.removeEventListener('scroll', onTouch, { capture: true } as EventListenerOptions)
      if (t) clearTimeout(t)
    }
  }, [])
  const offlineBar = (!online || backOnline) ? (
    <div role="status" style={{
      flexShrink: 0, padding: '7px 16px', fontSize: 12.5, fontWeight: 600, textAlign: 'center', lineHeight: 1.35,
      background: online ? 'var(--tm-green-soft, rgba(26,157,87,0.13))' : 'var(--tm-yellow-soft, rgba(240,180,41,0.16))',
      color: online ? 'var(--tm-green, #1a9d57)' : '#7a5a00',
      borderBottom: '1px solid var(--tm-line, #e3e6ea)',
    }}>
      {online
        ? '✅ Wieder online — gleiche ab …'
        : `📴 Offline — du siehst den letzten Stand${outboxCount > 0 ? ` · ${outboxCount} ${outboxCount === 1 ? 'Nachricht wartet' : 'Nachrichten warten'}` : ''}`}
    </div>
  ) : null

  /* §265 Push-Tap in die LAUFENDE App: Der SW schickt statt eines Reloads
   * eine Message (client.navigate() wirft bei unkontrollierten Clients und
   * ist auf iOS-PWAs unzuverlässig — Pascals „lande nicht bei der
   * Nachricht"-Bug). Hier wird die URL client-seitig umgesetzt: Tab
   * schalten + Ziel-Events an die dauerhaft gemounteten Panels. */
  const applyPushUrl = (url: string) => {
    let u: URL
    try { u = new URL(url, window.location.origin) } catch { return }
    if (!u.pathname.startsWith('/team')) { window.location.href = url; return }
    const conv = u.searchParams.get('conv')
    const chat = u.searchParams.get('chat')
    const task = u.searchParams.get('task')
    const wunschTab = u.searchParams.get('tab')
    // §274: Überbuchungs-Push → direkt auf die Aufgabe (Fokus + Scroll)
    if (task && tabs.some((t) => t.id === 'aufgaben')) {
      setTaskFocus(task)
      setTab('aufgaben')
      return
    }
    if (conv && role === 'team') {
      setSeg('gaeste'); setTab('inbox')
      window.dispatchEvent(new CustomEvent('trimosa-open-conv', { detail: { id: conv } }))
      return
    }
    if (chat) {
      setSeg('intern'); setTab('inbox')
      window.dispatchEvent(new CustomEvent('trimosa-open-intern', { detail: { id: chat } }))
      return
    }
    if (wunschTab) {
      const sg = segFor(wunschTab)
      if (sg) setSeg(sg)
      const t = normTab(wunschTab)
      if (t) setTab(t)
    }
  }
  const applyPushUrlRef = useRef(applyPushUrl)
  applyPushUrlRef.current = applyPushUrl
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; url?: string } | null
      if (d?.type === 'trimosa-push-open' && typeof d.url === 'string') {
        // §265: ACK über den mitgeschickten Port — sonst fällt der SW nach
        // 600 ms auf einen navigate()-Reload zurück (altes Bundle/kein Listener)
        try { e.ports?.[0]?.postMessage('ack') } catch { /* egal */ }
        applyPushUrlRef.current(d.url)
      }
    }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [])

  /* Treffer der Such-Ebene → Ziel öffnen */
  const openHit = (h: { id: string; group: 'chat' | 'intern' | 'task' }) => {
    if (h.group === 'chat') { setSeg('gaeste'); setTab('inbox'); window.dispatchEvent(new CustomEvent('trimosa-open-conv', { detail: { id: h.id } })) }
    else if (h.group === 'intern') { setSeg('intern'); setTab('inbox'); window.dispatchEvent(new CustomEvent('trimosa-open-intern', { detail: { id: h.id } })) }
    else { setTaskFocus(h.id); setTab('aufgaben') }
  }

  const goTab = (id: Tab) => { haptic(); setTab(id) }
  // §282.11 Live-Punkt statt Uhrzeit: grün pulsierend = verbunden, grau = offline;
  // die Sync-Zeit bleibt als Tooltip (und am Rechner als Text daneben)
  // Pascal 9.9.: Uhrzeit ganz ersetzt — Punkt pulsiert WÄHREND des Abgleichs, steht still wenn synchron
  const showSync = false
  /* §282.1 Großer Titel: fährt beim Scrollen des sichtbaren Panels zusammen —
     Scroll-Ereignisse der Panels kommen per Capture an der Inhaltsfläche an;
     gemerkt wird der Reiter, für den eingeklappt ist (Wechsel ⇒ wieder groß). */
  const [collapsedFor, setCollapsedFor] = useState<Tab | null>(null)
  const collapsed = collapsedFor === tab
  const onContentScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement | null
    if (!el || typeof el.scrollTop !== 'number' || el.clientHeight < 240 || el.scrollHeight <= el.clientHeight) return
    const next = el.scrollTop > 24 ? tab : null
    setCollapsedFor((c) => (c === next ? c : next))
  }
  // Inbox-Zähler = ungelesene Chats beider Seiten (Pascal-Spec)
  const badgeFor = (id: Tab) => id === 'inbox' ? (role === 'team' ? guestUnread : 0) + internUnread : id === 'heute' ? heuteCount : 0

  /* ── Segment-Pille „Gäste · n | Intern · n" (nur Team, unter der Kopfleiste) ── */
  const segmented = (
    <div style={{ flexShrink: 0, padding: '8px 16px 4px' }}>
      <div role="tablist" style={{
        display: 'flex', padding: 3, borderRadius: 999, maxWidth: 420,
        background: 'var(--tm-surface2)', border: '1px solid var(--tm-line)',
      }}>
        {([['gaeste', 'Gäste', guestUnread], ['intern', 'Intern', internUnread]] as const).map(([id, label, n]) => {
          const on = seg === id
          return (
            <button key={id} role="tab" aria-selected={on} className="tm-press-btn" onClick={() => { haptic(); setSeg(id) }} style={{
              flex: 1, border: 'none', cursor: 'pointer', padding: '7px 10px', borderRadius: 999,
              background: on ? 'var(--tm-card)' : 'transparent',
              boxShadow: on ? 'var(--tm-shadow)' : 'none',
              color: on ? 'var(--tm-text)' : 'var(--tm-muted)',
              fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap',
              transition: 'background .2s var(--tm-ease), color .2s var(--tm-ease)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}>
              {label}
              {n > 0 && <span className="tm-num" style={{ fontSize: 11.5, color: on ? 'var(--tm-accent-dark)' : 'var(--tm-muted2)' }}>· {n}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )

  /* ── Kopfleiste ── */
  const header = (
    <header style={{
      flexShrink: 0, position: 'relative', zIndex: 30,
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '9px 16px 9px',
      // §282.1: groß = fast transparent, eingeklappt = richtig Glas
      // eingeklappt: Glas mit zartem Gold-Hauch (Pascals Stand 9.9.: getönte Kopfleiste)
      background: isDesktop ? 'var(--tm-glass)' : collapsed ? 'linear-gradient(180deg, var(--tm-accent-soft), var(--tm-glass) 70%)' : 'var(--tm-glass-soft)',
      backdropFilter: 'blur(18px) saturate(1.5)', WebkitBackdropFilter: 'blur(18px) saturate(1.5)',
      borderBottom: `1px solid ${isDesktop || collapsed ? 'var(--tm-line)' : 'transparent'}`,
      transition: 'background .28s var(--tm-ease), border-color .28s var(--tm-ease)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {tab === 'offen' ? (
          <button className="tm-press-btn" onClick={() => goTab('einstellungen')} style={{
            border: 'none', background: 'none', padding: 0, cursor: 'pointer',
            color: 'var(--tm-accent-dark)', fontSize: 16, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 2,
          }}><span style={{ fontSize: 22, lineHeight: 1, marginTop: -2 }}>‹</span> Mehr</button>
        ) : (
          <>
            {!isDesktop && <Wordmark />}
            <div key={tab} className="tm-enter tm-title" style={{
              fontSize: isDesktop ? 22 : collapsed ? 19 : 30, fontWeight: 800,
              letterSpacing: isDesktop || collapsed ? '-0.02em' : '-0.03em', color: 'var(--tm-text)',
              lineHeight: 1.15, marginTop: isDesktop ? 0 : 3,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{TITLES[tab]}</div>
          </>
        )}
      </div>
      {showSync && lastSync && (
        <span className="tm-num" style={{ fontSize: 11.5, color: 'var(--tm-muted2)', whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtSync(lastSync)}</span>
      )}
      <span
        className={online && syncing ? 'tm-live' : undefined}
        title={online ? `${syncing ? 'Gleicht ab' : 'Synchron'}${lastSync ? ` · ${fmtSync(lastSync)}` : ''}` : 'Offline'}
        aria-label={online ? 'Verbunden' : 'Offline'}
        style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginRight: 2, background: online ? 'var(--tm-green)' : 'var(--tm-muted2)', transition: 'background .3s var(--tm-ease)' }}
      />
      <button className="tm-iconbtn tm-press-btn" onClick={() => { haptic(); setSearchOpen(true) }} aria-label="Suchen" title="Suchen (⌘K)">
        <IconSearch />
      </button>
      <button className="tm-iconbtn tm-press-btn" onClick={refresh} aria-label="Aktualisieren" title="Aktualisieren">
        <span key={spin} className={spin > 0 ? 'tm-spin-once' : undefined} style={{ display: 'inline-flex' }}><IconRefresh /></span>
      </button>
    </header>
  )

  /* ── Tab-Knopf (Leiste + Seitenleiste) ── */
  const tabButton = (t: { id: Tab; label: string }, sidebar: boolean) => {
    const active = tab === t.id
    const badge = badgeFor(t.id)
    return (
      <button key={t.id} className="tm-press-tab" onClick={() => goTab(t.id)} aria-current={active ? 'page' : undefined} style={{
        border: 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
        background: active ? 'var(--tm-accent-soft)' : 'transparent',
        color: active ? 'var(--tm-accent-dark)' : 'var(--tm-muted)',
        borderRadius: sidebar ? 12 : 22,
        transition: 'background .2s var(--tm-ease), color .2s var(--tm-ease)',
        ...(sidebar
          ? { display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 12px', textAlign: 'left' as const }
          : { flex: 1, minWidth: 0, height: 62, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: 4, padding: '0 2px' }),
      }}>
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <TabStrokeIcon name={t.id} size={sidebar ? 22 : 27} active={active} />
          {badge > 0 && (
            <span style={{
              position: 'absolute', top: -5, right: -10, minWidth: 17, height: 17, borderRadius: 9,
              background: 'var(--tm-red)', color: '#fff', fontSize: 9.5, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
              boxShadow: '0 0 0 2px var(--tm-card)',
            }}>{badge > 99 ? '99+' : badge}</span>
          )}
        </span>
        <span style={{ fontSize: sidebar ? 14.5 : 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{t.label}</span>
      </button>
    )
  }

  /* ── Schwebende Tab-Leiste (Handy/Tablet) ── */
  const floatingNav = (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 40, pointerEvents: 'none',
      padding: '0 12px calc(12px + env(safe-area-inset-bottom))',
    }}>
      <nav style={{
        pointerEvents: 'auto', height: 76, borderRadius: 28,
        background: 'var(--tm-nav-glass)',
        backdropFilter: 'blur(22px) saturate(1.6)', WebkitBackdropFilter: 'blur(22px) saturate(1.6)',
        border: '1px solid var(--tm-line)', boxShadow: 'var(--tm-shadow-float)',
        display: 'flex', alignItems: 'center', gap: 2, padding: '0 6px',
      }}>
        {tabs.map((t) => tabButton(t, false))}
      </nav>
    </div>
  )

  /* ── Seitenleiste (Rechner) ── */
  const sidebar = (
    <aside style={{
      width: 224, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4,
      padding: '20px 12px', background: 'var(--tm-card)', borderRight: '1px solid var(--tm-line)',
    }}>
      <div style={{ padding: '2px 12px 18px' }}><Wordmark big /></div>
      {tabs.map((t) => tabButton(t, true))}
    </aside>
  )

  const wrap = (id: Tab, node: React.ReactNode, centered = false) => (
    <div key={id} className={tab === id ? 'tm-enter' : undefined} style={{ height: '100%', display: tab === id ? 'block' : 'none' }}>
      {centered && isDesktop
        ? <div style={{ height: '100%', maxWidth: 1100, margin: '0 auto' }}>{node}</div>
        : node}
    </div>
  )

  return (
    <div ref={shellRef} className="team-shell" style={{
      height: '100dvh', display: 'flex', flexDirection: isDesktop ? 'row' : 'column',
      background: 'var(--tm-bg)', color: 'var(--tm-text)', overflow: 'hidden', overscrollBehavior: 'none',
      position: 'relative', top: 0,
      // viewport-fit=cover: falls die App unter der Statusbar beginnt, hält
      // das Padding den Inhalt frei (0 bei opaker Statusbar — harmlos)
      paddingTop: 'env(safe-area-inset-top)',
    }}>
      {updating && <div className="tm-update-stripe" aria-hidden="true" />}
      {linkSheet && (
        <div role="dialog" aria-label="Link" style={{ position: 'fixed', inset: 0, zIndex: 11000, display: 'flex', flexDirection: 'column', background: 'var(--tm-bg, #F3F4F6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 'calc(env(safe-area-inset-top) + 8px) 10px 8px', background: 'var(--tm-glass)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '0.5px solid var(--tm-line)' }}>
            <button onClick={() => { haptic(); setLinkSheet(null) }} style={{ border: 'none', background: 'var(--tm-surface2)', color: 'var(--tm-text)', borderRadius: 999, padding: '8px 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>‹ Zurück</button>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--tm-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'center' }}>
              {linkSheet.title || linkSheet.url.replace(/^https?:\/\//, '')}
            </span>
            <button onClick={() => window.open(linkSheet.url, '_blank', 'noopener')} title="Im Browser öffnen" style={{ border: 'none', background: 'var(--tm-surface2)', color: 'var(--tm-text)', borderRadius: 999, padding: '8px 12px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>↗</button>
          </div>
          <iframe src={linkSheet.url} title={linkSheet.title || 'Link'} style={{ flex: 1, border: 'none', width: '100%', background: '#fff' }} />
        </div>
      )}
      {syncing && <div className="tm-loadbar" aria-hidden="true" />}
      {isDesktop && sidebar}

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {!navHidden && header}
        {tab === 'inbox' && role === 'team' && !navHidden && segmented}
        {offlineBar}

        {/* Content */}
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }} onScrollCapture={onContentScroll}>
          {wrap('heute', <HeutePanel role={role} visible={tab === 'heute'} onCount={setHeuteCount} />, true)}
          {/* §277 Inbox = Gäste-Chat + Intern in EINEM Reiter, beide dauerhaft
              gemountet (Polling/Deep-Links), per Segment umgeschaltet */}
          {wrap('inbox',
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              {role === 'team' && (
                <div style={{ flex: 1, minHeight: 0, display: seg === 'gaeste' ? 'block' : 'none' }}>
                  <ChatPanel variant="app" team userId={userId} initialConvId={initialConvId} onMobileThread={setChatThread} onUnread={setGuestUnread} />
                </div>
              )}
              <div style={{ flex: 1, minHeight: 0, display: seg === 'intern' || role !== 'team' ? 'block' : 'none' }}>
                <InternPanel userId={userId} onUnread={setInternUnread} onMobileThread={setInternThread} initialChatId={initialInternChatId ?? null} />
              </div>
            </div>
          )}
          {role === 'team' && wrap('offen',
            <OffenPanel visible={tab === 'offen'} onCount={setOffenCount} />, true
          )}
          {/* Pascal 9.9.: Aufgaben/Kalender/Mehr bleiben gemountet — Reiterwechsel ohne Nachladen */}
          {wrap('aufgaben',
            <TasksPanel role={role} userId={userId} focusTaskId={taskFocus} onFocusConsumed={() => setTaskFocus(null)} />, true
          )}
          {wrap('kalender', <CalendarPanel />, true)}
          {wrap('einstellungen', <SettingsPanel role={role} />, true)}

          {/* §282.2 Progressive Unschärfe: Inhalt verschwimmt weich in die Tab-Leiste */}
          {!isDesktop && !navHidden && <div aria-hidden="true" className="tm-fade-bottom" style={{ height: 'calc(var(--tm-nav-pad, 92px) + 8px)' }} />}
          {/* Schwebende Tab-Leiste — im offenen Thread (mobil) ausgeblendet */}
          {!isDesktop && !navHidden && floatingNav}

          {toast && (
            <div className="tm-toast" role="status" style={{
              position: 'absolute', left: '50%', zIndex: 60,
              bottom: navHidden || isDesktop ? 'calc(20px + env(safe-area-inset-bottom))' : 'calc(var(--tm-nav-pad) + 6px)',
              background: 'var(--tm-text)', color: 'var(--tm-bg)', fontSize: 13, fontWeight: 600,
              borderRadius: 999, padding: '10px 16px', boxShadow: 'var(--tm-shadow-float)',
              whiteSpace: 'nowrap', maxWidth: 'calc(100% - 32px)', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{toast}</div>
          )}
        </div>
      </div>

      {searchOpen && (
        <SearchOverlay role={role} isDesktop={isDesktop} onClose={() => setSearchOpen(false)} onOpen={openHit} />
      )}
      {/* offenCount wird bis zum Heute-Tab (Baustein 2) nicht angezeigt */}
      <span hidden>{offenCount}</span>
    </div>
  )
}
