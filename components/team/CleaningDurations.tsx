'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { haptic } from '@/components/team/ux'

/**
 * ⏱ §255: Reinigungs-Dauer-Auswertung (nur Chefs). Von „Tür auf"
 * (Schloss-Protokoll) bis „fertig gemeldet" (NFC). Vollbild-Portal §83.
 * §266b: Wohnungs-Filter-Chips — die Statistik (Median/Ø/Trend/Sparkline/
 * Kräfte/letzte Einsätze) rechnet der Client aus den Roh-Einsätzen je Filter.
 */
interface Trend { deltaMin: number; olderMed: number; newerMed: number }
interface Einsatz {
  title: string; slotDate: string; person: string | null
  durationMin: number; startedAt: string | null; confirmedAt: string | null
}
interface Data {
  gesamt: { count: number }
  einsaetze?: Einsatz[]
  // Alt-Felder (Server-Aggregate) — der Client rechnet seit §266b selbst
  letzte?: Einsatz[]
}

function dur(min: number): string {
  const h = Math.floor(min / 60)
  return h ? `${h} h ${min % 60} min` : `${min} min`
}
/** Kompaktform für enge KPI-Kacheln („2:49 h" statt „2 h 49 min") — §84-Klasse:
 *  nowrap in Flex-Dritteln läuft auf 320–375-px-Geräten sonst über. */
function durKurz(min: number): string {
  const h = Math.floor(min / 60)
  return h ? `${h}:${String(min % 60).padStart(2, '0')} h` : `${min} min`
}
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0)
const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}
// Trend: Median der neueren vs. der älteren Hälfte (chronologisch, ab 4 Messungen)
const trendOf = (chrono: number[]): Trend | null => {
  if (chrono.length < 4) return null
  const half = Math.floor(chrono.length / 2)
  const olderMed = median(chrono.slice(0, half))
  const newerMed = median(chrono.slice(half))
  return { deltaMin: newerMed - olderMed, olderMed, newerMed }
}

/** Trend-Chip: kürzer geworden = grün ▼, länger = rot ▲, ±5min = stabil. */
function TrendChip({ t }: { t: Trend | null }) {
  if (!t) return <span style={{ fontSize: 11, color: 'var(--tm-muted2)' }}>—</span>
  const stable = Math.abs(t.deltaMin) < 5
  const faster = t.deltaMin < 0
  const color = stable ? '#8A8578' : faster ? '#16A34A' : '#C0392B'
  const arrow = stable ? '→' : faster ? '▼' : '▲'
  return (
    <span style={{ fontSize: 11.5, fontWeight: 700, color, whiteSpace: 'nowrap' }}
      title={`Median zuletzt ${dur(t.newerMed)} vs. davor ${dur(t.olderMed)}`}>
      {arrow} {stable ? 'stabil' : dur(Math.abs(t.deltaMin))}
    </span>
  )
}

/** Mini-Verlaufslinie der einzelnen Reinigungsdauern (alt → neu). */
function Sparkline({ xs, w = 240, h = 40 }: { xs: number[]; w?: number; h?: number }) {
  if (xs.length < 2) return null
  const min = Math.min(...xs), max = Math.max(...xs)
  const span = Math.max(1, max - min)
  const pts = xs.map((v, i) => {
    const x = (i / (xs.length - 1)) * (w - 6) + 3
    const y = h - 4 - ((v - min) / span) * (h - 10)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} style={{ display: 'block' }} preserveAspectRatio="none">
      <polyline points={pts.join(' ')} fill="none" stroke="#B0913A" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => { const [x, y] = p.split(','); return <circle key={i} cx={x} cy={y} r={i === pts.length - 1 ? 3 : 1.6} fill={i === pts.length - 1 ? '#12222E' : '#B0913A'} /> })}
    </svg>
  )
}
function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })
}
function fmtDate(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
}

