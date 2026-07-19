'use client'

/**
 * 📅 Belegungs-Übersicht im Smoobu-Stil (Pascal §107): Wohnungen als Zeilen,
 * Tage als Spalten, Aufenthalte als Balken von Anreise-Mittag bis
 * Abreise-Mittag (Wechseltage teilen sich die Zelle wie im Channel-Manager).
 * Erste Spalte (Wohnungsname) klebt links, Tages-Header oben; heute ist
 * hervorgehoben. Tap auf einen Balken zeigt die Details unterm Grid.
 * Dienstleister sehen keine Gastnamen (API liefert sie gar nicht erst).
 */
import { useEffect, useMemo, useRef, useState } from 'react'

export type GridStay = {
  id: string; listingId: string; checkIn: string; checkOut: string
  guestName: string | null; channel?: string | null
}

const DAY_W = 46
const ROW_H = 44
const NAME_W = 104
const DE_DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const DE_MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const DE_MONTHS_FULL = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

function isoOffset(days: number): string {
  const d = new Date(Date.now() + days * 86400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function dayDiff(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86400_000)
}

function channelColor(channel?: string | null): string {
  const c = (channel ?? '').toLowerCase()
  if (c.includes('airbnb')) return '#E0565B'
  if (c.includes('booking')) return '#1A4FA0'
  if (c.includes('fewo') || c.includes('vrbo')) return '#8B5CF6'
  if (c.includes('hometogo')) return '#0EA5E9'
  return 'var(--gold, #AE8D2D)'
}

export default function OccupancyGrid({ stays, listings }: {
  stays: GridStay[]
  listings: Record<string, { title: string; group: string | null }>
}) {
  const [selected, setSelected] = useState<GridStay | null>(null)
  // Monat des aktuell links sichtbaren Tages — klebt in der Ecke über der
  // Namensspalte, damit man beim Wischen immer weiß, wo man ist
  const [headMonth, setHeadMonth] = useState<{ m: string; y: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef(0)

  function updateHeadMonth() {
    const el = scrollRef.current
    if (!el) return
    const idx = Math.min(62, Math.max(0, Math.ceil(el.scrollLeft / DAY_W)))
    const d = new Date(isoOffset(idx - 7) + 'T00:00:00Z')
    const m = DE_MONTHS_FULL[d.getUTCMonth()]
    const y = d.getUTCFullYear()
    setHeadMonth((prev) => (prev && prev.m === m && prev.y === y ? prev : { m, y }))
  }
  const onScroll = () => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(updateHeadMonth)
  }

  // Beim Öffnen zu HEUTE scrollen (das Grid beginnt 7 Tage in der
  // Vergangenheit — gestern bleibt eine Wisch-Geste entfernt sichtbar)
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = 5.5 * DAY_W
    updateHeadMonth()
    return () => cancelAnimationFrame(rafRef.current)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const startIso = isoOffset(-7)
  const DAYS = 63
  const today = isoOffset(0)

  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => {
    const iso = isoOffset(i - 7)
    const d = new Date(iso + 'T00:00:00Z')
    return {
      iso,
      dow: DE_DAYS[d.getUTCDay()],
      num: d.getUTCDate(),
      month: d.getUTCDate() === 1 || i === 0 ? DE_MONTHS[d.getUTCMonth()] : null,
      weekend: d.getUTCDay() === 0 || d.getUTCDay() === 6,
    }
  }), []) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() =>
    Object.entries(listings)
      .map(([id, info]) => ({ id, title: info.title }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  [listings])

  const fmt = (iso: string) => { const [, m, d] = iso.split('-'); return `${Number(d)}.${Number(m)}.` }

  return (
    <div>
      <div ref={scrollRef} onScroll={onScroll} style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', borderRadius: 14, background: '#fff', boxShadow: 'inset 0 0 0 0.5px rgba(60,60,67,0.15)' }}>
        <div style={{ width: NAME_W + DAYS * DAY_W, minWidth: '100%' }}>
          {/* Tages-Header */}
          <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 3, background: '#fff', boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.2)' }}>
            <div style={{
              width: NAME_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 4,
              background: '#fff', boxShadow: 'inset -0.5px 0 0 rgba(60,60,67,0.2)',
              display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingLeft: 8,
            }}>
              {/* aktueller Monat — folgt dem Scrollen */}
              {headMonth && (
                <>
                  <span style={{ fontSize: 11.5, fontWeight: 800, color: '#8A7020', lineHeight: 1.15, whiteSpace: 'nowrap' }}>{headMonth.m}</span>
                  <span style={{ fontSize: 9, fontWeight: 700, color: '#B0AA9C' }}>{headMonth.y}</span>
                </>
              )}
            </div>
            {days.map((d) => (
              <div key={d.iso} style={{
                width: DAY_W, flexShrink: 0, textAlign: 'center', padding: '6px 0 5px',
                background: d.iso === today ? '#FAF5E4' : d.weekend ? '#FAFAF8' : '#fff',
              }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: d.month ? '#8A7020' : '#B0AA9C', textTransform: 'uppercase', height: 12 }}>
                  {d.month ?? d.dow}
                </div>
                <div style={{
                  fontSize: 13, fontWeight: d.iso === today ? 800 : 600,
                  color: d.iso === today ? '#8A7020' : '#3C3C43',
                }}>{d.num}</div>
              </div>
            ))}
          </div>

          {/* Wohnungs-Zeilen mit Belegungs-Balken */}
          {rows.map((row, ri) => {
            const mine = stays.filter((s) => s.listingId === row.id && s.checkOut > startIso)
            return (
              <div key={row.id} style={{ display: 'flex', height: ROW_H, boxShadow: ri < rows.length - 1 ? 'inset 0 -0.5px 0 rgba(60,60,67,0.12)' : 'none' }}>
                <div style={{
                  width: NAME_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 2,
                  background: '#fff', boxShadow: 'inset -0.5px 0 0 rgba(60,60,67,0.2)',
                  display: 'flex', alignItems: 'center', padding: '0 8px',
                }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: '#1A1814', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.title}
                  </span>
                </div>
                <div style={{ position: 'relative', width: DAYS * DAY_W, flexShrink: 0 }}>
                  {/* Tages-Raster (Wochenende + heute schattiert) */}
                  {days.map((d, i) => (
                    (d.weekend || d.iso === today) ? (
                      <div key={d.iso} style={{
                        position: 'absolute', left: i * DAY_W, top: 0, bottom: 0, width: DAY_W,
                        background: d.iso === today ? 'rgba(174,141,45,0.09)' : 'rgba(0,0,0,0.018)',
                      }} />
                    ) : null
                  ))}
                  {/* Aufenthalts-Balken: Anreise-Mittag → Abreise-Mittag */}
                  {mine.map((s) => {
                    const from = Math.max(dayDiff(startIso, s.checkIn) + 0.5, 0)
                    const to = Math.min(dayDiff(startIso, s.checkOut) + 0.5, DAYS)
                    if (to <= 0 || from >= DAYS) return null
                    const color = channelColor(s.channel)
                    const isSel = selected?.id === s.id
                    return (
                      <button key={s.id} onClick={() => setSelected(isSel ? null : s)} style={{
                        position: 'absolute', left: from * DAY_W + 1, width: (to - from) * DAY_W - 2,
                        top: 7, height: ROW_H - 14, borderRadius: 999, border: 'none', cursor: 'pointer',
                        background: color, color: '#fff', overflow: 'hidden',
                        display: 'flex', alignItems: 'center', padding: '0 10px',
                        boxShadow: isSel ? '0 0 0 2px #1A1814' : '0 1px 3px rgba(0,0,0,0.18)',
                      }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {s.guestName ?? 'Belegt'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Detail-Karte zum angetippten Aufenthalt */}
      {selected && (
        <div style={{
          marginTop: 10, background: '#fff', borderRadius: 14, padding: '12px 14px',
          boxShadow: `inset 0 0 0 1.5px ${channelColor(selected.channel)}`,
          display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: '#111' }}>
              {selected.guestName ?? 'Belegt'} · {listings[selected.listingId]?.title ?? 'Wohnung'}
            </div>
            <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
              {fmt(selected.checkIn)} – {fmt(selected.checkOut)} · {dayDiff(selected.checkIn, selected.checkOut)} {dayDiff(selected.checkIn, selected.checkOut) === 1 ? 'Nacht' : 'Nächte'}
              {selected.channel ? ` · ${selected.channel}` : ''}
            </div>
          </div>
          {selected.guestName && (
            <a href={`/team?conv=${selected.id}`} style={{
              fontSize: 12, fontWeight: 700, color: '#fff', textDecoration: 'none', flexShrink: 0,
              background: 'linear-gradient(135deg, var(--gold, #AE8D2D), #8A7020)', borderRadius: 999, padding: '7px 14px',
            }}>💬 Zum Chat</a>
          )}
        </div>
      )}
    </div>
  )
}
