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
import { haptic, tmToast, rueckmeldung } from '@/components/team/ux'
import { useThemeMode, useIsDark, setThemeMode } from '@/lib/theme'
import { useToeneAn, setToeneAn } from '@/lib/klang'
import { QsArchive } from '@/components/team/QsPanel'
import ScoreTrends from '@/components/team/ScoreTrends'
import WallboxPanel from '@/components/team/WallboxPanel'
import CallsPanel from '@/components/team/CallsPanel'
import BelegEinreichen from '@/components/team/BelegEinreichen'
import PushLogPanel from '@/components/team/PushLogPanel'
import LocksPanel from '@/components/team/LocksPanel'
import MaterialPanel from '@/components/team/MaterialPanel'
import CleaningDurations from '@/components/team/CleaningDurations'
import TempoPanel from '@/components/team/TempoPanel'
import SchuldenPanel from '@/components/team/SchuldenPanel'
import AutoReplyPanel from '@/components/team/AutoReplyPanel'
import { AssistentKostuemWahl } from '@/components/team/AssistentFigur'
import { VORSCHAU_HINWEIS, VORSCHAU_NAME, VORSCHAU_ROLLEN, type VorschauRolle } from '@/lib/rollen-vorschau-namen'
import { RUHE_STANDARD, ruheErklaerung, type Ruhezeit } from '@/lib/push-ruhe'
import { bereinigeZaehler, waehleHaeufig, zaehleOeffnung, type MehrZaehler } from '@/lib/mehr-haeufig'

const HAIR = 'inset 0 -0.5px 0 var(--tm-line)'
// 🌙 Ruhezeiten: Auswahl in vollen Stunden (0–23 Uhr)
const STUNDEN = Array.from({ length: 24 }, (_, h) => h)
const STUNDEN_SELECT: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, padding: '6px 8px', borderRadius: 10,
  border: '0.5px solid var(--tm-line)', background: 'var(--tm-card)', color: 'var(--tm-text)',
}

// label = Zeilentitel: zugänglicher Name für VoiceOver (der Schalter selbst hat keinen Text)
function Switch({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      style={{
        width: 51, height: 31, borderRadius: 16, border: 'none', padding: 2, flexShrink: 0,
        // iOS-27-Runde: Spur „aus" als neutrales Grau (Token, bei „Kontrast erhöhen" kräftiger) —
        // var(--tm-surface2) war auf der Karte kaum zu sehen
        background: on ? 'var(--tm-green)' : 'var(--tm-switch-off)',
        opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer',
        // transform/filter 'none': der Schalter nimmt am globalen Druck-Feedback nicht teil
        // (sprang sonst ohne Übergang auf 97 %)
        transition: 'background 0.2s ease', transform: 'none', filter: 'none', display: 'flex',
        justifyContent: on ? 'flex-end' : 'flex-start', alignItems: 'center',
      }}
    >
      {/* Knopf immer weiß (auch im Dark Mode — dort war er als var(--tm-card) fast schwarz) */}
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

/* ── 🧭 Pascal 7 (Chefsache 7.10.2026) Informationsarchitektur im Reiter Mehr ──
   Oben HÄUFIG (höchstens 4 Kacheln, Öffnungen je Gerät gezählt), darunter GÄSTE · BETRIEB · FIRMA,
   dann EINSTELLUNGEN (Darstellung, Ansicht als …, Mitteilungen, Bereitschaft). Jede Funktion in
   höchstens zwei Schritten: Reiter Mehr → Eintrag. Auswahl-Logik: lib/mehr-haeufig.ts */
type MehrGruppe = 'gaeste' | 'betrieb' | 'firma'
type MehrEintrag = {
  key: string; icon: string; title: string; sub: string
  /** null = steht nicht in einer Gruppe (Verlauf liegt im Mitteilungs-Block), nur als Häufig-Kachel */
  gruppe: MehrGruppe | null
  /** dieselben Sichtbarkeits-Bedingungen wie vor der Umordnung (Rolle + Rechte-Proben) */
  zeigen: boolean
  open: () => void
}
const MEHR_GRUPPEN: [MehrGruppe, string][] = [['gaeste', 'GÄSTE'], ['betrieb', 'BETRIEB'], ['firma', 'FIRMA']]
const MEHR_ZAEHLER_KEY = 'tm-mehr-oeffnungen-v1'
function leseMehrZaehler(): MehrZaehler {
  if (typeof window === 'undefined') return {}
  try { return bereinigeZaehler(JSON.parse(localStorage.getItem(MEHR_ZAEHLER_KEY) ?? '{}')) } catch { return {} }
}
function merkeMehrOeffnung(key: string) {
  try { localStorage.setItem(MEHR_ZAEHLER_KEY, JSON.stringify(zaehleOeffnung(leseMehrZaehler(), key))) } catch { /* privater Modus */ }
}

/** Kleinüberschrift im bestehenden Versalien-Stil */
function MehrTitel({ children }: { children: React.ReactNode }) {
  return (
    <div role="heading" aria-level={2} style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-muted)', letterSpacing: '0.05em', margin: '0 16px 7px' }}>
      {children}
    </div>
  )
}

/** Listenzeile wie bisher (Symbol · Titel + Unterzeile · ›) — Trennlinie außer bei der letzten */
function MehrZeile({ e, last, onOpen }: { e: MehrEintrag; last: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
      background: 'var(--tm-card)', border: 'none', cursor: 'pointer', textAlign: 'left',
      boxShadow: last ? 'none' : HAIR,
    }}>
      <span style={{ fontSize: 19 }} aria-hidden="true">{e.icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--tm-text)' }}>{e.title}</span>
        {e.sub && <span style={{ display: 'block', fontSize: 12, color: 'var(--tm-muted)', marginTop: 1 }}>{e.sub}</span>}
      </span>
      <span style={{ color: 'var(--tm-muted2)', fontSize: 16 }} aria-hidden="true">›</span>
    </button>
  )
}

