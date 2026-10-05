'use client'

import { useCallback, useEffect, useState } from 'react'
import { haptic, tmToast } from '@/components/team/ux'

/**
 * ⭐ Bewertungs-Abruf (§314) — kompakte, einklappbare Karte im Kalender-Reiter unter den Kennzahlen.
 * NUR Admins/Gastgeber: der erste Abruf entscheidet — 403 ⇒ die Karte bleibt komplett aus (gleiches
 * Probe-Muster wie KennzahlenCard). Zeigt je Wohnung × Portal eine Ampel (letzter erfolgreicher Abruf,
 * letzter Versuch + Fehler, neueste Bewertung, Anzahl) und je Wohnung den Knopf „Jetzt abrufen".
 * Daten: GET /api/reviews/status · Abruf: POST /api/reviews/sync { listingId }.
 */

type Ampel = 'gruen' | 'gelb' | 'rot' | 'aus'
type Zelle = {
  portal: string; name: string; konfiguriert: boolean; ampel: Ampel
  status: 'aus' | 'nie' | 'ok' | 'teilweise' | 'error'
  okAm: string | null; versuchAm: string | null
  fehler: string | null; fehlerArt: string | null; fehlerInFolge: number
  abgerufen: number | null; neu: number | null
  anzahl: number; neuesteBewertung: string | null; letzterImport: string | null
  tageSeit: number | null; ueberfaellig: boolean
  // optional: ein offline gespeicherter älterer Stand kennt die Felder noch nicht
  portalAnzahl?: number | null; luecke?: boolean
}
type Zeile = { id: string; title: string; versuchAm: string | null; zellen: Zelle[] }
type Status = {
  zeilen: Zeile[]; konfiguriert: number; aktuell: number; probleme: number
  budget: { usedUsd: number; maxUsd: number; zyklusEnde: string | null } | null
  cronAktivAm: string | null
  letzterLauf: { am: string; wohnungen: number; ausgelassen: number } | null
  nachholOffen: boolean; staleTage: number
}
type SyncResult = { source: string; status?: string; fetched?: number; neu?: number; partial?: boolean; detail?: string; errorKind?: string }

const OPEN_KEY = 'trimosa-rs-open'
const AMPEL_FARBE: Record<Ampel, string> = { gruen: 'var(--tm-green)', gelb: 'var(--tm-yellow)', rot: 'var(--tm-red)', aus: 'var(--tm-muted2)' }
const PORTAL_NAME: Record<string, string> = { airbnb: 'Airbnb', booking: 'Booking', vrbo: 'FeWo-direkt', google: 'Google' }
const FEHLER_LABEL: Record<string, string> = {
  kontingent: 'Apify-Guthaben aufgebraucht',
  eingabe: 'Abruf-Dienst lehnt die Eingabe ab',
  token: 'Zugangsschlüssel fehlt oder ist ungültig',
  actor: 'Abruf-Dienst nicht verfügbar',
  timeout: 'Zeitüberschreitung',
  leer: 'nichts Verwertbares geliefert',
  sonst: 'Fehler',
}

/** 28.9. (mit Jahr, wenn es nicht das laufende ist) — Zeitstempel in Europe/Berlin. */
function datum(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const jahr = d.getFullYear() !== new Date().getFullYear()
  try {
    return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric', ...(jahr ? { year: '2-digit' } : {}), timeZone: 'Europe/Berlin' })
  } catch {
    return iso.slice(0, 10)
  }
}
/** Reines Datum YYYY-MM-DD → 28.9. (ohne Zeitzonen-Verschiebung). */
function tag(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return '—'
  return y === new Date().getFullYear() ? `${d}.${m}.` : `${d}.${m}.${String(y).slice(2)}`
}
function zeitpunkt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  try {
    return d.toLocaleString('de-DE', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
  } catch {
    return iso.slice(0, 16)
  }
}
function vor(iso: string | null): string {
  if (!iso) return '—'
  const tage = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000)
  if (!Number.isFinite(tage)) return '—'
  return tage <= 0 ? 'heute' : tage === 1 ? 'gestern' : `vor ${tage} Tagen`
}
function usd(n: number): string {
  return `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`
}

