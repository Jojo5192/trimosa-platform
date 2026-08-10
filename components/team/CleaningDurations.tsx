'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * ⏱ §255: Reinigungs-Dauer-Auswertung (nur Chefs). Von „Tür auf"
 * (Schloss-Protokoll) bis „fertig gemeldet" (NFC). Vollbild-Portal §83.
 */
interface Trend { deltaMin: number; olderMed: number; newerMed: number }
interface Data {
  gesamt: { count: number; avgMin: number; medMin: number; trend: Trend | null; verlauf: number[] }
  wohnungen: { title: string; count: number; avgMin: number; medMin: number; minMin: number; maxMin: number; trend: Trend | null }[]
  personen: { name: string; count: number; avgMin: number; medMin: number }[]
  letzte: { title: string; slotDate: string; person: string | null; durationMin: number; startedAt: string | null; confirmedAt: string | null }[]
}

function dur(min: number): string {
  const h = Math.floor(min / 60)
  return h ? `${h} h ${min % 60} min` : `${min} min`
}

/** Trend-Chip: kürzer geworden = grün ▼, länger = rot ▲, ±5min = stabil. */
function TrendChip({ t }: { t: Trend | null }) {
  if (!t) return <span style={{ fontSize: 11, color: '#C7C2B8' }}>—</span>
  const stable = Math.abs(t.deltaMin) < 5
  const faster = t.deltaMin < 0
  const color = stable ? '#8A8578' : faster ? '#16A34A' : '#C0392B'
  const arrow = stable ? '→' : faster ? '▼' : '▲'
  const abs = Math.abs(t.deltaMin)
  return (
    <span style={{ fontSize: 11.5, fontWeight: 700, color, whiteSpace: 'nowrap' }}
      title={`Median zuletzt ${dur(t.newerMed)} vs. davor ${dur(t.olderMed)}`}>
      {arrow} {stable ? 'stabil' : dur(abs)}
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

  useEffect(() => {
    fetch('/api/cleaning/durations', { cache: 'no-store' })
      .then(async (r) => { if (!r.ok) throw new Error(r.status === 403 ? 'Kein Zugriff.' : `Fehler ${r.status}`); return r.json() })
      .then(setData).catch((e) => setError(String(e instanceof Error ? e.message : e))).finally(() => setLoading(false))
  }, [])

  const card = { borderRadius: 14, background: '#fff', boxShadow: '0 0 0 0.5px rgba(60,60,67,0.1)', overflow: 'hidden' as const, marginBottom: 14 }
  const eyebrow = { fontSize: 12, fontWeight: 700, color: '#8A8578', letterSpacing: '0.05em', margin: '0 4px 8px' }

  const body = (
    <div className="team-shell" style={{ position: 'fixed', inset: 0, zIndex: 80, background: '#F2F2F7', display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: '#fff', boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.15)', flexShrink: 0 }}>
        <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 22, color: 'var(--gold)', cursor: 'pointer', padding: '0 4px' }}>‹</button>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#1A1814' }}>⏱ Reinigungs-Dauer</div>
        <div style={{ flex: 1 }} />
        {loading && <span style={{ fontSize: 12, color: '#B0AA9C' }}>Laden…</span>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '14px 14px 40px' }}>
          {error && <div style={{ padding: '11px 14px', borderRadius: 12, background: '#FEF2F2', color: '#B91C1C', fontSize: 13, marginBottom: 14 }}>⚠️ {error}</div>}

          {data && data.gesamt.count === 0 && !error && (
            <div style={{ textAlign: 'center', color: '#8A8578', fontSize: 14, padding: '30px 12px', lineHeight: 1.6 }}>
              Noch keine gemessenen Reinigungen.<br />
              Die Dauer entsteht automatisch, sobald eine Reinigung über den NFC-Aufkleber
              als fertig gemeldet wird (Start = erste Türöffnung an dem Tag).
            </div>
          )}

          {data && data.gesamt.count > 0 && (
            <>
              {/* Gesamt-Kachel: Median (robust) prominent, Ø daneben, Trend + Sparkline */}
              <div style={{ ...card, background: '#12222E', color: '#fff', padding: '16px 18px' }}>
                <div style={{ fontSize: 12, color: '#C8B98A', fontWeight: 700, letterSpacing: '0.04em' }}>REINIGUNGS-DAUER (MEDIAN)</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 30, fontWeight: 800 }}>{dur(data.gesamt.medMin)}</span>
                  <span style={{ fontSize: 13, color: '#9FB0BC' }}>Ø {dur(data.gesamt.avgMin)}</span>
                  {data.gesamt.trend && (
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: data.gesamt.trend.deltaMin < -5 ? '#7CE0A8' : data.gesamt.trend.deltaMin > 5 ? '#F0A0A0' : '#9FB0BC' }}>
                      {data.gesamt.trend.deltaMin < -5 ? '▼' : data.gesamt.trend.deltaMin > 5 ? '▲' : '→'} {Math.abs(data.gesamt.trend.deltaMin) < 5 ? 'stabil' : dur(Math.abs(data.gesamt.trend.deltaMin))}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#9FB0BC', marginTop: 3 }}>aus {data.gesamt.count} Reinigungen (letzte 180 Tage)</div>
                {data.gesamt.verlauf.length >= 2 && (
                  <div style={{ marginTop: 12 }}>
                    <Sparkline xs={data.gesamt.verlauf} />
                    <div style={{ fontSize: 10.5, color: '#7E8F9B', marginTop: 3 }}>Verlauf der Einzeldauern · älteste links, neueste rechts</div>
                  </div>
                )}
              </div>

              {/* Je Wohnung: Median + Trend */}
              <div style={eyebrow}>JE WOHNUNG</div>
              <div style={card}>
                {data.wohnungen.map((w, i) => (
                  <div key={w.title} style={{ padding: '11px 16px', boxShadow: i ? 'inset 0 0.5px 0 rgba(60,60,67,0.1)' : 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: '#1A1814' }}>{w.title}</span>
                      <span style={{ display: 'block', fontSize: 11, color: '#8A8578', marginTop: 1 }}>{w.count}× · Ø {dur(w.avgMin)} · {dur(w.minMin)}–{dur(w.maxMin)}</span>
                    </span>
                    <span style={{ textAlign: 'right', flexShrink: 0 }}>
                      <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: '#12222E' }}>{dur(w.medMin)}</span>
                      <TrendChip t={w.trend} />
                    </span>
                  </div>
                ))}
              </div>

              {/* Je Person: Median + Ø */}
              {data.personen.length > 0 && (
                <>
                  <div style={eyebrow}>JE REINIGUNGSKRAFT</div>
                  <div style={card}>
                    {data.personen.map((p, i) => (
                      <div key={p.name} style={{ padding: '11px 16px', boxShadow: i ? 'inset 0 0.5px 0 rgba(60,60,67,0.1)' : 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ flex: 1, fontSize: 14.5, color: '#1A1814' }}>👤 {p.name}</span>
                        <span style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: '#12222E' }}>{dur(p.medMin)}</span>
                          <span style={{ display: 'block', fontSize: 11, color: '#8A8578' }}>Ø {dur(p.avgMin)} · {p.count}×</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Letzte Reinigungen */}
              <div style={eyebrow}>LETZTE REINIGUNGEN</div>
              <div style={card}>
                {data.letzte.map((r, i) => (
                  <div key={i} style={{ padding: '10px 16px', boxShadow: i ? 'inset 0 0.5px 0 rgba(60,60,67,0.1)' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#1A1814' }}>{r.title}</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#12222E' }}>{dur(r.durationMin)}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: '#8A8578', marginTop: 2 }}>
                      {fmtDate(r.slotDate)}{r.person ? ` · ${r.person}` : ''} · {fmtTime(r.startedAt)}–{fmtTime(r.confirmedAt)} Uhr
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={{ marginTop: 16, fontSize: 11.5, color: '#B0AA9C', lineHeight: 1.55, padding: '0 4px' }}>
            <b>Median</b> = der typische Wert (unempfindlich gegen einzelne Ausreißer), <b>Ø</b> = Durchschnitt.
            Der <b>Trend</b> vergleicht die neuere mit der älteren Hälfte der Reinigungen — <span style={{ color: '#16A34A' }}>▼ grün</span> heißt schneller geworden,
            <span style={{ color: '#C0392B' }}> ▲ rot</span> langsamer (ab 4 Messungen).<br />
            Gemessen vom ersten Aufschließen der Tür (Schloss-Protokoll, Gäste-Codes ausgenommen)
            bis zur „Fertig"-Meldung am NFC-Aufkleber. Nur sichtbar für Chefs.
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(body, document.body)
}
