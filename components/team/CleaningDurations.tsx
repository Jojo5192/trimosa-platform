'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * ⏱ §255: Reinigungs-Dauer-Auswertung (nur Chefs). Von „Tür auf"
 * (Schloss-Protokoll) bis „fertig gemeldet" (NFC). Vollbild-Portal §83.
 */
interface Data {
  gesamt: { count: number; avgMin: number }
  wohnungen: { title: string; count: number; avgMin: number; minMin: number; maxMin: number }[]
  personen: { name: string; count: number; avgMin: number }[]
  letzte: { title: string; slotDate: string; person: string | null; durationMin: number; startedAt: string | null; confirmedAt: string | null }[]
}

function dur(min: number): string {
  const h = Math.floor(min / 60)
  return h ? `${h} h ${min % 60} min` : `${min} min`
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
              {/* Gesamt-Kachel */}
              <div style={{ ...card, background: '#12222E', color: '#fff', padding: '16px 18px' }}>
                <div style={{ fontSize: 12, color: '#C8B98A', fontWeight: 700, letterSpacing: '0.04em' }}>DURCHSCHNITT ALLER REINIGUNGEN</div>
                <div style={{ fontSize: 30, fontWeight: 800, marginTop: 4 }}>{dur(data.gesamt.avgMin)}</div>
                <div style={{ fontSize: 12, color: '#9FB0BC', marginTop: 3 }}>aus {data.gesamt.count} gemessenen Reinigungen (letzte 180 Tage)</div>
              </div>

              {/* Je Wohnung */}
              <div style={eyebrow}>JE WOHNUNG</div>
              <div style={card}>
                {data.wohnungen.map((w, i) => (
                  <div key={w.title} style={{ padding: '11px 16px', boxShadow: i ? 'inset 0 0.5px 0 rgba(60,60,67,0.1)' : 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600, color: '#1A1814' }}>{w.title}</span>
                    <span style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: '#12222E' }}>{dur(w.avgMin)}</span>
                      <span style={{ display: 'block', fontSize: 11, color: '#8A8578' }}>{w.count}× · {dur(w.minMin)}–{dur(w.maxMin)}</span>
                    </span>
                  </div>
                ))}
              </div>

              {/* Je Person */}
              {data.personen.length > 0 && (
                <>
                  <div style={eyebrow}>JE REINIGUNGSKRAFT</div>
                  <div style={card}>
                    {data.personen.map((p, i) => (
                      <div key={p.name} style={{ padding: '11px 16px', boxShadow: i ? 'inset 0 0.5px 0 rgba(60,60,67,0.1)' : 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ flex: 1, fontSize: 14.5, color: '#1A1814' }}>👤 {p.name}</span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#12222E' }}>{dur(p.avgMin)}</span>
                        <span style={{ fontSize: 11, color: '#8A8578', width: 34, textAlign: 'right' }}>{p.count}×</span>
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

          <div style={{ marginTop: 16, fontSize: 11.5, color: '#B0AA9C', lineHeight: 1.5, padding: '0 4px' }}>
            Gemessen vom ersten Aufschließen der Tür (aus dem Schloss-Protokoll, Gäste-Codes ausgenommen)
            bis zur „Fertig"-Meldung am NFC-Aufkleber. Nur sichtbar für Chefs.
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(body, document.body)
}
