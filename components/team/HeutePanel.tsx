'use client'

/**
 * 🏠 §277 „Heute" — der erste Reiter der Team-App (Pascals JUPAS-Referenz):
 * Datumszeile (‹ › blättern, Tipp aufs Datum = zurück zu heute) ·
 * Türcode-Karte (nur der eigene Code, bleibt ohne Netz sichtbar) ·
 * 💬 Warten auf Antwort · 🔑 Anreisen mit Statuspunkten (✉ 🔑) + Vier-Schritte-
 * Leiste (begonnen → fertig → informiert → eingecheckt, nur heute; Admin-Knopf
 * „Gast jetzt informieren") · 👋 Abreisen (Pille „bis 10:00" bzw. „✓ 08:40" + Zeile
 * „ausgecheckt 08:40 (laut Gast)", wenn der Gast sich im Chat abgemeldet hat) ·
 * 🔴 Sofort-Aufgaben · 🛠️ Aufgaben heute ·
 * 📅 Morgen. Daten: /api/heute (Türcode, Stays, Status) + /api/tasks;
 * die Gäste-Threads kommen aus lib/inbox-store (Quelle: ChatPanel — dieselbe
 * Liste wie Inbox-Badge und Chip „Offen · n", Pascal 12.9.). 90 s Client-Cache,
 * Snapshot im Gerätespeicher.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { haptic, tmToast, usePullToRefresh, PullHint, SkeletonRows, EmptyState, portalColor, initials } from '@/components/team/ux'
import type { HeuteDaten, HeuteAnreise, HeuteStay, HeuteProzess, HeuteSchritt, SchrittStatus } from '@/lib/heute'
import { shouldPoll, isOnline } from '@/lib/offline'
import { isOffenThread, requestInboxReload, useInboxThreads, useInboxReady, type InboxThreadLite } from '@/lib/inbox-store'

type Thread = InboxThreadLite
const NO_THREADS: Thread[] = []
type Task = {
  id: string; title: string; prio: 'hoch' | 'mittel' | 'niedrig'; status: string
  due_date: string | null; listing_id: string | null; location_group: string | null
  /** manuell | ki_nachricht | ki_bewertung | anruf | qs | system (Migration 20260716) */
  source?: string | null
  description?: string | null
}
/** Pascal 9.9. (Chefsache): „Sofort" = nur Unmittelbares wie Rückruf oder Rechnung ausstellen —
 *  Büro-Handlungen, keine Reparaturen (Jalousie, Verdunkelung → nur Aufgaben-Reiter).
 *  Regel: Rückruf-Aufgaben (source anruf) immer; sonst Prio hoch UND Titel/Beschreibung nennt
 *  eine solche Handlung; nie, wenn ein Termin in der Zukunft steht. */
const SOFORT_RE = /rechnung|r[üu]ckruf|zur[üu]ckrufen|storn|zahlung|erstatt|gutschrift|[üu]berweis|mahnung|check-?in|zugang|t[üu]rcode|schl[üu]ssel|wlan|parkplatz/i
const hmBerlin = (iso: string) => new Date(iso).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })
const berlinHmNow = () => hmBerlin(new Date().toISOString())
const istSofort = (t: Task, heute: string) => (t.status === 'offen' || t.status === 'in_arbeit')
  && (!t.due_date || t.due_date <= heute)
  && (t.source === 'anruf' || (t.prio === 'hoch' && SOFORT_RE.test(`${t.title} ${t.description ?? ''}`)))

const SNAP_KEY = 'trimosa-heute-v1'
const CODE_KEY = 'trimosa-door-code'
const STALE_MS = 90_000
const DAYS = ['SONNTAG', 'MONTAG', 'DIENSTAG', 'MITTWOCH', 'DONNERSTAG', 'FREITAG', 'SAMSTAG']
const MONTHS = ['JANUAR', 'FEBRUAR', 'MÄRZ', 'APRIL', 'MAI', 'JUNI', 'JULI', 'AUGUST', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DEZEMBER']

function berlinToday(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date())
}
function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}
function ddmm(ymd: string | null | undefined): string {
  return ymd ? `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.` : ''
}
function dateLabel(tag: string, heute: string): string {
  const d = new Date(tag + 'T12:00:00Z')
  const base = `${DAYS[d.getUTCDay()]}, ${tag.slice(8, 10)}. ${MONTHS[d.getUTCMonth()]}`
  if (tag === heute) return `HEUTE · ${base}`
  if (tag === addDays(heute, 1)) return `MORGEN · ${base}`
  if (tag === addDays(heute, -1)) return `GESTERN · ${base}`
  return base
}

