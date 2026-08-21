'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Kredit, KreditMonat, FIRMEN, fitAnnuitaet, projektionMonate, summenVerlauf,
  fortschreibungBisHeute, parseVerlaufBulk, fmtMonat, indexMonat, monatIndex,
  istAnzahl, eur0, eur2, pct2,
} from '@/lib/schulden-mathe'
import { haptic } from '@/components/team/ux'

/**
 * 🏦 §272 SCHULDENSTAND — Vollbild-Bereich im Mehr-Tab, NUR CHEFS (is_admin;
 * der ⚙️-Eintrag erscheint nur bei probe=200). Kredite je Standort mit
 * Restschuld-Verlauf: Gesamt-Hero + SVG-Charts (ScoreTrends-Muster §171,
 * keine Chart-Library), Annuitäts-Fit (Zins + Rate automatisch erkannt),
 * Tilgungs-Fortschritt, Projektion. Verlauf per Bulk-Paste aus Excel.
 * Portal via createPortal(document.body) — §83; Root trägt team-shell.
 * Team-App-Doktrin §266e: Akzent NAVY, kein Gold.
 */

const NAVY = '#12222E'
const CARD: React.CSSProperties = {
  background: '#fff', borderRadius: 16, boxShadow: '0 0 0 0.5px rgba(60,60,67,0.1)',
}
const BTN: React.CSSProperties = {
  border: 'none', borderRadius: 11, padding: '10px 14px', fontSize: 14,
  fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
}
const INPUT: React.CSSProperties = {
  fontSize: 16, padding: '10px 12px', borderRadius: 11,
  border: '0.5px solid rgba(60,60,67,0.25)', background: '#fff', fontFamily: 'inherit', width: '100%',
}

const fmtMonatLang = (m: string) => {
  const M = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
  return `${M[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`
}

/* ── SVG-Verlaufs-Chart (Apple-like: Fläche + Linie + Endpunkt) ── */

function VerlaufChart({ verlauf, color, height = 220, planAb }: {
  verlauf: KreditMonat[]; color: string; height?: number
  /** Index des ersten PLAN-Monats (Zukunft) — ab dort gestrichelt; undefined = alles Ist */
  planAb?: number
}) {
  // §272c Mobil-Fix: ECHTE Container-Breite messen statt festem 680er-viewBox.
  // Doppelter Gewinn: (a) Safari-Blowout — WebKit nimmt bei <svg viewBox> mit
  // width:100% die viewBox-Breite als min-content-Beitrag im Grid, der Track
  // wuchs auf dem iPhone auf 680px und schob die ganze Karte aus dem Viewport
  // (§84-Klasse; Chromium clampt auf 0, darum im Pane nie sichtbar);
  // (b) Labels bleiben in echter 11px-Größe lesbar statt auf ~6px gestaucht.
  const wrapRef = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(320)
  useEffect(() => {
    const mess = () => {
      const el = wrapRef.current
      if (el && el.clientWidth > 40) setW(el.clientWidth)
    }
    mess()
    window.addEventListener('resize', mess)
    return () => window.removeEventListener('resize', mess)
  }, [])
  const W = w
  const H = height
  const PAD = { l: 48, r: 12, t: 12, b: 22 }
  const chart = useMemo(() => {
    if (verlauf.length < 2) return null
    const vals = verlauf.map((p) => p.restschuld)
    let min = Math.min(...vals)
    let max = Math.max(...vals)
    if (max - min < 1) { min -= 1; max += 1 }
    const span = max - min
    min = Math.max(0, min - span * 0.06)
    max = max + span * 0.06
    const x = (i: number) => PAD.l + (i / (verlauf.length - 1)) * (W - PAD.l - PAD.r)
    const y = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b)
    const seg = (von: number, bis: number) => verlauf.slice(von, bis + 1)
      .map((p, j) => `${j === 0 ? 'M' : 'L'}${x(von + j).toFixed(1)},${y(p.restschuld).toFixed(1)}`).join(' ')
    // §272b: Ist-Segment voll + Fläche, Plan-Segment (Zukunft) gestrichelt
    const split = planAb != null && planAb > 0 && planAb < verlauf.length ? planAb : verlauf.length
    const istEnd = split - 1
    const istLine = seg(0, istEnd)
    const planLine = split < verlauf.length ? seg(istEnd, verlauf.length - 1) : null
    const area = istEnd > 0
      ? `${istLine} L${x(istEnd).toFixed(1)},${H - PAD.b} L${x(0).toFixed(1)},${H - PAD.b} Z`
      : null
    const kEuro = (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)))
    const yTicks = [min, (min + max) / 2, max].map((v) => ({ label: kEuro(v), y: y(v) }))
    const xIdx = verlauf.length > 2 ? [0, Math.floor((verlauf.length - 1) / 2), verlauf.length - 1] : [0, verlauf.length - 1]
    const xLabels = xIdx.map((i) => ({ label: fmtMonat(verlauf[i].monat), x: x(i) }))
    return { istLine, planLine, area, yTicks, xLabels, dotX: x(istEnd), dotY: y(verlauf[istEnd].restschuld) }
  }, [verlauf, H, W, planAb])
  return (
    <div ref={wrapRef} style={{ minWidth: 0, maxWidth: '100%', overflow: 'hidden' }}>
      {!chart ? (
        <p style={{ fontSize: 13, color: '#8A8578', margin: '10px 0' }}>Mindestens 2 Monatswerte für den Verlauf eintragen.</p>
      ) : (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', maxWidth: '100%' }}>
      {chart.yTicks.map((tk, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={tk.y} y2={tk.y} stroke="rgba(60,60,67,0.1)" strokeWidth={1} />
          <text x={PAD.l - 8} y={tk.y + 4} textAnchor="end" fontSize={11} fill="#8A8578">{tk.label}</text>
        </g>
      ))}
      {chart.xLabels.map((xl, i) => (
        <text key={i} x={xl.x} y={H - 6} textAnchor="middle" fontSize={11} fill="#8A8578">{xl.label}</text>
      ))}
      {chart.area && <path d={chart.area} fill={color} opacity={0.08} />}
      <path d={chart.istLine} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {chart.planLine && (
        <path d={chart.planLine} fill="none" stroke={color} strokeWidth={2} strokeDasharray="5 5"
          opacity={0.45} strokeLinejoin="round" strokeLinecap="round" />
      )}
      <circle cx={chart.dotX} cy={chart.dotY} r={4.5} fill={color} stroke="#fff" strokeWidth={2} />
    </svg>
      )}
    </div>
  )
}

