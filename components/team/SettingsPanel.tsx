'use client'

/**
 * ⚙️ Einstellungen der Team-App — bündelt die vorher doppelt verteilten
 * Push-Einstellungen (Glocke im Gäste-Chat + Toggle-Zeile im Intern-Tab)
 * an EINEM Ort, im iOS-Settings-Look.
 *
 * Zwei Ebenen, bewusst getrennt erklärt:
 *  - „Auf diesem Gerät": die Push-Subscription DIESES Geräts (Browser-API)
 *  - Kategorien (Gäste / Intern): Nutzer-Präferenz in profiles — gilt für
 *    ALLE Geräte des Nutzers (Server filtert beim Senden)
 */
import { useEffect, useState } from 'react'
import { QsArchive } from '@/components/team/QsPanel'
import ScoreTrends from '@/components/team/ScoreTrends'

const HAIR = 'inset 0 -0.5px 0 rgba(60,60,67,0.15)'

function Switch({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      aria-pressed={on}
      style={{
        width: 51, height: 31, borderRadius: 16, border: 'none', padding: 2, flexShrink: 0,
        background: on ? '#34C759' : 'rgba(120,120,128,0.18)',
        opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer',
        transition: 'background 0.2s ease', display: 'flex',
        justifyContent: on ? 'flex-end' : 'flex-start', alignItems: 'center',
      }}
    >
      <span style={{ width: 27, height: 27, borderRadius: '50%', background: '#fff', boxShadow: '0 2px 5px rgba(0,0,0,0.22)' }} />
    </button>
  )
}

