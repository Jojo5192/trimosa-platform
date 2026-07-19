'use client'

/**
 * Die Team-App-Shell: Bottom-Tabs wie WhatsApp/iOS.
 *  team (admin|host|staff): 💬 Chat (Gäste) · 💼 Intern · ✅ Aufgaben · 📅 Kalender
 *  provider (Dienstleister): 💼 Intern · ✅ Aufgaben · 📅 Kalender (KEIN Gäste-Chat)
 * ChatPanel/InternPanel bleiben gemountet (Polling/State), die anderen Tabs
 * werden per display umgeschaltet — Tab-Wechsel fühlt sich instant an.
 */
import { useEffect, useState } from 'react'
import ChatPanel from '@/components/chat/ChatPanel'
import InternPanel from '@/components/team/InternPanel'
import TasksPanel from '@/components/team/TasksPanel'
import CalendarPanel from '@/components/team/CalendarPanel'
import SettingsPanel from '@/components/team/SettingsPanel'

type Tab = 'chat' | 'intern' | 'aufgaben' | 'kalender' | 'einstellungen'

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'chat', icon: '💬', label: 'Chat' },
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
  const tabs = role === 'provider' ? TABS.filter((t) => t.id !== 'chat') : TABS
  const fallback: Tab = role === 'provider' ? 'intern' : 'chat'
  const [tab, setTab] = useState<Tab>(
    tabs.some((t) => t.id === initialTab) ? (initialTab as Tab) : fallback
  )
  const [internUnread, setInternUnread] = useState(0)
  // Mobil in einem Thread: Tab-Bar versteckt (WhatsApp-Verhalten, §98-Feedback)
  const [chatThread, setChatThread] = useState(false)
  const [internThread, setInternThread] = useState(false)
  const navHidden = (tab === 'chat' && chatThread) || (tab === 'intern' && internThread)

  // Tastatur-Pinning: iOS scrollt bei offener Tastatur das ganze Fenster —
  // der Header rutscht oben raus und „springt" nach Sekunden zurück. Fix:
  // Shell-Höhe an den sichtbaren Viewport heften + Fenster-Scroll auf 0 halten.
  const [vvHeight, setVvHeight] = useState<number | null>(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const sync = () => {
      const kb = window.innerHeight - vv.height
      if (kb > 100) {
        setVvHeight(Math.round(vv.height))
        window.scrollTo(0, 0)
      } else {
        setVvHeight(null)
      }
    }
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)
    window.addEventListener('scroll', sync)
    return () => {
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
      window.removeEventListener('scroll', sync)
    }
  }, [])

  // Service Worker früh registrieren (Push-Empfang) — die Einstellungen dazu
  // liegen im ⚙️-Tab; so bekommen auch Dienstleister ohne Chat-Tab Push
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])

  return (
    <div className="team-shell" style={{
      height: vvHeight ?? '100dvh', display: 'flex', flexDirection: 'column',
      background: '#fff', overflow: 'hidden', overscrollBehavior: 'none',
      // viewport-fit=cover zieht die App unter die Statusbar — Inhalt darunter beginnen
      paddingTop: 'env(safe-area-inset-top)',
    }}>
      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {role === 'team' && (
          <div style={{ height: '100%', display: tab === 'chat' ? 'block' : 'none' }}>
            <ChatPanel variant="app" team userId={userId} initialConvId={initialConvId} onMobileThread={setChatThread} />
          </div>
        )}
        <div style={{ height: '100%', display: tab === 'intern' ? 'block' : 'none' }}>
          <InternPanel userId={userId} onUnread={setInternUnread} onMobileThread={setInternThread} />
        </div>
        {tab === 'aufgaben' && (
          <TasksPanel role={role} userId={userId} />
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
