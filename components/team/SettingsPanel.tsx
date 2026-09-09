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
import { haptic } from '@/components/team/ux'
import { useThemeMode, useIsDark, setThemeMode } from '@/lib/theme'
import { QsArchive } from '@/components/team/QsPanel'
import ScoreTrends from '@/components/team/ScoreTrends'
import WallboxPanel from '@/components/team/WallboxPanel'
import CallsPanel from '@/components/team/CallsPanel'
import BelegEinreichen from '@/components/team/BelegEinreichen'
import PushLogPanel from '@/components/team/PushLogPanel'
import LocksPanel from '@/components/team/LocksPanel'
import MaterialPanel from '@/components/team/MaterialPanel'
import CleaningDurations from '@/components/team/CleaningDurations'
import SchuldenPanel from '@/components/team/SchuldenPanel'

const HAIR = 'inset 0 -0.5px 0 var(--tm-line)'

function Switch({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      aria-pressed={on}
      style={{
        width: 51, height: 31, borderRadius: 16, border: 'none', padding: 2, flexShrink: 0,
        background: on ? '#34C759' : 'var(--tm-surface2)',
        opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer',
        transition: 'background 0.2s ease', display: 'flex',
        justifyContent: on ? 'flex-end' : 'flex-start', alignItems: 'center',
      }}
    >
      <span style={{ width: 27, height: 27, borderRadius: '50%', background: 'var(--tm-card)', boxShadow: '0 2px 5px rgba(0,0,0,0.22)' }} />
    </button>
  )
}

function Row({ title, subtitle, last, children }: {
  title: string; subtitle?: string; last?: boolean; children: React.ReactNode
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px',
      boxShadow: last ? 'none' : HAIR, background: 'var(--tm-card)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--tm-text)' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: 'var(--tm-muted)', marginTop: 1, lineHeight: 1.4 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  )
}

