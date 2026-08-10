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
import WallboxPanel from '@/components/team/WallboxPanel'
import CallsPanel from '@/components/team/CallsPanel'
import BelegEinreichen from '@/components/team/BelegEinreichen'
import LocksPanel from '@/components/team/LocksPanel'
import CleaningDurations from '@/components/team/CleaningDurations'

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
  const [prefs, setPrefs] = useState<{ guestChats: boolean; teamChats: boolean; bookings: boolean; tasks: boolean; calls: boolean; buchhaltung: boolean; system: boolean } | null>(null)
  const [showQs, setShowQs] = useState(false)
  const [showTrends, setShowTrends] = useState(false)
  // ☎️ Bereitschaft (§175) — nur Admins (GET liefert sonst 403 → Sektion bleibt aus)
  const [oncallPeople, setOncallPeople] = useState<{ id: string; name: string; role: string }[] | null>(null)
  const [oncallSel, setOncallSel] = useState<string[]>([])
  // ⚡ Wallbox (§185) — nur Admins (probe liefert sonst 403 → Bereich + Toggles bleiben aus)
  const [showWallbox, setShowWallbox] = useState(false)
  const [showCalls, setShowCalls] = useState(false)
  const [showBeleg, setShowBeleg] = useState(false)
  // 🔑 Türschlösser (§253) — Admins/Hosts/Staff (probe 403 → Eintrag bleibt aus)
  const [locksOk, setLocksOk] = useState(false)
  const [showLocks, setShowLocks] = useState(false)
  // ⏱ Reinigungs-Dauer (§255) — NUR Chefs (is_admin; probe 403 → aus)
  const [durOk, setDurOk] = useState(false)
  const [showDur, setShowDur] = useState(false)
  const [wb, setWb] = useState<{ pushStart: boolean; pushEnd: boolean } | null>(null)
  // 🧾 Beleg-Inbox (§238) — nur Admins/Gastgeber (probe 403 → Eintrag bleibt aus)
  const [belegeOk, setBelegeOk] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { setPushState('unsupported'); return }
    navigator.serviceWorker.register('/sw.js').then(async (reg) => {
      const sub = await reg.pushManager.getSubscription()
      setPushState(sub ? 'on' : 'off')
    }).catch(() => setPushState('unsupported'))
    fetch('/api/push/prefs', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setPrefs({ guestChats: d.guestChats !== false, teamChats: d.teamChats !== false, bookings: d.bookings !== false, tasks: d.tasks !== false, calls: d.calls !== false, buchhaltung: d.buchhaltung !== false, system: d.system !== false }) })
      .catch(() => {})
    fetch('/api/admin/oncall', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setOncallPeople(d.people ?? []); setOncallSel(d.selected ?? []) } })
      .catch(() => {})
    fetch('/api/wallbox?probe=1', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.settings) setWb({ pushStart: d.settings.pushStart, pushEnd: d.settings.pushEnd }) })
      .catch(() => {})
    fetch('/api/belege?probe=1', { cache: 'no-store' })
      .then((r) => { if (r.ok) setBelegeOk(true) })
      .catch(() => {})
    fetch('/api/locks/control?probe=1', { cache: 'no-store' })
      .then((r) => { if (r.ok) setLocksOk(true) })
      .catch(() => {})
    fetch('/api/cleaning/durations?probe=1', { cache: 'no-store' })
      .then((r) => { if (r.ok) setDurOk(true) })
      .catch(() => {})
  }, [])

  async function toggleWallboxPush(key: 'pushStart' | 'pushEnd') {
    if (!wb) return
    const next = { ...wb, [key]: !wb[key] }
    setWb(next)
    await fetch('/api/wallbox', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: next[key] }),
    }).catch(() => {})
  }

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

  async function togglePref(key: 'guestChats' | 'teamChats' | 'bookings' | 'tasks' | 'calls' | 'buchhaltung' | 'system') {
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
              <button onClick={() => setShowCalls(true)} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                background: '#fff', border: 'none', cursor: 'pointer', textAlign: 'left',
                boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.12)',
              }}>
                <span style={{ fontSize: 19 }}>☎️</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: '#1A1814' }}>Telefonate</span>
                  <span style={{ display: 'block', fontSize: 12, color: '#8A8578', marginTop: 1 }}>Alle Anrufe der KI-Assistentin — Transkript lesen & abhören</span>
                </span>
                <span style={{ color: '#C7C7CC', fontSize: 16 }}>›</span>
              </button>
              {locksOk && (
                <button onClick={() => setShowLocks(true)} style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                  background: '#fff', border: 'none', cursor: 'pointer', textAlign: 'left',
                  boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.12)',
                }}>
                  <span style={{ fontSize: 19 }}>🔑</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: '#1A1814' }}>Türschlösser</span>
                    <span style={{ display: 'block', fontSize: 12, color: '#8A8578', marginTop: 1 }}>Fernöffnen & Codes einsehen je Wohnung</span>
                  </span>
                  <span style={{ color: '#C7C7CC', fontSize: 16 }}>›</span>
                </button>
              )}
              {durOk && (
                <button onClick={() => setShowDur(true)} style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                  background: '#fff', border: 'none', cursor: 'pointer', textAlign: 'left',
                  boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.12)',
                }}>
                  <span style={{ fontSize: 19 }}>⏱</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: '#1A1814' }}>Reinigungs-Dauer</span>
                    <span style={{ display: 'block', fontSize: 12, color: '#8A8578', marginTop: 1 }}>Wie lange Reinigungen dauern (nur Chefs)</span>
                  </span>
                  <span style={{ color: '#C7C7CC', fontSize: 16 }}>›</span>
                </button>
              )}
              <button onClick={() => setShowQs(true)} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                background: '#fff', border: 'none', cursor: 'pointer', textAlign: 'left',
                boxShadow: wb ? 'inset 0 -0.5px 0 rgba(60,60,67,0.12)' : 'none',
              }}>
                <span style={{ fontSize: 19 }}>🧾</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: '#1A1814' }}>Qualitätssicherung</span>
                  <span style={{ display: 'block', fontSize: 12, color: '#8A8578', marginTop: 1 }}>Protokolle & Historie je Wohnung</span>
                </span>
                <span style={{ color: '#C7C7CC', fontSize: 16 }}>›</span>
              </button>
              {belegeOk && (
                <button onClick={() => { window.location.href = '/buchhaltung' }} style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                  background: '#fff', border: 'none', cursor: 'pointer', textAlign: 'left',
                  boxShadow: wb ? 'inset 0 -0.5px 0 rgba(60,60,67,0.12)' : 'none',
                }}>
                  <span style={{ fontSize: 19 }}>💶</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: '#1A1814' }}>Buchhaltung</span>
                    <span style={{ display: 'block', fontSize: 12, color: '#8A8578', marginTop: 1 }}>Eigene Vollbild-Oberfläche — Belege, Zahlungen, Verbuchen (nur Admins)</span>
                  </span>
                  <span style={{ color: '#C7C7CC', fontSize: 16 }}>›</span>
                </button>
              )}
              {wb && (
                <button onClick={() => setShowWallbox(true)} style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                  background: '#fff', border: 'none', cursor: 'pointer', textAlign: 'left',
                  boxShadow: belegeOk ? 'inset 0 -0.5px 0 rgba(60,60,67,0.12)' : 'none',
                }}>
                  <span style={{ fontSize: 19 }}>⚡</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: '#1A1814' }}>Wallbox</span>
                    <span style={{ display: 'block', fontSize: 12, color: '#8A8578', marginTop: 1 }}>Ladehistorie — kWh, Umsatz & Gewinn</span>
                  </span>
                  <span style={{ color: '#C7C7CC', fontSize: 16 }}>›</span>
                </button>
              )}
              {belegeOk && (
                <button onClick={() => { window.location.href = '/api/tv-bridge/sso' }} style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                  background: '#fff', border: 'none', cursor: 'pointer', textAlign: 'left',
                }}>
                  <span style={{ fontSize: 19 }}>📺</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: '#1A1814' }}>TV-Steuerung</span>
                    <span style={{ display: 'block', fontSize: 12, color: '#8A8578', marginTop: 1 }}>Ferienwohnungs-TVs — Inhalte, Screensaver, Boxen (ohne 2. Login)</span>
                  </span>
                  <span style={{ color: '#C7C7CC', fontSize: 16 }}>›</span>
                </button>
              )}
            </div>
          </>
        )}

        {/* §243ad: Beleg einreichen — für ALLE Rollen inkl. Dienstleister
            (Upload + Ort + Notiz; keinerlei Finanz-Einblick) */}
        <div style={{ fontSize: 12, fontWeight: 700, color: '#8A8578', letterSpacing: '0.05em', margin: '0 16px 7px' }}>BELEGE</div>
        <div style={{ borderRadius: 12, overflow: 'hidden', boxShadow: '0 0 0 0.5px rgba(60,60,67,0.1)', marginBottom: 22 }}>
          <button onClick={() => setShowBeleg(true)} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
            background: '#fff', border: 'none', cursor: 'pointer', textAlign: 'left',
          }}>
            <span style={{ fontSize: 19 }}>🧾</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: '#1A1814' }}>Beleg einreichen</span>
              <span style={{ display: 'block', fontSize: 12, color: '#8A8578', marginTop: 1 }}>Rechnung oder Kassenbon fotografieren — die Buchhaltung übernimmt</span>
            </span>
            <span style={{ color: '#C7C7CC', fontSize: 16 }}>›</span>
          </button>
        </div>

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
          <Row title="Interne Gruppen" subtitle="Nachrichten aus Team-Gruppen" last={false}>
            <Switch on={prefs?.teamChats ?? true} disabled={!prefs} onChange={() => togglePref('teamChats')} />
          </Row>
          {role === 'team' && (
            <Row title="✅ Aufgaben & QS" subtitle="Zuweisungen, Kommentare, Vorschläge, QS-Termine">
              <Switch on={prefs?.tasks ?? true} disabled={!prefs} onChange={() => togglePref('tasks')} />
            </Row>
          )}
          {role === 'team' && (
            <Row title="☎️ Anrufe" subtitle="Meldungen der Telefon-Assistentin (Bereitschaft)">
              <Switch on={prefs?.calls ?? true} disabled={!prefs} onChange={() => togglePref('calls')} />
            </Row>
          )}
          {role === 'team' && (
            <Row title="🔧 System & Betrieb" subtitle="TV, Türschlösser, Überbuchungen, Buchungs-Abgleich" last={!belegeOk && !wb}>
              <Switch on={prefs?.system ?? true} disabled={!prefs} onChange={() => togglePref('system')} />
            </Row>
          )}
          {belegeOk && (
            <Row title="💶 Buchhaltung" subtitle="Neue Belege aus dem Mail-Scan (nur Admins)" last={!wb}>
              <Switch on={prefs?.buchhaltung ?? true} disabled={!prefs} onChange={() => togglePref('buchhaltung')} />
            </Row>
          )}
          {wb && (
            <Row title="⚡ Ladevorgang gestartet" subtitle="Push, sobald ein Gast zu laden beginnt">
              <Switch on={wb.pushStart} onChange={() => toggleWallboxPush('pushStart')} />
            </Row>
          )}
          {wb && (
            <Row title="⚡ Ladevorgang beendet" subtitle="Push mit kWh, Umsatz & Gewinn-Schätzung" last>
              <Switch on={wb.pushEnd} onChange={() => toggleWallboxPush('pushEnd')} />
            </Row>
          )}
        </div>
        <div style={{ fontSize: 12, color: '#8A8578', lineHeight: 1.55, margin: '9px 16px 0' }}>
          Jede Kategorie einzeln schaltbar — die Einstellung gilt für alle deine Geräte.
          „Push auf diesem Gerät" ist die oberste Ebene: ist die aus, kommt gar nichts.
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
      {showWallbox && <WallboxPanel onClose={() => setShowWallbox(false)} />}
      {showCalls && <CallsPanel onClose={() => setShowCalls(false)} />}
      {showBeleg && <BelegEinreichen onClose={() => setShowBeleg(false)} />}
      {showLocks && <LocksPanel onClose={() => setShowLocks(false)} />}
      {showDur && <CleaningDurations onClose={() => setShowDur(false)} />}
    </div>
  )
}
