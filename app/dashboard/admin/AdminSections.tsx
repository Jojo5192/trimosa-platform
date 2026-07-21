'use client'

/**
 * 🗂 Aufgeräumter Admin-Bereich (§133): Die neun Einstellungs-Karten sind
 * in thematische REITER gruppiert, jeder Reiter erklärt oben, wer die
 * betreffenden Bereiche sieht bzw. auf wen die Einstellungen wirken.
 * Reiter-Wechsel per display-Umschaltung — die Karten bleiben gemountet
 * (geladene Daten gehen nicht verloren).
 */
import { useState, type ReactNode } from 'react'
import AdminUsersClient from './AdminUsersClient'
import KnowledgeAdmin from './KnowledgeAdmin'
import PromptStudio from './PromptStudio'
import TaskPermissionsCard from './TaskPermissionsCard'
import QsSettingsCard from './QsSettingsCard'
import QsTemplateEditor from './QsTemplateEditor'
import CalendarVisibilityCard from './CalendarVisibilityCard'
import CleaningCard from './CleaningCard'
import LocksCard from './LocksCard'

type TabId = 'team' | 'betrieb' | 'zugang' | 'ki' | 'sichtbarkeit'

const TABS: { id: TabId; label: string }[] = [
  { id: 'team', label: '👥 Team & Rechte' },
  { id: 'betrieb', label: '🧹 Betrieb & QS' },
  { id: 'zugang', label: '🔑 Türcodes' },
  { id: 'ki', label: '🤖 KI' },
  { id: 'sichtbarkeit', label: '👁 Wer sieht was' },
]

/** Gelber Hinweis über jedem Reiter: Sichtbarkeit + Wirkung der Einstellungen */
function Scope({ children }: { children: ReactNode }) {
  return (
    <div style={{
      padding: '10px 14px', borderRadius: 12, background: '#FAF5E4',
      border: '1px solid #EADFB8', fontSize: 12.5, lineHeight: 1.6, color: '#6B5D33',
    }}>
      👁 {children}
    </div>
  )
}

const ROLLEN: { rolle: string; sieht: string }[] = [
  { rolle: '🧳 Gast', sieht: 'Website (Suche, Buchung, eigener Gast-Bereich, Chat mit uns), eigene digitale Gästemappe (inkl. Türcode ab X Tagen vor Anreise). KEIN Dashboard, KEINE Team-App.' },
  { rolle: '🛠 Dienstleister (z. B. Patrick, Tip-Top)', sieht: 'Team-App mit Intern-Chat, eigenen Aufgaben und Kalender OHNE Gastnamen (nur Belegt-Balken, Personenzahl, Service-PINs, Reinigungsplaner der eigenen Wohnungen). KEIN Gäste-Chat, KEINE Umsätze.' },
  { rolle: '👩‍💼 Mitarbeiter (z. B. Vanessa)', sieht: 'Team-App komplett: Gäste-Chat, Intern-Chat, Aufgaben (Rechte unten einstellbar), Kalender MIT Gastnamen, QS-Protokolle, Service-PINs. KEINE Kosten/Umsätze, KEIN Dashboard/Admin.' },
  { rolle: '🏠 Gastgeber (Johannes, Pascal, Dominik)', sieht: 'Alles der Mitarbeiter PLUS: Dashboard (Inserate, Buchungen, Gästemappen-Builder), Reinigungs-KOSTEN im Kalender, Buchungs-Pushes mit Betrag.' },
  { rolle: '🛡 Admin (Johannes, Pascal, Dominik)', sieht: 'Alles PLUS diesen Admin-Bereich: Rollen vergeben, Rechte, Reinigungs-Sätze, Türcodes, QS-Verwaltung, KI-Einstellungen, 🤖-Aufgaben-Vorschläge.' },
]

export default function AdminSections() {
  const [tab, setTab] = useState<TabId>('team')

  const section = (id: TabId, scope: ReactNode, children: ReactNode) => (
    <div style={{ display: tab === id ? 'block' : 'none' }}>
      <div style={{ marginTop: 20 }}><Scope>{scope}</Scope></div>
      {children}
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 4 }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flexShrink: 0, padding: '7px 14px', borderRadius: 999, cursor: 'pointer',
            fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap',
            border: tab === t.id ? '1px solid transparent' : '1px solid #E0DDD6',
            background: tab === t.id ? 'linear-gradient(135deg, var(--gold), var(--gold-dark))' : '#fff',
            color: tab === t.id ? '#fff' : '#6B6455',
          }}>{t.label}</button>
        ))}
      </div>

      {section('team',
        <>Sichtbar: <strong>nur Admins</strong>. Wirkt auf: alle Rollen — hier werden
        Admins, Gastgeber, Mitarbeiter und Dienstleister ernannt, Aufgaben-Rechte
        vergeben und festgelegt, wer welche Wohnungen im Kalender sieht.</>,
        <>
          <AdminUsersClient />
          <TaskPermissionsCard />
          <CalendarVisibilityCard />
        </>)}

      {section('betrieb',
        <>Sichtbar: <strong>nur Admins</strong>. Wirkt auf: den Reinigungsplaner im
        Team-Kalender (alle Rollen — Kosten-Sätze sehen nur Admins/Gastgeber) und
        die QS-Termine/Checklisten der zuständigen Person.</>,
        <>
          <CleaningCard />
          <QsSettingsCard />
          <QsTemplateEditor />
        </>)}

      {section('zugang',
        <>Sichtbar: <strong>nur Admins</strong>. Wirkt auf: die Gäste (Türcode in der
        Gästemappe) und das Team inkl. Dienstleister (Service-PINs über dem
        Team-Kalender).</>,
        <LocksCard />)}

      {section('ki',
        <>Sichtbar: <strong>nur Admins</strong>. Wirkt auf: die ✨-Antwortvorschläge
        im Gäste-Chat (Wissensbasis aus der Chat-Historie) und alle KI-Texte
        (Prompt-Studio).</>,
        <>
          <KnowledgeAdmin />
          <PromptStudio />
        </>)}

      {section('sichtbarkeit',
        <>Überblick, welche Rolle was sieht — die Rollen selbst vergibst du im
        Reiter „👥 Team &amp; Rechte". Es gilt: die höchste Rolle gewinnt.</>,
        <div style={{ background: '#fff', borderRadius: 16, padding: '6px 22px', marginTop: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          {ROLLEN.map((r) => (
            <div key={r.rolle} style={{ padding: '14px 0', borderBottom: '1px solid #F0EDE5' }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: '#111', marginBottom: 4 }}>{r.rolle}</div>
              <div style={{ fontSize: 12.5, color: '#666', lineHeight: 1.6 }}>{r.sieht}</div>
            </div>
          ))}
        </div>)}
    </div>
  )
}
