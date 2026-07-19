'use client'

/**
 * 📅 Kalender-Tab: Agenda der nächsten 8 Wochen — Abreisen (= Reinigungs-
 * Slots), Anreisen, Wechsel-Tage und fällige Aufgaben. Dazu LEERSTANDS-
 * INTELLIGENZ: „🔧 Gerade frei" zeigt aktuell leere Wohnungen mit Dauer +
 * passenden offenen Aufgaben, und jede Abreise zeigt das folgende Frei-
 * Fenster („danach 4 Nächte frei") samt Aufgaben-Gelegenheiten.
 * Dienstleister sehen keine Gastnamen (kommen von der API gar nicht erst).
 */
import { useState, useEffect, useCallback } from 'react'

type Stay = { id: string; listingId: string; checkIn: string; checkOut: string; guestName: string | null }
type CalTask = { id: string; title: string; due_date: string | null; status: string; prio: string; listing_id: string | null; location_group: string | null; is_general: boolean }
type CalQs = { id: string; listingId: string; dueDate: string }
type ListingInfo = { title: string; group: string | null }

const DE_DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
const DE_MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const PRIO_DOT: Record<string, string> = { hoch: '#EF4444', mittel: '#F59E0B', niedrig: '#9CA3AF' }

function isoOffset(days: number): string {
  const d = new Date(Date.now() + days * 86400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86400_000)
}
function dayLabel(iso: string, today: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  const base = `${DE_DAYS[d.getUTCDay()]}, ${d.getUTCDate()}. ${DE_MONTHS[d.getUTCMonth()]}`
  if (iso === today) return `Heute · ${base}`
  if (iso === isoOffset(1)) return `Morgen · ${base}`
  return base
}
function fmtShort(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${Number(d)}.${Number(m)}.`
}

/** Offene Aufgaben, die zu dieser Wohnung passen (direkt oder via Standort). */
function tasksForListing(tasks: CalTask[], listingId: string, group: string | null): CalTask[] {
  return tasks.filter((t) =>
    t.listing_id === listingId || (!!t.location_group && !!group && t.location_group === group)
  )
}

function TaskChips({ tasks, max = 3 }: { tasks: CalTask[]; max?: number }) {
  const shown = tasks.slice(0, max)
  const rest = tasks.length - shown.length
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 5, verticalAlign: 'middle' }}>
      {shown.map((t) => (
        <span key={t.id} style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
          padding: '3px 9px', borderRadius: 999, background: '#fff', color: '#4A4438',
          boxShadow: 'inset 0 0 0 0.5px rgba(60,60,67,0.2)',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: PRIO_DOT[t.prio] ?? '#9CA3AF', flexShrink: 0 }} />
          {t.title.length > 34 ? t.title.slice(0, 34) + '…' : t.title}
        </span>
      ))}
      {rest > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#8A7020' }}>+{rest} weitere</span>}
    </span>
  )
}

export default function CalendarPanel() {
  const [stays, setStays] = useState<Stay[]>([])
  const [tasks, setTasks] = useState<CalTask[]>([])
  const [qs, setQs] = useState<CalQs[]>([])
  const [listings, setListings] = useState<Record<string, ListingInfo>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (attempt = 0) => {
    try {
      const res = await fetch('/api/team/calendar', { cache: 'no-store' })
      const text = await res.text()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let j: { [k: string]: any } = {}
      try { j = JSON.parse(text) } catch {
        if (attempt < 1) { setTimeout(() => load(1), 1200); return }
        setError(`Unerwartete Antwort vom Server (HTTP ${res.status}).`)
        setLoading(false)
        return
      }
      if (j.error) setError(j.error)
      else { setStays(j.stays ?? []); setTasks(j.tasks ?? []); setQs(j.qs ?? []); setListings(j.listings ?? {}); setError(null) }
    } catch {
      // iOS-PWA: erster Request nach dem Aufwachen scheitert gern → 1× retry
      if (attempt < 1) { setTimeout(() => load(1), 1200); return }
      setError('Netzwerkfehler beim Laden.')
    }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    const onOnline = () => load()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('online', onOnline)
    }
  }, [load])

  const today = isoOffset(0)
  const rangeEnd = isoOffset(56)
  const overdue = tasks.filter((t) => t.due_date && t.due_date < today)

  /** Nächste Anreise einer Wohnung NACH einem Datum (exklusive). */
  function nextCheckIn(listingId: string, afterIso: string): string | null {
    const next = stays
      .filter((s) => s.listingId === listingId && s.checkIn >= afterIso)
      .sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0]
    return next?.checkIn ?? null
  }

  /* ── „Gerade frei": Wohnungen ohne aktuellen Aufenthalt + ohne Anreise heute ── */
  const freeNow = Object.entries(listings)
    .map(([id, info]) => {
      const occupied = stays.some((s) => s.listingId === id && s.checkIn <= today && s.checkOut > today)
      const arrivingToday = stays.some((s) => s.listingId === id && s.checkIn === today)
      if (occupied || arrivingToday) return null
      const nextIn = nextCheckIn(id, today)
      const nights = nextIn ? daysBetween(today, nextIn) : null
      return { id, title: info.title, nights, nextIn, tasks: tasksForListing(tasks, id, info.group) }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => (b.tasks.length - a.tasks.length) || ((b.nights ?? 99) - (a.nights ?? 99)))

  /* ── 🧠 Planungs-Vorschläge: offene Aufgaben in KOMMENDE Frei-Fenster legen ── */
  const freeNowIds = new Set(freeNow.map((f) => f.id))
  type Slot = { from: string; nights: number | null; to: string | null }
  function nextGap(listingId: string): Slot | null {
    const mine = stays.filter((s) => s.listingId === listingId).sort((a, b) => a.checkIn.localeCompare(b.checkIn))
    if (mine.length === 0) return { from: today, nights: null, to: null }
    for (let i = 0; i < mine.length; i++) {
      const out = mine[i].checkOut
      if (out <= today) continue
      const next = mine.slice(i + 1).find((x) => x.checkIn >= out)
      const nights = next ? daysBetween(out, next.checkIn) : null
      if (nights == null) return { from: out, nights: null, to: null }
      if (nights >= 1) return { from: out, nights, to: next!.checkIn }
      // nights === 0 (Wechseltag) → nächste Lücke suchen
    }
    return null
  }
  const planning = Object.entries(listings)
    .filter(([id]) => !freeNowIds.has(id))
    .map(([id, info]) => {
      const matching = tasksForListing(tasks, id, info.group)
      if (!matching.length) return null
      const slot = nextGap(id)
      if (!slot) return null
      return { id, title: info.title, slot, tasks: matching }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => a.slot.from.localeCompare(b.slot.from))
  // Standort-Aufgaben nur beim FRÜHESTEN Fenster ihres Standorts zeigen (Gruppierung)
  const seenGroupTask = new Set<string>()
  for (const p of planning) {
    p.tasks = p.tasks.filter((t) => {
      if (t.listing_id || !t.location_group) return true
      if (seenGroupTask.has(t.id)) return false
      seenGroupTask.add(t.id)
      return true
    })
  }
  const planningVisible = planning.filter((p) => p.tasks.length > 0)

  /* ── Agenda: nur Tage mit Ereignissen (heute bis +56) ── */
  type Ev = { type: 'abreise' | 'anreise' | 'aufgabe' | 'qs'; label: string; sub?: string; wechsel?: boolean; gapText?: string; gapTasks?: CalTask[] }
  const days: { iso: string; events: Ev[] }[] = []
  for (let i = 0; i <= 56; i++) {
    const iso = isoOffset(i)
    const outs = stays.filter((s) => s.checkOut === iso)
    const ins = stays.filter((s) => s.checkIn === iso)
    const due = tasks.filter((t) => t.due_date === iso)
    const qsDue = qs.filter((q) => q.dueDate === iso)
    const events: Ev[] = []
    for (const q of qsDue) {
      events.push({ type: 'qs', label: `Qualitätscheck · ${listings[q.listingId]?.title ?? 'Wohnung'}`, sub: 'Protokoll im Aufgaben-Tab ausfüllen' })
    }
    for (const s of outs) {
      const info = listings[s.listingId]
      const wechsel = ins.some((x) => x.listingId === s.listingId)
      let gapText: string | undefined
      let gapTasks: CalTask[] | undefined
      if (!wechsel) {
        const nextIn = nextCheckIn(s.listingId, iso)
        const nights = nextIn ? daysBetween(iso, nextIn) : null
        gapText = nights != null
          ? `danach ${nights} ${nights === 1 ? 'Nacht' : 'Nächte'} frei (bis ${fmtShort(nextIn!)})`
          : `danach frei — nichts geplant bis ${fmtShort(rangeEnd)}`
        const matching = tasksForListing(tasks, s.listingId, info?.group ?? null)
        if (matching.length && (nights == null || nights >= 1)) gapTasks = matching
      }
      events.push({ type: 'abreise', label: info?.title ?? 'Wohnung', sub: s.guestName ?? undefined, wechsel, gapText, gapTasks })
    }
    for (const s of ins) {
      events.push({ type: 'anreise', label: listings[s.listingId]?.title ?? 'Wohnung', sub: s.guestName ?? undefined })
    }
    // Mehrere fällige Aufgaben am selben Ort → EINE gruppierte Karte
    const dueByScope = new Map<string, CalTask[]>()
    for (const t of due) {
      const key = t.listing_id ?? (t.location_group ? `g:${t.location_group}` : 'allg')
      dueByScope.set(key, [...(dueByScope.get(key) ?? []), t])
    }
    for (const [key, list] of dueByScope) {
      const scope = key.startsWith('g:') ? `📍 ${key.slice(2)}` : key === 'allg' ? 'Allgemein' : listings[key]?.title ?? 'Wohnung'
      if (list.length === 1) {
        events.push({ type: 'aufgabe', label: list[0].title, sub: scope })
      } else {
        events.push({
          type: 'aufgabe',
          label: `${list.length} Aufgaben fällig · ${scope}`,
          sub: list.map((t) => t.title).join(' · ').slice(0, 110),
        })
      }
    }
    if (events.length) days.push({ iso, events })
  }

  const EVENT_META = {
    abreise: { icon: '↖', color: '#C2410C', bg: '#FFF7ED', tag: 'Abreise' },
    anreise: { icon: '↘', color: '#15803D', bg: '#F0FDF4', tag: 'Anreise' },
    aufgabe: { icon: '✓', color: '#8A7020', bg: '#FAF5E4', tag: 'Aufgabe fällig' },
    qs: { icon: '🧾', color: '#0F766E', bg: '#EFFAF7', tag: 'QS-Termin' },
  } as const

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#F7F7F8', WebkitOverflowScrolling: 'touch' }}>
      <div style={{
        position: 'sticky', top: 0, zIndex: 5, background: 'rgba(247,247,248,0.9)',
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        // Safe-Area oben liefert seit viewport-fit=cover die TeamShell zentral
        padding: '14px 16px 10px',
        boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.15)',
      }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: '#111', letterSpacing: '-0.4px' }}>Kalender</h1>
      </div>

      {loading ? (
        <p style={{ textAlign: 'center', color: '#8E8E93', fontSize: 14, padding: 40 }}>Laden…</p>
      ) : error ? (
        <p style={{ margin: '14px 16px', padding: '10px 14px', borderRadius: 12, background: '#FEE2E2', color: '#B91C1C', fontSize: 13 }}>{error}</p>
      ) : (
        <div style={{ padding: '12px 16px 40px' }}>
          {/* Überfällige Aufgaben gesammelt oben */}
          {overdue.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <p style={{ fontSize: 13, fontWeight: 800, color: '#B91C1C', margin: '0 0 8px' }}>⚠︎ Überfällig</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {overdue.map((t) => (
                  <div key={t.id} style={{
                    background: '#fff', borderRadius: 14, padding: '11px 14px',
                    boxShadow: 'inset 0 0 0 1.5px #EF4444', display: 'flex', justifyContent: 'space-between', gap: 10,
                  }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: '#111' }}>{t.title}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#B91C1C', flexShrink: 0 }}>seit {fmtShort(t.due_date!)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 🔧 Gerade frei: leere Wohnungen + Aufgaben-Gelegenheiten */}
          {freeNow.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 13, fontWeight: 800, color: '#8A7020', margin: '0 0 8px' }}>🔧 Gerade frei</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {freeNow.map((f) => (
                  <div key={f.id} style={{
                    background: 'linear-gradient(135deg, #FDFBF4, #FAF5E4)', borderRadius: 14, padding: '12px 14px',
                    boxShadow: 'inset 0 0 0 1px #E8DCB8',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: '#111' }}>{f.title}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#8A7020', flexShrink: 0 }}>
                        {f.nights != null
                          ? `frei bis ${fmtShort(f.nextIn!)} · ${f.nights} ${f.nights === 1 ? 'Nacht' : 'Nächte'}`
                          : 'frei — nichts geplant'}
                      </span>
                    </div>
                    {f.tasks.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <TaskChips tasks={f.tasks} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 🧠 Planungs-Vorschläge: kommende Frei-Fenster mit passenden Aufgaben */}
          {planningVisible.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 13, fontWeight: 800, color: '#0369A1', margin: '0 0 8px' }}>🧠 Planungs-Vorschläge</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {planningVisible.map((p) => (
                  <div key={p.id} style={{
                    background: 'linear-gradient(135deg, #FAFDFF, #EFF8FF)', borderRadius: 14, padding: '12px 14px',
                    boxShadow: 'inset 0 0 0 1px #BAE6FD',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: '#111' }}>{p.title}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#0369A1', flexShrink: 0 }}>
                        {p.slot.nights != null
                          ? `Fenster ${fmtShort(p.slot.from)}–${fmtShort(p.slot.to!)} · ${p.slot.nights} ${p.slot.nights === 1 ? 'Nacht' : 'Nächte'}`
                          : `frei ab ${fmtShort(p.slot.from)} — nichts geplant`}
                      </span>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <TaskChips tasks={p.tasks} max={4} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {days.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 20px', color: '#8E8E93' }}>
              <p style={{ fontSize: 40, margin: '0 0 8px' }}>📅</p>
              <p style={{ fontSize: 15, fontWeight: 600, margin: 0, color: '#3C3C43' }}>Keine Termine in den nächsten 8 Wochen.</p>
            </div>
          ) : days.map(({ iso, events }) => (
            <div key={iso} style={{ marginBottom: 16 }}>
              <p style={{
                fontSize: 12.5, fontWeight: 800, margin: '0 0 7px',
                color: iso === today ? 'var(--gold, #AE8D2D)' : '#6B7280',
                textTransform: 'uppercase', letterSpacing: '0.03em',
              }}>{dayLabel(iso, today)}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {events.map((e, i) => {
                  const meta = EVENT_META[e.type]
                  return (
                    <div key={i} style={{
                      background: '#fff', borderRadius: 14, padding: '10px 13px',
                      boxShadow: 'inset 0 0 0 0.5px rgba(60,60,67,0.15)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                        <span style={{
                          width: 32, height: 32, borderRadius: 10, background: meta.bg, color: meta.color,
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 16, fontWeight: 800, flexShrink: 0,
                        }}>{meta.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 13.5, fontWeight: 700, color: '#111', margin: 0 }}>
                            {e.label}
                            {e.wechsel && (
                              <span style={{
                                marginLeft: 7, fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 999,
                                background: '#EDE9FE', color: '#6D28D9', verticalAlign: 'middle',
                              }}>WECHSEL</span>
                            )}
                          </p>
                          <p style={{ fontSize: 11.5, color: '#8E8E93', margin: '1px 0 0' }}>
                            {meta.tag}{e.sub ? ` · ${e.sub}` : ''}{e.gapText ? ` · ${e.gapText}` : ''}
                          </p>
                        </div>
                      </div>
                      {e.gapTasks && e.gapTasks.length > 0 && (
                        <div style={{
                          marginTop: 9, padding: '8px 11px', borderRadius: 10,
                          background: '#FAF5E4', boxShadow: 'inset 0 0 0 0.5px #E8DCB8',
                        }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: '#8A7020', marginRight: 7 }}>🛠️ Gelegenheit:</span>
                          <TaskChips tasks={e.gapTasks} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
