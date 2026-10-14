'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { haptic } from '@/components/team/ux'
import type { TempoAuswertung, TempoZeile } from '@/lib/tempo'

/**
 * ⏱ Wartestellen (Pascal, Chefsache 7.10.2026, Bereich 11 „Gefühlte Geschwindigkeit") — nur Chefs.
 * Zeigt aus /api/tempo, wo die Team-App in den letzten 7 Tagen auf Antworten gewartet hat: je Funktion
 * Aufrufe, „meist" (Median), „9 von 10 unter" (p90) und Fehlerquote, sortiert nach gefühlter
 * Wartelast (Aufrufe × p90) — oben steht, was als Nächstes schneller werden sollte.
 * Overlay via createPortal(document.body) — §83.
 */

type Antwort = TempoAuswertung & { tageMitDaten: number; von: string; bis: string }

const ERSTE = 25

/** ms → „0,4 s" / „12 s" / „< 0,1 s" */
function sek(ms: number): string {
  if (ms < 100) return '< 0,1 s'
  if (ms < 10_000) return `${(ms / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`
  return `${Math.round(ms / 1000)} s`
}
const zahl = (n: number) => n.toLocaleString('de-DE')
const tagKurz = (iso: string) => { const [, m, d] = iso.split('-'); return `${Number(d)}.${Number(m)}.` }

/** Ampel für den p90-Wert: unter 1 s gut · unter 3 s spürbar · darüber zäh */
function ampel(ms: number): { fg: string; bg: string } {
  if (ms < 1000) return { fg: 'var(--tm-green)', bg: 'var(--tm-green-soft)' }
  if (ms < 3000) return { fg: 'var(--tm-yellow)', bg: 'var(--tm-yellow-soft)' }
  return { fg: 'var(--tm-red)', bg: 'var(--tm-red-soft)' }
}

/** Farbe je Zeitstufe (<0,1 · <0,3 · <1 · <3 · <10 · ≥10 s) für den Verteilungs-Streifen */
const STUFE: { farbe: string; deckkraft: number }[] = [
  { farbe: 'var(--tm-green)', deckkraft: 1 },
  { farbe: 'var(--tm-green)', deckkraft: 0.55 },
  { farbe: 'var(--tm-yellow)', deckkraft: 0.55 },
  { farbe: 'var(--tm-yellow)', deckkraft: 1 },
  { farbe: 'var(--tm-red)', deckkraft: 0.7 },
  { farbe: 'var(--tm-red)', deckkraft: 1 },
]
const STUFEN_TEXT = ['unter 0,1 s', 'unter 0,3 s', 'unter 1 s', 'unter 3 s', 'unter 10 s', 'ab 10 s']

function Streifen({ eimer }: { eimer: number[] }) {
  const gesamt = eimer.reduce((a, b) => a + b, 0) || 1
  return (
    <div aria-hidden style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden', background: 'var(--tm-surface2)', marginTop: 7 }}>
      {eimer.map((c, i) => c > 0 && (
        <span key={i} style={{ width: `${(c / gesamt) * 100}%`, background: STUFE[i].farbe, opacity: STUFE[i].deckkraft }} />
      ))}
    </div>
  )
}

