'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * 📈 Score-ENTWICKLUNG (§171): Vollbild-Bereich im Mehr-Tab — Bewertungs-
 * Scores über die Zeit (Gesamt + je Plattform, je Wohnung filterbar) als
 * eigenes SVG-Liniendiagramm (keine Chart-Library). Datenbasis: täglicher
 * score_history-Snapshot; Deltas vs. Vorwoche/Vormonat mit 2 Nachkommastellen.
 * Overlay via createPortal(document.body) — §83-Lektion (fixed im Scroller);
 * Portal-Root trägt team-shell (Zoom-Sperre/16px-Inputs, §100-Muster).
 */

interface Point { listingId: string; source: string; score: number; count: number; date: string }

const SOURCES: { id: string; label: string; color: string }[] = [
  { id: 'overall', label: 'Gesamt', color: '#AE8D2D' },
  { id: 'airbnb', label: 'Airbnb', color: '#E0565B' },
  { id: 'booking', label: 'Booking', color: '#2E7CF6' },
  { id: 'google', label: 'Google', color: '#34A853' },
  { id: 'vrbo', label: 'FeWo', color: '#8B5CF6' },
]
const RANGES: { id: number; label: string }[] = [
  { id: 30, label: '30 Tage' },
  { id: 90, label: '90 Tage' },
  { id: 365, label: '1 Jahr' },
]

const f2 = (n: number) => n.toFixed(2).replace('.', ',')

