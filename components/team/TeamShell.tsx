'use client'

/**
 * Die Team-App-Shell: Bottom-Tabs wie WhatsApp/iOS.
 *  team (admin|host|staff): 💬 Chat (Gäste) · 💼 Intern · ✅ Aufgaben · 📅 Kalender
 *  provider (Dienstleister): 💼 Intern · ✅ Aufgaben · 📅 Kalender (KEIN Gäste-Chat)
 * ChatPanel/InternPanel bleiben gemountet (Polling/State), die anderen Tabs
 * werden per display umgeschaltet — Tab-Wechsel fühlt sich instant an.
 */
import { useEffect, useRef, useState } from 'react'
import ChatPanel from '@/components/chat/ChatPanel'
import OffenPanel from '@/components/team/OffenPanel'
import InternPanel from '@/components/team/InternPanel'
import TasksPanel from '@/components/team/TasksPanel'
import CalendarPanel from '@/components/team/CalendarPanel'
import SettingsPanel from '@/components/team/SettingsPanel'

type Tab = 'chat' | 'offen' | 'intern' | 'aufgaben' | 'kalender' | 'einstellungen'

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'chat', icon: '💬', label: 'Chat' },
  { id: 'offen', icon: '📥', label: 'Offen' },
  { id: 'intern', icon: '💼', label: 'Intern' },
  { id: 'aufgaben', icon: '✅', label: 'Aufgaben' },
  { id: 'kalender', icon: '📅', label: 'Kalender' },
  { id: 'einstellungen', icon: '⚙️', label: 'Mehr' },
]

