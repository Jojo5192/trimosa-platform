'use client'

/**
 * 🏠 §277 „Heute" — der erste Reiter der Team-App (Pascals JUPAS-Referenz):
 * Datumszeile (‹ › blättern, Tipp aufs Datum = zurück zu heute) ·
 * Türcode-Karte (nur der eigene Code, bleibt ohne Netz sichtbar) ·
 * 💬 Warten auf Antwort · 🔑 Anreisen mit Statuspunkten + Reinigungs-/
 * Check-in-Block · 👋 Abreisen · 🔴 Sofort-Aufgaben · 🛠️ Aufgaben heute ·
 * 📅 Morgen. Daten: /api/heute (Türcode, Stays, Status) + /api/tasks +
 * /api/chat/inbox (team). 90 s Client-Cache, Snapshot im Gerätespeicher.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { haptic, tmToast, usePullToRefresh, PullHint, SkeletonRows, EmptyState, portalColor, initials } from '@/components/team/ux'
import type { HeuteDaten, HeuteAnreise, HeuteStay } from '@/lib/heute'
import { shouldPoll } from '@/lib/offline'

type Thread = {
  id: string; guestName: string; listingTitle: string | null; bookingId?: string | null
  platform: string; lastMessageAt: string | null; lastSender: 'guest' | 'host' | null
  lastPreview?: string | null; noReplyNeeded: boolean; phoneResolved: boolean
}
type Task = {
  id: string; title: string; prio: 'hoch' | 'mittel' | 'niedrig'; status: string
  due_date: string | null; listing_id: string | null; location_group: string | null
}

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
const CARD: CSSProperties = { background: 'var(--tm-card)', border: '1px solid var(--tm-line)', borderRadius: 20, boxShadow: 'var(--tm-shadow)', overflow: 'hidden' }
function Card({ title, count, right, children }: { title: string; count?: number; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="tm-stagger" style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 16px 6px' }}>
        <span style={{ flex: 1, fontSize: 16.5, fontWeight: 800, color: 'var(--tm-text)', letterSpacing: '-0.01em' }}>{title}</span>
        {right}
        {count !== undefined && <span className="tm-num" style={{ fontSize: 14, fontWeight: 700, color: 'var(--tm-muted2)' }}>{count}</span>}
      </div>
      {children}
    </section>
  )
}
function Avatar({ name, platform, size = 40 }: { name: string | null; platform: string; size?: number }) {
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
      width: 22, height: 22, borderRadius: 7, background: DOT[tone].bg, color: DOT[tone].fg,
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
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
        cursor: onClick ? 'pointer' : 'default',
        boxShadow: last ? 'none' : 'inset 0 -1px 0 var(--tm-line)',
      }}
    >{children}</div>
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
  const [threads, setThreads] = useState<Thread[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [storedCode, setStoredCode] = useState<{ code: string; listings: string[]; firstName: string | null } | null>(null)
  const lastLoad = useRef<Record<string, number>>({})
  const inflight = useRef<Set<string>>(new Set())
  const scrollRef = useRef<HTMLDivElement | null>(null)

  /* Snapshot: Oberfläche steht sofort, Abgleich läuft dahinter */
  useEffect(() => {
    try {
      const snap = JSON.parse(localStorage.getItem(SNAP_KEY) ?? 'null') as { data?: HeuteDaten; tasks?: Task[]; threads?: Thread[] } | null
      if (snap?.data && snap.data.tag === heute) {
        setData({ [heute]: snap.data })
        setTasks(snap.tasks ?? [])
        setThreads(snap.threads ?? [])
        setLoading(false)
      }
      const c = JSON.parse(localStorage.getItem(CODE_KEY) ?? 'null')
      if (c?.code) setStoredCode(c)
    } catch { /* Gerätespeicher leer */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const load = useCallback(async (t: string, fresh = false) => {
    if (inflight.current.has(t) && !fresh) return
    inflight.current.add(t)
    try {
      const [h, tk, ib] = await Promise.all([
        fetch(`/api/heute?tag=${t}${fresh ? '&fresh=1' : ''}`, { cache: 'no-store' }),
        fetch('/api/tasks', { cache: 'no-store' }),
        role === 'team' ? fetch('/api/chat/inbox', { cache: 'no-store' }) : Promise.resolve(null),
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
      const ij = ib && ib.ok ? await ib.json() : { threads: [] }
      const d = hj as HeuteDaten
      setData((prev) => ({ ...prev, [t]: d }))
      setTasks(tj.tasks ?? [])
      setThreads(ij.threads ?? [])
      setError(null)
      lastLoad.current[t] = Date.now()
      if (t === d.heute) {
        try {
          localStorage.setItem(SNAP_KEY, JSON.stringify({ data: d, tasks: (tj.tasks ?? []).slice(0, 80), threads: (ij.threads ?? []).slice(0, 60) }))
          if (d.doorCode) localStorage.setItem(CODE_KEY, JSON.stringify({ ...d.doorCode, firstName: d.firstName }))
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
    const onRefresh = () => { if (visible) load(tag, true) }
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
  const dayTasks = useMemo(() => {
    const open = tasks.filter((t) => t.status === 'offen' || t.status === 'in_arbeit')
    const list = istHeute
      ? open.filter((t) => !!t.due_date && t.due_date <= heute)
      : open.filter((t) => t.due_date === tag)
    return list.sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
  }, [tasks, istHeute, heute, tag])
  const sofort = useMemo(() => istHeute ? tasks.filter((t) => t.prio === 'hoch' && (t.status === 'offen' || t.status === 'in_arbeit')) : [], [tasks, istHeute])
  const warten = useMemo(() => role === 'team' && istHeute
    ? threads.filter((t) => t.lastSender === 'guest' && !t.noReplyNeeded && !t.phoneResolved)
      .sort((a, b) => String(b.lastMessageAt ?? '').localeCompare(String(a.lastMessageAt ?? '')))
    : [], [threads, role, istHeute])

  // Roter Zähler am Reiter: Anreisen heute + Sofort-Aufgaben + heute geplante
  const heuteData = data[heute]
  useEffect(() => {
    const planned = tasks.filter((t) => (t.status === 'offen' || t.status === 'in_arbeit') && !!t.due_date && t.due_date <= heute)
    const s = tasks.filter((t) => t.prio === 'hoch' && (t.status === 'offen' || t.status === 'in_arbeit'))
    onCount((heuteData?.anreisen.length ?? 0) + s.length + planned.filter((t) => !s.includes(t)).length)
  }, [heuteData, tasks, heute, onCount])

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
  const copyCode = async () => {
    if (!code) return
    haptic()
    try { await navigator.clipboard.writeText(code.code); tmToast('✓ Code kopiert') } catch { tmToast('Kopieren nicht möglich') }
  }

  const stayRow = (s: HeuteStay, sub: string, last: boolean, right?: ReactNode) => (
    <Row key={s.bookingId} last={last} onClick={role === 'team' ? () => openConv(s.bookingId) : undefined}>
      <Avatar name={s.guestName ?? s.listingTitle} platform={s.platform} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 15.5, fontWeight: 700, color: 'var(--tm-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {s.guestName ?? s.listingTitle}
        </span>
        <span style={{ display: 'block', fontSize: 13, color: 'var(--tm-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>
      </span>
      {right}
    </Row>
  )
  const arrivalRow = (a: HeuteAnreise, i: number, all: HeuteAnreise[]) => {
    const dots = (
      <span style={{ display: 'inline-flex', gap: 6, flexShrink: 0 }}>
        <Dot tone={a.infosRaus ? 'green' : 'grey'} title="Anreise-Infos gesendet">✉</Dot>
        <Dot tone={a.codeDa ? 'green' : 'grey'} title="Türcode liegt bereit">🔑</Dot>
        <Dot tone={a.fertig === 'ja' ? 'green' : a.fertig === 'fehler' ? 'red' : 'grey'} title="„Wohnung ist fertig“ gemeldet">{a.fertig === 'gesperrt' ? '🚫' : '✓'}</Dot>
      </span>
    )
    const sub = `${a.guestName ? `${a.listingTitle} · ` : ''}bis ${ddmm(a.checkOut)}${a.persons ? ` · ${a.persons} 👤` : ''}`
    const last = i === all.length - 1
    return (
      <div key={a.bookingId}>
        {stayRow(a, sub, !!a.reinigung || last, dots)}
        {a.reinigung && a.checkin && (
          <div style={{ margin: '0 16px 10px 68px', padding: '8px 12px', borderRadius: 12, background: 'var(--tm-surface2)', fontSize: 12.5, lineHeight: 1.5, boxShadow: last ? 'none' : undefined }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ width: 84, flexShrink: 0, color: 'var(--tm-muted)' }}>🧹 Reinigung</span>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 600, color: a.reinigung.status === 'offen' ? 'var(--tm-red)' : a.reinigung.status === 'laeuft' || a.reinigung.status === 'unklar' ? 'var(--tm-yellow)' : 'var(--tm-green)' }}>{a.reinigung.text}</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ width: 84, flexShrink: 0, color: 'var(--tm-muted)' }}>🕐 Check-in</span>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 600, color: a.checkin.status === 'green' ? 'var(--tm-green)' : a.checkin.status === 'red' ? 'var(--tm-red)' : a.checkin.status === 'yellow' ? 'var(--tm-yellow)' : 'var(--tm-muted)' }}>{a.checkin.text}</span>
            </div>
          </div>
        )}
        {a.reinigung && !last && <div style={{ height: 1, background: 'var(--tm-line)', margin: '0 16px' }} />}
      </div>
    )
  }
  const taskRow = (t: Task, last: boolean) => {
    const overdue = !!t.due_date && t.due_date < heute
    return (
      <Row key={t.id} last={last} onClick={() => openTask(t.id)}>
        <span style={{ width: 9, height: 9, borderRadius: 5, flexShrink: 0, background: t.prio === 'hoch' ? 'var(--tm-red)' : t.prio === 'mittel' ? 'var(--tm-yellow)' : 'var(--tm-muted2)' }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--tm-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</span>
          {(overdue || t.due_date) && (
            <span style={{ display: 'block', fontSize: 12.5, marginTop: 2, color: overdue ? 'var(--tm-yellow)' : 'var(--tm-muted)' }}>
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 14px 0' }}>

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
          <section style={{ borderRadius: 22, padding: '14px 16px 15px', color: '#fff', background: 'linear-gradient(135deg, var(--tm-accent) 0%, var(--tm-accent-dark) 100%)', boxShadow: 'var(--tm-shadow-float)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                🔑 Türcode{firstName ? ` · ${firstName}` : ''}{role === 'provider' ? ' · Team' : ''}
              </span>
              <button className="tm-press-btn" onClick={copyCode} style={{ border: 'none', cursor: 'pointer', borderRadius: 999, padding: '7px 14px', fontSize: 13, fontWeight: 700, color: '#fff', background: 'rgba(255,255,255,0.22)', backdropFilter: 'blur(6px)' }}>Kopieren</button>
            </div>
            <div className="tm-num" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 30, fontWeight: 800, letterSpacing: '7px', marginTop: 8, lineHeight: 1.1 }}>{code.code}</div>
            <div style={{ fontSize: 12.5, opacity: 0.85, marginTop: 6 }}>
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
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Dot tone="green">✓</Dot> „fertig“ gemeldet</span>
            </div>
          </Card>
        )}

        {/* 💬 Warten auf Antwort — IMMER sichtbar (Pascal 9.9.: offene Nachrichten
            gehören aufs Home-Fenster; leer = „alles beantwortet"), Reihenfolge wie
            in Pascals Stand: Anreisen → Warten → Abreisen → Aufgaben */}
        {d && (
          <Card title="💬 Warten auf Antwort" count={warten.length}>
            {warten.length === 0 && <Empty text="Keine offenen Nachrichten – alles beantwortet." />}
            {warten.slice(0, 6).map((t, i, arr) => (
              <Row key={t.id} last={i === arr.length - 1 && warten.length <= 6} onClick={() => { openTab('chat'); window.dispatchEvent(new CustomEvent('trimosa-open-conv', { detail: { id: t.id } })) }}>
                <Avatar name={t.guestName} platform={t.platform} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 15.5, fontWeight: 700, color: 'var(--tm-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.guestName}</span>
                  <span style={{ display: 'block', fontSize: 13, color: 'var(--tm-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.lastPreview || t.listingTitle || ''}</span>
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
            {d.abreisen.map((s, i, arr) => stayRow(s, `${s.guestName ? `${s.listingTitle} · ` : ''}seit ${ddmm(s.checkIn)}`, i === arr.length - 1))}
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