export default function SettingsPanel({ role }: { role: 'team' | 'provider' }) {
  // 🌗 §284 Dark Mode mit Schalter (Inhaber 9.9.)
  const themeMode = useThemeMode()
  const isDark = useIsDark()
  const [pushState, setPushState] = useState<'unknown' | 'off' | 'on' | 'unsupported'>('unknown')
  const [busy, setBusy] = useState(false)
  const [prefs, setPrefs] = useState<{ guestChats: boolean; teamChats: boolean; bookings: boolean; tasks: boolean; reinigung: boolean; calls: boolean; buchhaltung: boolean; material: boolean; system: boolean; tv: boolean } | null>(null)
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
  const [showMaterial, setShowMaterial] = useState(false)
  const [showPushLog, setShowPushLog] = useState(false)
  // ⏱ Reinigungs-Dauer (§255) — NUR Chefs (is_admin; probe 403 → aus)
  const [durOk, setDurOk] = useState(false)
  const [showDur, setShowDur] = useState(false)
  // 🏦 Schuldenstand (§272) — NUR Chefs (is_admin; probe 403 → aus)
  const [schuldenOk, setSchuldenOk] = useState(false)
  const [showSchulden, setShowSchulden] = useState(false)
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
      .then((d) => { if (d) setPrefs({ guestChats: d.guestChats !== false, teamChats: d.teamChats !== false, bookings: d.bookings !== false, tasks: d.tasks !== false, reinigung: d.reinigung !== false, calls: d.calls !== false, buchhaltung: d.buchhaltung !== false, material: d.material !== false, system: d.system !== false, tv: d.tv !== false }) })
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
    fetch('/api/schulden?probe=1', { cache: 'no-store' })
      .then((r) => { if (r.ok) setSchuldenOk(true) })
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

  async function togglePref(key: 'guestChats' | 'teamChats' | 'bookings' | 'tasks' | 'reinigung' | 'calls' | 'buchhaltung' | 'material' | 'system' | 'tv') {
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
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--tm-bg)', WebkitOverflowScrolling: 'touch' }}>
      {/* §276: Titel „Mehr" steht in der Shell-Kopfleiste */}
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '14px 16px', paddingBottom: 'var(--tm-nav-pad)' }}>

        {/* 🌗 §284 Darstellung: Auto (System) · Hell · Dunkel — je Gerät */}
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-muted)', letterSpacing: '0.05em', margin: '0 16px 7px' }}>DARSTELLUNG</div>
        <div className="tm-card" style={{ padding: '12px 16px', marginBottom: 22, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 19 }}>{isDark ? '🌙' : '☀️'}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--tm-text)' }}>Dark Mode</span>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--tm-muted)', marginTop: 1 }}>
              {themeMode === 'system' ? `Folgt dem System (gerade ${isDark ? 'dunkel' : 'hell'})` : themeMode === 'dark' ? 'Immer dunkel' : 'Immer hell'}
            </span>
          </span>
          <div role="tablist" style={{ display: 'flex', padding: 3, borderRadius: 999, background: 'var(--tm-surface2)', border: '1px solid var(--tm-line)', flexShrink: 0 }}>
            {(['system', 'light', 'dark'] as const).map((m) => (
              <button key={m} role="tab" aria-selected={themeMode === m} className="tm-press-btn" onClick={() => { haptic(); setThemeMode(m) }} style={{
                border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 999, fontSize: 12.5, fontWeight: 700,
                background: themeMode === m ? 'var(--tm-card)' : 'transparent',
                color: themeMode === m ? 'var(--tm-text)' : 'var(--tm-muted)',
                boxShadow: themeMode === m ? 'var(--tm-shadow)' : 'none',
                transition: 'background .2s var(--tm-ease), color .2s var(--tm-ease)',
              }}>{m === 'system' ? 'Auto' : m === 'light' ? 'Hell' : 'Dunkel'}</button>
            ))}
          </div>
        </div>

        {role === 'team' && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-muted)', letterSpacing: '0.05em', margin: '0 16px 7px' }}>BEREICHE</div>
            <div style={{ borderRadius: 12, overflow: 'hidden', boxShadow: '0 0 0 0.5px var(--tm-line)', marginBottom: 22 }}>
              {/* §276: „Offen"-Karten-Stapel ist kein Reiter mehr — hier erreichbar */}
              <button onClick={() => window.dispatchEvent(new CustomEvent('trimosa-open-tab', { detail: 'offen' }))} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                background: 'var(--tm-card)', border: 'none', cursor: 'pointer', textAlign: 'left',
                boxShadow: 'inset 0 -0.5px 0 var(--tm-line)',
              }}>
                <span style={{ fontSize: 19 }}>📥</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--tm-text)' }}>Offen abarbeiten</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--tm-muted)', marginTop: 1 }}>Unbeantwortete Gäste als Karten-Stapel — Antwort, ✓, 📞, Aufgabe</span>
                </span>
                <span style={{ color: 'var(--tm-muted2)', fontSize: 16 }}>›</span>
              </button>
              <button onClick={() => setShowTrends(true)} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                background: 'var(--tm-card)', border: 'none', cursor: 'pointer', textAlign: 'left',
                boxShadow: 'inset 0 -0.5px 0 var(--tm-line)',
              }}>
                <span style={{ fontSize: 19 }}>📈</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--tm-text)' }}>Entwicklung</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--tm-muted)', marginTop: 1 }}>Bewertungs-Scores im Zeitverlauf — gesamt & je Plattform</span>
                </span>
                <span style={{ color: 'var(--tm-muted2)', fontSize: 16 }}>›</span>
              </button>
              <button onClick={() => setShowCalls(true)} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                background: 'var(--tm-card)', border: 'none', cursor: 'pointer', textAlign: 'left',
                boxShadow: 'inset 0 -0.5px 0 var(--tm-line)',
              }}>
                <span style={{ fontSize: 19 }}>☎️</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--tm-text)' }}>Telefonate</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--tm-muted)', marginTop: 1 }}>Alle Anrufe der KI-Assistentin — Transkript lesen & abhören</span>
                </span>
                <span style={{ color: 'var(--tm-muted2)', fontSize: 16 }}>›</span>
              </button>
              {locksOk && (
                <button onClick={() => setShowLocks(true)} style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                  background: 'var(--tm-card)', border: 'none', cursor: 'pointer', textAlign: 'left',
                  boxShadow: 'inset 0 -0.5px 0 var(--tm-line)',
                }}>
                  <span style={{ fontSize: 19 }}>🔑</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--tm-text)' }}>Türschlösser</span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--tm-muted)', marginTop: 1 }}>Fernöffnen & Codes einsehen je Wohnung</span>
                  </span>
                  <span style={{ color: 'var(--tm-muted2)', fontSize: 16 }}>›</span>
                </button>
              )}
              {durOk && (
                <button onClick={() => setShowDur(true)} style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                  background: 'var(--tm-card)', border: 'none', cursor: 'pointer', textAlign: 'left',
                  boxShadow: 'inset 0 -0.5px 0 var(--tm-line)',
                }}>
                  <span style={{ fontSize: 19 }}>⏱</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--tm-text)' }}>Reinigungs-Dauer</span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--tm-muted)', marginTop: 1 }}>Wie lange Reinigungen dauern (nur Chefs)</span>
                  </span>
                  <span style={{ color: 'var(--tm-muted2)', fontSize: 16 }}>›</span>
                </button>
              )}
              {schuldenOk && (
                <button onClick={() => setShowSchulden(true)} style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                  background: 'var(--tm-card)', border: 'none', cursor: 'pointer', textAlign: 'left',
                  boxShadow: 'inset 0 -0.5px 0 var(--tm-line)',
                }}>
                  <span style={{ fontSize: 19 }}>🏦</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--tm-text)' }}>Schuldenstand</span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--tm-muted)', marginTop: 1 }}>Kredite je Standort — Restschuld, Zins &amp; Tilgung (nur Chefs)</span>
                  </span>
                  <span style={{ color: 'var(--tm-muted2)', fontSize: 16 }}>›</span>
                </button>
              )}
              <button onClick={() => setShowQs(true)} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                background: 'var(--tm-card)', border: 'none', cursor: 'pointer', textAlign: 'left',
                boxShadow: wb ? 'inset 0 -0.5px 0 var(--tm-line)' : 'none',
              }}>
                <span style={{ fontSize: 19 }}>🧾</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--tm-text)' }}>Qualitätssicherung</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--tm-muted)', marginTop: 1 }}>Protokolle & Historie je Wohnung</span>
                </span>
                <span style={{ color: 'var(--tm-muted2)', fontSize: 16 }}>›</span>
              </button>
              {belegeOk && (
                <button onClick={() => { window.location.href = '/buchhaltung' }} style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                  background: 'var(--tm-card)', border: 'none', cursor: 'pointer', textAlign: 'left',
                  boxShadow: wb ? 'inset 0 -0.5px 0 var(--tm-line)' : 'none',
                }}>
                  <span style={{ fontSize: 19 }}>💶</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--tm-text)' }}>Buchhaltung</span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--tm-muted)', marginTop: 1 }}>Eigene Vollbild-Oberfläche — Belege, Zahlungen, Verbuchen (nur Admins)</span>
                  </span>
                  <span style={{ color: 'var(--tm-muted2)', fontSize: 16 }}>›</span>
                </button>
              )}
              {wb && (
                <button onClick={() => setShowWallbox(true)} style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                  background: 'var(--tm-card)', border: 'none', cursor: 'pointer', textAlign: 'left',
                  boxShadow: belegeOk ? 'inset 0 -0.5px 0 var(--tm-line)' : 'none',
                }}>
                  <span style={{ fontSize: 19 }}>⚡</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--tm-text)' }}>Wallbox</span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--tm-muted)', marginTop: 1 }}>Ladehistorie — kWh, Umsatz & Gewinn</span>
                  </span>
                  <span style={{ color: 'var(--tm-muted2)', fontSize: 16 }}>›</span>
                </button>
              )}
              {belegeOk && (
                <button onClick={() => { window.location.href = '/api/tv-bridge/sso' }} style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                  background: 'var(--tm-card)', border: 'none', cursor: 'pointer', textAlign: 'left',
                }}>
                  <span style={{ fontSize: 19 }}>📺</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--tm-text)' }}>TV-Steuerung</span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--tm-muted)', marginTop: 1 }}>Ferienwohnungs-TVs — Inhalte, Screensaver, Boxen (ohne 2. Login)</span>
                  </span>
                  <span style={{ color: 'var(--tm-muted2)', fontSize: 16 }}>›</span>
                </button>
              )}
            </div>
          </>
        )}

        {/* §266f/§303: Material — Team-Rollen (Pascal 9.9.: für Dienstleister ausgeblendet) */}
        {role === 'team' && (<>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-muted)', letterSpacing: '0.05em', margin: '0 16px 7px' }}>MATERIAL</div>
        <div style={{ borderRadius: 12, overflow: 'hidden', boxShadow: '0 0 0 0.5px var(--tm-line)', marginBottom: 22 }}>
          <button onClick={() => setShowMaterial(true)} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
            background: 'var(--tm-card)', border: 'none', cursor: 'pointer', textAlign: 'left',
          }}>
            <span style={{ fontSize: 19 }}>🛒</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--tm-text)' }}>Material & Bestellungen</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--tm-muted)', marginTop: 1 }}>Standort wählen, Produkt antippen — fertig. Warenkorb kommt automatisch</span>
            </span>
            <span style={{ color: 'var(--tm-muted2)', fontSize: 16 }}>›</span>
          </button>
        </div>

        </>)}

        {/* §243ad: Beleg einreichen — für ALLE Rollen inkl. Dienstleister
            (Upload + Ort + Notiz; keinerlei Finanz-Einblick) */}
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-muted)', letterSpacing: '0.05em', margin: '0 16px 7px' }}>BELEGE</div>
        <div style={{ borderRadius: 12, overflow: 'hidden', boxShadow: '0 0 0 0.5px var(--tm-line)', marginBottom: 22 }}>
          <button onClick={() => setShowBeleg(true)} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
            background: 'var(--tm-card)', border: 'none', cursor: 'pointer', textAlign: 'left',
          }}>
            <span style={{ fontSize: 19 }}>🧾</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--tm-text)' }}>Beleg einreichen</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--tm-muted)', marginTop: 1 }}>Rechnung oder Kassenbon fotografieren — die Buchhaltung übernimmt</span>
            </span>
            <span style={{ color: 'var(--tm-muted2)', fontSize: 16 }}>›</span>
          </button>
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-muted)', letterSpacing: '0.05em', margin: '0 16px 7px' }}>MITTEILUNGEN</div>
        <div style={{ borderRadius: 12, overflow: 'hidden', boxShadow: '0 0 0 0.5px var(--tm-line)' }}>
          {/* §265 (Pascal): anklickbarer Verlauf aller eigenen Pushes */}
          <button onClick={() => setShowPushLog(true)} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
            background: 'var(--tm-card)', border: 'none', cursor: 'pointer', textAlign: 'left',
            boxShadow: 'inset 0 -0.5px 0 var(--tm-line)',
          }}>
            <span style={{ fontSize: 19 }}>🔔</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--tm-text)' }}>Verlauf</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--tm-muted)', marginTop: 1 }}>Alle Mitteilungen der letzten 30 Tage — antippen springt zum Ziel</span>
            </span>
            <span style={{ color: 'var(--tm-muted2)', fontSize: 16 }}>›</span>
          </button>
          <Row
            title="Push auf diesem Gerät"
            subtitle={pushState === 'unsupported'
              ? 'Auf diesem Gerät nicht verfügbar'
              : 'Mitteilungen auf dieses Gerät erhalten'}
          >
            {pushState === 'unknown'
              ? <span style={{ fontSize: 13, color: 'var(--tm-muted2)' }}>…</span>
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
          <Row title="✅ Aufgaben & QS" subtitle="Zuweisungen, Kommentare, Vorschläge, QS-Termine">
            <Switch on={prefs?.tasks ?? true} disabled={!prefs} onChange={() => togglePref('tasks')} />
          </Row>
          <Row title="🧹 Reinigung" subtitle="Fertigmeldungen aus den Wohnungen">
            <Switch on={prefs?.reinigung ?? true} disabled={!prefs} onChange={() => togglePref('reinigung')} />
          </Row>
          {role === 'team' && (
          <Row title="🛒 Material" subtitle="Bestellung fällig — Bedarf je Standort erreicht">
            <Switch on={prefs?.material ?? true} disabled={!prefs} onChange={() => togglePref('material')} />
          </Row>
          )}
          {role === 'team' && (
            <Row title="☎️ Anrufe" subtitle="Meldungen der Telefon-Assistentin (Bereitschaft)">
              <Switch on={prefs?.calls ?? true} disabled={!prefs} onChange={() => togglePref('calls')} />
            </Row>
          )}
          <Row title="📺 TV-Boxen & TV-Server" subtitle="Ausfälle und Entwarnungen der TV-Systeme (Sweet Spot & Co.)">
            <Switch on={prefs?.tv ?? true} disabled={!prefs} onChange={() => togglePref('tv')} />
          </Row>
          <Row title="🔧 System & Betrieb" subtitle="Türschlösser, Überbuchungen, Buchungs-Abgleich" last={!belegeOk && !wb}>
            <Switch on={prefs?.system ?? true} disabled={!prefs} onChange={() => togglePref('system')} />
          </Row>
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
        <div style={{ fontSize: 12, color: 'var(--tm-muted)', lineHeight: 1.55, margin: '9px 16px 0' }}>
          Jede Kategorie einzeln schaltbar — die Einstellung gilt für alle deine Geräte.
          „Push auf diesem Gerät" ist die oberste Ebene: ist die aus, kommt gar nichts.
        </div>
        {pushState === 'unsupported' && (
          <div style={{
            margin: '14px 0 0', padding: '11px 14px', borderRadius: 12,
            background: '#FEF9EC', border: '1px solid #F1E4BD', fontSize: 12.5, lineHeight: 1.55, color: 'var(--tm-accent-dark)',
          }}>
            💡 Auf dem iPhone: <strong>trimosa.de/team</strong> in Safari öffnen → Teilen → „Zum Home-Bildschirm" — in der installierten App lässt sich Push hier aktivieren.
          </div>
        )}

        {/* ☎️ Bereitschaft (§175) — nur Admins sichtbar */}
        {oncallPeople && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-muted)', letterSpacing: '0.05em', margin: '24px 16px 7px' }}>☎️ BEREITSCHAFT (TELEFON-ASSISTENTIN)</div>
            <div style={{ borderRadius: 12, overflow: 'hidden', boxShadow: '0 0 0 0.5px var(--tm-line)' }}>
              {oncallPeople.map((p, i) => (
                <Row key={p.id} title={p.name} subtitle={p.role} last={i === oncallPeople.length - 1}>
                  <Switch on={oncallSel.includes(p.id)} onChange={() => toggleOncall(p.id)} />
                </Row>
              ))}
            </div>
            <div style={{ fontSize: 12, color: 'var(--tm-muted)', lineHeight: 1.55, margin: '9px 16px 0' }}>
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
      {showMaterial && <MaterialPanel onClose={() => setShowMaterial(false)} />}
      {showPushLog && <PushLogPanel onClose={() => setShowPushLog(false)} />}
      {showDur && <CleaningDurations onClose={() => setShowDur(false)} />}
      {showSchulden && <SchuldenPanel onClose={() => setShowSchulden(false)} />}
    </div>
  )
}