/** Punkte einer Quelle je Tag über die gewählten Wohnungen gewichtet mitteln. */
function seriesFor(points: Point[], source: string, listingId: string): { date: string; score: number }[] {
  const byDate = new Map<string, { w: number; c: number }>()
  for (const p of points) {
    if (p.source !== source) continue
    if (listingId && p.listingId !== listingId) continue
    const e = byDate.get(p.date) ?? { w: 0, c: 0 }
    e.w += p.score * p.count
    e.c += p.count
    byDate.set(p.date, e)
  }
  return [...byDate.entries()]
    .filter(([, e]) => e.c > 0)
    .map(([date, e]) => ({ date, score: Math.round((e.w / e.c) * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

function deltaChip(curr: number | null, prev: number | null, label: string) {
  if (curr == null || prev == null) {
    return <span style={{ fontSize: 11.5, color: '#B0AA9C' }}>{label}: —</span>
  }
  const d = Math.round((curr - prev) * 100) / 100
  const up = d > 0
  const same = d === 0
  return (
    <span style={{
      fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
      background: same ? '#F2F2F7' : up ? '#DCFCE7' : '#FEE2E2',
      color: same ? '#8A8578' : up ? '#16A34A' : '#DC2626',
    }}>
      {label}: {same ? '±0,00' : `${up ? '▲ +' : '▼ '}${f2(d)}`}
    </span>
  )
}

export default function ScoreTrends({ onClose }: { onClose: () => void }) {
  const [points, setPoints] = useState<Point[]>([])
  const [listings, setListings] = useState<{ id: string; title: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState('overall')
  const [listing, setListing] = useState('')
  const [range, setRange] = useState(90)

  useEffect(() => {
    Promise.all([
      fetch('/api/score-history?days=730', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { points: [] })),
      fetch('/api/team/calendar', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([sh, cal]) => {
        setPoints(sh.points ?? [])
        const ls = cal?.listings ?? {}
        setListings(Object.entries(ls).map(([id, v]) => ({ id, title: (v as { title: string }).title }))
          .sort((a, b) => a.title.localeCompare(b.title)))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const cutoff = useMemo(() => new Date(Date.now() - range * 86400_000).toISOString().slice(0, 10), [range])
  const series = useMemo(
    () => seriesFor(points, source, listing).filter((p) => p.date >= cutoff),
    [points, source, listing, cutoff],
  )
  const fullSeries = useMemo(() => seriesFor(points, source, listing), [points, source, listing])

  // Deltas: aktueller Wert vs. jüngster Snapshot ≤ vor 7/30 Tagen
  const current = fullSeries.length ? fullSeries[fullSeries.length - 1].score : null
  const valueAt = (daysAgo: number): number | null => {
    const d = new Date(Date.now() - daysAgo * 86400_000).toISOString().slice(0, 10)
    const older = fullSeries.filter((p) => p.date <= d)
    return older.length ? older[older.length - 1].score : null
  }
  const weekAgo = valueAt(7)
  const monthAgo = valueAt(30)

  const srcMeta = SOURCES.find((s) => s.id === source) ?? SOURCES[0]

  /* ── SVG-Chart ── */
  const W = 680
  const H = 260
  const PAD = { l: 44, r: 14, t: 14, b: 26 }
  const chart = useMemo(() => {
    if (series.length < 1) return null
    const scores = series.map((p) => p.score)
    let min = Math.min(...scores)
    let max = Math.max(...scores)
    if (max - min < 0.1) { min -= 0.06; max += 0.06 } // flache Linien nicht dramatisieren
    min = Math.max(0, min - 0.02)
    max = Math.min(5, max + 0.02)
    const x = (i: number) => series.length === 1
      ? PAD.l + (W - PAD.l - PAD.r) / 2
      : PAD.l + (i / (series.length - 1)) * (W - PAD.l - PAD.r)
    const y = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b)
    const line = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ')
    const area = `${line} L${x(series.length - 1).toFixed(1)},${H - PAD.b} L${x(0).toFixed(1)},${H - PAD.b} Z`
    const yTicks = [min, (min + max) / 2, max].map((v) => ({ v: Math.round(v * 100) / 100, y: y(v) }))
    const fmtD = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`
    const xLabels = series.length > 1
      ? [0, Math.floor((series.length - 1) / 2), series.length - 1].map((i) => ({ label: fmtD(series[i].date), x: x(i) }))
      : [{ label: fmtD(series[0].date), x: x(0) }]
    return { line, area, yTicks, xLabels, lastX: x(series.length - 1), lastY: y(series[series.length - 1].score) }
  }, [series])

  const body = (
    <div className="team-shell" style={{
      position: 'fixed', inset: 0, zIndex: 80, background: '#F2F2F7',
      display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top)',
    }}>
      {/* Kopf */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
        background: 'rgba(249,249,249,0.94)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.15)', flexShrink: 0,
      }}>
        <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 22, color: '#AE8D2D', cursor: 'pointer', padding: '0 4px' }}>‹</button>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: '#1A1814', margin: 0, flex: 1 }}>📈 Entwicklung</h2>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '14px 14px 40px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          {/* Plattform-Chips */}
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 4 }}>
            {SOURCES.map((s) => (
              <button key={s.id} onClick={() => setSource(s.id)} style={{
                padding: '6px 13px', borderRadius: 999, border: 'none', fontSize: 13, fontWeight: 700, flexShrink: 0,
                background: source === s.id ? s.color : 'rgba(120,120,128,0.12)',
                color: source === s.id ? '#fff' : '#3C3C43', cursor: 'pointer', whiteSpace: 'nowrap',
              }}>{s.label}</button>
            ))}
          </div>

          {/* Wohnung + Zeitraum */}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={listing} onChange={(e) => setListing(e.target.value)} style={{
              fontSize: 13, fontWeight: 600, padding: '7px 10px', borderRadius: 10,
              border: '0.5px solid rgba(60,60,67,0.25)', background: '#fff', color: '#1A1814', maxWidth: 220,
            }}>
              <option value="">🏠 Alle Wohnungen</option>
              {listings.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 5 }}>
              {RANGES.map((r) => (
                <button key={r.id} onClick={() => setRange(r.id)} style={{
                  padding: '6px 11px', borderRadius: 999, border: 'none', fontSize: 12, fontWeight: 700,
                  background: range === r.id ? '#111' : 'rgba(120,120,128,0.12)',
                  color: range === r.id ? '#fff' : '#3C3C43', cursor: 'pointer',
                }}>{r.label}</button>
              ))}
            </div>
          </div>

          {/* Aktueller Wert + Deltas */}
          <div style={{
            marginTop: 14, background: '#fff', borderRadius: 16, padding: '16px 18px',
            boxShadow: '0 0 0 0.5px rgba(60,60,67,0.1)',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 34, fontWeight: 800, color: srcMeta.color, letterSpacing: '-0.5px' }}>
                {current != null ? `★ ${f2(current)}` : '—'}
              </span>
              <span style={{ fontSize: 13, color: '#8A8578', fontWeight: 600 }}>
                {srcMeta.label} · {listing ? listings.find((l) => l.id === listing)?.title : 'alle Wohnungen'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {deltaChip(current, weekAgo, 'vs. Vorwoche')}
              {deltaChip(current, monthAgo, 'vs. Vormonat')}
            </div>

            {/* Chart */}
            <div style={{ marginTop: 14, overflowX: 'auto' }}>
              {loading ? (
                <p style={{ fontSize: 13, color: '#8A8578', margin: '20px 0' }}>Lädt…</p>
              ) : !chart ? (
                <p style={{ fontSize: 13, color: '#8A8578', lineHeight: 1.6, margin: '14px 0' }}>
                  Noch keine Datenpunkte für diese Auswahl. Die Historie wächst ab jetzt
                  mit jedem Tag — der nächtliche Bewertungs-Sync speichert täglich einen
                  Snapshot aller Scores.
                </p>
              ) : (
                <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
                  {chart.yTicks.map((tk, i) => (
                    <g key={i}>
                      <line x1={PAD.l} x2={W - PAD.r} y1={tk.y} y2={tk.y} stroke="rgba(60,60,67,0.1)" strokeWidth={1} />
                      <text x={PAD.l - 7} y={tk.y + 4} textAnchor="end" fontSize={11} fill="#8A8578">{f2(tk.v)}</text>
                    </g>
                  ))}
                  {chart.xLabels.map((xl, i) => (
                    <text key={i} x={xl.x} y={H - 8} textAnchor="middle" fontSize={11} fill="#8A8578">{xl.label}</text>
                  ))}
                  <path d={chart.area} fill={srcMeta.color} opacity={0.09} />
                  <path d={chart.line} fill="none" stroke={srcMeta.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                  <circle cx={chart.lastX} cy={chart.lastY} r={4.5} fill={srcMeta.color} stroke="#fff" strokeWidth={2} />
                </svg>
              )}
            </div>
          </div>

          {/* Alle Plattformen als Schnellübersicht */}
          {!loading && (
            <div style={{
              marginTop: 12, background: '#fff', borderRadius: 16, padding: '6px 18px',
              boxShadow: '0 0 0 0.5px rgba(60,60,67,0.1)',
            }}>
              {SOURCES.map((s, i) => {
                const fs = seriesFor(points, s.id, listing)
                const cur = fs.length ? fs[fs.length - 1].score : null
                const d = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)
                const older = fs.filter((p) => p.date <= d)
                const wk = older.length ? older[older.length - 1].score : null
                return (
                  <div key={s.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '11px 0',
                    boxShadow: i < SOURCES.length - 1 ? 'inset 0 -0.5px 0 rgba(60,60,67,0.12)' : 'none',
                  }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#1A1814', flex: 1 }}>{s.label}</span>
                    <span style={{ fontSize: 14.5, fontWeight: 800, color: '#1A1814' }}>{cur != null ? f2(cur) : '—'}</span>
                    {deltaChip(cur, wk, '7 T')}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(body, document.body) : null
}