/* ── kleine Bausteine ── */
// iOS-27-Runde: eine Kartenform app-weit — Radius-Token + Kanten-Rezept light (Haarlinie innen + weicher Schatten), kein backdrop-filter
const CARD: CSSProperties = { background: 'var(--tm-card)', borderRadius: 'var(--tm-r-card)', boxShadow: 'inset 0 0 0 0.5px var(--tm-line), var(--tm-shadow)', overflow: 'hidden' }
function Card({ title, count, right, children }: { title: string; count?: number; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="tm-stagger" style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px 5px' }}>
        <span style={{ flex: 1, fontSize: 15, fontWeight: 800, color: 'var(--tm-text)', letterSpacing: '-0.01em' }}>{title}</span>
        {right}
        {count !== undefined && <span className="tm-num" style={{ fontSize: 14, fontWeight: 700, color: 'var(--tm-muted2)' }}>{count}</span>}
      </div>
      {children}
    </section>
  )
}
function Avatar({ name, platform, size = 36 }: { name: string | null; platform: string; size?: number }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: Math.round(size * 0.32), flexShrink: 0,
      background: portalColor(platform), color: '#fff', fontWeight: 800, fontSize: Math.round(size * 0.36),
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', letterSpacing: '0.02em',
    }}>{initials(name ?? '')}</span>
  )
}
const DOT: Record<'green' | 'grey' | 'red' | 'yellow', { bg: string; fg: string }> = {
  green: { bg: 'var(--tm-green-soft)', fg: 'var(--tm-green)' },
  grey: { bg: 'var(--tm-surface2)', fg: 'var(--tm-muted2)' },
  red: { bg: 'var(--tm-red-soft)', fg: 'var(--tm-red)' },
  yellow: { bg: 'var(--tm-yellow-soft)', fg: 'var(--tm-yellow)' },
}
function Dot({ tone, children, title }: { tone: keyof typeof DOT; children: ReactNode; title?: string }) {
  return (
    <span title={title} style={{
      width: 20, height: 20, borderRadius: 6, background: DOT[tone].bg, color: DOT[tone].fg,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, flexShrink: 0,
    }}>{children}</span>
  )
}
function Row({ onClick, children, last }: { onClick?: () => void; children: ReactNode; last?: boolean }) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      className={onClick ? 'tm-press' : undefined}
      onClick={onClick ? () => { haptic(); onClick() } : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
        cursor: onClick ? 'pointer' : 'default',
        boxShadow: last ? 'none' : 'inset 0 -1px 0 var(--tm-line)',
      }}
    >{children}</div>
  )
}

/* ── Vier-Schritte-Leiste je Anreise (Pascal 17.9.): 1 begonnen · 2 fertig · 3 informiert · 4 eingecheckt ──
   Eine Zeile: Statuskreis + Uhrzeit, darunter klein die Beschriftung. erledigt grün · aktiv gelb · offen grau ·
   Fehler rot. Tipp auf die Leiste klappt die Detailzeilen auf (Touch hat keinen Tooltip). */
