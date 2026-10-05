'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { haptic, Segmented } from '@/components/team/ux'

/**
 * 🤖 KI-Auto-Antworten (Phase 2, Pascal 26.9.) — Mehr → KI-Auto-Antworten.
 * Modus (Aus · Schatten · Aktiv), Tor-Fortschritt und die letzten 50 Entscheidungen der KI mit
 * „richtig"/„falsch"-Bewertung. Sichtbar nur für Admins und Gastgeber (Probe 403 → kein Eintrag);
 * den Modus kann nur ein Admin ändern. Alle Sicherungen (Kategorien, Tor, Zeitfenster) stehen fest
 * im Code (lib/ai-autoreply.ts) — hier wird nur angezeigt und bewertet.
 * Overlay via createPortal(document.body) mit .team-shell (§83/§100).
 */

type Mode = 'aus' | 'schatten' | 'aktiv'
interface Gate { ok: boolean; bewertet: number; falsch: number; quote: number | null; min: number; maxQuote: number; grund: string; art?: 'qualitaet' | 'pause' | 'technik' }
interface Row {
  id: string; created_at: string; booking_id: string; gast: string; wohnung: string | null
  modus: string; kategorie: string | null; konfidenz: number | null
  gast_text: string | null; gast_lang: string | null; entwurf: string | null; gesendet_text: string | null
  entscheidung: string; grund: string | null; kanal: string | null
  bewertung: 'richtig' | 'falsch' | null; bewertet_von?: string | null; bewertet_name: string | null; bewertet_at: string | null
  team_antwort: string | null
}
interface Daten {
  settings: {
    mode: Mode; schwelle: number; geaendertVon?: string | null; geaendertAm?: string | null
    gateSeit?: string | null; zurueckgestellt?: { am: string; grund: string } | null
  }
  darfModus: boolean
  /** eigene Nutzer-id — fremde Urteile kann nur ein Admin ändern */
  ich?: string
  migration: 'ok' | 'fehlt'
  gate: Gate
  grenzen: { schwelleMin: number; schwelleMax: number; torMin: number; torMaxFalsch: number; torMaxUnbewertet?: number; minAlterMin: number; maxAlterStd: number; stundeVon: number; stundeBis: number; maxProThreadTag: number; maxProTag: number }
  rows: Row[]
}

const KAT: Record<string, string> = {
  wlan: 'WLAN', parken: 'Parken', checkin_zeit: 'Check-in-Zeit', checkout_zeit: 'Check-out-Zeit',
  anfahrt: 'Anfahrt', muell: 'Müll', sperre: 'Stichwort-Sperre',
}
/** Entscheidungen mit inhaltlich freigegebenem Entwurf — nur sie zählen für das Tor */
const SENDE = ['haette_gesendet', 'vorrang', 'gesendet']
const ENTSCHEIDUNG: Record<string, { label: string; fg: string; bg: string }> = {
  gesendet: { label: '🤖 gesendet', fg: 'var(--tm-green)', bg: 'var(--tm-green-soft)' },
  haette_gesendet: { label: 'hätte gesendet', fg: 'var(--tm-accent-dark)', bg: 'var(--tm-accent-soft)' },
  vorrang: { label: 'inhaltlich ok · Mensch hatte Vorrang', fg: 'var(--tm-blue)', bg: 'var(--tm-surface2)' },
  abgelehnt: { label: 'nicht beantwortet', fg: 'var(--tm-muted)', bg: 'var(--tm-surface2)' },
  fehler: { label: 'Fehler', fg: 'var(--tm-red)', bg: 'var(--tm-red-soft)' },
  laeuft: { label: 'läuft …', fg: 'var(--tm-muted)', bg: 'var(--tm-surface2)' },
  sendet: { label: 'sendet …', fg: 'var(--tm-muted)', bg: 'var(--tm-surface2)' },
}
const MODUS_TEXT: Record<Mode, string> = {
  aus: 'Die KI beantwortet nichts selbstständig und protokolliert nichts. Der ✨-Vorschlag im Chat bleibt wie gewohnt.',
  schatten: 'Die KI sendet NICHTS. Sie protokolliert nur, was sie gesendet hätte – zum Bewerten hier unten.',
  aktiv: 'Die KI beantwortet einfache Fragen selbstständig, wenn alle Sicherungen erfüllt sind. Jede Antwort steht im Thread mit „🤖 automatisch beantwortet“ und kommt als Push.',
}