export default function TeamShell({ userId, role, initialConvId, initialTab }: {
  userId: string
  role: 'team' | 'provider'
  initialConvId: string | null
  initialTab?: string
}) {
  const tabs = role === 'provider' ? TABS.filter((t) => t.id !== 'chat' && t.id !== 'offen') : TABS
  const fallback: Tab = role === 'provider' ? 'intern' : 'chat'
  const [tab, setTab] = useState<Tab>(
    tabs.some((t) => t.id === initialTab) ? (initialTab as Tab) : fallback
  )
  const [internUnread, setInternUnread] = useState(0)
  const [guestUnread, setGuestUnread] = useState(0)
  const [offenCount, setOffenCount] = useState(0)
  // Mobil in einem Thread: Tab-Bar versteckt (WhatsApp-Verhalten, §98-Feedback)
  const [chatThread, setChatThread] = useState(false)
  const [internThread, setInternThread] = useState(false)
  const navHidden = (tab === 'chat' && chatThread) || (tab === 'intern' && internThread)

  // §162: Klick auf eine Aufgabe im Kalender → Aufgaben-Tab öffnen und die
  // Aufgabe fokussieren (Event aus CalendarPanel; TasksPanel ist nur bei
  // aktivem Tab gemountet, darum vermittelt die Shell per Prop)
  const [taskFocus, setTaskFocus] = useState<string | null>(null)
  useEffect(() => {
    const onOpenTask = (e: Event) => {
      const id = (e as CustomEvent<{ id: string | null }>).detail?.id ?? null
      setTaskFocus(id)
      setTab('aufgaben')
    }
    window.addEventListener('trimosa-open-task', onOpenTask)
    return () => window.removeEventListener('trimosa-open-task', onOpenTask)
  }, [])

  // App-Icon-Badge ZENTRAL (Pascal 19.7.): folgt den Push-Einstellungen —
  // Gäste stumm ⇒ nur Intern-Threads zählen (und umgekehrt). Zahlen = THREADS
  // (Gäste: ungelesen ODER unbeantwortet · Intern: ungelesen).
  const [badgePrefs, setBadgePrefs] = useState<{ guestChats: boolean; teamChats: boolean } | null>(null)
  useEffect(() => {
    const loadPrefs = () => {
      fetch('/api/push/prefs', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d) setBadgePrefs({ guestChats: d.guestChats !== false, teamChats: d.teamChats !== false }) })
        .catch(() => {})
    }
    loadPrefs()
    const onVis = () => { if (document.visibilityState === 'visible') loadPrefs() }
    window.addEventListener('trimosa-prefs-changed', loadPrefs)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('trimosa-prefs-changed', loadPrefs)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    const total = (badgePrefs?.guestChats !== false ? guestUnread : 0)
      + (badgePrefs?.teamChats !== false ? internUnread : 0)
    try {
      if (total > 0) nav.setAppBadge?.(total)?.catch(() => {})
      else nav.clearAppBadge?.()?.catch(() => {})
    } catch { /* Badging API nicht verfügbar */ }
  }, [guestUnread, internUnread, badgePrefs])

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
  // hart auf Weiß setzen (Gürtel + Hosenträger)
  useEffect(() => {
    const html = document.documentElement
    const prev = html.style.backgroundColor
    html.style.backgroundColor = '#ffffff'
    return () => { html.style.backgroundColor = prev }
  }, [])

  // Service Worker früh registrieren (Push-Empfang) — die Einstellungen dazu
  // liegen im ⚙️-Tab; so bekommen auch Dienstleister ohne Chat-Tab Push
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])

  return (
    <div ref={shellRef} className="team-shell" style={{
      height: '100dvh', display: 'flex', flexDirection: 'column',
      background: '#fff', overflow: 'hidden', overscrollBehavior: 'none',
      position: 'relative', top: 0,
      // viewport-fit=cover: falls die App unter der Statusbar beginnt, hält
      // das Padding den Inhalt frei (0 bei opaker Statusbar — harmlos)
      paddingTop: 'env(safe-area-inset-top)',
    }}>
      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {role === 'team' && (
          <div style={{ height: '100%', display: tab === 'chat' ? 'block' : 'none' }}>
            <ChatPanel variant="app" team userId={userId} initialConvId={initialConvId} onMobileThread={setChatThread} onUnread={setGuestUnread} />
          </div>
        )}
        {role === 'team' && (
          <div style={{ height: '100%', display: tab === 'offen' ? 'block' : 'none' }}>
            <OffenPanel visible={tab === 'offen'} onCount={setOffenCount} />
          </div>
        )}
        <div style={{ height: '100%', display: tab === 'intern' ? 'block' : 'none' }}>
          <InternPanel userId={userId} onUnread={setInternUnread} onMobileThread={setInternThread} />
        </div>
        {tab === 'aufgaben' && (
          <TasksPanel role={role} userId={userId} focusTaskId={taskFocus} onFocusConsumed={() => setTaskFocus(null)} />
        )}
        {tab === 'kalender' && <CalendarPanel />}
        {tab === 'einstellungen' && <SettingsPanel role={role} />}
      </div>

      {/* Bottom-Tab-Bar — im offenen Thread (mobil) ausgeblendet */}
      {!navHidden && (
      <nav style={{
        display: 'flex', flexShrink: 0,
        background: 'rgba(249,249,249,0.92)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
        boxShadow: 'inset 0 0.5px 0 rgba(60,60,67,0.2)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        {tabs.map((t) => {
          const active = tab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, border: 'none', background: 'none', cursor: 'pointer',
              padding: '7px 0 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            }}>
              <span style={{ position: 'relative', fontSize: 22, filter: active ? 'none' : 'grayscale(1) opacity(0.55)' }}>
                {t.icon}
                {t.id === 'intern' && internUnread > 0 && (
                  <span style={{
                    position: 'absolute', top: -3, right: -9, minWidth: 16, height: 16, borderRadius: 8,
                    background: '#DC2626', color: '#fff', fontSize: 9.5, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
                    filter: 'none',
                  }}>{internUnread > 9 ? '9+' : internUnread}</span>
                )}
                {t.id === 'offen' && offenCount > 0 && (
                  <span style={{
                    position: 'absolute', top: -3, right: -9, minWidth: 16, height: 16, borderRadius: 8,
                    background: 'linear-gradient(135deg, var(--gold, #AE8D2D), #8A7020)', color: '#fff',
                    fontSize: 9.5, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
                    filter: 'none',
                  }}>{offenCount > 9 ? '9+' : offenCount}</span>
                )}
              </span>
              <span style={{
                fontSize: 10, fontWeight: active ? 700 : 500,
                color: active ? 'var(--gold, #AE8D2D)' : '#8E8E93',
              }}>{t.label}</span>
            </button>
          )
        })}
      </nav>
      )}
    </div>
  )
}