function hauptText(c: Zelle): string {
  if (c.status === 'ok') return `${vor(c.okAm)} abgerufen · ${c.abgerufen ?? 0} geholt${c.neu != null ? `, ${c.neu} neu` : ''}`
  if (c.status === 'teilweise') return `${vor(c.versuchAm)}: nur Gesamtnote und Kurzfassung, Volltexte nicht abrufbar`
  if (c.status === 'error') return `Versuch am ${datum(c.versuchAm)} gescheitert: ${FEHLER_LABEL[c.fehlerArt ?? 'sonst'] ?? 'Fehler'}`
  return c.letzterImport ? `Noch kein Abruf protokolliert · letzter Import ${datum(c.letzterImport)}` : 'Noch nie abgerufen'
}
function nebenText(c: Zelle): string {
  const teile: string[] = []
  if (c.status === 'error' || c.status === 'teilweise') {
    teile.push(c.okAm ? `letzter Erfolg ${datum(c.okAm)}` : c.letzterImport ? `letzter Import ${datum(c.letzterImport)}` : 'noch kein Erfolg')
    if (c.fehlerInFolge > 1) teile.push(`${c.fehlerInFolge}× in Folge`)
  }
  if (c.neuesteBewertung) teile.push(`neueste Bewertung ${tag(c.neuesteBewertung)}`)
  teile.push(c.portalAnzahl != null ? `Portal nennt ${c.portalAnzahl} · ${c.anzahl} gespeichert` : `${c.anzahl} gespeichert`)
  return teile.join(' · ')
}

