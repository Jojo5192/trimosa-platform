'use client'

/**
 * 📅 Kalender-Tab: Agenda der nächsten 8 Wochen — Abreisen (= Reinigungs-
 * Slots), Anreisen, Wechsel-Tage (Abreise + Anreise derselben Wohnung) und
 * fällige Aufgaben. Überfällige Aufgaben stehen gesammelt ganz oben.
 * Dienstleister sehen keine Gastnamen (kommen von der API gar nicht erst).
 */
import { useState, useEffect } from 'react'

type Stay = { id: string; listingId: string; checkIn: string; checkOut: string; guestName: string | null }
type CalTask = { id: string; title: string; due_date: string; status: string; prio: string; listing_id: string | null; location_group: string | null; is_general: boolean }

const DE_DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
const DE_MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

function isoOffset(days: number): string {
  const d = new Date(Date.now() + days * 86400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

export default function CalendarPanel() {
  const [stays, setStays] = useState<Stay[]>([])
  const [tasks, setTasks] = useState<CalTask[]>([])
  const [listings, setListings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/team/calendar')
      .then((r) => r.json())
      .then((j) => {
        if (j.error) setError(j.error)
        else { setStays(j.stays ?? []); setTasks(j.tasks ?? []); setListings(j.listings ?? {}) }
      })
      .catch(() => setError('Netzwerkfehler beim Laden.'))
      .finally(() => setLoading(false))
  }, [])

  const today = isoOffset(0)
  const overdue = tasks.filter((t) => t.due_date < today)

  // Agenda: nur Tage mit Ereignissen (heute bis +56)
  const days: { iso: string; events: { type: 'abreise' | 'anreise' | 'aufgabe'; label: string; sub?: string; wechsel?: boolean }[] }[] = []
  for (let i = 0; i <= 56; i++) {
    const iso = isoOffset(i)
    const outs = stays.filter((s) => s.checkOut === iso)
    const ins = stays.filter((s) => s.checkIn === iso)
    const due = tasks.filter((t) => t.due_date === iso)
    const events: typeof days[number]['events'] = []
    for (const s of outs) {
      const wechsel = ins.some((x) => x.listingId === s.listingId)
      events.push({
        type: 'abreise',
        label: listings[s.listingId] ?? 'Wohnung',
        sub: s.guestName ?? undefined,
        wechsel,
      })
    }
    for (const s of ins) {
      events.push({ type: 'anreise', label: listings[s.listingId] ?? 'Wohnung', sub: s.guestName ?? undefined })
    }
    for (const t of due) {
      const scope = t.listing_id ? listings[t.listing_id] : t.location_group ? `📍 ${t.location_group}` : 'Allgemein'
      events.push({ type: 'aufgabe', label: t.title, sub: scope })
    }
    if (events.length) days.push({ iso, events })
  }

  const EVENT_META = {
    abreise: { icon: '↖', color: '#C2410C', bg: '#FFF7ED', tag: 'Abreise' },
    anreise: { icon: '↘', color: '#15803D', bg: '#F0FDF4', tag: 'Anreise' },
    aufgabe: { icon: '✓', color: '#8A7020', bg: '#FAF5E4', tag: 'Aufgabe fällig' },
  } as const

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#F7F7F8', WebkitOverflowScrolling: 'touch' }}>
      <div style={{
        position: 'sticky', top: 0, zIndex: 5, background: 'rgba(247,247,248,0.9)',
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        padding: '14px 16px 10px', paddingTop: 'max(14px, env(safe-area-inset-top))',
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
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#B91C1C', flexShrink: 0 }}>seit {fmtShort(t.due_date)}</span>
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
                      display: 'flex', alignItems: 'center', gap: 11,
                    }}>
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
                          {meta.tag}{e.sub ? ` · ${e.sub}` : ''}
                        </p>
                      </div>
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