/* ── Kennzahl-Kachel ── */

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ ...CARD, padding: '11px 13px', minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: '#8A8578', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color ?? '#1A1814', marginTop: 3, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#8A8578', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function deltaChip(delta: number | null, label: string) {
  if (delta == null) return <span style={{ fontSize: 11.5, color: '#B0AA9C' }}>{label}: —</span>
  // Schulden: SINKEN = gut (grün)
  const down = delta < 0
  const same = Math.round(delta) === 0
  return (
    <span style={{
      fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
      background: same ? '#F2F2F7' : down ? '#DCFCE7' : '#FEE2E2',
      color: same ? '#8A8578' : down ? '#16A34A' : '#DC2626',
    }}>
      {label}: {same ? '±0' : `${down ? '▼ ' : '▲ +'}${eur0(Math.abs(delta))}`}
    </span>
  )
}

/* ── Haupt-Panel ── */

export default function SchuldenPanel({ onClose }: { onClose: () => void }) {
  const [kredite, setKredite] = useState<Kredit[]>([])
  const [loading, setLoading] = useState(true)
  const [fehler, setFehler] = useState('')
  const [openId, setOpenId] = useState('')
  const [showNeu, setShowNeu] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = () => {
    fetch('/api/schulden', { cache: 'no-store' })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) throw new Error(j.error ?? 'Fehler')
        setKredite(j.kredite ?? [])
        setFehler('')
      })
      .catch((e) => setFehler(String(e instanceof Error ? e.message : e)))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  // Review §272: busyRef-Guard — zwei schnelle ✕-Taps feuerten sonst
  // parallele PATCHes (Lost Update: der zweite schrieb den alten Stand zurück)
  const busyRef = useRef(false)
  const patch = async (body: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
    if (busyRef.current) return null
    busyRef.current = true
    setBusy(true); setFehler('')
    try {
      const r = await fetch('/api/schulden', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) {
        // CAS-Konflikt / Stale-Edit → frischen Stand laden, dann Meldung zeigen
        if (r.status === 409 || r.status === 404) load()
        throw new Error(j.error ?? `HTTP ${r.status}`)
      }
      if (Array.isArray(j.kredite)) setKredite(j.kredite)
      return j
    } catch (e) { setFehler(String(e instanceof Error ? e.message : e)); return null } finally { busyRef.current = false; setBusy(false) }
  }

  /* §272c: Kredite, deren Verlauf VOR heute endet (z. B. variabel, Tabelle
     nicht fortgeschrieben), werden für Hero/Gruppen-Summen automatisch bis
     heute hochgerechnet — sonst zählte ein 8 Monate alter Stand als aktuell */
  const krediteEff = useMemo(() => kredite.map((k) => {
    const fs = fortschreibungBisHeute(k)
    return fs ? { ...k, verlauf: [...k.verlauf, ...fs.zeilen] } : k
  }), [kredite])
  const fsAnzahl = useMemo(
    () => krediteEff.filter((k, i) => k !== kredite[i]).length,
    [krediteEff, kredite],
  )

  /* Gesamt-Kennzahlen — §272b: „aktuell" = letzter IST-Monat (≤ heute),
     Tilgungsplan-Zukunftszeilen zählen nicht als Stand */
  const gesamt = useMemo(() => summenVerlauf(krediteEff), [krediteEff])
  const gesamtIstN = useMemo(() => istAnzahl(gesamt), [gesamt])
  const istEnde = gesamtIstN > 0 ? gesamt[gesamtIstN - 1] : (gesamt[0] ?? null)
  const aktuell = istEnde?.restschuld ?? 0
  const wertVor = (monate: number): number | null => {
    if (!istEnde) return null
    const ziel = monatIndex(istEnde.monat) - monate
    const p = gesamt.filter((z) => monatIndex(z.monat) <= ziel)
    return p.length ? p[p.length - 1].restschuld : null
  }
  const vorMonat = wertVor(1)
  const vorJahr = wertVor(12)

  /* Standort-Gruppen (Karten bekommen die ECHTEN Kredite — die Summenzeile
     nutzt den effektiven, ggf. fortgeschriebenen Stand aus effStand) */
  const gruppen = useMemo(() => {
    const map = new Map<string, Kredit[]>()
    for (const k of kredite) {
      const g = map.get(k.standort) ?? []
      g.push(k)
      map.set(k.standort, g)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [kredite])
  const effStand = useMemo(() => {
    const m = new Map<string, number>()
    for (const k of krediteEff) {
      const n = istAnzahl(k.verlauf)
      const z = n > 0 ? k.verlauf[n - 1] : k.verlauf[0]
      m.set(k.id, z ? z.restschuld : 0)
    }
    return m
  }, [krediteEff])
  const standorte = useMemo(() => {
    const s = new Set<string>(['Minden', 'Sirzenich', 'Bitburg', 'Edingen', 'Kanzem'])
    for (const k of kredite) s.add(k.standort)
    return [...s].sort()
  }, [kredite])

  const body = (
    <div className="team-shell" style={{
      position: 'fixed', inset: 0, zIndex: 80, background: '#F2F2F7',
      display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
        background: 'rgba(249,249,249,0.94)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.15)', flexShrink: 0,
      }}>
        <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 22, color: NAVY, cursor: 'pointer', padding: '0 4px' }}>‹</button>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: '#1A1814', margin: 0, flex: 1 }}>🏦 Schuldenstand</h2>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#8A8578', background: 'rgba(120,120,128,0.12)', borderRadius: 999, padding: '4px 10px' }}>nur Chefs</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch', padding: '14px 14px 48px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14 }}>
          {fehler && (
            <div style={{ fontSize: 13.5, color: '#B42318', background: '#FEE2E2', borderRadius: 12, padding: '10px 13px' }}>
              {fehler} <button onClick={load} style={{ ...BTN, padding: '4px 10px', fontSize: 12.5, marginLeft: 6, background: '#fff', color: '#B42318' }}>Erneut laden</button>
            </div>
          )}
          {loading && <div style={{ fontSize: 14, color: '#8A8578', padding: 18 }}>Lädt…</div>}

          {/* ── Gesamt-Hero ── */}
          {!loading && (
            <div style={{ background: NAVY, borderRadius: 20, padding: '20px 20px 14px', color: '#fff' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', opacity: 0.65, textTransform: 'uppercase' }}>Gesamt-Restschuld</div>
              <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-0.8px', fontVariantNumeric: 'tabular-nums', margin: '4px 0 2px' }}>
                {fsAnzahl > 0 ? '~ ' : ''}{eur0(aktuell)}
              </div>
              <div style={{ fontSize: 12.5, opacity: 0.65 }}>
                {kredite.length ? `${kredite.length} Kredit${kredite.length === 1 ? '' : 'e'} · Stand ${istEnde ? fmtMonatLang(istEnde.monat) : '—'}` : 'Noch keine Kredite angelegt'}
              </div>
              <div style={{ display: 'flex', gap: 8, margin: '10px 0 6px', flexWrap: 'wrap' }}>
                {deltaChip(vorMonat != null ? aktuell - vorMonat : null, 'Vormonat')}
                {deltaChip(vorJahr != null ? aktuell - vorJahr : null, '12 Monate')}
                {gesamtIstN < gesamt.length && (
                  <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.75)' }}>
                    Plan bis {fmtMonat(gesamt[gesamt.length - 1].monat)} ┄
                  </span>
                )}
                {fsAnzahl > 0 && (
                  <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: 'rgba(255,184,0,0.18)', color: '#FFD68A' }}>
                    ↻ {fsAnzahl} Kredit{fsAnzahl === 1 ? '' : 'e'} fortgeschrieben ~
                  </span>
                )}
              </div>
              {gesamt.length >= 2 && (
                <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 14, padding: '8px 6px 2px', marginTop: 8 }}>
                  <VerlaufChart verlauf={gesamt} color="#7FA8C9" height={170} planAb={gesamtIstN} />
                </div>
              )}
            </div>
          )}

          {/* ── Standort-Gruppen ── */}
          {gruppen.map(([standort, liste]) => (
            <div key={standort}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#8A8578', letterSpacing: '0.05em', margin: '2px 4px 7px', textTransform: 'uppercase' }}>
                📍 {standort} · {eur0(liste.reduce((a, k) => a + (effStand.get(k.id) ?? 0), 0))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
                {liste.map((k) => (
                  <KreditKarte key={k.id} k={k} open={openId === k.id}
                    onToggle={() => { haptic(); setOpenId(openId === k.id ? '' : k.id) }}
                    patch={patch} busy={busy} />
                ))}
              </div>
            </div>
          ))}

          {/* ── Neu anlegen ── */}
          {!loading && (showNeu
            ? <KreditForm standorte={standorte} busy={busy}
                onSave={async (kr) => { if (await patch({ action: 'save-kredit', kredit: kr })) setShowNeu(false) }}
                onCancel={() => setShowNeu(false)} />
            : <button onClick={() => { haptic(); setShowNeu(true) }} style={{
                ...BTN, background: NAVY, color: '#fff', padding: '13px 16px', fontSize: 15,
              }}>＋ Kredit anlegen</button>
          )}

          <p style={{ fontSize: 11.5, color: '#8A8578', lineHeight: 1.55, margin: '4px 4px 0' }}>
            Zins &amp; Monatsrate werden automatisch aus dem Restschuld-Verlauf erkannt
            (Annuitäts-Fit über die letzten 18 Monate). ✓ = mathematisch exakt,
            ~ = Schätzung. Endet ein Verlauf in der Vergangenheit, schreibt die App
            ihn mit den erkannten Konditionen automatisch bis heute fort (↻ — im
            Kredit-Chart gestrichelt, in der Gesamt-Grafik steckt der Schätzanteil
            in der Summenlinie, erkennbar am ~ vor der Zahl und dem ↻-Chip) —
            echte nachgepflegte Werte ersetzen die Schätzung.
            Verlauf einfach aus Excel kopieren und einfügen —
            Format „07.2024 440.000,00" je Zeile.
          </p>
        </div>
      </div>
    </div>
  )

  return createPortal(body, document.body)
}