export default function ReviewSyncCard() {
  const [ok, setOk] = useState<boolean | null>(null)
  const [data, setData] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<boolean>(() => {
    try { return typeof localStorage !== 'undefined' && localStorage.getItem(OPEN_KEY) === '1' } catch { return false }
  })
  const [busy, setBusy] = useState<string | null>(null)
  const [ergebnis, setErgebnis] = useState<{ id: string; zeilen: SyncResult[]; hinweis: string | null } | null>(null)
  const [mehr, setMehr] = useState<string | null>(null)
  // Offline liefert der Service Worker den zuletzt gespeicherten Stand (Header X-Trimosa-Offline)
  const [offlineStand, setOfflineStand] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/reviews/status', { cache: 'no-store' })
      if (res.status === 403 || res.status === 401) { setOk(false); return }
      // 500 gibt es erst NACH der Rechteprüfung → Karte mit Fehlerhinweis zeigen. Alles andere (z. B. 503
      // offline ohne gespeicherten Stand) sagt nichts über die Berechtigung — Karte bleibt, wie sie ist.
      if (res.status === 500) { setOk(true); setError('Status konnte nicht geladen werden.'); return }
      if (!res.ok) return
      const j = (await res.json()) as Status
      const cachedAt = Number(res.headers.get('X-Trimosa-Cached-At'))
      setOfflineStand(res.headers.get('X-Trimosa-Offline') === '1'
        ? (Number.isFinite(cachedAt) && cachedAt > 0 ? new Date(cachedAt).toISOString() : 'unbekannt')
        : null)
      setOk(true)
      setError(null)
      setData(j)
    } catch {
      /* Netzfehler: letzten Stand stehen lassen */
    }
  }, [])

  useEffect(() => {
    void load()
    const h = () => { void load() }
    window.addEventListener('trimosa-refresh', h)
    return () => window.removeEventListener('trimosa-refresh', h)
  }, [load])

  const toggle = () => {
    haptic()
    setOpen((v) => {
      try { localStorage.setItem(OPEN_KEY, v ? '0' : '1') } catch { /* egal */ }
      return !v
    })
  }

  const abrufen = async (z: Zeile) => {
    if (busy) return
    if (offlineStand) { tmToast('Offline — Abruf erst wieder mit Verbindung möglich.'); return }
    if (!window.confirm(`Bewertungen für „${z.title}“ jetzt abrufen?\n\nKostet ca. 0,25 $ Apify-Guthaben und dauert bis zu 3 Minuten.`)) return
    haptic()
    setBusy(z.id)
    setErgebnis(null)
    try {
      const res = await fetch('/api/reviews/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId: z.id }),
      })
      const j = (await res.json().catch(() => ({}))) as { results?: SyncResult[]; error?: string }
      if (!res.ok) {
        setErgebnis({ id: z.id, zeilen: [], hinweis: j.error ?? `Abruf fehlgeschlagen (HTTP ${res.status}).` })
      } else {
        const zeilen = (j.results ?? []).filter((r) => r.source in PORTAL_NAME && !(r.status === 'skipped' && !r.errorKind))
        setErgebnis({ id: z.id, zeilen, hinweis: zeilen.length ? null : 'Keine Quelle hinterlegt.' })
        tmToast(zeilen.some((r) => r.status === 'error') ? 'Abruf beendet — mit Fehlern' : 'Bewertungen abgerufen')
      }
    } catch {
      setErgebnis({ id: z.id, zeilen: [], hinweis: 'Abruf abgebrochen (Verbindung oder Zeitlimit). Der Stand oben zeigt, was angekommen ist.' })
    } finally {
      setBusy(null)
      void load()
    }
  }

  // Nicht berechtigt (403) → Karte komplett aus; vor der ersten Antwort auch nichts.
  if (ok === false || ok === null) return null

  const probleme = data?.probleme ?? 0
  const zeilen = [...(data?.zeilen ?? [])].sort((a, b) => {
    const ra = a.zellen.some((c) => c.ampel === 'rot') ? 0 : 1
    const rb = b.zellen.some((c) => c.ampel === 'rot') ? 0 : 1
    return ra - rb
  })
  const b = data?.budget ?? null
  const budgetPct = b ? Math.max(0, Math.min(100, (b.usedUsd / b.maxUsd) * 100)) : 0

  return (
    <section className="tm-card tm-enter" style={{ margin: '14px 4px 0', padding: '12px 14px' }}>
      <button type="button" onClick={toggle} aria-expanded={open} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ minWidth: 0, fontSize: 15, fontWeight: 800, color: 'var(--tm-text)' }}>
          <span style={{ display: 'inline-block', width: 14, fontSize: 11, color: 'var(--tm-accent-dark)' }}>{open ? '▾' : '▸'}</span>⭐ Bewertungs-Abruf
        </span>
        {data && (
          <span className="tm-num" style={{
            flexShrink: 0, fontSize: 11.5, fontWeight: 800, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap',
            background: probleme > 0 ? 'var(--tm-red-soft)' : 'var(--tm-green-soft)',
            color: probleme > 0 ? 'var(--tm-red)' : 'var(--tm-green)',
          }}>
            {probleme > 0 ? `${probleme} ${probleme === 1 ? 'Quelle hängt' : 'Quellen hängen'}` : `${data.aktuell} von ${data.konfiguriert} aktuell`}
          </span>
        )}
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          {error && !data ? (
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--tm-red)' }}>{error}</p>
          ) : data ? (
            <>
              <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: 'var(--tm-muted)' }}>
                Automatisch jeden Montag früh: 2 Wohnungen reihum, je Portal die 40 neuesten Bewertungen{data.nachholOffen && probleme > 0 ? ' (beim nächsten Lauf einmalig bis zu 4 zum Nachholen)' : ''}.
                {' '}Letzter automatischer Abruf: {data.letzterLauf
                  ? `${zeitpunkt(data.letzterLauf.am)} (${data.letzterLauf.wohnungen} ${data.letzterLauf.wohnungen === 1 ? 'Wohnung' : 'Wohnungen'}${data.letzterLauf.ausgelassen > 0 ? `, ${data.letzterLauf.ausgelassen} aus Zeitgründen verschoben` : ''})`
                  : 'noch nicht protokolliert'}.
                {' '}Rot = seit über {Math.round(data.staleTage / 7)} Wochen kein erfolgreicher Abruf oder dauerhafter Fehler.
              </p>
              {offlineStand && (
                <p style={{ margin: '6px 0 0', fontSize: 11.5, fontWeight: 700, color: 'var(--tm-yellow)' }}>
                  Offline — gespeicherter Stand{offlineStand !== 'unbekannt' ? ` vom ${zeitpunkt(offlineStand)}` : ''}.
                </p>
              )}
              {b && (
                <div style={{ marginTop: 8 }}>
                  <div className="tm-num" style={{ fontSize: 11.5, color: 'var(--tm-muted)' }}>
                    Apify-Guthaben: {usd(b.usedUsd)} von {usd(b.maxUsd)} verbraucht{b.zyklusEnde ? ` · neu ab ${datum(b.zyklusEnde)}` : ''}
                  </div>
                  <div style={{ marginTop: 4, height: 6, borderRadius: 999, background: 'var(--tm-surface2)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${budgetPct}%`, borderRadius: 999, background: budgetPct >= 80 ? 'var(--tm-red)' : 'var(--tm-accent)' }} />
                  </div>
                </div>
              )}

              <div style={{ marginTop: 10, borderTop: '1px solid var(--tm-line)' }}>
                {zeilen.length === 0 && (
                  <p style={{ margin: 0, padding: '12px 0 2px', fontSize: 12.5, color: 'var(--tm-muted)' }}>Keine aktiven Wohnungen.</p>
                )}
                {zeilen.map((z) => {
                  const aktiv = z.zellen.filter((c) => c.konfiguriert)
                  const laeuft = busy === z.id
                  return (
                    <div key={z.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--tm-line)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 800, color: 'var(--tm-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{z.title}</span>
                        {aktiv.length > 0 && (
                          <button type="button" className="tm-press-btn" disabled={!!busy || !!offlineStand} onClick={() => void abrufen(z)} style={{
                            flexShrink: 0, padding: '6px 11px', borderRadius: 999, border: '1px solid var(--tm-line)', background: 'var(--tm-surface2)',
                            fontSize: 12, fontWeight: 700, color: 'var(--tm-accent-dark)', whiteSpace: 'nowrap',
                            cursor: busy ? (laeuft ? 'wait' : 'default') : 'pointer', opacity: (busy && !laeuft) || offlineStand ? 0.5 : 1,
                          }}>
                            {laeuft ? 'Wird abgerufen …' : 'Jetzt abrufen'}
                          </button>
                        )}
                      </div>
                      {laeuft && (
                        <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--tm-muted)' }}>Die Portale werden abgefragt — das dauert bis zu 3 Minuten. Bitte die Seite offen lassen.</p>
                      )}
                      {aktiv.length === 0 ? (
                        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--tm-muted2)' }}>Kein Portal hinterlegt.</p>
                      ) : aktiv.map((c) => {
                        const key = `${z.id}:${c.portal}`
                        const lang = mehr === key
                        return (
                          <div key={c.portal} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 7 }}>
                            <span aria-hidden style={{ flexShrink: 0, width: 9, height: 9, marginTop: 4, borderRadius: 999, background: AMPEL_FARBE[c.ampel] }} />
                            <span style={{ flexShrink: 0, width: 78, fontSize: 12.5, fontWeight: 700, color: 'var(--tm-text)' }}>{c.name}</span>
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <span className="tm-num" style={{ display: 'block', fontSize: 12.5, lineHeight: 1.35, color: c.ampel === 'rot' ? 'var(--tm-red)' : 'var(--tm-text)', overflowWrap: 'anywhere' }}>
                                {hauptText(c)}{c.ueberfaellig && c.status === 'ok' ? ' · überfällig' : ''}{c.luecke && c.status !== 'error' ? ' · Texte fehlen' : ''}
                              </span>
                              <span className="tm-num" style={{ display: 'block', marginTop: 1, fontSize: 11.5, lineHeight: 1.35, color: 'var(--tm-muted)', overflowWrap: 'anywhere' }}>{nebenText(c)}</span>
                              {c.fehler && (
                                <button type="button" onClick={() => setMehr(lang ? null : key)} title={lang ? 'Einklappen' : 'Ganzen Fehlertext zeigen'} style={{
                                  display: 'block', width: '100%', marginTop: 2, padding: 0, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                                  fontSize: 11, lineHeight: 1.4, color: 'var(--tm-muted2)', overflowWrap: 'anywhere',
                                }}>
                                  {lang || c.fehler.length <= 90 ? c.fehler : `${c.fehler.slice(0, 90)} … mehr`}
                                </button>
                              )}
                            </span>
                          </div>
                        )
                      })}
                      {ergebnis?.id === z.id && (
                        <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 10, background: 'var(--tm-surface2)' }}>
                          <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--tm-text)', marginBottom: 2 }}>Ergebnis des Abrufs</div>
                          {ergebnis.hinweis && <div style={{ fontSize: 12, lineHeight: 1.4, color: 'var(--tm-muted)', overflowWrap: 'anywhere' }}>{ergebnis.hinweis}</div>}
                          {ergebnis.zeilen.map((r) => (
                            <div key={r.source} className="tm-num" style={{ fontSize: 12, lineHeight: 1.45, overflowWrap: 'anywhere', color: r.status === 'ok' ? (r.partial ? 'var(--tm-yellow)' : 'var(--tm-green)') : 'var(--tm-red)' }}>
                              {PORTAL_NAME[r.source]}: {r.status === 'ok'
                                ? `${r.fetched ?? 0} geholt${r.neu != null ? `, ${r.neu} neu` : ''}${r.partial ? ' — nur Kurzfassung, Volltexte nicht abrufbar' : ' ✓'}`
                                : `Fehler — ${FEHLER_LABEL[r.errorKind ?? 'sonst'] ?? 'Fehler'}${r.detail ? `: ${r.detail.slice(0, 160)}` : ''}`}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 11, lineHeight: 1.45, color: 'var(--tm-muted2)' }}>
                „Jetzt abrufen“ kostet ca. 0,25 $ Apify-Guthaben je Wohnung. Nach einem vollständig erfolgreichen Abruf ist die Wohnung 6 Stunden gesperrt.
              </p>
            </>
          ) : null}
        </div>
      )}
    </section>
  )
}