/** Häufig-Kachel: Symbol + Titel, zwei Spalten (auch bei 375 px Breite) */
function MehrKachel({ e, onOpen }: { e: MehrEintrag; onOpen: () => void }) {
  return (
    <button type="button" className="tm-card tm-press-btn" onClick={onOpen} title={e.sub || undefined} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8,
      minHeight: 80, padding: '12px 14px', cursor: 'pointer', textAlign: 'start', color: 'var(--tm-text)', minWidth: 0,
    }}>
      <span style={{ fontSize: 22, lineHeight: 1 }} aria-hidden="true">{e.icon}</span>
      <span style={{
        fontSize: 14, fontWeight: 650, lineHeight: 1.25, letterSpacing: '-0.1px', overflowWrap: 'anywhere',
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>{e.title}</span>
    </button>
  )
}

export default function SettingsPanel({ role, vorschau = null, darfVorschau = false }: {
  role: 'team' | 'provider'
  /** 👀 Rollen-Vorschau (lib/rollen-vorschau.ts): aktive Vorschau und ob der ECHTE Nutzer Chef ist */
  vorschau?: VorschauRolle | null
  darfVorschau?: boolean
}) {
  // 👀 Umschalten = Cookie setzen/löschen und die App neu laden (Seite und alle Routen lesen die Rolle neu)
  const [vorschauBusy, setVorschauBusy] = useState(false)
  async function waehleVorschau(rolle: VorschauRolle | null) {
    if (vorschauBusy || rolle === vorschau) return
    haptic()
    setVorschauBusy(true)
    try {
      const r = rolle
        ? await fetch('/api/team/vorschau', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rolle }) })
        : await fetch('/api/team/vorschau', { method: 'DELETE' })
      if (!r.ok) {
        const d = await r.json().catch(() => ({})) as { error?: string }
        tmToast(d.error ?? '⚠️ Die Vorschau ließ sich nicht umschalten. Bitte versuch es noch einmal.')
        setVorschauBusy(false)
        return
      }
      location.replace('/team?tab=einstellungen')
    } catch {
      tmToast('📵 Keine Verbindung – die Vorschau ließ sich nicht umschalten.')
      setVorschauBusy(false)
    }
  }

  // 🌗 §284 Dark Mode mit Schalter (Inhaber 9.9.)
  const themeMode = useThemeMode()
  const isDark = useIsDark()
  // 🔔 Töne je Gerät (Standard an)
  const toene = useToeneAn()
  const [pushState, setPushState] = useState<'unknown' | 'off' | 'on' | 'unsupported'>('unknown')
  const [busy, setBusy] = useState(false)
  const [prefs, setPrefs] = useState<{ guestChats: boolean; teamChats: boolean; bookings: boolean; tasks: boolean; reinigung: boolean; calls: boolean; buchhaltung: boolean; material: boolean; system: boolean; tv: boolean } | null>(null)
  // 🌙 Ruhezeiten (Pascal, Chefsache 7.10.2026) — push_prefs.ruhe über /api/push/prefs
  const [ruhe, setRuhe] = useState<Ruhezeit | null>(null)
  const [showQs, setShowQs] = useState(false)
  const [showTrends, setShowTrends] = useState(false)
  // ☎️ Bereitschaft (§175) — nur Admins (GET liefert sonst 403 → Sektion bleibt aus)
  const [oncallPeople, setOncallPeople] = useState<{ id: string; name: string; role: string }[] | null>(null)
  const [oncallSel, setOncallSel] = useState<string[]>([])
  // ⚡ Wallbox (§185) — nur Admins (probe liefert sonst 403 → Bereich + Toggles bleiben aus)
  const [showWallbox, setShowWallbox] = useState(false)
  const [showCalls, setShowCalls] = useState(false)
  // 🎧 „Mitschnitt" an einer Anruf-Aufgabe bzw. /team?call=<id>: Telefonate öffnen und den Anruf aufklappen
  const [callFocus, setCallFocus] = useState<{ id?: string; phone?: string | null; at?: string; name?: string } | null>(null)
  useEffect(() => {
    const onOpenCall = (e: Event) => {
      const d = (e as CustomEvent<{ id?: string; phone?: string | null; at?: string; name?: string }>).detail ?? {}
      setCallFocus({ ...d, at: d.at ?? new Date().toISOString() })
      setShowCalls(true)
    }
    window.addEventListener('trimosa-open-call', onOpenCall)
    // 🌅 Sammel-Mitteilung nach der Ruhezeit → Mitteilungs-Verlauf öffnen
    const onOpenPushLog = () => setShowPushLog(true)
    window.addEventListener('trimosa-open-pushlog', onOpenPushLog)
    return () => {
      window.removeEventListener('trimosa-open-call', onOpenCall)
      window.removeEventListener('trimosa-open-pushlog', onOpenPushLog)
    }
  }, [])
  const [showBeleg, setShowBeleg] = useState(false)
  // 🔑 Türschlösser (§253) — Admins/Hosts/Staff (probe 403 → Eintrag bleibt aus)
  const [locksOk, setLocksOk] = useState(false)
  const [showLocks, setShowLocks] = useState(false)
  const [showMaterial, setShowMaterial] = useState(false)
  const [showPushLog, setShowPushLog] = useState(false)
  // ⏱ Reinigungs-Dauer (§255) — NUR Chefs (is_admin; probe 403 → aus)
  const [durOk, setDurOk] = useState(false)
  const [showDur, setShowDur] = useState(false)
  // ⏱ Wartestellen (Pascal, Chefsache 7.10., Bereich 11) — NUR Chefs (is_admin; probe 403 → aus)
  const [tempoOk, setTempoOk] = useState(false)
  const [showTempo, setShowTempo] = useState(false)
  // 🏦 Schuldenstand (§272) — NUR Chefs (is_admin; probe 403 → aus)
  const [schuldenOk, setSchuldenOk] = useState(false)
  const [showSchulden, setShowSchulden] = useState(false)
  // 🤖 KI-Auto-Antworten (Phase 2) — nur Admins/Gastgeber (probe 403 → Eintrag bleibt aus)
  const [autoReplyOk, setAutoReplyOk] = useState(false)
  const [showAutoReply, setShowAutoReply] = useState(false)
  const [wb, setWb] = useState<{ pushStart: boolean; pushEnd: boolean } | null>(null)
  // 🧾 Beleg-Inbox (§238) — nur Admins/Gastgeber (probe 403 → Eintrag bleibt aus)
  const [belegeOk, setBelegeOk] = useState(false)

  // 🧭 Pascal 7: HÄUFIG + Gruppen (Typen/Helfer oben bei MehrEintrag)
  const [probenFertig, setProbenFertig] = useState(false)
  useEffect(() => {
    // Rückfall, falls eine Probe hängt — ohne Push-Unterstützung laufen die Proben gar nicht (früher Ausstieg unten)
    const ohneProben = !('serviceWorker' in navigator) || !('PushManager' in window)
    const t = setTimeout(() => setProbenFertig(true), ohneProben ? 0 : 4000)
    return () => clearTimeout(t)
  }, [])
  // Zählerstand einmal lesen: HÄUFIG bleibt während der Sitzung stehen (Kacheln springen nicht unter dem Finger),
  // frisch erst, wenn die App aus dem Hintergrund zurückkommt
  const [zaehler, setZaehler] = useState<MehrZaehler>(leseMehrZaehler)
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') setZaehler(leseMehrZaehler()) }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])
  // Der Verlauf-Knopf steckt im Mitteilungs-Block (bleibt unverändert) → jede Öffnung hier zählen, auch per Sammel-Mitteilung
  useEffect(() => { if (showPushLog) merkeMehrOeffnung('verlauf') }, [showPushLog])

  const team = role === 'team'
  const eintraege: MehrEintrag[] = [
    // GÄSTE
    { key: 'offen', gruppe: 'gaeste', icon: '📥', title: 'Offen abarbeiten', sub: 'Unbeantwortete Gäste als Karten-Stapel – Antwort, ✓, 📞, Aufgabe', zeigen: team,
      // §276: „Offen"-Karten-Stapel ist kein Reiter mehr — hier erreichbar
      open: () => window.dispatchEvent(new CustomEvent('trimosa-open-tab', { detail: 'offen' })) },
    { key: 'telefonate', gruppe: 'gaeste', icon: '☎️', title: 'Telefonate', sub: 'Alle Anrufe der Telefon-Assistentin – Transkript lesen & abhören', zeigen: team, open: () => setShowCalls(true) },
    { key: 'autoantworten', gruppe: 'gaeste', icon: '🤖', title: 'KI-Auto-Antworten', sub: 'Modus, Tor-Fortschritt & Entscheidungen der KI bewerten', zeigen: team && autoReplyOk, open: () => setShowAutoReply(true) },
    { key: 'entwicklung', gruppe: 'gaeste', icon: '📈', title: 'Entwicklung', sub: 'Bewertungen im Zeitverlauf – gesamt & je Portal', zeigen: team, open: () => setShowTrends(true) },
    // BETRIEB
    { key: 'tuerschloesser', gruppe: 'betrieb', icon: '🔑', title: 'Türschlösser', sub: 'Fernöffnen & Türcodes je Wohnung', zeigen: team && locksOk, open: () => setShowLocks(true) },
    { key: 'qs', gruppe: 'betrieb', icon: '📋', title: 'Qualitätssicherung', sub: 'Protokolle & Historie je Wohnung', zeigen: team, open: () => setShowQs(true) },
    { key: 'reinigungsdauer', gruppe: 'betrieb', icon: '⏱', title: 'Reinigungs-Dauer', sub: 'Wie lange Reinigungen dauern (nur Chefs)', zeigen: team && durOk, open: () => setShowDur(true) },
    // §266f/§303: Material — Team-Rollen (Pascal 9.9.: für Dienstleister ausgeblendet)
    { key: 'material', gruppe: 'betrieb', icon: '🛒', title: 'Material & Bestellungen', sub: 'Standort wählen, Produkt antippen – fertig. Der Warenkorb kommt automatisch.', zeigen: team, open: () => setShowMaterial(true) },
    { key: 'wallbox', gruppe: 'betrieb', icon: '⚡', title: 'Wallbox', sub: 'Ladehistorie – kWh, Umsatz & Gewinn', zeigen: team && !!wb, open: () => setShowWallbox(true) },
    { key: 'tv', gruppe: 'betrieb', icon: '📺', title: 'TV-Steuerung', sub: 'TVs in den Wohnungen – Inhalte, Bildschirmschoner, Boxen (ohne zweite Anmeldung)', zeigen: team && belegeOk,
      open: () => { window.location.href = '/api/tv-bridge/sso' } },
    // FIRMA
    { key: 'buchhaltung', gruppe: 'firma', icon: '💶', title: 'Buchhaltung', sub: 'Eigene Vollbild-Oberfläche – Belege, Zahlungen, Verbuchen (nur Chefs)', zeigen: team && belegeOk,
      open: () => { window.location.href = '/buchhaltung' } },
    // §243ad: Beleg einreichen — für ALLE Rollen inkl. Dienstleister (Upload + Ort + Notiz; keinerlei Finanz-Einblick)
    { key: 'beleg', gruppe: 'firma', icon: '🧾', title: 'Beleg einreichen', sub: 'Rechnung oder Kassenbon fotografieren – die Buchhaltung übernimmt', zeigen: true, open: () => setShowBeleg(true) },
    { key: 'schulden', gruppe: 'firma', icon: '🏦', title: 'Schuldenstand', sub: 'Kredite je Standort – Restschuld, Zins & Tilgung (nur Chefs)', zeigen: team && schuldenOk, open: () => setShowSchulden(true) },
    { key: 'wartestellen', gruppe: 'firma', icon: '⏳', title: 'Wartestellen', sub: 'Wo die App warten lässt – was als Nächstes schneller werden soll (nur Chefs)', zeigen: team && tempoOk, open: () => setShowTempo(true) },
    // EINSTELLUNGEN → MITTEILUNGEN → Verlauf: nur als mögliche Häufig-Kachel (der Knopf selbst bleibt im Block)
    { key: 'verlauf', gruppe: null, icon: '🔔', title: 'Mitteilungs-Verlauf', sub: 'Alle Mitteilungen der letzten 30 Tage', zeigen: true, open: () => setShowPushLog(true) },
  ]
  // Vorgaben ohne Zähler-Daten: Chefs/Gastgeber (Beleg-Inbox-Recht) · Mitarbeiter · Dienstleister
  const haeufigVorgabe = !team ? ['beleg', 'verlauf']
    : belegeOk ? ['offen', 'telefonate', 'buchhaltung', 'tuerschloesser']
    : ['offen', 'tuerschloesser', 'material', 'beleg']
  const haeufig = probenFertig
    ? waehleHaeufig(eintraege.filter((e) => e.zeigen).map((e) => e.key), zaehler, haeufigVorgabe)
      .map((k) => eintraege.find((e) => e.key === k))
      .filter((e): e is MehrEintrag => !!e)
    : []
  function oeffne(e: MehrEintrag) {
    haptic()
    if (e.key !== 'verlauf') merkeMehrOeffnung(e.key) // Verlauf zählt über showPushLog (s. o.)
    e.open()
  }

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { setPushState('unsupported'); return }
    navigator.serviceWorker.register('/sw.js').then(async (reg) => {
      const sub = await reg.pushManager.getSubscription()
      setPushState(sub ? 'on' : 'off')
    }).catch(() => setPushState('unsupported'))
    fetch('/api/push/prefs', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setPrefs({ guestChats: d.guestChats !== false, teamChats: d.teamChats !== false, bookings: d.bookings !== false, tasks: d.tasks !== false, reinigung: d.reinigung !== false, calls: d.calls !== false, buchhaltung: d.buchhaltung !== false, material: d.material !== false, system: d.system !== false, tv: d.tv !== false }); if (d) setRuhe(d.ruhe ?? { ...RUHE_STANDARD }) })
      .catch(() => {})
    fetch('/api/admin/oncall', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setOncallPeople(d.people ?? []); setOncallSel(d.selected ?? []) } })
      .catch(() => {})
    // 🧭 Pascal 7: Rechte-Proben gesammelt — HÄUFIG erscheint erst, wenn alle zurück sind (sonst springen die Kacheln)
    Promise.allSettled([
      fetch('/api/wallbox?probe=1', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d?.settings) setWb({ pushStart: d.settings.pushStart, pushEnd: d.settings.pushEnd }) }),
      fetch('/api/belege?probe=1', { cache: 'no-store' })
        .then((r) => { if (r.ok) setBelegeOk(true) }),
      fetch('/api/locks/control?probe=1', { cache: 'no-store' })
        .then((r) => { if (r.ok) setLocksOk(true) }),
      fetch('/api/cleaning/durations?probe=1', { cache: 'no-store' })
        .then((r) => { if (r.ok) setDurOk(true) }),
      fetch('/api/tempo?probe=1', { cache: 'no-store' })
        .then((r) => { if (r.ok) setTempoOk(true) }),
      fetch('/api/schulden?probe=1', { cache: 'no-store' })
        .then((r) => { if (r.ok) setSchuldenOk(true) }),
      fetch('/api/ai/autoreply/log?probe=1', { cache: 'no-store' })
        .then((r) => { if (r.ok) setAutoReplyOk(true) }),
    ]).then(() => setProbenFertig(true))
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

  // 🌙 Ruhezeiten speichern — sofort anzeigen, bei Fehler zurückdrehen
  async function saveRuhe(next: Ruhezeit) {
    if (!ruhe) return
    const vorher = ruhe
    haptic()
    setRuhe(next)
    const ok = await fetch('/api/push/prefs', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ruhe: next }),
    }).then((r) => r.ok).catch(() => false)
    if (!ok) { setRuhe(vorher); tmToast('Ruhezeit konnte nicht gespeichert werden') }
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--tm-bg)', WebkitOverflowScrolling: 'touch' }}>
      {/* §276: Titel „Mehr" steht in der Shell-Kopfleiste */}
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '14px 16px', paddingBottom: 'var(--tm-nav-pad)' }}>

        {/* 🧭 Pascal 7: HÄUFIG — höchstens 4 meistgenutzte Funktionen (je Gerät gezählt, sonst Vorgaben je Rolle) */}
        {haeufig.length > 0 && (
          <>
            <MehrTitel>HÄUFIG</MehrTitel>
            <div className="tm-enter" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginBottom: 22 }}>
              {haeufig.map((e) => <MehrKachel key={e.key} e={e} onOpen={() => oeffne(e)} />)}
            </div>
          </>
        )}
        {/* 🧭 Pascal 7: thematische Gruppen — nur Gruppen mit mindestens einem sichtbaren Eintrag */}
        {MEHR_GRUPPEN.map(([g, titel]) => {
          const liste = eintraege.filter((e) => e.zeigen && e.gruppe === g)
          if (!liste.length) return null
          return (
            <div key={g}>
              <MehrTitel>{titel}</MehrTitel>
              <div style={{ borderRadius: 12, overflow: 'hidden', boxShadow: '0 0 0 0.5px var(--tm-line)', marginBottom: 22 }}>
                {liste.map((e, i) => <MehrZeile key={e.key} e={e} last={i === liste.length - 1} onOpen={() => oeffne(e)} />)}
              </div>
            </div>
          )
        })}
        {/* 🧭 Pascal 7: EINSTELLUNGEN — darunter die Blöcke Darstellung, Ansicht als …, Mitteilungen und Bereitschaft (unverändert) */}
        <div role="heading" aria-level={2} style={{
          display: 'flex', alignItems: 'center', gap: 10, margin: '10px 16px 14px',
          fontSize: 12, fontWeight: 800, color: 'var(--tm-text)', letterSpacing: '0.05em',
        }}>
          EINSTELLUNGEN
          <span aria-hidden="true" style={{ flex: 1, height: 0.5, background: 'var(--tm-line)' }} />
        </div>

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
          <div role="tablist" style={{ display: 'flex', padding: 3, borderRadius: 999, background: 'var(--tm-seg-track)', boxShadow: 'inset 0 0 0 0.5px var(--tm-line)', flexShrink: 0 }}>
            {(['system', 'light', 'dark'] as const).map((m) => (
              <button key={m} role="tab" aria-selected={themeMode === m} className="tm-press-btn" onClick={() => { haptic(); setThemeMode(m) }} style={{
                border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 999, fontSize: 12.5, fontWeight: 700,
                background: themeMode === m ? 'var(--tm-seg-on)' : 'transparent',
                color: themeMode === m ? 'var(--tm-text)' : 'var(--tm-muted)',
                boxShadow: themeMode === m ? '0 1px 3px rgba(0,0,0,0.16), var(--tm-edge)' : 'none',
                transition: 'background .2s var(--tm-ease), color .2s var(--tm-ease)',
              }}>{m === 'system' ? 'Auto' : m === 'light' ? 'Hell' : 'Dunkel'}</button>
            ))}
          </div>
        </div>
        {/* 🔔 Pascal 7.10. Gestaltung 1: Töne je Gerät (lib/klang.ts) — eigene Karte, rückt per negativem
            Rand an die Dark-Mode-Karte heran (gehört noch zu DARSTELLUNG) */}
        <div className="tm-card" style={{ padding: '12px 16px', marginTop: -12, marginBottom: 22, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 19 }} aria-hidden="true">{toene ? '🔔' : '🔕'}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--tm-text)' }}>Töne</span>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--tm-muted)', marginTop: 1, lineHeight: 1.4 }}>
              Kurze Töne bei Senden, Erledigt und Fehlern. Folgen dem Stumm-Schalter.
            </span>
          </span>
          <Switch label="Töne" on={toene} onChange={() => {
            const an = !toene
            setToeneAn(an)
            // Hörprobe beim Einschalten (läuft in der Geste — legt dabei auch den AudioContext an)
            if (an) rueckmeldung('erledigt')
            else haptic()
          }} />
        </div>

        {/* 🤖 Pascal 7.10. Gestaltung 5: Kostüm der Assistenten-Figur je Gerät (Automatisch / fest / Aus) —
            rückt wie die Töne-Karte an DARSTELLUNG heran */}
        <AssistentKostuemWahl style={{ marginTop: -12 }} />

        {/* 👀 Rollen-Vorschau — nur für Chefs (echte Rolle), auch WÄHREND einer Vorschau sichtbar, um zurückzuschalten */}
        {darfVorschau && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-muted)', letterSpacing: '0.05em', margin: '0 16px 7px' }}>ANSICHT ALS …</div>
            <div className="tm-card" style={{ padding: '12px 16px', marginBottom: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 19 }}>👀</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--tm-text)' }}>Rollen-Vorschau</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--tm-muted)', marginTop: 1 }}>
                    {vorschau ? `Du siehst die App gerade ${VORSCHAU_HINWEIS[vorschau]}.` : 'Die App so sehen, wie sie eine andere Rolle sieht. Was du dabei tust, wirkt echt.'}
                  </span>
                </span>
              </div>
              <div role="tablist" aria-label="Rolle für die Vorschau" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                {([null, ...VORSCHAU_ROLLEN] as (VorschauRolle | null)[]).map((r) => {
                  const on = r === vorschau
                  return (
                    <button key={r ?? 'eigene'} role="tab" aria-selected={on} disabled={vorschauBusy} className="tm-press-btn" onClick={() => waehleVorschau(r)} style={{
                      border: 'none', cursor: vorschauBusy ? 'wait' : 'pointer', padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700,
                      background: on ? 'var(--tm-text)' : 'var(--tm-seg-track)', color: on ? 'var(--tm-bg)' : 'var(--tm-text)',
                      boxShadow: on ? 'none' : 'inset 0 0 0 0.5px var(--tm-line)', opacity: vorschauBusy ? 0.6 : 1,
                    }}>{r ? VORSCHAU_NAME[r] : '👑 Eigene Rolle'}</button>
                  )
                })}
              </div>
            </div>
          </>
        )}

        {/* 🧭 Pascal 7: die früheren Blöcke BEREICHE · MATERIAL · BELEGE stehen jetzt oben in HÄUFIG + GÄSTE/BETRIEB/FIRMA
            (Daten: eintraege) — Rechte unverändert (role === 'team' + Proben) */}

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
              : <Switch label="Push auf diesem Gerät" on={pushState === 'on'} disabled={pushState === 'unsupported' || busy} onChange={toggleDevice} />}
          </Row>
          {/* 🌙 Ruhezeiten (Pascal, Chefsache 7.10.2026): gilt für alle Geräte — Dringendes sofort, der Rest gesammelt */}
          <Row title="🌙 Ruhezeiten" subtitle={ruheErklaerung(ruhe ?? RUHE_STANDARD)}>
            <Switch label="Ruhezeiten" on={(ruhe ?? RUHE_STANDARD).an} disabled={!ruhe} onChange={() => { if (ruhe) saveRuhe({ ...ruhe, an: !ruhe.an }) }} />
          </Row>
          {ruhe?.an && (
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14, padding: '9px 16px', boxShadow: HAIR, background: 'var(--tm-card)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--tm-text)' }}>
                Von
                <select value={ruhe.von} onChange={(e) => saveRuhe({ ...ruhe, von: Number(e.target.value) })} style={STUNDEN_SELECT}>
                  {STUNDEN.map((h) => <option key={h} value={h}>{h} Uhr</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--tm-text)' }}>
                bis
                <select value={ruhe.bis} onChange={(e) => saveRuhe({ ...ruhe, bis: Number(e.target.value) })} style={STUNDEN_SELECT}>
                  {STUNDEN.map((h) => <option key={h} value={h}>{h} Uhr</option>)}
                </select>
              </label>
            </div>
          )}
          {role === 'team' && (
            <Row title="Neue Buchungen" subtitle="Buchungen & Anfragen aus allen Kanälen">
              <Switch label="Neue Buchungen" on={prefs?.bookings ?? true} disabled={!prefs} onChange={() => togglePref('bookings')} />
            </Row>
          )}
          {role === 'team' && (
            <Row title="Gäste-Chats" subtitle="Neue Nachrichten von Gästen">
              <Switch label="Gäste-Chats" on={prefs?.guestChats ?? true} disabled={!prefs} onChange={() => togglePref('guestChats')} />
            </Row>
          )}
          <Row title="Interne Gruppen" subtitle="Nachrichten aus Team-Gruppen" last={false}>
            <Switch label="Interne Gruppen" on={prefs?.teamChats ?? true} disabled={!prefs} onChange={() => togglePref('teamChats')} />
          </Row>
          <Row title="✅ Aufgaben & QS" subtitle="Zuweisungen, Kommentare, Vorschläge, QS-Termine">
            <Switch label="Aufgaben & QS" on={prefs?.tasks ?? true} disabled={!prefs} onChange={() => togglePref('tasks')} />
          </Row>
          <Row title="🧹 Reinigung" subtitle="Fertigmeldungen aus den Wohnungen">
            <Switch label="Reinigung" on={prefs?.reinigung ?? true} disabled={!prefs} onChange={() => togglePref('reinigung')} />
          </Row>
          {role === 'team' && (
          <Row title="🛒 Material" subtitle="Bestellung fällig — Bedarf je Standort erreicht">
            <Switch label="Material" on={prefs?.material ?? true} disabled={!prefs} onChange={() => togglePref('material')} />
          </Row>
          )}
          {role === 'team' && (
            <Row title="☎️ Anrufe" subtitle="Meldungen der Telefon-Assistentin (Bereitschaft)">
              <Switch label="Anrufe" on={prefs?.calls ?? true} disabled={!prefs} onChange={() => togglePref('calls')} />
            </Row>
          )}
          <Row title="📺 TV-Boxen & TV-Server" subtitle="Ausfälle und Entwarnungen der TV-Systeme (Sweet Spot & Co.)">
            <Switch label="TV-Boxen & TV-Server" on={prefs?.tv ?? true} disabled={!prefs} onChange={() => togglePref('tv')} />
          </Row>
          <Row title="🔧 System & Betrieb" subtitle="Türschlösser, Überbuchungen, Buchungs-Abgleich" last={!belegeOk && !wb}>
            <Switch label="System & Betrieb" on={prefs?.system ?? true} disabled={!prefs} onChange={() => togglePref('system')} />
          </Row>
          {belegeOk && (
            <Row title="💶 Buchhaltung" subtitle="Neue Belege aus dem Mail-Scan (nur Admins)" last={!wb}>
              <Switch label="Buchhaltung" on={prefs?.buchhaltung ?? true} disabled={!prefs} onChange={() => togglePref('buchhaltung')} />
            </Row>
          )}
          {wb && (
            <Row title="⚡ Ladevorgang gestartet" subtitle="Push, sobald ein Gast zu laden beginnt">
              <Switch label="Ladevorgang gestartet" on={wb.pushStart} onChange={() => toggleWallboxPush('pushStart')} />
            </Row>
          )}
          {wb && (
            <Row title="⚡ Ladevorgang beendet" subtitle="Push mit kWh, Umsatz & Gewinn-Schätzung" last>
              <Switch label="Ladevorgang beendet" on={wb.pushEnd} onChange={() => toggleWallboxPush('pushEnd')} />
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
            background: 'var(--tm-accent-soft)', boxShadow: 'inset 0 0 0 0.5px var(--tm-line)', fontSize: 12.5, lineHeight: 1.55, color: 'var(--tm-accent-dark)',
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
                  <Switch label={`Bereitschaft: ${p.name}`} on={oncallSel.includes(p.id)} onChange={() => toggleOncall(p.id)} />
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
      {showCalls && <CallsPanel onClose={() => { setShowCalls(false); setCallFocus(null) }} focus={callFocus} />}
      {showBeleg && <BelegEinreichen onClose={() => setShowBeleg(false)} />}
      {showLocks && <LocksPanel onClose={() => setShowLocks(false)} />}
      {showMaterial && <MaterialPanel onClose={() => setShowMaterial(false)} />}
      {showPushLog && <PushLogPanel onClose={() => setShowPushLog(false)} />}
      {showDur && <CleaningDurations onClose={() => setShowDur(false)} />}
      {showTempo && <TempoPanel onClose={() => setShowTempo(false)} />}
      {showSchulden && <SchuldenPanel onClose={() => setShowSchulden(false)} />}
      {showAutoReply && <AutoReplyPanel onClose={() => setShowAutoReply(false)} />}
    </div>
  )
}