/* ── Kredit-Karte (zu/auf) ── */

function KreditKarte({ k, open, onToggle, patch, busy }: {
  k: Kredit; open: boolean; onToggle: () => void
  patch: (b: Record<string, unknown>) => Promise<Record<string, unknown> | null>; busy: boolean
}) {
  const [bulk, setBulk] = useState('')
  const [bulkInfo, setBulkInfo] = useState('')
  const [edit, setEdit] = useState(false)

  // §272b: „aktuell" = letzter IST-Monat; Zukunftszeilen (Tilgungsplan) nur
  // fürs gestrichelte Chart-Segment. Fit bevorzugt Ist-Monate (echte
  // Zahlungen), fällt bei zu wenigen auf den Gesamtverlauf zurück (frischer
  // Kredit mit reinem Plan trägt dieselben Konditionen).
  const istNEcht = useMemo(() => istAnzahl(k.verlauf), [k.verlauf])
  const fit = useMemo(
    () => fitAnnuitaet(k.verlauf.slice(0, istNEcht)) ?? fitAnnuitaet(k.verlauf),
    [k.verlauf, istNEcht],
  )
  // §272c: endet der gepflegte Verlauf VOR heute, wird bis heute
  // fortgeschrieben (fs greift nur ohne Plan-Zeilen — dann sind alle Zeilen
  // Ist und der interne Fit von fortschreibungBisHeute ist identisch mit
  // `fit`; Hero/Gruppen rechnen im Haupt-Panel dieselbe Funktion)
  const fs = useMemo(() => fortschreibungBisHeute(k), [k])
  const verlaufEff = useMemo(() => (fs ? [...k.verlauf, ...fs.zeilen] : k.verlauf), [k.verlauf, fs])
  const istN = fs ? verlaufEff.length : istNEcht
  const aktuell = istN > 0 ? verlaufEff[istN - 1] : (verlaufEff[0] ?? null)
  const erster = verlaufEff.length ? verlaufEff[0] : null
  const getilgt = erster && aktuell ? erster.restschuld - aktuell.restschuld : 0
  const getilgtPct = erster && erster.restschuld > 0 ? (getilgt / erster.restschuld) * 100 : 0
  // Review §272c: einheitliche Konditions-Quelle — Fit, sonst (im
  // Vertrags-Fallback der Fortschreibung) die Vertragsfelder; damit zeigen
  // KPI-Block und Projektion dieselben Werte, mit denen das Chart rechnet
  const kond = fit
    ? { zinsPa: fit.zinsPa, rate: fit.rate, vertrag: false }
    : fs && fs.basis === 'vertrag'
      ? { zinsPa: fs.zinsPa, rate: fs.rate, vertrag: true }
      : null
  const zeigZins = kond != null && (!kond.vertrag || k.zinssatz != null)
  const proj = aktuell && kond && kond.rate > 0 ? projektionMonate(aktuell.restschuld, kond.zinsPa, kond.rate) : null
  const projMonat = proj != null && aktuell ? indexMonat(monatIndex(aktuell.monat) + proj) : null
  const tilgung12 = useMemo(() => {
    if (!aktuell || istN < 2) return null
    const zielIdx = monatIndex(aktuell.monat) - 12
    const alt = verlaufEff.filter((z) => monatIndex(z.monat) <= zielIdx)
    if (!alt.length) return null
    const ref = alt[alt.length - 1]
    const monate = monatIndex(aktuell.monat) - monatIndex(ref.monat)
    return monate > 0 ? (ref.restschuld - aktuell.restschuld) / monate : null
  }, [verlaufEff, istN, aktuell])

  const uebernehmen = async () => {
    const parsed = parseVerlaufBulk(bulk)
    if (!parsed.zeilen.length) { setBulkInfo('Keine gültigen Zeilen erkannt — Format „07.2024 440.000,00".'); return }
    const j = await patch({ action: 'set-verlauf', id: k.id, zeilen: parsed.zeilen })
    if (j) {
      setBulk('')
      // Review §272: Zahl aus der SERVER-Antwort (was wirklich übernommen
      // wurde), nicht aus dem Client-Parse
      const n = Number(j.uebernommen ?? parsed.zeilen.length)
      setBulkInfo(`✓ ${n} Monat${n === 1 ? '' : 'e'} übernommen${parsed.fehler.length ? ` · ${parsed.fehler.length} Zeile(n) übersprungen` : ''}`)
    }
  }

  return (
    <div style={{ ...CARD, overflow: 'hidden' }}>
      {/* Kopfzeile */}
      <button onClick={onToggle} style={{
        width: '100%', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left',
        padding: '14px 16px', fontFamily: 'inherit',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15.5, fontWeight: 700, color: '#1A1814', flex: 1, minWidth: 140 }}>{k.name}</span>
          <span style={{ fontSize: 19, fontWeight: 800, color: NAVY, fontVariantNumeric: 'tabular-nums' }}>
            {aktuell ? `${fs ? '~ ' : ''}${eur0(aktuell.restschuld)}` : '—'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 5, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#5A6B7A', background: 'rgba(120,120,128,0.1)', borderRadius: 999, padding: '2px 9px' }}>{FIRMEN[k.firma] ?? k.firma}</span>
          {k.bank && <span style={{ fontSize: 11.5, color: '#8A8578' }}>{k.bank}</span>}
          {fit && (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#0A84FF', background: 'rgba(10,132,255,0.1)', borderRadius: 999, padding: '2px 9px' }}>
              {fit.exakt ? '✓' : '~'} {pct2(fit.zinsPa)} p.a.
            </span>
          )}
          {fs && (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#B45309', background: '#FEF3C7', borderRadius: 999, padding: '2px 9px' }}>
              ↻ ab {fmtMonat(fs.abMonat)} geschätzt
            </span>
          )}
          <span style={{ marginLeft: 'auto', color: '#C7C7CC', fontSize: 13 }}>{open ? '▴' : '▾'}</span>
        </div>
        {/* Tilgungs-Fortschritt */}
        {erster && aktuell && getilgt > 0 && (
          <div style={{ marginTop: 9 }}>
            <div style={{ height: 5, borderRadius: 3, background: 'rgba(120,120,128,0.14)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(100, getilgtPct)}%`, background: '#16A34A', borderRadius: 3 }} />
            </div>
            <div style={{ fontSize: 11, color: '#8A8578', marginTop: 4 }}>
              getilgt seit {fmtMonatLang(erster.monat)}: <b style={{ color: '#16A34A' }}>{eur0(getilgt)}</b> ({getilgtPct.toFixed(1).replace('.', ',')} %)
            </div>
          </div>
        )}
      </button>

      {open && (
        <div style={{ padding: '0 16px 16px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
          <VerlaufChart verlauf={verlaufEff} color={NAVY} planAb={fs ? k.verlauf.length : istN} />
          {fs ? (
            <div style={{ fontSize: 11.5, color: '#8A8578', marginTop: -6 }}>
              ┄ gestrichelt = automatisch fortgeschrieben ab {fmtMonat(fs.abMonat)}
              {' '}({pct2(fs.zinsPa)} · {eur2(fs.rate)}/M{fs.basis === 'vertrag' ? ', Vertragsdaten' : ''})
            </div>
          ) : istN < verlaufEff.length && (
            <div style={{ fontSize: 11.5, color: '#8A8578', marginTop: -6 }}>
              ┄ gestrichelt = hinterlegter Tilgungsplan bis {fmtMonat(verlaufEff[verlaufEff.length - 1].monat)}
            </div>
          )}
          {fs && (
            <div style={{ fontSize: 12, color: '#B45309', background: '#FEF3C7', borderRadius: 10, padding: '8px 11px', lineHeight: 1.5 }}>
              Der gepflegte Verlauf endet {fmtMonatLang(fs.letzterEchter.monat)} ({eur0(fs.letzterEchter.restschuld)}) —
              seither rechnet die App mit {pct2(fs.zinsPa)} p.a. · {eur2(fs.rate)}/M automatisch weiter.
              Echte Kontostände unten einfügen ersetzt die Schätzung.
            </div>
          )}

          {/* Kennzahlen */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
            {zeigZins && kond && (
              <Kpi label={kond.vertrag ? 'Zins (Vertrag)' : fit?.exakt ? 'Zins (erkannt ✓)' : 'Zins (geschätzt ~)'}
                value={pct2(kond.zinsPa) + ' p.a.'}
                sub={kond.vertrag ? 'aus Vertragsdaten' : `aus ${fit?.monate ?? 0} Monaten`}
                color={kond.vertrag ? '#B45309' : '#0A84FF'} />
            )}
            {kond && (
              <Kpi label="Monatsrate" value={eur2(kond.rate)}
                sub={kond.vertrag ? 'aus Vertragsdaten' : fit?.exakt ? 'exakt erkannt' : 'geschätzt'} />
            )}
            {zeigZins && kond && aktuell && <Kpi label="Zinskosten p.a." value={'≈ ' + eur0(aktuell.restschuld * kond.zinsPa / 100)} sub="beim aktuellen Stand" />}
            {tilgung12 != null && <Kpi label="Ø Tilgung / Monat" value={(fs ? '~ ' : '') + eur0(tilgung12)} sub={fs ? 'letzte 12 M. · teils fortgeschrieben' : 'letzte 12 Monate'} color="#16A34A" />}
            {projMonat && <Kpi label="Schuldenfrei ca." value={fmtMonatLang(projMonat)} sub={`bei gleichen Konditionen (~${Math.round((proj ?? 0) / 12)} J.)`} />}
            {k.zinsbindungBis && <Kpi label="Zinsbindung bis" value={fmtMonatLang(k.zinsbindungBis)} color="#B45309" />}
          </div>
          {k.zinssatz != null && fit && Math.abs(k.zinssatz - fit.zinsPa) > 0.15 && (
            <div style={{ fontSize: 12, color: '#B45309', background: '#FEF3C7', borderRadius: 10, padding: '8px 11px' }}>
              Hinterlegter Vertragszins {pct2(k.zinssatz)} weicht vom erkannten Zins {pct2(fit.zinsPa)} ab — Verlauf oder Vertragsdaten prüfen.
            </div>
          )}
          {k.notiz && <div style={{ fontSize: 12.5, color: '#5A6B7A', lineHeight: 1.5 }}>{k.notiz}</div>}

          {/* Verlauf einpflegen */}
          <div style={{ background: '#F7F7F9', borderRadius: 13, padding: '11px 13px' }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: '#5A6B7A', letterSpacing: '0.04em', marginBottom: 7 }}>VERLAUF EINFÜGEN (aus Excel kopieren)</div>
            <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={3}
              placeholder={'07.2024\t440.000,00 €\n08.2024\t439.400,00 €\n…'}
              style={{ ...INPUT, resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: 16 }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => void uebernehmen()} disabled={busy || !bulk.trim()}
                style={{ ...BTN, background: NAVY, color: '#fff', opacity: busy || !bulk.trim() ? 0.5 : 1 }}>
                {busy ? '⏳…' : 'Übernehmen'}
              </button>
              {bulkInfo && <span style={{ fontSize: 12.5, color: bulkInfo.startsWith('✓') ? '#16A34A' : '#B42318' }}>{bulkInfo}</span>}
            </div>
            {k.verlauf.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 12.5, color: '#5A6B7A' }}>
                {k.verlauf.length} Monate erfasst ({fmtMonat(k.verlauf[0].monat)} – {fmtMonat(k.verlauf[k.verlauf.length - 1].monat)})
                {' · letzte: '}
                {k.verlauf.slice(-3).map((z) => (
                  <span key={z.monat} style={{ whiteSpace: 'nowrap', marginRight: 8 }}>
                    {fmtMonat(z.monat)} {eur2(z.restschuld)}
                    <button disabled={busy} onClick={() => { if (confirm(`${fmtMonat(z.monat)} löschen?`)) void patch({ action: 'delete-monat', id: k.id, monat: z.monat }) }}
                      style={{ border: 'none', background: 'none', color: '#B42318', cursor: 'pointer', fontSize: 12, padding: '0 2px', opacity: busy ? 0.4 : 1 }}>✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Stammdaten bearbeiten / löschen */}
          {edit ? (
            <KreditForm standorte={[k.standort]} vorlage={k} busy={busy}
              onSave={async (kr) => { if (await patch({ action: 'save-kredit', id: k.id, kredit: kr })) setEdit(false) }}
              onCancel={() => setEdit(false)} />
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setEdit(true)} style={{ ...BTN, background: 'rgba(120,120,128,0.1)', color: '#1A1814' }}>✏️ Bearbeiten</button>
              <button disabled={busy} onClick={() => {
                if (confirm(`Kredit „${k.name}" mit ${k.verlauf.length} Monatswerten wirklich löschen?`)) void patch({ action: 'delete-kredit', id: k.id })
              }} style={{ ...BTN, background: 'rgba(255,59,48,0.08)', color: '#D70015', opacity: busy ? 0.5 : 1 }}>🗑 Löschen</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Kredit-Formular (neu + bearbeiten) ── */

function KreditForm({ standorte, vorlage, busy, onSave, onCancel }: {
  standorte: string[]; vorlage?: Kredit; busy: boolean
  onSave: (k: Record<string, unknown>) => void; onCancel: () => void
}) {
  const [name, setName] = useState(vorlage?.name ?? '')
  const [standort, setStandort] = useState(vorlage?.standort ?? standorte[0] ?? 'Minden')
  const [standortNeu, setStandortNeu] = useState('')
  const [firma, setFirma] = useState<string>(vorlage?.firma ?? 'gbr')
  const [bank, setBank] = useState(vorlage?.bank ?? '')
  const [zinsbindung, setZinsbindung] = useState(vorlage?.zinsbindungBis ? fmtMonat(vorlage.zinsbindungBis) : '')
  const [zins, setZins] = useState(vorlage?.zinssatz != null ? String(vorlage.zinssatz).replace('.', ',') : '')
  const [rate, setRate] = useState(vorlage?.rate != null ? String(vorlage.rate).replace('.', ',') : '')
  const [notiz, setNotiz] = useState(vorlage?.notiz ?? '')
  const [formFehler, setFormFehler] = useState('')

  const submit = () => {
    const st = standortNeu.trim() || standort
    if (!name.trim() || !st) return
    // Zinsbindung: MM.JJJJ (wie überall in der App) ODER JJJJ-MM — Müll
    // blockiert den Submit statt still zu löschen (Review §272)
    let zb: string | null = null
    const zbT = zinsbindung.trim()
    if (zbT) {
      const a = zbT.match(/^(0[1-9]|1[0-2])\.(20\d{2})$/)
      const b = zbT.match(/^(20\d{2})-(0[1-9]|1[0-2])$/)
      if (a) zb = `${a[2]}-${a[1]}`
      else if (b) zb = zbT
      else { setFormFehler('Zinsbindung bitte als MM.JJJJ angeben (z. B. 06.2030).'); return }
    }
    const numOderNull = (s: string): number | null | undefined => {
      const t = s.trim()
      if (!t) return null
      const n = Number(t.replace(/\./g, '').replace(',', '.'))
      return Number.isFinite(n) && n >= 0 ? n : undefined
    }
    const z = numOderNull(zins)
    const r = numOderNull(rate)
    if (z === undefined) { setFormFehler('Vertragszins bitte als Zahl angeben (z. B. 4,2).'); return }
    if (r === undefined) { setFormFehler('Rate bitte als Zahl angeben (z. B. 2328,17).'); return }
    setFormFehler('')
    onSave({
      name: name.trim(), standort: st, firma, bank: bank || null,
      zinsbindungBis: zb, zinssatz: z, rate: r,
      notiz: notiz || null,
    })
  }

  return (
    <div style={{ ...CARD, padding: 16, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: '#1A1814' }}>{vorlage ? 'Kredit bearbeiten' : 'Neuer Kredit'}</div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name — z. B. Volksbank MFH Minden" style={INPUT} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select value={standort} onChange={(e) => setStandort(e.target.value)} style={{ ...INPUT, width: 'auto', flex: '1 1 150px' }}>
          {standorte.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input value={standortNeu} onChange={(e) => setStandortNeu(e.target.value)} placeholder="…oder neuer Standort" style={{ ...INPUT, width: 'auto', flex: '1 1 150px' }} />
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {Object.entries(FIRMEN).map(([id, label]) => (
          <button key={id} onClick={() => setFirma(id)} style={{
            ...BTN, padding: '8px 12px', fontSize: 12.5, flex: 1,
            background: firma === id ? NAVY : 'rgba(120,120,128,0.1)',
            color: firma === id ? '#fff' : '#3C3C43',
          }}>{label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input value={bank ?? ''} onChange={(e) => setBank(e.target.value)} placeholder="Bank (optional)" style={{ ...INPUT, width: 'auto', flex: '1 1 150px' }} />
        <input value={zinsbindung ?? ''} onChange={(e) => setZinsbindung(e.target.value)} placeholder="Zinsbindung bis (MM.JJJJ)" style={{ ...INPUT, width: 'auto', flex: '1 1 150px' }} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input value={zins} onChange={(e) => setZins(e.target.value)} inputMode="decimal" placeholder="Vertragszins % p.a. (optional)" style={{ ...INPUT, width: 'auto', flex: '1 1 150px' }} />
        <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="Rate €/Monat (optional)" style={{ ...INPUT, width: 'auto', flex: '1 1 150px' }} />
      </div>
      <input value={notiz ?? ''} onChange={(e) => setNotiz(e.target.value)} placeholder="Notiz (optional)" style={INPUT} />
      {formFehler && <div style={{ fontSize: 12.5, color: '#B42318', background: '#FEE2E2', borderRadius: 10, padding: '8px 11px' }}>{formFehler}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={submit} disabled={busy || !name.trim()} style={{ ...BTN, background: NAVY, color: '#fff', opacity: busy || !name.trim() ? 0.5 : 1 }}>
          {busy ? '⏳…' : '💾 Speichern'}
        </button>
        <button onClick={onCancel} style={{ ...BTN, background: 'rgba(120,120,128,0.1)', color: '#3C3C43' }}>Abbrechen</button>
      </div>
    </div>
  )
}