function zeit(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const LABEL: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: 'var(--tm-muted)', letterSpacing: '0.04em', margin: '0 4px 7px', textTransform: 'uppercase' }
// iOS-27-Runde: eine Kartenform app-weit — Radius-Token + Haarlinie innen + weicher Schatten (wie .tm-card)
const CARD: React.CSSProperties = { background: 'var(--tm-card)', borderRadius: 'var(--tm-r-card)', padding: '13px 14px', boxShadow: 'inset 0 0 0 0.5px var(--tm-line), var(--tm-shadow)', marginBottom: 18 }

function Zitat({ titel, text, farbe }: { titel: string; text: string; farbe?: string }) {
  return (
    <div style={{ marginTop: 8, minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.04em', color: farbe ?? 'var(--tm-muted)', textTransform: 'uppercase', marginBottom: 2 }}>{titel}</div>
      <div style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--tm-text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{text}</div>
    </div>
  )
}

export default function AutoReplyPanel({ onClose }: { onClose: () => void }) {
  const [d, setD] = useState<Daten | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [meldung, setMeldung] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState<'sende' | 'alle'>('sende')

  useEffect(() => {
    fetch('/api/ai/autoreply/log', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 403 ? 'Kein Zugriff.' : `Fehler ${r.status}`)
        setD(await r.json() as Daten)
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)))
  }, [])

  async function speichern(patch: { mode?: Mode; schwelle?: number }) {
    if (!d || !d.darfModus || busy) return
    setBusy(true)
    setMeldung(null)
    try {
      const r = await fetch('/api/ai/autoreply', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      })
      const j = await r.json().catch(() => ({})) as { settings?: Daten['settings']; gate?: Gate; error?: string }
      if (!r.ok || !j.settings) { haptic('error'); setMeldung(j.error ?? 'Speichern fehlgeschlagen.'); return }
      haptic('success')
      const settings = j.settings
      setD((p) => (p ? { ...p, settings, gate: j.gate ?? p.gate } : p))
    } catch {
      haptic('error'); setMeldung('Speichern fehlgeschlagen – keine Verbindung.')
    } finally { setBusy(false) }
  }

  function schwelleSenken() {
    if (!d || busy || d.settings.mode === 'aktiv') return
    // Senken öffnet einen Konfidenz-Bereich, den noch niemand bewertet hat → das Tor zählt neu
    if (d.gate.bewertet > 0 && !window.confirm('Die Schwelle zu senken setzt das Tor zurück: Für „Aktiv“ zählen dann nur Entscheidungen ab jetzt (wieder mindestens ' + d.gate.min + ' Bewertungen). Wirklich senken?')) return
    void speichern({ schwelle: d.settings.schwelle - 1 })
  }

  function modusWaehlen(v: string) {
    if (!d || v === d.settings.mode) return
    if (v !== 'aus' && v !== 'schatten' && v !== 'aktiv') return
    if (v === 'aktiv' && !window.confirm('Im Modus „Aktiv“ sendet die KI selbstständig Antworten an echte Gäste – ohne Freigabe durch das Team. Wirklich einschalten?')) return
    void speichern({ mode: v })
  }

  /** das Urteil eines anderen ändert/löscht nur ein Admin (der Server prüft das ebenfalls) */
  const fremdesUrteil = (r: Row): boolean => !!d && !d.darfModus && !!r.bewertung && !!r.bewertet_von && r.bewertet_von !== d.ich

  async function bewerten(row: Row, b: 'richtig' | 'falsch') {
    if (fremdesUrteil(row)) { haptic('error'); setMeldung('Dieses Urteil stammt von jemand anderem – ändern kann es nur ein Admin.'); return }
    const next = row.bewertung === b ? null : b
    const setRow = (x: Partial<Row>) => setD((p) => (p ? { ...p, rows: p.rows.map((r) => (r.id === row.id ? { ...r, ...x } : r)) } : p))
    haptic()
    setMeldung(null)
    setRow({ bewertung: next, bewertet_von: next ? d?.ich ?? null : null, bewertet_name: next ? 'dir' : null, bewertet_at: next ? new Date().toISOString() : null })
    try {
      const r = await fetch('/api/ai/autoreply/log', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.id, bewertung: next }),
      })
      const j = await r.json().catch(() => ({})) as { gate?: Gate; error?: string }
      if (!r.ok) throw new Error(j.error ?? 'Bewertung nicht gespeichert.')
      const gate = j.gate
      if (gate) setD((p) => (p ? { ...p, gate } : p))
    } catch (e) {
      haptic('error')
      setRow({ bewertung: row.bewertung, bewertet_von: row.bewertet_von, bewertet_name: row.bewertet_name, bewertet_at: row.bewertet_at })
      setMeldung(String(e instanceof Error ? e.message : e))
    }
  }

  const g = d?.gate
  const quotePct = g && g.quote !== null ? (g.quote * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 }) : null
  const rows = (d?.rows ?? []).filter((r) => filter === 'alle' || SENDE.includes(r.entscheidung))
  const offen = (d?.rows ?? []).filter((r) => SENDE.includes(r.entscheidung) && !r.bewertung).length

  const body = (
    <div className="team-shell" style={{
      position: 'fixed', inset: 0, zIndex: 80, background: 'var(--tm-bg)',
      display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'var(--tm-card)',
        boxShadow: 'inset 0 -0.5px 0 var(--tm-line)', flexShrink: 0,
      }}>
        <button type="button" onClick={onClose} aria-label="Zurück" style={{ border: 'none', background: 'none', fontSize: 22, color: 'var(--tm-accent-dark)', cursor: 'pointer', padding: '0 4px' }}>‹</button>
        <div style={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: 800, color: 'var(--tm-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🤖 KI-Auto-Antworten</div>
        {d === null && !error && <span style={{ fontSize: 12, color: 'var(--tm-muted2)', flexShrink: 0 }}>Laden…</span>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '14px 14px calc(40px + env(safe-area-inset-bottom))' }}>
          {error && (
            <div style={{ padding: '11px 14px', borderRadius: 12, background: 'var(--tm-red-soft)', color: 'var(--tm-red)', fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
              ⚠️ {error}
            </div>
          )}
          {meldung && (
            <div role="alert" style={{ padding: '11px 14px', borderRadius: 12, background: 'var(--tm-red-soft)', color: 'var(--tm-red)', fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
              {meldung}
            </div>
          )}

          {d && (
            <>
              {d.migration !== 'ok' && (
                <div style={{ padding: '11px 14px', borderRadius: 12, background: 'var(--tm-yellow-soft)', color: 'var(--tm-text)', fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
                  ⚙️ Noch nicht eingerichtet: Die Datenbank-Migration <strong>20261004_ai_autoreply.sql</strong> wurde noch nicht ausgeführt. Bis dahin ist die Funktion komplett aus.
                </div>
              )}

              {/* ── Modus ── */}
              <div style={LABEL}>Modus</div>
              <div style={CARD}>
                <div style={{ opacity: d.darfModus && !busy ? 1 : 0.55, pointerEvents: d.darfModus && !busy ? 'auto' : 'none' }}>
                  <Segmented
                    options={[['aus', 'Aus'], ['schatten', 'Schatten'], ['aktiv', 'Aktiv']]}
                    value={d.settings.mode}
                    onChange={modusWaehlen}
                    accent={{ aktiv: 'var(--tm-green)', schatten: 'var(--tm-accent-dark)' }}
                  />
                </div>
                <div style={{ fontSize: 13, color: 'var(--tm-text)', lineHeight: 1.5, marginTop: 10 }}>{MODUS_TEXT[d.settings.mode]}</div>
                {d.settings.mode === 'aktiv' && !d.gate.ok && (
                  <div style={{ marginTop: 10, padding: '9px 11px', borderRadius: 10, background: 'var(--tm-yellow-soft)', fontSize: 12.5, lineHeight: 1.5, color: 'var(--tm-text)' }}>
                    ⚠️ „Aktiv“ ist gewählt, aber das Tor ist nicht (mehr) erfüllt: {d.gate.grund} Bis dahin sendet die KI nichts und arbeitet wie im Schatten-Modus.
                  </div>
                )}
                {d.settings.mode === 'schatten' && d.settings.zurueckgestellt && (
                  <div style={{ marginTop: 10, padding: '9px 11px', borderRadius: 10, background: 'var(--tm-yellow-soft)', fontSize: 12.5, lineHeight: 1.5, color: 'var(--tm-text)' }}>
                    ⚠️ Automatisch von „Aktiv“ auf „Schatten“ zurückgestellt ({zeit(d.settings.zurueckgestellt.am)} Uhr), weil das Tor nicht mehr erfüllt war: {d.settings.zurueckgestellt.grund} Wieder einschalten kann nur ein Admin.
                  </div>
                )}
                {d.settings.mode !== 'aktiv' && !d.gate.ok && d.darfModus && (
                  <div style={{ fontSize: 12, color: 'var(--tm-muted)', lineHeight: 1.5, marginTop: 8 }}>
                    „Aktiv“ lässt sich erst einschalten, wenn das Tor unten erfüllt ist.
                  </div>
                )}
                {!d.darfModus && (
                  <div style={{ fontSize: 12, color: 'var(--tm-muted)', lineHeight: 1.5, marginTop: 8 }}>Den Modus kann nur ein Admin ändern.</div>
                )}
                {d.settings.geaendertVon && d.settings.geaendertAm && (
                  <div style={{ fontSize: 11.5, color: 'var(--tm-muted2)', marginTop: 8 }}>Zuletzt geändert von {d.settings.geaendertVon}, {zeit(d.settings.geaendertAm)} Uhr</div>
                )}

                {/* Schwelle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, paddingTop: 12, boxShadow: 'inset 0 0.5px 0 var(--tm-line)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--tm-text)' }}>Mindest-Konfidenz</div>
                    <div style={{ fontSize: 12, color: 'var(--tm-muted)', lineHeight: 1.4, marginTop: 1 }}>
                      Darunter antwortet die KI nie ({d.grenzen.schwelleMin}–{d.grenzen.schwelleMax}).
                      {d.darfModus ? (d.settings.mode === 'aktiv' ? ' Senken geht nur im Modus „Schatten“.' : ' Senken setzt das Tor zurück.') : ''}
                    </div>
                  </div>
                  {d.darfModus && (
                    <button aria-label="Schwelle senken" disabled={busy || d.settings.mode === 'aktiv' || d.settings.schwelle <= d.grenzen.schwelleMin}
                      onClick={schwelleSenken}
                      style={{ width: 32, height: 32, borderRadius: 16, border: 'none', background: 'var(--tm-fill)', color: 'var(--tm-text)', fontSize: 18, cursor: 'pointer', flexShrink: 0, opacity: busy || d.settings.mode === 'aktiv' || d.settings.schwelle <= d.grenzen.schwelleMin ? 0.4 : 1 }}>−</button>
                  )}
                  <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--tm-text)', fontVariantNumeric: 'tabular-nums', minWidth: 30, textAlign: 'center', flexShrink: 0 }}>{d.settings.schwelle}</div>
                  {d.darfModus && (
                    <button aria-label="Schwelle erhöhen" disabled={busy || d.settings.schwelle >= d.grenzen.schwelleMax}
                      onClick={() => void speichern({ schwelle: d.settings.schwelle + 1 })}
                      style={{ width: 32, height: 32, borderRadius: 16, border: 'none', background: 'var(--tm-fill)', color: 'var(--tm-text)', fontSize: 18, cursor: 'pointer', flexShrink: 0, opacity: busy || d.settings.schwelle >= d.grenzen.schwelleMax ? 0.4 : 1 }}>+</button>
                  )}
                </div>
              </div>

              {/* ── Tor ── */}
              <div style={LABEL}>Tor für „Aktiv“</div>
              <div style={CARD}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: 'var(--tm-text)' }}>
                    {Math.min(d.gate.bewertet, d.gate.min)} von {d.gate.min} bewertet
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, flexShrink: 0, color: d.gate.ok ? 'var(--tm-green)' : 'var(--tm-muted)' }}>
                    {d.gate.ok ? '✓ erfüllt' : 'gesperrt'}
                  </div>
                </div>
                <div style={{ height: 8, borderRadius: 4, background: 'var(--tm-surface2)', overflow: 'hidden', margin: '9px 0 8px' }}>
                  <div style={{ height: '100%', borderRadius: 4, width: `${Math.min(100, Math.round((d.gate.bewertet / Math.max(1, d.gate.min)) * 100))}%`, background: d.gate.ok ? 'var(--tm-green)' : 'var(--tm-accent)' }} />
                </div>
                <div style={{ fontSize: 13, color: 'var(--tm-text)', lineHeight: 1.5 }}>
                  Fehlerquote: <strong>{quotePct === null ? '–' : `${quotePct} %`}</strong>
                  {g && g.bewertet > 0 ? ` (${g.falsch} von ${g.bewertet} „falsch“)` : ''} · erlaubt höchstens {d.gate.maxQuote * 100} %
                </div>
                <div style={{ fontSize: 12, color: 'var(--tm-muted)', lineHeight: 1.5, marginTop: 6 }}>
                  {d.gate.grund} Es zählen nur von Menschen bewertete Entscheidungen mit freigegebenem Entwurf (jüngste 100). Das Tor wird bei jedem Lauf neu geprüft; fällt es im Modus „Aktiv“ zu, stellt sich der Modus auf „Schatten“ zurück. Warten {d.grenzen.torMaxUnbewertet ?? 10} oder mehr gesendete Antworten auf ihre Bewertung, pausiert der Versand.
                </div>
              </div>

              {/* ── Sicherungen ── */}
              <div style={LABEL}>Feste Sicherungen</div>
              <div style={{ ...CARD, fontSize: 12.5, color: 'var(--tm-muted)', lineHeight: 1.6 }}>
                Nur einfache Fragen zu <strong style={{ color: 'var(--tm-text)' }}>WLAN, Parken, Check-in-/Check-out-Zeit, Anfahrt und Müll</strong> – und nur, wenn jede Aussage in den Buchungs-/Wohnungsdaten oder der Gästemappe steht.
                Nie bei Geld, Rechnung, Storno, Änderungen, Beschwerden, Mängeln, Notfällen, Tür/Türcode/Schlüssel oder Sonderwünschen – und nie, wenn der Gast eine Zahl, Uhrzeit, Tageszeit oder einen Wochentag nennt.
                Der Mensch hat Vorrang: keine Auto-Antwort, wenn die Nachricht jünger als {d.grenzen.minAlterMin} Minuten oder älter als {d.grenzen.maxAlterStd} Stunden ist oder dem Team noch keine {d.grenzen.minAlterMin} Minuten in der App sichtbar war, das Team den Thread geöffnet, schon geantwortet oder in den 75 Minuten davor geschrieben hat (das gilt für jede der unbeantworteten Gast-Nachrichten, nicht nur die letzte), bei mehr als 4 Gast-Nachrichten in Folge, außerhalb {d.grenzen.stundeVon}–{d.grenzen.stundeBis} Uhr, bei stummgeschalteten Buchungen – und höchstens {d.grenzen.maxProThreadTag} Auto-Antwort je Thread und Tag.
              </div>

              {/* ── Entscheidungen ── */}
              <div style={LABEL}>Letzte Entscheidungen{offen > 0 ? ` · ${offen} zu bewerten` : ''}</div>
              <div style={{ marginBottom: 10 }}>
                <Segmented options={[['sende', 'Zum Bewerten'], ['alle', 'Alle']]} value={filter} onChange={(v) => setFilter(v === 'alle' ? 'alle' : 'sende')} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--tm-muted)', lineHeight: 1.5, margin: '0 4px 10px' }}>
                „richtig“ = die KI hätte genau so antworten dürfen · „falsch“ = Inhalt oder Entscheidung war nicht in Ordnung.
              </div>
              {rows.length === 0 && (
                <div style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--tm-muted)', fontSize: 13.5, lineHeight: 1.5 }}>
                  {d.settings.mode === 'aus'
                    ? 'Noch keine Einträge – im Modus „Aus“ wird nichts protokolliert.'
                    : filter === 'sende' ? 'Noch keine Entscheidung mit freigegebenem Entwurf. Unter „Alle“ steht, was die KI abgelehnt hat.' : 'Noch keine Einträge.'}
                </div>
              )}
              {rows.map((r) => {
                const e = ENTSCHEIDUNG[r.entscheidung] ?? ENTSCHEIDUNG.abgelehnt
                const fertig = r.entscheidung !== 'laeuft' && r.entscheidung !== 'sendet'
                return (
                  <div key={r.id} style={{ ...CARD, marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--tm-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.gast}{r.wohnung ? ` · ${r.wohnung}` : ''}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--tm-muted2)', marginTop: 1 }}>
                          {zeit(r.created_at)} Uhr{r.gast_lang && r.gast_lang !== 'de' ? ` · ${r.gast_lang.toUpperCase()}` : ''}
                        </div>
                      </div>
                      <button onClick={() => { haptic(); window.location.href = '/team?conv=' + r.booking_id }}
                        style={{ border: 'none', background: 'none', color: 'var(--tm-accent-dark)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', padding: '2px 0', flexShrink: 0 }}>
                        Thread ›
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 8px', borderRadius: 999, color: e.fg, background: e.bg }}>{e.label}</span>
                      {r.kategorie && <span style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 8px', borderRadius: 999, color: 'var(--tm-muted)', background: 'var(--tm-surface2)' }}>{KAT[r.kategorie] ?? r.kategorie}</span>}
                      {r.konfidenz !== null && <span style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 8px', borderRadius: 999, color: 'var(--tm-muted)', background: 'var(--tm-surface2)' }}>Konfidenz {r.konfidenz}</span>}
                    </div>

                    {r.gast_text && <Zitat titel="Gast" text={r.gast_text} />}
                    {r.entwurf && <Zitat titel={r.entscheidung === 'gesendet' ? 'KI-Antwort (deutsch)' : 'KI-Entwurf'} text={r.entwurf} farbe="var(--tm-purple)" />}
                    {r.gesendet_text && r.gesendet_text !== r.entwurf && <Zitat titel="So gesendet" text={r.gesendet_text} />}
                    {r.team_antwort && <Zitat titel="Team antwortete" text={r.team_antwort} farbe="var(--tm-green)" />}
                    {r.grund && (
                      <div style={{ fontSize: 12, color: 'var(--tm-muted)', lineHeight: 1.45, marginTop: 8, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                        Grund: {r.grund}
                      </div>
                    )}

                    {fertig && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 11, flexWrap: 'wrap', opacity: fremdesUrteil(r) ? 0.55 : 1 }}>
                        <button onClick={() => void bewerten(r, 'richtig')} aria-pressed={r.bewertung === 'richtig'} style={{
                          flex: '1 1 110px', minWidth: 0, padding: '9px 10px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 700,
                          background: r.bewertung === 'richtig' ? 'var(--tm-green)' : 'var(--tm-green-soft)',
                          color: r.bewertung === 'richtig' ? '#fff' : 'var(--tm-green)',
                        }}>✓ richtig</button>
                        <button onClick={() => void bewerten(r, 'falsch')} aria-pressed={r.bewertung === 'falsch'} style={{
                          flex: '1 1 110px', minWidth: 0, padding: '9px 10px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 700,
                          background: r.bewertung === 'falsch' ? 'var(--tm-red)' : 'var(--tm-red-soft)',
                          color: r.bewertung === 'falsch' ? '#fff' : 'var(--tm-red)',
                        }}>✕ falsch</button>
                      </div>
                    )}
                    {r.bewertung && (
                      <div style={{ fontSize: 11.5, color: 'var(--tm-muted2)', marginTop: 6 }}>
                        Bewertet von {r.bewertet_name ?? 'Team'}{r.bewertet_at ? `, ${zeit(r.bewertet_at)} Uhr` : ''}
                        {!SENDE.includes(r.entscheidung) ? ' · zählt nicht für das Tor' : ''}
                        {fremdesUrteil(r) ? ' · ändern kann nur ein Admin' : ''}
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(body, document.body) : null
}
