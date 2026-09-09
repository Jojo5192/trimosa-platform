'use client'

import { useCallback, useEffect, useState } from 'react'
import { haptic, tmToast } from '@/components/team/ux'

/**
 * 📈 Kennzahlen + Ausblick unter der Belegung (Pascal-Prompt 8.9., Punkt 5 —
 * Baustein ⑤). NUR Admins/Gastgeber: der erste Abruf entscheidet — 403 ⇒ die
 * Karte bleibt komplett aus (gleiches Probe-Muster wie im Mehr-Tab, §255).
 * Daten: GET /api/kennzahlen?monat=YYYY-MM (Summen, je Wohnung, Ausblick).
 * Ziel-Override: PUT /api/kennzahlen { monat, ziel } (Tipp auf „Ziel").
 */

type Wohnung = { id: string; title: string; umsatz: number; naechte: number; auslastung: number }
type AusblickMonat = {
  monat: string; label: string; umsatz: number; vj: number
  ziel: number | null; zielManuell: boolean; lead: number; anteil: number | null
}
type Kennzahlen = {
  monat: string
  label: string
  summen: { umsatz: number; auslastung: number; oNacht: number | null; naechte: number; buchungen: number }
  wohnungen: Wohnung[]
  ausblick: { stand: string; monate: AusblickMonat[] }
  ust: number
  zielAufschlag: number
}

const DETAILS_KEY = 'trimosa-kz-details'
const DE_MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