function Zeile({ z, letzte }: { z: TempoZeile; letzte: boolean }) {
  const a = ampel(z.p90)
  const fehler = z.fehlerQuote > 0
    ? ` · ${(z.fehlerQuote * 100).toLocaleString('de-DE', { maximumFractionDigits: z.fehlerQuote < 0.1 ? 1 : 0 })} % Fehler`
    : ''
  return (
    <div style={{ padding: '11px 14px', minHeight: 66, boxSizing: 'border-box', boxShadow: letzte ? 'none' : 'inset 0 -0.5px 0 var(--tm-line)' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--tm-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{z.name}</div>
          <div style={{ fontSize: 12.5, color: z.fehlerQuote >= 0.05 ? 'var(--tm-red)' : 'var(--tm-muted)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
            {zahl(z.aufrufe)} × · meist {sek(z.median)}{fehler}
          </div>
        </div>
        <span title="9 von 10 Aufrufen waren schneller" style={{
          flexShrink: 0, minWidth: 58, textAlign: 'center', padding: '4px 9px', borderRadius: 'var(--tm-r-pill)',
          background: a.bg, color: a.fg, fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
        }}>{sek(z.p90)}</span>
      </div>
      <Streifen eimer={z.eimer} />
    </div>
  )
}

export default function TempoPanel({ onClose }: { onClose: () => void }) {
  const [daten, setDaten] = useState<Antwort | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [alle, setAlle] = useState(false)

  useEffect(() => {
    fetch('/api/tempo', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          setFehler(r.status === 403 ? 'Die Wartestellen sehen nur Chefs.' : 'Die Messwerte konnten nicht geladen werden. Versuch es gleich noch einmal.')
          return
        }
        setDaten(await r.json())
      })
      .catch(() => setFehler('Die Messwerte konnten nicht geladen werden. Prüf die Verbindung und öffne sie noch einmal.'))
  }, [])

  const zeilen = daten?.zeilen ?? []
  const sichtbar = alle ? zeilen : zeilen.slice(0, ERSTE)
  const laedt = daten === null && !fehler

  const body = (
    <div className="team-shell" style={{
      position: 'fixed', inset: 0, zIndex: 80, background: 'var(--tm-surface2)',
      display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'var(--tm-card)',
        boxShadow: 'inset 0 -0.5px 0 var(--tm-line)', flexShrink: 0,
      }}>
        <button onClick={() => { haptic(); onClose() }} aria-label="Zurück" style={{ border: 'none', background: 'none', fontSize: 22, color: 'var(--tm-accent)', cursor: 'pointer', padding: '0 4px', minWidth: 40, minHeight: 40 }}>‹</button>
        <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--tm-text)' }}>⏱ Wartestellen</div>
        <div style={{ flex: 1 }} />
        {laedt && <span style={{ fontSize: 12, color: 'var(--tm-muted2)' }}>Lädt…</span>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '14px 14px 40px' }}>
          <div style={{ fontSize: 13, color: 'var(--tm-muted)', lineHeight: 1.5, margin: '0 4px 14px' }}>
            Wo die App in den letzten 7 Tagen auf Antworten gewartet hat – ganz oben steht, was am meisten Wartezeit kostet und als Nächstes schneller werden sollte.
          </div>

          {fehler && (
            <div style={{ padding: '11px 14px', borderRadius: 12, background: 'var(--tm-red-soft)', color: 'var(--tm-red)', fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
              ⚠️ {fehler}
            </div>
          )}

          {/* Platzhalter in passender Größe, solange geladen wird — nichts springt beim Eintreffen */}
          {laedt && (
            <>
              <div className="team-skel" style={{ height: 74, borderRadius: 14, marginBottom: 14 }} />
              <div className="team-skel" style={{ height: 14, width: '45%', borderRadius: 6, margin: '0 4px 8px' }} />
              <div style={{ background: 'var(--tm-card)', borderRadius: 14, overflow: 'clip', boxShadow: 'var(--tm-shadow)' }}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} style={{ padding: '11px 14px', minHeight: 66, boxSizing: 'border-box', boxShadow: i < 5 ? 'inset 0 -0.5px 0 var(--tm-line)' : 'none' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <div className="team-skel" style={{ height: 13, borderRadius: 6, width: `${60 - (i % 3) * 12}%`, marginBottom: 7 }} />
                        <div className="team-skel" style={{ height: 11, borderRadius: 6, width: `${42 - (i % 2) * 8}%` }} />
                      </div>
                      <div className="team-skel" style={{ width: 58, height: 24, borderRadius: 12 }} />
                    </div>
                    <div className="team-skel" style={{ height: 5, borderRadius: 3, marginTop: 7 }} />
                  </div>
                ))}
              </div>
            </>
          )}

          {daten && (
            <>
              {/* App-Start */}
              <div style={{ background: 'var(--tm-card)', borderRadius: 14, padding: '12px 14px', boxShadow: 'var(--tm-shadow)', marginBottom: 14, minHeight: 74, boxSizing: 'border-box' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 20 }}>🚀</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--tm-text)' }}>App-Start</div>
                    <div style={{ fontSize: 12.5, color: 'var(--tm-muted)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                      {daten.appStart
                        ? `${zahl(daten.appStart.aufrufe)} Starts · meist ${sek(daten.appStart.median)} bis die App bedienbar ist`
                        : 'Noch kein Start gemessen – kommt beim nächsten Öffnen der App.'}
                    </div>
                  </div>
                  {daten.appStart && (
                    <span title="9 von 10 Starts waren schneller" style={{
                      flexShrink: 0, minWidth: 58, textAlign: 'center', padding: '4px 9px', borderRadius: 'var(--tm-r-pill)',
                      background: ampel(daten.appStart.p90).bg, color: ampel(daten.appStart.p90).fg,
                      fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                    }}>{sek(daten.appStart.p90)}</span>
                  )}
                </div>
                {daten.appStart && <Streifen eimer={daten.appStart.eimer} />}
              </div>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '0 4px 7px' }}>
                <div style={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--tm-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  {tagKurz(daten.von)}–{tagKurz(daten.bis)} · {zahl(daten.aufrufeGesamt)} Aufrufe
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--tm-muted2)' }}>9 von 10 unter</div>
              </div>

              {zeilen.length === 0 ? (
                <div style={{ background: 'var(--tm-card)', borderRadius: 14, padding: '28px 20px', textAlign: 'center', color: 'var(--tm-muted)', fontSize: 14, lineHeight: 1.5, boxShadow: 'var(--tm-shadow)' }}>
                  Noch keine Messwerte. Sobald das Team die App nutzt, siehst du hier, wo gewartet wird – die ersten Werte kommen nach ein paar Minuten.
                </div>
              ) : (
                <div style={{ background: 'var(--tm-card)', borderRadius: 14, overflow: 'clip', boxShadow: 'var(--tm-shadow)' }}>
                  {sichtbar.map((z, i) => <Zeile key={`${z.methode} ${z.muster}`} z={z} letzte={i === sichtbar.length - 1} />)}
                </div>
              )}

              {!alle && zeilen.length > ERSTE && (
                <button onClick={() => { haptic(); setAlle(true) }} style={{
                  display: 'block', width: '100%', marginTop: 10, padding: '11px 14px', borderRadius: 12, border: 'none',
                  background: 'var(--tm-card)', color: 'var(--tm-accent-dark)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  boxShadow: 'var(--tm-shadow)',
                }}>Alle {zahl(zeilen.length)} Funktionen zeigen</button>
              )}

              <div style={{ fontSize: 12, color: 'var(--tm-muted)', lineHeight: 1.6, margin: '16px 4px 0' }}>
                <strong>So liest du das:</strong> „meist“ heißt, die Hälfte der Aufrufe war schneller. Die Zahl rechts ist die Zeit, unter der 9 von 10 Aufrufen blieben – grün unter 1 s, gelb unter 3 s, rot darüber. Der Streifen zeigt die Verteilung ({STUFEN_TEXT.join(' · ')}). Die Werte sind aus Zeitstufen geschätzt.
                {daten.tageMitDaten < 7 && <> Bisher gibt es Messwerte von {daten.tageMitDaten === 1 ? 'einem Tag' : `${daten.tageMitDaten} Tagen`}.</>}
                <br />Gemessen wird nur, wie lange jede Funktion dauert – keine Inhalte, keine Namen, keine Texte. Aufrufe bei geschlossener App zählen nicht mit.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(body, document.body) : null
}