export default function CleaningDurations({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')   // '' = alle Wohnungen

  useEffect(() => {
    fetch('/api/cleaning/durations', { cache: 'no-store' })
      .then(async (r) => { if (!r.ok) throw new Error(r.status === 403 ? 'Kein Zugriff.' : `Fehler ${r.status}`); return r.json() })
      .then(setData).catch((e) => setError(String(e instanceof Error ? e.message : e))).finally(() => setLoading(false))
  }, [])

  // Roh-Einsätze (chronologisch alt → neu); Fallback über `letzte` für den
  // unwahrscheinlichen Fall einer alten API-Antwort ohne einsaetze-Feld.
  const alle = useMemo<Einsatz[]>(() => {
    if (data?.einsaetze?.length) return data.einsaetze
    return [...(data?.letzte ?? [])].reverse()
  }, [data])

  const wohnungsNamen = useMemo(() => [...new Set(alle.map((e) => e.title))].sort((a, b) => a.localeCompare(b, 'de')), [alle])

  // Sicht = gefilterte Einsätze + daraus gerechnete Statistik
  const sicht = useMemo(() => {
    const es = filter ? alle.filter((e) => e.title === filter) : alle
    const chrono = es.map((e) => e.durationMin)
    // je Wohnung (nur in der Alle-Sicht gebraucht)
    const byW = new Map<string, number[]>()
    // je Kraft (immer, aus der gefilterten Menge)
    const byP = new Map<string, number[]>()
    for (const e of es) {
      const w = byW.get(e.title); if (w) w.push(e.durationMin); else byW.set(e.title, [e.durationMin])
      const pk = (e.person ?? 'Unbekannt').trim() || 'Unbekannt'
      const p = byP.get(pk); if (p) p.push(e.durationMin); else byP.set(pk, [e.durationMin])
    }
    return {
      es,
      count: es.length,
      medMin: median(chrono),
      avgMin: avg(chrono),
      minMin: chrono.length ? Math.min(...chrono) : 0,
      maxMin: chrono.length ? Math.max(...chrono) : 0,
      trend: trendOf(chrono),
      verlauf: chrono.slice(-40),
      wohnungen: [...byW.entries()]
        .map(([title, xs]) => ({ title, count: xs.length, avgMin: avg(xs), medMin: median(xs), minMin: Math.min(...xs), maxMin: Math.max(...xs), trend: trendOf(xs) }))
        .sort((a, b) => b.medMin - a.medMin),
      personen: [...byP.entries()]
        .map(([name, xs]) => ({ name, count: xs.length, avgMin: avg(xs), medMin: median(xs) }))
        .sort((a, b) => b.count - a.count),
      letzte: [...es].reverse().slice(0, 40),
    }
  }, [alle, filter])

  const card = { borderRadius: 14, background: 'var(--tm-card)', boxShadow: '0 0 0 0.5px var(--tm-line)', overflow: 'clip' as const, marginBottom: 14 }
  const eyebrow = { fontSize: 12, fontWeight: 700, color: 'var(--tm-muted)', letterSpacing: '0.05em', margin: '0 4px 8px' }
  const chip = (aktiv: boolean) => ({
    flexShrink: 0, padding: '7px 14px', borderRadius: 999, fontSize: 13, fontWeight: 700 as const,
    border: 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent', whiteSpace: 'nowrap' as const,
    background: aktiv ? 'var(--tm-navy)' : 'var(--tm-surface2)',
    color: aktiv ? '#fff' : 'var(--tm-text)',
  })
  const kpi = { flex: 1, minWidth: 0, borderRadius: 14, background: 'var(--tm-card)', boxShadow: '0 0 0 0.5px var(--tm-line)', padding: '11px 13px' }
  const kpiLabel = { fontSize: 10.5, fontWeight: 700, color: 'var(--tm-muted)', letterSpacing: '0.05em' }
  const kpiValue = { fontSize: 17, fontWeight: 800, color: 'var(--tm-text)', marginTop: 2, fontVariantNumeric: 'tabular-nums' as const }

  const body = (
    <div className="team-shell" style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'var(--tm-surface2)', display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'var(--tm-card)', boxShadow: 'inset 0 -0.5px 0 var(--tm-line)', flexShrink: 0 }}>
        <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 22, color: 'var(--gold)', cursor: 'pointer', padding: '0 4px' }}>‹</button>
        <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--tm-text)' }}>⏱ Reinigungs-Dauer</div>
        <div style={{ flex: 1 }} />
        {loading && <span style={{ fontSize: 12, color: 'var(--tm-muted2)' }}>Laden…</span>}
      </div>

      {/* §266b: Wohnungs-Filter — horizontale Chip-Leiste im iOS-Stil */}
      {wohnungsNamen.length > 1 && (
        <div style={{
          display: 'flex', gap: 8, padding: '10px 14px', background: 'var(--tm-card)', flexShrink: 0,
          overflowX: 'auto', WebkitOverflowScrolling: 'touch',
          boxShadow: 'inset 0 -0.5px 0 var(--tm-line)',
        }}>
          <button style={chip(filter === '')} onClick={() => { haptic(); setFilter('') }}>Alle</button>
          {wohnungsNamen.map((w) => (
            <button key={w} style={chip(filter === w)} onClick={() => { haptic(); setFilter(w) }}>{w}</button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '14px 14px 40px' }}>
          {error && <div style={{ padding: '11px 14px', borderRadius: 12, background: 'var(--tm-red-soft)', color: 'var(--tm-red)', fontSize: 13, marginBottom: 14 }}>⚠️ {error}</div>}

          {data && alle.length === 0 && !error && (
            <div style={{ textAlign: 'center', color: 'var(--tm-muted)', fontSize: 14, padding: '30px 12px', lineHeight: 1.6 }}>
              Noch keine gemessenen Reinigungen.<br />
              Die Dauer entsteht automatisch, sobald eine Reinigung über den NFC-Aufkleber
              als fertig gemeldet wird (Start = erste Türöffnung an dem Tag).
            </div>
          )}

          {data && alle.length > 0 && sicht.count === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--tm-muted)', fontSize: 14, padding: '30px 12px' }}>
              Für {filter} gibt es noch keine gemessene Reinigung.
            </div>
          )}

          {data && sicht.count > 0 && (
            <>
              {/* Hero: Median der aktuellen Sicht */}
              <div style={{ ...card, background: 'var(--tm-navy)', color: '#fff', padding: '16px 18px' }}>
                <div style={{ fontSize: 12, color: 'var(--tm-muted2)', fontWeight: 700, letterSpacing: '0.04em' }}>
                  {filter ? `${filter.toUpperCase()} · MEDIAN` : 'REINIGUNGS-DAUER (MEDIAN)'}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 30, fontWeight: 800 }}>{dur(sicht.medMin)}</span>
                  <span style={{ fontSize: 13, color: 'var(--tm-muted)' }}>Ø {dur(sicht.avgMin)}</span>
                  {sicht.trend && (
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: sicht.trend.deltaMin < -5 ? '#7CE0A8' : sicht.trend.deltaMin > 5 ? '#F0A0A0' : 'var(--tm-muted)' }}>
                      {sicht.trend.deltaMin < -5 ? '▼' : sicht.trend.deltaMin > 5 ? '▲' : '→'} {Math.abs(sicht.trend.deltaMin) < 5 ? 'stabil' : dur(Math.abs(sicht.trend.deltaMin))}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--tm-muted)', marginTop: 3 }}>
                  aus {sicht.count} Reinigung{sicht.count === 1 ? '' : 'en'}{filter ? '' : ' (alle Wohnungen)'} · letzte 180 Tage
                </div>
                {sicht.verlauf.length >= 2 && (
                  <div style={{ marginTop: 12 }}>
                    <Sparkline xs={sicht.verlauf} />
                    <div style={{ fontSize: 10.5, color: '#7E8F9B', marginTop: 3 }}>Verlauf der Einzeldauern · älteste links, neueste rechts</div>
                  </div>
                )}
              </div>

              {/* Gefilterte Wohnung: KPI-Kacheln Kürzeste/Längste/Spanne */}
              {filter && (
                <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                  <div style={kpi}>
                    <div style={kpiLabel}>KÜRZESTE</div>
                    <div style={{ ...kpiValue, color: 'var(--tm-green)' }}>{durKurz(sicht.minMin)}</div>
                  </div>
                  <div style={kpi}>
                    <div style={kpiLabel}>LÄNGSTE</div>
                    <div style={{ ...kpiValue, color: 'var(--tm-red)' }}>{durKurz(sicht.maxMin)}</div>
                  </div>
                  <div style={kpi}>
                    <div style={kpiLabel}>EINSÄTZE</div>
                    <div style={kpiValue}>{sicht.count}×</div>
                  </div>
                </div>
              )}

              {/* Alle-Sicht: je Wohnung (Zeile antippen = filtern) */}
              {!filter && (
                <>
                  <div style={eyebrow}>JE WOHNUNG</div>
                  <div style={card}>
                    {sicht.wohnungen.map((w, i) => (
                      <button
                        key={w.title}
                        onClick={() => { haptic(); setFilter(w.title) }}
                        style={{
                          width: '100%', textAlign: 'left', border: 'none', background: 'none', cursor: 'pointer',
                          WebkitTapHighlightColor: 'transparent',
                          padding: '11px 16px', boxShadow: i ? 'inset 0 0.5px 0 var(--tm-line)' : 'none',
                          display: 'flex', alignItems: 'center', gap: 10,
                        }}
                      >
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: 'var(--tm-text)' }}>{w.title}</span>
                          <span style={{ display: 'block', fontSize: 11, color: 'var(--tm-muted)', marginTop: 1 }}>{w.count}× · Ø {dur(w.avgMin)} · {dur(w.minMin)}–{dur(w.maxMin)}</span>
                        </span>
                        <span style={{ textAlign: 'right', flexShrink: 0 }}>
                          <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: 'var(--tm-text)' }}>{dur(w.medMin)}</span>
                          <TrendChip t={w.trend} />
                        </span>
                        <span style={{ color: 'var(--tm-muted2)', fontSize: 15, flexShrink: 0 }}>›</span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Je Person (folgt dem Filter) */}
              {sicht.personen.length > 0 && (
                <>
                  <div style={eyebrow}>{filter ? `REINIGUNGSKRÄFTE · ${filter.toUpperCase()}` : 'JE REINIGUNGSKRAFT'}</div>
                  <div style={card}>
                    {sicht.personen.map((p, i) => (
                      <div key={p.name} style={{ padding: '11px 16px', boxShadow: i ? 'inset 0 0.5px 0 var(--tm-line)' : 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ flex: 1, fontSize: 14.5, color: 'var(--tm-text)' }}>👤 {p.name}</span>
                        <span style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--tm-text)' }}>{dur(p.medMin)}</span>
                          <span style={{ display: 'block', fontSize: 11, color: 'var(--tm-muted)' }}>Ø {dur(p.avgMin)} · {p.count}×</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Letzte Reinigungen (folgt dem Filter) */}
              <div style={eyebrow}>LETZTE REINIGUNGEN</div>
              <div style={card}>
                {sicht.letzte.map((r, i) => (
                  <div key={`${r.title}-${r.slotDate}-${i}`} style={{ padding: '10px 16px', boxShadow: i ? 'inset 0 0.5px 0 var(--tm-line)' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--tm-text)' }}>
                        {filter ? `${fmtDate(r.slotDate)}${r.person ? ` · ${r.person}` : ''}` : r.title}
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--tm-text)' }}>{dur(r.durationMin)}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--tm-muted)', marginTop: 2 }}>
                      {filter ? '' : `${fmtDate(r.slotDate)}${r.person ? ` · ${r.person}` : ''} · `}
                      {fmtTime(r.startedAt)}–{fmtTime(r.confirmedAt)} Uhr
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={{ marginTop: 16, fontSize: 11.5, color: 'var(--tm-muted2)', lineHeight: 1.55, padding: '0 4px' }}>
            <b>Median</b> = der typische Wert (unempfindlich gegen einzelne Ausreißer), <b>Ø</b> = Durchschnitt.
            Der <b>Trend</b> vergleicht die neuere mit der älteren Hälfte der Reinigungen — <span style={{ color: 'var(--tm-green)' }}>▼ grün</span> heißt schneller geworden,
            <span style={{ color: 'var(--tm-red)' }}> ▲ rot</span> langsamer (ab 4 Messungen).<br />
            Gemessen vom ersten Aufschließen der Tür (Schloss-Protokoll, Gäste-Codes ausgenommen)
            bis zur „Fertig"-Meldung am NFC-Aufkleber. Nur sichtbar für Chefs.
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(body, document.body)
}