/** Monat des heutigen Tages in Europe/Berlin als YYYY-MM. */
function currentMonth(): string {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' }).slice(0, 7)
  } catch {
    return new Date().toISOString().slice(0, 7)
  }
}
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${DE_MONTHS[m - 1] ?? ym} ${y}`
}
/** 26.232 € — ganze Euro, deutsches Tausenderzeichen. */
function fmtEur(n: number): string {
  return `${Math.round(n).toLocaleString('de-DE')} €`
}
/** 28,0 k € — für die Ausblick-Zeilen (kompakt). */
function fmtK(n: number): string {
  if (Math.abs(n) < 1000) return `${Math.round(n)} €`
  return `${(n / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} k €`
}
function fmtStand(iso: string): string {
  const [, m, d] = iso.split('-')
  return d && m ? `${d}.${m}.` : iso
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ background: 'var(--tm-surface2, #f4f5f7)', borderRadius: 12, padding: '12px 10px', textAlign: 'center', minWidth: 0 }}>
      <div className="tm-num" style={{ fontSize: 18, fontWeight: 800, color: 'var(--tm-text, #171a1f)', lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--tm-muted, #646b76)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
    </div>
  )
}

export default function KennzahlenCard() {
  const [ok, setOk] = useState<boolean | null>(null)
  const [monat, setMonat] = useState<string>(() => currentMonth())
  const [data, setData] = useState<Kennzahlen | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDetails, setShowDetails] = useState(true)
  const [showInfo, setShowInfo] = useState(false)

  useEffect(() => {
    try { setShowDetails(localStorage.getItem(DETAILS_KEY) !== '0') } catch { /* egal */ }
  }, [])

  const load = useCallback(async (ym: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/kennzahlen?monat=${encodeURIComponent(ym)}`, { cache: 'no-store' })
      if (res.status === 403) { setOk(false); return }
      if (!res.ok) { setError('Kennzahlen konnten nicht geladen werden.'); return }
      const j = (await res.json()) as Kennzahlen
      setOk(true)
      setError(null)
      setData(j)
    } catch {
      setError('Kennzahlen konnten nicht geladen werden.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (ok !== false) void load(monat) }, [monat, load, ok])
  useEffect(() => {
    const h = () => { if (ok) void load(monat) }
    window.addEventListener('trimosa-refresh', h)
    return () => window.removeEventListener('trimosa-refresh', h)
  }, [load, monat, ok])

  const toggleDetails = () => {
    haptic()
    setShowDetails((v) => {
      try { localStorage.setItem(DETAILS_KEY, v ? '0' : '1') } catch { /* egal */ }
      return !v
    })
  }

  const editZiel = async (m: AusblickMonat) => {
    const vorschlag = m.ziel != null ? String(Math.round(m.ziel)) : ''
    const raw = window.prompt(
      `Ziel für ${m.label} (netto, ganze Euro).\nLeer lassen = zurück auf Vorjahr + ${data?.zielAufschlag ?? 5} %.`,
      vorschlag,
    )
    if (raw === null) return
    const cleaned = raw.replace(/[^\d]/g, '')
    const ziel = cleaned ? Number(cleaned) : null
    try {
      const res = await fetch('/api/kennzahlen', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monat: m.monat, ziel }),
      })
      if (!res.ok) throw new Error()
      tmToast(ziel != null ? `Ziel ${m.label}: ${fmtEur(ziel)}` : `Ziel ${m.label} wieder automatisch`)
      void load(monat)
    } catch {
      tmToast('Ziel konnte nicht gespeichert werden.')
    }
  }

  // Nicht berechtigt (403) → Karte komplett aus; vor der ersten Antwort auch nichts.
  if (ok === false || (ok === null && !data)) return null

  const s = data?.summen
  const maxUmsatz = Math.max(1, ...(data?.wohnungen.map((w) => w.umsatz) ?? [1]))
  const istAktuell = monat === currentMonth()

  return (
    <section className="tm-card tm-enter" style={{ margin: '14px 4px 0', padding: '14px 14px 12px', opacity: loading ? 0.7 : 1, transition: 'opacity 0.2s var(--tm-ease, ease)' }}>
      {/* Kopf: ‹ Monat › */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
        <button type="button" className="tm-iconbtn tm-press-btn" aria-label="Vormonat" onClick={() => { haptic(); setMonat((m) => shiftMonth(m, -1)) }} style={{ width: 36, height: 36, fontSize: 18 }}>‹</button>
        <button type="button" onClick={() => { if (!istAktuell) { haptic(); setMonat(currentMonth()) } }} title={istAktuell ? undefined : 'Zum aktuellen Monat'} style={{ background: 'none', border: 'none', padding: 0, cursor: istAktuell ? 'default' : 'pointer', fontSize: 16, fontWeight: 800, color: 'var(--tm-text, #171a1f)', letterSpacing: '-0.01em' }}>
          {monthLabel(monat)}
        </button>
        <button type="button" className="tm-iconbtn tm-press-btn" aria-label="Folgemonat" onClick={() => { haptic(); setMonat((m) => shiftMonth(m, 1)) }} style={{ width: 36, height: 36, fontSize: 18 }}>›</button>
      </div>

      {error && !data ? (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--tm-red, #dc3d3d)' }}>{error}</p>
      ) : s ? (
        <>
          {/* Vier Kacheln */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
            <Tile value={fmtEur(s.umsatz)} label="Umsatz netto" />
            <Tile value={`${Math.round(s.auslastung)}%`} label="Auslastung" />
            <Tile value={s.oNacht != null ? fmtEur(s.oNacht) : '—'} label="Ø / Nacht netto" />
            <Tile value={String(s.naechte)} label={`Nächte · ${s.buchungen} ${s.buchungen === 1 ? 'Buchung' : 'Buchungen'}`} />
          </div>

          {/* Je Wohnung — standardmäßig ausgeklappt, Zustand gemerkt */}
          <button type="button" onClick={toggleDetails} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: '12px 0 6px', cursor: 'pointer', fontSize: 13.5, fontWeight: 700, color: 'var(--tm-accent-dark, #8A7020)' }}>
            <span style={{ fontSize: 11 }}>{showDetails ? '▾' : '▸'}</span>
            {showDetails ? 'Details ausblenden' : 'Je Wohnung anzeigen'}
          </button>
          {showDetails && (
            <div style={{ borderTop: '1px solid var(--tm-line, #e3e6ea)' }}>
              {data!.wohnungen.length === 0 ? (
                <p style={{ margin: 0, padding: '12px 0 4px', fontSize: 12.5, color: 'var(--tm-muted, #646b76)' }}>Keine Buchungen in diesem Monat.</p>
              ) : data!.wohnungen.map((w) => (
                <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--tm-line, #e3e6ea)' }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--tm-text, #171a1f)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.title}</span>
                  <span style={{ width: 64, height: 8, borderRadius: 999, background: 'var(--tm-surface2, #f4f5f7)', overflow: 'hidden', flexShrink: 0 }}>
                    <span style={{ display: 'block', height: '100%', width: `${Math.max(0, Math.min(100, w.auslastung))}%`, borderRadius: 999, background: 'var(--tm-accent, #AE8D2D)', transition: 'width 0.4s var(--tm-ease, ease)' }} />
                  </span>
                  <span className="tm-num" style={{ width: 38, textAlign: 'right', fontSize: 12.5, color: 'var(--tm-muted, #646b76)', flexShrink: 0 }}>{Math.round(w.auslastung)}%</span>
                  <span className="tm-num" style={{ width: 66, textAlign: 'right', fontSize: 13.5, fontWeight: 800, color: 'var(--tm-text, #171a1f)', flexShrink: 0, opacity: w.umsatz / maxUmsatz < 0.02 && w.umsatz === 0 ? 0.5 : 1 }}>{fmtEur(w.umsatz)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Ausblick: die nächsten 6 Monate ab heute */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 14, marginBottom: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--tm-text, #171a1f)' }}>Ausblick</span>
            <span style={{ fontSize: 11.5, color: 'var(--tm-muted2, #959ca7)' }}>Stand {fmtStand(data!.ausblick.stand)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {data!.ausblick.monate.map((m) => {
              const pct = m.anteil
              const width = pct == null ? (m.umsatz > 0 ? 8 : 0) : Math.max(m.umsatz > 0 ? 8 : 0, Math.min(100, pct))
              const erreicht = m.ziel != null && m.umsatz >= m.ziel
              const innen = width >= 48
              const text = pct == null ? fmtK(m.umsatz) : `${fmtK(m.umsatz)} · ${Math.round(pct)}%`
              const [yy, mm] = m.monat.split('-')
              return (
                <div key={m.monat} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 54, flexShrink: 0, lineHeight: 1.15 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: m.lead === 0 ? 'var(--tm-accent-dark, #8A7020)' : 'var(--tm-text, #171a1f)' }}>
                      {DE_MONTHS[Number(mm) - 1]?.slice(0, 3)} {yy.slice(2)}
                    </span>
                    {m.lead >= 2 && <span style={{ display: 'block', fontSize: 10.5, color: 'var(--tm-muted2, #959ca7)', marginTop: 1 }}>+{m.lead} Mon.</span>}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, height: 26, borderRadius: 999, background: 'var(--tm-surface2, #f4f5f7)', position: 'relative', overflow: 'hidden' }}>
                    <span style={{ position: 'absolute', inset: 0, width: `${width}%`, borderRadius: 999, background: erreicht ? 'var(--tm-green, #1a9d57)' : 'var(--tm-accent, #AE8D2D)', transition: 'width 0.4s var(--tm-ease, ease)' }} />
                    <span className="tm-num" style={{
                      position: 'absolute', top: 0, bottom: 0, display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
                      ...(innen ? { left: 10, color: '#fff' } : { right: 10, color: erreicht ? 'var(--tm-green, #1a9d57)' : 'var(--tm-accent-dark, #8A7020)' }),
                    }}>{text}</span>
                  </span>
                  <button type="button" onClick={() => { haptic(); void editZiel(m) }} title="Ziel anpassen" style={{ width: 84, flexShrink: 0, textAlign: 'right', background: 'none', border: 'none', padding: 0, cursor: 'pointer', lineHeight: 1.2 }}>
                    <span className="tm-num" style={{ display: 'block', fontSize: 12.5, fontWeight: 800, color: 'var(--tm-text, #171a1f)' }}>
                      Ziel {m.ziel != null ? fmtK(m.ziel) : '—'}{m.zielManuell ? ' ✎' : ''}
                    </span>
                    <span className="tm-num" style={{ display: 'block', fontSize: 11.5, color: 'var(--tm-muted2, #959ca7)' }}>VJ {fmtK(m.vj)}</span>
                  </button>
                </div>
              )
            })}
          </div>

          {/* Fußnote: wie gerechnet wird */}
          <button type="button" onClick={() => setShowInfo((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: '12px 0 0', cursor: 'pointer', fontSize: 11.5, color: 'var(--tm-muted2, #959ca7)' }}>
            <span style={{ fontSize: 10 }}>{showInfo ? '▾' : '▸'}</span> Alle Beträge netto · wie das Ziel entsteht
          </button>
          {showInfo && (
            <p style={{ margin: '6px 0 0', fontSize: 11.5, lineHeight: 1.5, color: 'var(--tm-muted, #646b76)' }}>
              Netto = Buchungspreis ohne {data!.ust} % USt, Buchungen zählen anteilig nach Nächten im Monat
              (nur bestätigte, bezahlte Aufenthalte mit Preis). Auslastung = belegte Nächte ÷ (aktive Wohnungen × Tage).
              Ziel = Vorjahresmonat + {data!.zielAufschlag} %; Tipp auf &bdquo;Ziel&ldquo; setzt einen eigenen Wert (✎), leer = wieder automatisch.
              Ausblick = bereits gebuchter Umsatz der nächsten Monate, Stand heute.
            </p>
          )}
        </>
      ) : null}
    </section>
  )
}