const S_KURZ: Record<HeuteSchritt['key'], string> = { begonnen: 'Begonnen', fertig: 'Fertig', informiert: 'Informiert', eingecheckt: 'Eingecheckt' }
const S_LANG: Record<HeuteSchritt['key'], string> = { begonnen: 'Reinigung begonnen', fertig: 'Reinigung fertig', informiert: 'Gast informiert', eingecheckt: 'Eingecheckt' }
const S_TON: Record<SchrittStatus, { bg: string; fg: string; bd: string; txt: string }> = {
  erledigt: { bg: 'var(--tm-green)', fg: '#fff', bd: 'var(--tm-green)', txt: 'var(--tm-green)' },
  aktiv: { bg: 'var(--tm-yellow-soft)', fg: 'var(--tm-yellow)', bd: 'var(--tm-yellow)', txt: 'var(--tm-yellow)' },
  offen: { bg: 'transparent', fg: 'var(--tm-muted)', bd: 'var(--tm-muted2)', txt: 'var(--tm-muted)' },
  fehler: { bg: 'var(--tm-red)', fg: '#fff', bd: 'var(--tm-red)', txt: 'var(--tm-red)' },
}
const HINT_TON: Record<'red' | 'yellow' | 'grey', string> = { red: 'var(--tm-red)', yellow: 'var(--tm-yellow)', grey: 'var(--tm-muted)' }
function ProzessLeiste({ p, earlyBlock, note, canInform, busy, onInform }: {
  p: HeuteProzess; earlyBlock: string | null; note: string | null; canInform: boolean; busy: boolean; onInform: () => void
}) {
  const [open, setOpen] = useState(false)
  const schritte = Array.isArray(p.schritte) ? p.schritte : []
  const hinweise = Array.isArray(p.hinweise) ? p.hinweise : []
  return (
    <div data-prozess style={{ margin: '0 14px 8px', padding: '7px 4px 6px', borderRadius: 11, background: 'var(--tm-surface2)' }}>
      <div
        role="button" aria-expanded={open} aria-label="Ablauf der Anreise – Details ein-/ausblenden" className="tm-press"
        onClick={() => { haptic(); setOpen((o) => !o) }}
        style={{ display: 'grid', gridTemplateColumns: `repeat(${schritte.length || 1}, minmax(0, 1fr))`, gap: 2, cursor: 'pointer' }}
      >
        {schritte.map((s, i) => {
          const t = S_TON[s.status] ?? S_TON.offen
          return (
            <div key={s.key} style={{ minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span style={{ maxWidth: '100%', minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <span aria-hidden style={{
                  width: 17, height: 17, borderRadius: 9, flexShrink: 0, boxSizing: 'border-box',
                  border: `1.5px solid ${t.bd}`, background: t.bg, color: t.fg,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, lineHeight: 1,
                }}>{s.status === 'erledigt' ? '✓' : s.status === 'fehler' ? '!' : i + 1}</span>
                <span className="tm-num" style={{ minWidth: 0, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: s.status === 'erledigt' ? 'var(--tm-text)' : t.txt }}>{s.zeit ?? '–'}</span>
              </span>
              <span style={{ maxWidth: '100%', fontSize: 10, fontWeight: 600, color: 'var(--tm-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{S_KURZ[s.key] ?? s.key}</span>
            </div>
          )
        })}
      </div>
      {open && (
        <div style={{ margin: '7px 6px 0', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {schritte.map((s, i) => (
            <div key={s.key} style={{ display: 'flex', gap: 6, fontSize: 12, lineHeight: 1.4 }}>
              <span style={{ width: 12, flexShrink: 0, fontWeight: 800, color: (S_TON[s.status] ?? S_TON.offen).txt }}>{i + 1}</span>
              <span style={{ flex: 1, minWidth: 0, color: 'var(--tm-muted)', overflowWrap: 'anywhere' }}>
                <span style={{ fontWeight: 700, color: 'var(--tm-text)' }}>{S_LANG[s.key] ?? s.key}</span> · {s.text}
              </span>
            </div>
          ))}
        </div>
      )}
      {hinweise.map((h, i) => (
        <div key={i} style={{ margin: '6px 6px 0', fontSize: 12, lineHeight: 1.4, fontWeight: 600, color: HINT_TON[h.ton] ?? HINT_TON.grey, overflowWrap: 'anywhere' }}>{h.text}</div>
      ))}
      {earlyBlock && (
        <div style={{ margin: '6px 6px 0', fontSize: 12, lineHeight: 1.4, fontWeight: 600, color: 'var(--tm-yellow)', overflowWrap: 'anywhere' }}>🔧 Early Check-in gesperrt — {earlyBlock}</div>
      )}
      {note && (
        <div style={{ margin: '6px 6px 0', fontSize: 12, lineHeight: 1.4, fontWeight: 600, color: 'var(--tm-red)', overflowWrap: 'anywhere' }}>{note}</div>
      )}
      {canInform && (
        <button
          className="tm-press-btn" disabled={busy} onClick={onInform}
          style={{ display: 'block', width: 'calc(100% - 4px)', minHeight: 40, margin: '8px 2px 0', padding: '8px 12px', border: 'none', borderRadius: 11, background: 'var(--tm-navy)', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
        >{busy ? 'Wird gesendet …' : 'Gast jetzt informieren'}</button>
      )}
    </div>
  )
}
function Empty({ text }: { text: string }) {
  return <div style={{ padding: '6px 16px 16px', fontSize: 14, color: 'var(--tm-muted2)' }}>{text}</div>
}

export default function HeutePanel({ role, visible, onCount }: {
  role: 'team' | 'provider'
  visible: boolean
  onCount: (n: number) => void
}) {
  const heute = berlinToday()
  const [tag, setTag] = useState(heute)
  const [data, setData] = useState<Record<string, HeuteDaten>>({})
  // Gäste-Threads: gemeinsamer Stand (ChatPanel veröffentlicht) statt eigenem Inbox-Abruf —
  // „Warten auf Antwort", Heute-Zähler, Inbox-Badge und Chip „Offen" zeigen so dieselbe Zahl
  const liveThreads = useInboxThreads()
  const inboxReady = useInboxReady()
  const threads = role === 'team' ? liveThreads : NO_THREADS
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [storedCode, setStoredCode] = useState<{ code: string; listings: string[]; firstName: string | null; roleLabel?: string | null } | null>(null)
  // Knopf „Gast jetzt informieren": laufender Versand (Buchung) + letzte Ablehnung je Buchung (bleibt lesbar stehen)
  const [informBusy, setInformBusy] = useState<string | null>(null)
  const [informNote, setInformNote] = useState<Record<string, string>>({})
  const lastLoad = useRef<Record<string, number>>({})
  const inflight = useRef<Set<string>>(new Set())
  const scrollRef = useRef<HTMLDivElement | null>(null)

  /* Snapshot: Oberfläche steht sofort, Abgleich läuft dahinter */
  useEffect(() => {
    try {
      const snap = JSON.parse(localStorage.getItem(SNAP_KEY) ?? 'null') as { data?: HeuteDaten; tasks?: Task[] } | null
      if (snap?.data && snap.data.tag === heute) {
        setData({ [heute]: snap.data })
        setTasks(snap.tasks ?? [])
        setLoading(false)
      }
      const c = JSON.parse(localStorage.getItem(CODE_KEY) ?? 'null')
      if (c?.code) setStoredCode(c)
    } catch { /* Gerätespeicher leer */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const load = useCallback(async (t: string, fresh = false, askInbox = true) => {
    if (inflight.current.has(t) && !fresh) return
    inflight.current.add(t)
    // Gäste-Threads lädt das ChatPanel — hier nur um einen (gebremsten) Listen-Abgleich bitten
    if (askInbox && role === 'team') requestInboxReload()
    try {
      const [h, tk] = await Promise.all([
        fetch(`/api/heute?tag=${t}${fresh ? '&fresh=1' : ''}`, { cache: 'no-store' }),
        fetch('/api/tasks', { cache: 'no-store' }),
      ])
      if (h.status === 401 || h.status === 403) {
        try { localStorage.removeItem(CODE_KEY); localStorage.removeItem(SNAP_KEY) } catch { /* egal */ }
        setError('Sitzung abgelaufen — bitte neu anmelden.')
        setLoading(false)
        return
      }
      const hj = await h.json()
      if (!h.ok) throw new Error(hj.error ?? `HTTP ${h.status}`)
      const tj = tk.ok ? await tk.json() : { tasks: [] }
      const d = hj as HeuteDaten
      // Ohne Netz liefert der Service Worker die LETZTE gespeicherte Antwort (Header X-Trimosa-Offline).
      // Die wird angezeigt, gilt aber nicht als frisch: kein Sync-Zeitpunkt, kein Snapshot, beim
      // nächsten Anlass wird neu geladen — sonst steht ein alter Stand („noch nicht begonnen") als aktuell da.
      const alterStand = h.headers.get('X-Trimosa-Offline') === '1'
      setData((prev) => ({ ...prev, [t]: d }))
      setTasks(tj.tasks ?? [])
      setError(null)
      if (alterStand) return
      lastLoad.current[t] = Date.now()
      if (t === d.heute) {
        try {
          localStorage.setItem(SNAP_KEY, JSON.stringify({ data: d, tasks: (tj.tasks ?? []).slice(0, 80) }))
          if (d.doorCode) localStorage.setItem(CODE_KEY, JSON.stringify({ ...d.doorCode, firstName: d.firstName, roleLabel: d.roleLabel }))
          else localStorage.removeItem(CODE_KEY)
        } catch { /* quota */ }
      }
      window.dispatchEvent(new Event('trimosa-synced'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Keine Verbindung.')
    } finally {
      inflight.current.delete(t)
      setLoading(false)
    }
  }, [role])

  // Start + Tageswechsel + beim Öffnen des Reiters (immer zurück auf heute)
  useEffect(() => { load(heute) }, [load, heute])
  useEffect(() => {
    if (!visible) return
    setTag(heute)
    if (Date.now() - (lastLoad.current[heute] ?? 0) > STALE_MS) load(heute)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])
  useEffect(() => {
    if (tag === heute) return
    if (Date.now() - (lastLoad.current[tag] ?? 0) > STALE_MS) load(tag)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag])
  useEffect(() => {
    // Aktualisieren-Knopf: die Inbox-Liste lädt das ChatPanel dabei selbst (trimosa-refresh)
    const onRefresh = () => { if (visible) load(tag, true, false) }
    const onVis = () => { if (document.visibilityState === 'visible' && visible && Date.now() - (lastLoad.current[tag] ?? 0) > STALE_MS) load(tag) }
    window.addEventListener('trimosa-refresh', onRefresh)
    document.addEventListener('visibilitychange', onVis)
    return () => { window.removeEventListener('trimosa-refresh', onRefresh); document.removeEventListener('visibilitychange', onVis) }
  }, [visible, tag, load])
  useEffect(() => {
    if (!visible) return
    const t = setInterval(() => { if (shouldPoll('heute')) load(tag) }, 120_000) // §280: offline pausieren
    return () => clearInterval(t)
  }, [visible, tag, load])
  const ptr = usePullToRefresh(scrollRef, useCallback(() => load(tag, true), [load, tag]))

  const d = data[tag]
  const istHeute = tag === heute
  // Pascal 9.9.: „Aufgaben heute" NUR mit Termin genau an diesem Tag (Überfälliges bleibt im
  // Aufgaben-Reiter), „Sofort" nur KI-erkannte Unmittelbares — nichts steht doppelt.
  const dayTasks = useMemo(() => {
    const open = tasks.filter((t) => t.status === 'offen' || t.status === 'in_arbeit')
    return open.filter((t) => t.due_date === tag).sort((a, b) => a.title.localeCompare(b.title, 'de'))
  }, [tasks, tag])
  const sofort = useMemo(() => istHeute ? tasks.filter((t) => istSofort(t, heute) && t.due_date !== heute) : [], [tasks, istHeute, heute])
  const warten = useMemo(() => role === 'team' && istHeute
    ? threads.filter(isOffenThread)
      .sort((a, b) => String(b.lastMessageAt ?? '').localeCompare(String(a.lastMessageAt ?? '')))
    : [], [threads, role, istHeute])

  // Roter Zähler am Reiter (Pascal 9.9. 15:04–15:08, verbindlich): NUR Handlungsbedarf —
  // Sofort-Aufgaben + heute geplante Aufgaben + offene Gast-Nachrichten + Anreisen NUR, wenn
  // noch ein Häkchen fehlt (Infos nicht raus, Türcode fehlt, Reinigung nicht „fertig" gemeldet).
  // Abreisen und komplett grüne Anreisen sind Information, kein To-do.
  const heuteData = data[heute]
  useEffect(() => {
    const planned = tasks.filter((t) => (t.status === 'offen' || t.status === 'in_arbeit') && t.due_date === heute)
    const s = tasks.filter((t) => istSofort(t, heute) && t.due_date !== heute)
    const offen = role === 'team' ? threads.filter(isOffenThread).length : 0
    const anreisenOffen = (heuteData?.anreisen ?? []).filter((a) => !(a.infosRaus && a.codeDa && a.fertig === 'ja')).length
    onCount(s.length + planned.length + offen + anreisenOffen)
  }, [heuteData, tasks, threads, role, heute, onCount])

  /* Ziele öffnen */
  const openTab = (id: string) => window.dispatchEvent(new CustomEvent('trimosa-open-tab', { detail: id }))
  const openConv = (bookingId: string) => {
    const t = threads.find((x) => x.id === bookingId || x.bookingId === bookingId)
    if (!t) { openTab('kalender'); return }
    openTab('chat')
    window.dispatchEvent(new CustomEvent('trimosa-open-conv', { detail: { id: t.id } }))
  }
  const openTask = (id: string) => window.dispatchEvent(new CustomEvent('trimosa-open-task', { detail: { id } }))

  const code = d?.doorCode ?? heuteData?.doorCode ?? (storedCode ? { code: storedCode.code, listings: storedCode.listings } : null)
  const firstName = d?.firstName ?? heuteData?.firstName ?? storedCode?.firstName ?? null
  const roleLabel = d?.roleLabel ?? heuteData?.roleLabel ?? storedCode?.roleLabel ?? null
  // Paragraph 308: Rollen-Ansicht (Reinigungs-Dienstleister: nur An-/Abreisen; Handwerker: Aufgaben + An-/Abreisen)
  const view: 'full' | 'cleaning' | 'provider' = d?.heuteView ?? heuteData?.heuteView ?? (role === 'provider' ? 'provider' : 'full')
  const copyCode = async () => {
    if (!code) return
    haptic()
    try { await navigator.clipboard.writeText(code.code); tmToast('✓ Code kopiert') } catch { tmToast('Kopieren nicht möglich') }
  }

  /* 📣 Schritt 3 von Hand: Bestätigungsdialog → POST /api/heute/inform. Die EINZIGE Stelle, die diese
     Nachricht auf Knopfdruck sendet; der Server prüft Sperren, Master-Schalter und Doppelversand. */
  const inform = async (a: HeuteAnreise) => {
    if (informBusy) return
    if (!isOnline()) { tmToast('Offline – nicht gesendet.'); return }
    haptic()
    const warn = a.prozess?.warnung ? `⚠️ ${a.prozess.warnung}\n\n` : ''
    if (!window.confirm(`${warn}„Wohnung ist bereit“ jetzt an ${a.guestName ?? 'den Gast'} senden?\n\n${a.listingTitle}: Der Gast erfährt, dass er schon vor ${a.checkInTime} Uhr einchecken kann.`)) return
    setInformBusy(a.bookingId)
    const post = async (erneut: boolean): Promise<{ ok?: boolean; code?: string; message?: string }> => {
      const r = await fetch('/api/heute/inform', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ bookingId: a.bookingId, bestaetigt: true, ...(erneut ? { erneut: true } : {}) }),
      })
      return await r.json().catch(() => ({ ok: false, message: `Senden fehlgeschlagen (HTTP ${r.status}).` }))
    }
    try {
      let res = await post(false)
      if (!res.ok && res.code === 'unklar'
        && window.confirm('Ein früherer Versand hängt – die Nachricht ist vielleicht schon beim Gast angekommen (bitte im Chat prüfen).\n\nTrotzdem erneut senden?')) {
        res = await post(true)
      }
      const msg = res.message ?? (res.ok ? 'Gast informiert.' : 'Senden fehlgeschlagen.')
      setInformNote((n) => { const next = { ...n }; if (res.ok) delete next[a.bookingId]; else next[a.bookingId] = msg; return next })
      tmToast(res.ok ? `✓ ${msg}` : msg)
    } catch {
      setInformNote((n) => ({ ...n, [a.bookingId]: 'Verbindung unterbrochen – bitte im Chat prüfen, ob die Nachricht rausging.' }))
      tmToast('Verbindung unterbrochen.')
    } finally {
      setInformBusy(null)
      load(tag, true, false)
    }
  }

  const stayRow = (s: HeuteStay, sub: string, last: boolean, right?: ReactNode, extra?: ReactNode) => (
    <Row key={s.bookingId} last={last} onClick={role === 'team' ? () => openConv(s.bookingId) : undefined}>
      <Avatar name={s.guestName ?? s.listingTitle} platform={s.platform} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: 'var(--tm-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {s.guestName ?? s.listingTitle}
        </span>
        <span style={{ display: 'block', fontSize: 12.5, color: 'var(--tm-muted)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>
        {extra}
      </span>
      {right}
    </Row>
  )
  /* 👋 Abreise-Zeile (Check-out-Erkennung, lib/checkout-detect.ts): hat der Gast am Abreisetag im Chat
     gemeldet, dass er weg ist, steht rechts grün „✓ 08:40" und darunter „ausgecheckt 08:40 (laut Gast)" —
     sonst grau „bis 10:00" (Check-out-Zeit der Wohnung). Reine Information; alte Snapshots kennen
     `checkout` nicht (dann wie „nicht gemeldet"). */
  const departRow = (s: HeuteStay, last: boolean) => {
    const coHm = s.checkout?.at && !Number.isNaN(Date.parse(s.checkout.at)) ? hmBerlin(s.checkout.at) : null
    const label = coHm ? `✓ ${coHm}` : s.checkOutTime ? `bis ${s.checkOutTime}` : null
    const pill = label ? (
      <span className="tm-num" data-checkout={coHm ? 'gemeldet' : 'offen'} style={{
        flexShrink: 0, padding: '4px 9px', borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
        background: coHm ? 'var(--tm-green-soft)' : 'var(--tm-surface2)', color: coHm ? 'var(--tm-green)' : 'var(--tm-muted)',
      }}>{label}</span>
    ) : undefined
    const extra = coHm ? (
      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--tm-green)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        ausgecheckt {coHm} (laut Gast)
      </span>
    ) : undefined
    // gemeldet: die reguläre Check-out-Zeit bleibt sichtbar (die Meldung ist eine Aussage des Gastes, keine Messung)
    const wann = coHm && s.checkOutTime ? `regulär bis ${s.checkOutTime}` : `seit ${ddmm(s.checkIn)}`
    return stayRow(s, `${s.guestName ? `${s.listingTitle} · ` : ''}${wann}`, last, pill, extra)
  }
  const arrivalRow = (a: HeuteAnreise, i: number, all: HeuteAnreise[]) => {
    // Leiste nur mit vollständigem Schritt-Modell — alte Snapshots/Offline-Antworten kennen `prozess` nicht
    const p = a.prozess && Array.isArray(a.prozess.schritte) && a.prozess.schritte.length ? a.prozess : null
    const dots = (
      <span style={{ display: 'inline-flex', gap: 6, flexShrink: 0 }}>
        <Dot tone={a.infosRaus ? 'green' : 'grey'} title="Anreise-Infos gesendet">✉</Dot>
        <Dot tone={a.codeDa ? 'green' : 'grey'} title="Türcode liegt bereit">🔑</Dot>
        {/* „fertig gemeldet" + „eingecheckt" stehen heute in der Vier-Schritte-Leiste (Schritt 3/4) —
            die beiden Punkte nur noch ohne Leiste (andere Tage, alter Snapshot/Offline-Stand) */}
        {!p && <Dot tone={a.fertig === 'ja' ? 'green' : a.fertig === 'fehler' ? 'red' : 'grey'} title="„Wohnung ist fertig“ gemeldet">{a.fertig === 'gesperrt' ? '🚫' : '✓'}</Dot>}
        {/* Paragraph 308: 4. Haken = Gast hat eingecheckt (Tuercode benutzt) - Information, zaehlt nicht mit */}
        {!p && <Dot tone={a.eingecheckt ? 'green' : 'grey'} title={a.eingecheckt ? `Eingecheckt ${hmBerlin(a.eingecheckt)} — Wohnung belegt` : 'Noch nicht eingecheckt'}>🏠</Dot>}
      </span>
    )
    const sub = `${a.guestName ? `${a.listingTitle} · ` : ''}${view !== 'full' ? `Check-in ab ${a.checkInTime} · ` : ''}bis ${ddmm(a.checkOut)}${a.persons ? ` · ${a.persons} 👤` : ''}${(a.stays ?? 1) >= 2 ? ` · ⭐ ${a.stayNr}. Aufenthalt` : ''}`
    const last = i === all.length - 1
    return (
      <div key={a.bookingId}>
        {stayRow(a, sub, !!p || !!a.reinigung || last, dots)}
        {/* Geschwister-Block UNTER der Zeile (die Zeile selbst öffnet den Gast-Chat) */}
        {p && (
          <ProzessLeiste
            p={p} earlyBlock={a.earlyBlock ?? null} note={informNote[a.bookingId] ?? null}
            canInform={role === 'team' && istHeute && p.kannInformieren === true && berlinHmNow() < a.checkInTime}
            busy={informBusy === a.bookingId} onInform={() => inform(a)}
          />
        )}
        {/* Rückfall ohne Leiste (alter Snapshot/Offline-Stand): bisheriger Reinigungs-/Check-in-Block */}
        {!p && a.reinigung && a.checkin && (
          <div style={{ margin: '0 14px 8px 60px', padding: '7px 10px', borderRadius: 11, background: 'var(--tm-surface2)', fontSize: 12, lineHeight: 1.45, boxShadow: last ? 'none' : undefined }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ width: 80, flexShrink: 0, color: 'var(--tm-muted)' }}>🧹 Reinigung</span>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 600, color: a.reinigung.status === 'offen' ? 'var(--tm-red)' : a.reinigung.status === 'laeuft' || a.reinigung.status === 'unklar' ? 'var(--tm-yellow)' : 'var(--tm-green)' }}>{a.reinigung.text}</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ width: 80, flexShrink: 0, color: 'var(--tm-muted)' }}>🕐 Check-in</span>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 600, color: a.checkin.status === 'green' ? 'var(--tm-green)' : a.checkin.status === 'red' ? 'var(--tm-red)' : a.checkin.status === 'yellow' ? 'var(--tm-yellow)' : 'var(--tm-muted)' }}>{a.checkin.text}</span>
            </div>
          </div>
        )}
        {!p && a.earlyBlock && (
          <div style={{ margin: '0 14px 8px 60px', padding: '6px 10px', borderRadius: 11, background: 'var(--tm-surface2)', fontSize: 12, lineHeight: 1.4, color: 'var(--tm-yellow)', fontWeight: 600 }}>
            🔧 Early Check-in gesperrt — {a.earlyBlock}
          </div>
        )}
        {(p || a.reinigung) && !last && <div style={{ height: 1, background: 'var(--tm-line)', margin: '0 14px' }} />}
      </div>
    )
  }
  const taskRow = (t: Task, last: boolean) => {
    const overdue = !!t.due_date && t.due_date < heute
    return (
      <Row key={t.id} last={last} onClick={() => openTask(t.id)}>
        <span style={{ width: 9, height: 9, borderRadius: 5, flexShrink: 0, background: t.prio === 'hoch' ? 'var(--tm-red)' : t.prio === 'mittel' ? 'var(--tm-yellow)' : 'var(--tm-muted2)' }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: 'var(--tm-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</span>
          {(overdue || t.due_date) && (
            <span style={{ display: 'block', fontSize: 12, marginTop: 1, color: overdue ? 'var(--tm-yellow)' : 'var(--tm-muted)' }}>
              {overdue ? `! überfällig seit ${ddmm(t.due_date)}` : `bis ${ddmm(t.due_date)}`}
            </span>
          )}
        </span>
        <span style={{ color: 'var(--tm-muted2)', fontSize: 16 }}>›</span>
      </Row>
    )
  }

  // Pascal 9.9.: Warten- und Aufgaben-Karte stehen immer — der Leerzustand gilt nur noch für An-/Abreisen
  const nothing = !!d && d.anreisen.length === 0 && d.abreisen.length === 0

  return (
    <div ref={scrollRef} style={{ height: '100%', overflowY: 'auto', background: 'var(--tm-bg)', WebkitOverflowScrolling: 'touch', paddingBottom: 'var(--tm-nav-pad)' }}>
      <PullHint pull={ptr.pull} busy={ptr.busy} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 12px 0' }}>

        {/* Datumszeile */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="tm-press-btn" aria-label="Vorheriger Tag" onClick={() => { haptic(); setTag(addDays(tag, -1)) }} style={{ width: 34, height: 34, borderRadius: 12, border: '1px solid var(--tm-line)', background: 'var(--tm-card)', boxShadow: 'var(--tm-shadow)', cursor: 'pointer', color: 'var(--tm-text)', fontSize: 18, lineHeight: 1, padding: 0 }}>‹</button>
          <button className="tm-press-btn" onClick={() => { haptic(); setTag(heute) }} style={{ flex: 1, minWidth: 0, border: 'none', background: 'none', cursor: 'pointer', padding: '6px 0', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--tm-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {dateLabel(tag, heute)}
          </button>
          <button className="tm-press-btn" aria-label="Nächster Tag" onClick={() => { haptic(); setTag(addDays(tag, 1)) }} style={{ width: 34, height: 34, borderRadius: 12, border: '1px solid var(--tm-line)', background: 'var(--tm-card)', boxShadow: 'var(--tm-shadow)', cursor: 'pointer', color: 'var(--tm-text)', fontSize: 18, lineHeight: 1, padding: 0 }}>›</button>
        </div>

        {/* 🔑 Türcode — bleibt an jedem Tag oben stehen */}
        {code ? (
          <section style={{ borderRadius: 'var(--tm-r-card)', padding: '12px 14px 13px', color: '#fff', background: 'linear-gradient(135deg, var(--tm-accent) 0%, var(--tm-accent-dark) 100%)', boxShadow: 'var(--tm-shadow-float)' }}>
            {/* Pascal 9.9. (Chefsache): kein Schlüssel-Symbol; Name größer mit Rolle dahinter,
                „TÜRCODE" als eigene Zeile, Code etwas kleiner — ruhig und symmetrisch */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis' }}>{firstName ?? 'Team'}</span>
                {roleLabel && <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.85, flexShrink: 0 }}>· {roleLabel}</span>}
              </span>
              <button className="tm-press-btn" onClick={copyCode} style={{ border: 'none', cursor: 'pointer', borderRadius: 999, padding: '7px 14px', fontSize: 13, fontWeight: 700, color: '#fff', background: 'rgba(255,255,255,0.22)', flexShrink: 0 }}>Kopieren</button>
            </div>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', opacity: 0.8, marginTop: 12 }}>Türcode</div>
            <div className="tm-num" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 24, fontWeight: 800, letterSpacing: '5px', marginTop: 2, lineHeight: 1.1 }}>{code.code}</div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 5 }}>
              {code.listings.length >= 7 ? 'Alle Wohnungen' : code.listings.length ? code.listings.join(' · ') : 'Alle Schlösser'} · dauerhaft gültig
            </div>
          </section>
        ) : !loading && (
          <section style={{ ...CARD, padding: '12px 16px', fontSize: 13, color: 'var(--tm-muted)', lineHeight: 1.5 }}>
            🔑 Noch kein persönlicher Türcode — wird im Admin-Bereich unter <strong>Türcodes → Personen-Codes</strong> angelegt.
          </section>
        )}

        {error && (
          <div style={{ padding: '10px 14px', borderRadius: 14, background: 'var(--tm-red-soft)', color: 'var(--tm-red)', fontSize: 13, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ flex: 1 }}>{error}</span>
            <button onClick={() => { setLoading(true); load(tag, true) }} style={{ border: 'none', background: 'var(--tm-red)', color: '#fff', borderRadius: 999, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Erneut</button>
          </div>
        )}
        {loading && !d && <SkeletonRows kind="card" count={3} />}

        {d && nothing && (
          <section style={CARD}>
            <EmptyState icon="house" title={istHeute ? 'Heute keine An- oder Abreisen.' : 'Keine An- oder Abreisen an diesem Tag.'} />
          </section>
        )}

        {/* 🔑 Anreisen */}
        {d && d.anreisen.length > 0 && (
          <Card title="🔑 Anreisen" count={d.anreisen.length}>
            {d.anreisen.map((a, i) => arrivalRow(a, i, d.anreisen))}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 18, padding: '10px 12px 12px', margin: '0 16px', boxShadow: 'inset 0 1px 0 var(--tm-line)', fontSize: 11.5, color: 'var(--tm-muted)', flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Dot tone="grey">✉</Dot> Infos raus</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Dot tone="grey">🔑</Dot> Türcode da</span>
              {d.anreisen.some((a) => !a.prozess) && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Dot tone="green">✓</Dot> „fertig“ gemeldet</span>}
            </div>
          </Card>
        )}

        {/* 💬 Warten auf Antwort — IMMER sichtbar (Pascal 9.9.: offene Nachrichten
            gehören aufs Home-Fenster; leer = „alles beantwortet"), Reihenfolge wie
            in Pascals Stand: Anreisen → Warten → Abreisen → Aufgaben */}
        {d && view === 'full' && (
          <Card title="💬 Warten auf Antwort" count={warten.length}>
            {warten.length === 0 && <Empty text={inboxReady || !istHeute ? 'Keine offenen Nachrichten – alles beantwortet.' : 'Lädt …'} />}
            {warten.slice(0, 6).map((t, i, arr) => (
              <Row key={t.id} last={i === arr.length - 1 && warten.length <= 6} onClick={() => { openTab('chat'); window.dispatchEvent(new CustomEvent('trimosa-open-conv', { detail: { id: t.id } })) }}>
                <Avatar name={t.guestName} platform={t.platform} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: 'var(--tm-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.guestName}</span>
                  <span style={{ display: 'block', fontSize: 12.5, color: 'var(--tm-muted)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.lastPreview || t.listingTitle || ''}</span>
                </span>
                <span style={{ color: 'var(--tm-muted2)', fontSize: 16 }}>›</span>
              </Row>
            ))}
            {warten.length > 6 && (
              <button className="tm-press" onClick={() => { haptic(); openTab('chat') }} style={{ width: '100%', border: 'none', background: 'none', cursor: 'pointer', padding: '11px 16px 13px', textAlign: 'left', fontSize: 14, fontWeight: 600, color: 'var(--tm-accent-dark)' }}>
                Alle {warten.length} in der Inbox ›
              </button>
            )}
          </Card>
        )}

        {/* 👋 Abreisen */}
        {d && d.abreisen.length > 0 && (
          <Card title="👋 Abreisen" count={d.abreisen.length}>
            {d.abreisen.map((s, i, arr) => departRow(s, i === arr.length - 1))}
          </Card>
        )}

        {/* 🔴 Sofort-Aufgaben */}
        {sofort.length > 0 && (
          <Card title="🔴 Sofort-Aufgaben" count={sofort.length}>
            {sofort.map((t, i) => taskRow(t, i === sofort.length - 1))}
          </Card>
        )}

        {/* 🛠️ Aufgaben — immer sichtbar, mit „＋ Neu" */}
        <Card
          title={istHeute ? '🛠️ Aufgaben heute' : '🛠️ Aufgaben an diesem Tag'}
          right={
            <button className="tm-press-btn" onClick={() => { haptic(); openTask('new') }} style={{ border: '1px solid var(--tm-line)', background: 'var(--tm-surface2)', color: 'var(--tm-text)', borderRadius: 12, padding: '7px 12px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>＋ Neu</button>
          }
        >
          {dayTasks.length === 0
            ? <Empty text={istHeute ? 'Keine Aufgaben für heute geplant.' : 'Keine Aufgaben für diesen Tag geplant.'} />
            : dayTasks.map((t, i) => taskRow(t, i === dayTasks.length - 1))}
        </Card>

        {/* 📅 Morgen / Am Tag danach */}
        {d && (d.vorschau.anreisen.length > 0 || d.vorschau.abreisen.length > 0) && (
          <Card title={istHeute ? '📅 Morgen' : '📅 Am Tag danach'} count={d.vorschau.anreisen.length + d.vorschau.abreisen.length}>
            {d.vorschau.anreisen.map((s, i, arr) => stayRow(s, `Anreise${s.guestName ? ` · ${s.listingTitle}` : ''}${s.persons ? ` · ${s.persons} 👤` : ''}`, d.vorschau.abreisen.length === 0 && i === arr.length - 1))}
            {d.vorschau.abreisen.map((s, i, arr) => stayRow(s, `Abreise${s.guestName ? ` · ${s.listingTitle}` : ''}`, i === arr.length - 1))}
          </Card>
        )}
      </div>
    </div>
  )
}