function Row({ title, subtitle, last, children }: {
  title: string; subtitle?: string; last?: boolean; children: React.ReactNode
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px',
      boxShadow: last ? 'none' : HAIR, background: '#fff',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#1A1814' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: '#8A8578', marginTop: 1, lineHeight: 1.4 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  )
}

export default function SettingsPanel({ role }: { role: 'team' | 'provider' }) {
  const [pushState, setPushState] = useState<'unknown' | 'off' | 'on' | 'unsupported'>('unknown')
  const [busy, setBusy] = useState(false)
  const [prefs, setPrefs] = useState<{ guestChats: boolean; teamChats: boolean; bookings: boolean } | null>(null)
  const [showQs, setShowQs] = useState(false)
  const [showTrends, setShowTrends] = useState(false)
  // ☎️ Bereitschaft (§175) — nur Admins (GET liefert sonst 403 → Sektion bleibt aus)
  const [oncallPeople, setOncallPeople] = useState<{ id: string; name: string; role: string }[] | null>(null)
  const [oncallSel, setOncallSel] = useState<string[]>([])

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { setPushState('unsupported'); return }
    navigator.serviceWorker.register('/sw.js').then(async (reg) => {
      const sub = await reg.pushManager.getSubscription()
      setPushState(sub ? 'on' : 'off')
    }).catch(() => setPushState('unsupported'))
    fetch('/api/push/prefs', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setPrefs({ guestChats: d.guestChats, teamChats: d.teamChats, bookings: d.bookings !== false }) })
      .catch(() => {})
    fetch('/api/admin/oncall', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setOncallPeople(d.people ?? []); setOncallSel(d.selected ?? []) } })
      .catch(() => {})
  }, [])

  async function toggleOncall(id: string) {
    const next = oncallSel.includes(id) ? oncallSel.filter((x) => x !== id) : [...oncallSel, id]
    setOncallSel(next)
    await fetch('/api/admin/oncall', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: next }),
    }).catch(() => {})
  }

  async function toggleDevice() {
    if (pushState === 'unsupported' || busy) return
    setBusy(true)
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
    } finally { setBusy(false) }
  }

  async function togglePref(key: 'guestChats' | 'teamChats' | 'bookings') {
    if (!prefs) return
    const next = { ...prefs, [key]: !prefs[key] }
    setPrefs(next)
    await fetch('/api/push/prefs', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: next[key] }),
    }).catch(() => {})
    // App-Badge-Berechnung der Shell sofort nachziehen
    window.dispatchEvent(new Event('trimosa-prefs-changed'))
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#F2F2F7', WebkitOverflowScrolling: 'touch' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '18px 16px 40px' }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#1A1814', margin: '4px 2px 18px' }}>Einstellungen</h1>

        {role === 'team' && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#8A8578', letterSpacing: '0.05em', margin: '0 16px 7px' }}>BEREICHE</div>
            <div style={{ borderRadius: 12, overflow: 'hidden', boxShadow: '0 0 0 0.5px rgba(60,60,67,0.1)', marginBottom: 22 }}>
              <button onClick={() => setShowTrends(true)} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                background: '#fff', border: 'none', cursor: 'pointer', textAlign: 'left',
                boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.12)',
              }}>
                <span style={{ fontSize: 19 }}>📈</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: '#1A1814' }}>Entwicklung</span>
                  <span style={{ display: 'block', fontSize: 12, color: '#8A8578', marginTop: 1 }}>Bewertungs-Scores im Zeitverlauf — gesamt & je Plattform</span>
                </span>
                <span style={{ color: '#C7C7CC', fontSize: 16 }}>›</span>
              </button>
              <button onClick={() => setShowQs(true)} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                background: '#fff', border: 'none', cursor: 'pointer', textAlign: 'left',
              }}>
                <span style={{ fontSize: 19 }}>🧾</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: '#1A1814' }}>Qualitätssicherung</span>
                  <span style={{ display: 'block', fontSize: 12, color: '#8A8578', marginTop: 1 }}>Protokolle & Historie je Wohnung</span>
                </span>
                <span style={{ color: '#C7C7CC', fontSize: 16 }}>›</span>
              </button>
            </div>
          </>
        )}

        <div style={{ fontSize: 12, fontWeight: 700, color: '#8A8578', letterSpacing: '0.05em', margin: '0 16px 7px' }}>MITTEILUNGEN</div>
        <div style={{ borderRadius: 12, overflow: 'hidden', boxShadow: '0 0 0 0.5px rgba(60,60,67,0.1)' }}>
          <Row
            title="Push auf diesem Gerät"
            subtitle={pushState === 'unsupported'
              ? 'Auf diesem Gerät nicht verfügbar'
              : 'Mitteilungen auf dieses Gerät erhalten'}
          >
            {pushState === 'unknown'
              ? <span style={{ fontSize: 13, color: '#B0AA9C' }}>…</span>
              : <Switch on={pushState === 'on'} disabled={pushState === 'unsupported' || busy} onChange={toggleDevice} />}
          </Row>
          {role === 'team' && (
            <Row title="Neue Buchungen" subtitle="Buchungen & Anfragen aus allen Kanälen">
              <Switch on={prefs?.bookings ?? true} disabled={!prefs} onChange={() => togglePref('bookings')} />
            </Row>
          )}
          {role === 'team' && (
            <Row title="Gäste-Chats" subtitle="Neue Nachrichten von Gästen">
              <Switch on={prefs?.guestChats ?? true} disabled={!prefs} onChange={() => togglePref('guestChats')} />
            </Row>
          )}
          <Row title="Interne Gruppen" subtitle="Nachrichten aus Team-Gruppen" last>
            <Switch on={prefs?.teamChats ?? true} disabled={!prefs} onChange={() => togglePref('teamChats')} />
          </Row>
        </div>
        <div style={{ fontSize: 12, color: '#8A8578', lineHeight: 1.55, margin: '9px 16px 0' }}>
          Die Kategorien gelten für alle deine Geräte. Aufgaben-Zuweisungen und wichtige Systemmeldungen werden immer zugestellt.
        </div>
        {pushState === 'unsupported' && (
          <div style={{
            margin: '14px 0 0', padding: '11px 14px', borderRadius: 12,
            background: '#FEF9EC', border: '1px solid #F1E4BD', fontSize: 12.5, lineHeight: 1.55, color: '#6B5D33',
          }}>
            💡 Auf dem iPhone: <strong>trimosa.de/team</strong> in Safari öffnen → Teilen → „Zum Home-Bildschirm" — in der installierten App lässt sich Push hier aktivieren.
          </div>
        )}

        {/* ☎️ Bereitschaft (§175) — nur Admins sichtbar */}
        {oncallPeople && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#8A8578', letterSpacing: '0.05em', margin: '24px 16px 7px' }}>☎️ BEREITSCHAFT (TELEFON-ASSISTENTIN)</div>
            <div style={{ borderRadius: 12, overflow: 'hidden', boxShadow: '0 0 0 0.5px rgba(60,60,67,0.1)' }}>
              {oncallPeople.map((p, i) => (
                <Row key={p.id} title={p.name} subtitle={p.role} last={i === oncallPeople.length - 1}>
                  <Switch on={oncallSel.includes(p.id)} onChange={() => toggleOncall(p.id)} />
                </Row>
              ))}
            </div>
            <div style={{ fontSize: 12, color: '#8A8578', lineHeight: 1.55, margin: '9px 16px 0' }}>
              Ausgewählte Personen sehen akute Anruf-Meldungen ganz oben im Aufgaben-Tab und bekommen die Anruf-Pushes. <strong>Niemand ausgewählt = das ganze Team.</strong>
            </div>
          </>
        )}
      </div>
      {showQs && <QsArchive onClose={() => setShowQs(false)} />}
      {showTrends && <ScoreTrends onClose={() => setShowTrends(false)} />}
    </div>
  )
}
