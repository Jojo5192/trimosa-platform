'use client'

/**
 * Die Team-App-Shell: Bottom-Tabs wie WhatsApp/iOS.
 *  team (admin|host|staff): 💬 Chat · ✅ Aufgaben · 📅 Kalender
 *  provider (Dienstleister): ✅ Aufgaben · 📅 Kalender (KEIN Chat)
 * ChatPanel bleibt gemountet (Polling/State), die anderen Tabs werden
 * per display umgeschaltet — Tab-Wechsel fühlt sich instant an.
 */
import { useState } from 'react'
import ChatPanel from '@/components/chat/ChatPanel'
import TasksPanel from '@/components/team/TasksPanel'

type Tab = 'chat' | 'aufgaben' | 'kalender'

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'chat', icon: '💬', label: 'Chat' },
  { id: 'aufgaben', icon: '✅', label: 'Aufgaben' },
  { id: 'kalender', icon: '📅', label: 'Kalender' },
]

export default function TeamShell({ userId, role, initialConvId, initialTab }: {
  userId: string
  role: 'team' | 'provider'
  initialConvId: string | null
  initialTab?: string
}) {
  const tabs = role === 'provider' ? TABS.filter((t) => t.id !== 'chat') : TABS
  const fallback: Tab = role === 'provider' ? 'aufgaben' : 'chat'
  const [tab, setTab] = useState<Tab>(
    tabs.some((t) => t.id === initialTab) ? (initialTab as Tab) : fallback
  )

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>
      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {role === 'team' && (
          <div style={{ height: '100%', display: tab === 'chat' ? 'block' : 'none' }}>
            <ChatPanel variant="app" team userId={userId} initialConvId={initialConvId} />
          </div>
        )}
        {tab === 'aufgaben' && (
          <TasksPanel role={role} userId={userId} />
        )}
        {tab === 'kalender' && (
          <div style={{
            height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', background: '#F7F7F8', padding: 24, textAlign: 'center',
          }}>
            <p style={{ fontSize: 44, margin: '0 0 10px' }}>📅</p>
            <p style={{ fontSize: 16, fontWeight: 700, color: '#111', margin: '0 0 6px' }}>Kalender kommt in Kürze</p>
            <p style={{ fontSize: 13.5, color: '#8E8E93', margin: 0, maxWidth: 300, lineHeight: 1.5 }}>
              Hier erscheinen An- und Abreisen aller Wohnungen sowie fällige Aufgaben.
            </p>
          </div>
        )}
      </div>

      {/* Bottom-Tab-Bar */}
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
              <span style={{ fontSize: 22, filter: active ? 'none' : 'grayscale(1) opacity(0.55)' }}>{t.icon}</span>
              <span style={{
                fontSize: 10, fontWeight: active ? 700 : 500,
                color: active ? 'var(--gold, #AE8D2D)' : '#8E8E93',
              }}>{t.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
