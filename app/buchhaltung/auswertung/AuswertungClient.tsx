'use client'

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { haptic, SkeletonRows } from '@/components/team/ux'
import { gruppeFuerKonto, neutralFuerKonto, KANAL_META } from '@/lib/auswertung-gruppen'

/**
 * 📊 AUSWERTUNG (§243ae) — Statistik-Bereich der Buchhaltung im iOS-Look:
 * KPI-Kacheln (Einnahmen/Ausgaben/Überschuss/Auslastung mit Delta zur
 * Vorperiode), klickbares Monats-Chart (eigenes SVG, keine Chart-Library),
 * Einnahmen nach Kanal, Ausgaben nach Konten-GRUPPEN (aufklappbar bis auf
 * Konto + Lieferant), Wohnungs-Tabelle. Alles CLIENT-seitig aus EINEM
 * gecachten Datensatz — Filter reagieren instant.
 * Doktrin §243o: „Allgemein" existiert hier nicht — Allgemeinkosten sind
 * gleichmäßig auf alle Wohnungen verteilt; Kanzem = eigene Aufbau-Einheit.
 */

interface Daten {
  stand: string
  einheiten: { id: string; titel: string; gruppe: string | null }[]
  ausgaben: { m: string; nr: string; name: string; g: number; e: Record<string, number>; lief: string }[]
  buchungen: { l: number; ci: string; co: string; p: number; k: string }[]
}

const NAVY = '#12222E'
const GOLD = '#B0912B'
const GOLDL = '#E3C878'
const INK = '#1A1814'
const SUB = '#8A8578'
const GREEN = '#248A3D'
const RED = '#D70015'
const GROUP_BG = '#F2F2F7'
const HAIRLINE = 'rgba(60,60,67,0.12)'
const CARD: CSSProperties = { background: '#fff', borderRadius: 14, boxShadow: '0 0 0 0.5px rgba(60,60,67,0.1)', overflow: 'hidden' }

const eur = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const eur0 = (n: number) => Math.round(n).toLocaleString('de-DE') + ' €'
const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const JAHR = '2026'

/** Nächte einer Buchung innerhalb eines Monats (UTC-Parse — §74). */
function naechteImMonat(ci: string, co: string, m: string): number {
  const start = Date.parse(m + '-01T00:00:00Z')
  const d = new Date(start)
  d.setUTCMonth(d.getUTCMonth() + 1)
  const a = Math.max(Date.parse(ci + 'T00:00:00Z'), start)
  const b = Math.min(Date.parse(co + 'T00:00:00Z'), d.getTime())
  return Math.max(0, Math.round((b - a) / 86400000))
}
function tageImMonat(m: string): number {
  const [y, mo] = m.split('-').map(Number)
  return new Date(Date.UTC(y, mo, 0)).getUTCDate()
}

const Chip = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) => (
  <button onClick={() => { haptic(); onClick() }} style={{
    fontSize: 13.5, fontWeight: 600, padding: '7px 13px', borderRadius: 999, border: 'none',
    cursor: 'pointer', whiteSpace: 'nowrap', WebkitTapHighlightColor: 'transparent',
    background: active ? INK : '#fff', color: active ? '#fff' : INK,
    boxShadow: active ? 'none' : `0 0 0 0.5px ${HAIRLINE}`,
  }}>{children}</button>
)

export default function AuswertungClient() {
  const [daten, setDaten] = useState<Daten | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const heuteM = new Date().toISOString().slice(0, 7)

  // Filter
  const [zeitraum, setZeitraum] = useState<string>('ytd') // ytd | jahr | q1..q4 | 'JJJJ-MM'
  const [einheit, setEinheit] = useState<number | 'alle'>('alle')
  const [offeneGruppe, setOffeneGruppe] = useState<string | null>(null)

  const load = async (refresh = false) => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/buchhaltung/auswertung' + (refresh ? '?refresh=1' : ''), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      setDaten(j)
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)) } finally { setBusy(false) }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Zeitraum → Monatsliste
  const alleMonate = useMemo(() => Array.from({ length: 12 }, (_, i) => `${JAHR}-${String(i + 1).padStart(2, '0')}`), [])
  const zeitraumMonate = useMemo(() => {
    if (zeitraum === 'jahr') return alleMonate
    if (zeitraum === 'ytd') return alleMonate.filter((m) => m <= heuteM)
    const q = { q1: [0, 2], q2: [3, 5], q3: [6, 8], q4: [9, 11] }[zeitraum as 'q1']
    if (q) return alleMonate.slice(q[0], q[1] + 1)
    return [zeitraum]
  }, [zeitraum, alleMonate, heuteM])
  // Vorperiode (für Deltas): Monat → Vormonat, Quartal → Vorquartal
  const vorMonate = useMemo(() => {
    if (/^q[2-4]$/.test(zeitraum)) {
      const i = Number(zeitraum[1]) - 2
      return alleMonate.slice(i * 3, i * 3 + 3)
    }
    if (/^\d{4}-\d{2}$/.test(zeitraum)) {
      const i = alleMonate.indexOf(zeitraum)
      return i > 0 ? [alleMonate[i - 1]] : null
    }
    return null
  }, [zeitraum, alleMonate])

  // Anteil einer Ausgaben-Zeile an der gewählten Einheit
  const anteil = (e: Record<string, number>): number =>
    einheit === 'alle' ? 1 : (e[String(einheit)] ?? 0)

  interface Summen {
    einnahmen: number; ausgaben: number; naechte: number; verfuegbar: number
    kanaele: Map<string, number>
    gruppen: Map<string, { label: string; emoji: string; sum: number; konten: Map<string, { name: string; sum: number }>; liefs: Map<string, number> }>
    neutral: Map<string, { label: string; sum: number }>
  }
  const rechne = (monate: string[]): Summen => {
    const s: Summen = { einnahmen: 0, ausgaben: 0, naechte: 0, verfuegbar: 0, kanaele: new Map(), gruppen: new Map(), neutral: new Map() }
    if (!daten) return s
    const mSet = new Set(monate)
    for (const a of daten.ausgaben) {
      if (!mSet.has(a.m)) continue
      const ant = anteil(a.e)
      if (!ant) continue
      const betrag = a.g * ant
      const neutral = neutralFuerKonto(a.nr)
      if (neutral) {
        const n = s.neutral.get(neutral.id) ?? { label: neutral.label, sum: 0 }
        n.sum += betrag
        s.neutral.set(neutral.id, n)
        continue
      }
      s.ausgaben += betrag
      const gr = gruppeFuerKonto(a.nr)
      const g = s.gruppen.get(gr.id) ?? { label: gr.label, emoji: gr.emoji, sum: 0, konten: new Map(), liefs: new Map() }
      g.sum += betrag
      const k = g.konten.get(a.nr) ?? { name: a.name, sum: 0 }
      k.sum += betrag
      g.konten.set(a.nr, k)
      g.liefs.set(a.lief, (g.liefs.get(a.lief) ?? 0) + betrag)
      s.gruppen.set(gr.id, g)
    }
    // Einnahmen: Buchung zählt im Anreise-Monat (wie die Rechnungen);
    // Auslastung: Nächte-Überlappung je Monat (auch künftige = Buchungsstand)
    const wohnAnzahl = einheit === 'alle'
      ? daten.einheiten.filter((e) => e.id !== 'kanzem').length
      : (daten.einheiten[einheit]?.id === 'kanzem' ? 0 : 1)
    for (const m of monate) s.verfuegbar += tageImMonat(m) * wohnAnzahl
    for (const b of daten.buchungen) {
      const passtEinheit = einheit === 'alle' || b.l === einheit
      if (!passtEinheit) continue
      if (mSet.has(b.ci.slice(0, 7))) {
        s.einnahmen += b.p
        s.kanaele.set(b.k, (s.kanaele.get(b.k) ?? 0) + b.p)
      }
      for (const m of monate) s.naechte += naechteImMonat(b.ci, b.co, m)
    }
    return s
  }

  const S = useMemo(() => rechne(zeitraumMonate), [daten, zeitraumMonate, einheit]) // eslint-disable-line react-hooks/exhaustive-deps
  const V = useMemo(() => (vorMonate ? rechne(vorMonate) : null), [daten, vorMonate, einheit]) // eslint-disable-line react-hooks/exhaustive-deps

  // Monats-Chart-Daten (immer ganzes Jahr, gefiltert nach Einheit)
  const chart = useMemo(() => alleMonate.map((m) => {
    let einn = 0, ausg = 0
    if (daten) {
      for (const b of daten.buchungen) {
        if (b.ci.slice(0, 7) === m && (einheit === 'alle' || b.l === einheit)) einn += b.p
      }
      for (const a of daten.ausgaben) {
        if (a.m !== m || neutralFuerKonto(a.nr)) continue
        ausg += a.g * anteil(a.e)
      }
    }
    return { m, einn, ausg }
  }), [daten, einheit]) // eslint-disable-line react-hooks/exhaustive-deps

  // Wohnungs-Tabelle (nur bei „Alle")
  const tabelle = useMemo(() => {
    if (!daten || einheit !== 'alle') return []
    const mSet = new Set(zeitraumMonate)
    return daten.einheiten.map((e, idx) => {
      let einn = 0, naechte = 0, ausg = 0
      for (const b of daten.buchungen) {
        if (b.l !== idx) continue
        if (mSet.has(b.ci.slice(0, 7))) einn += b.p
        for (const m of zeitraumMonate) naechte += naechteImMonat(b.ci, b.co, m)
      }
      for (const a of daten.ausgaben) {
        if (!mSet.has(a.m) || neutralFuerKonto(a.nr)) continue
        ausg += a.g * (a.e[String(idx)] ?? 0)
      }
      const verf = e.id === 'kanzem' ? 0 : zeitraumMonate.reduce((s, m) => s + tageImMonat(m), 0)
      return { idx, titel: e.titel, kanzem: e.id === 'kanzem', einn, ausg, ueber: einn - ausg, naechte, ausl: verf ? naechte / verf : null }
    }).sort((a, b) => b.ueber - a.ueber)
  }, [daten, zeitraumMonate, einheit])

  const ueberschuss = S.einnahmen - S.ausgaben
  const auslastung = S.verfuegbar ? S.naechte / S.verfuegbar : null
  const vAusl = V && V.verfuegbar ? V.naechte / V.verfuegbar : null

  const Delta = ({ curr, prev, invers }: { curr: number; prev: number | null; invers?: boolean }) => {
    if (prev == null) return null
    const d = curr - prev
    if (Math.abs(d) < 0.005) return <span style={{ fontSize: 11.5, color: SUB }}>± 0 zur Vorperiode</span>
    const besser = invers ? d < 0 : d > 0
    return (
      <span style={{ fontSize: 11.5, fontWeight: 700, color: besser ? GREEN : RED }}>
        {d > 0 ? '▲' : '▼'} {eur0(Math.abs(d))} zur Vorperiode
      </span>
    )
  }

  const zeitraumLabel = zeitraum === 'ytd' ? 'Jahr bis heute'
    : zeitraum === 'jahr' ? 'Ganzes Jahr (inkl. gebucht)'
    : /^q\d$/.test(zeitraum) ? zeitraum.toUpperCase() + ' ' + JAHR
    : MONATE[Number(zeitraum.slice(5)) - 1] + ' ' + JAHR

  const maxChart = Math.max(1, ...chart.map((c) => Math.max(c.einn, c.ausg)))

  return (
    <div style={{ minHeight: '100dvh', background: GROUP_BG, WebkitFontSmoothing: 'antialiased', overflowX: 'hidden' }}>
      <header style={{ background: NAVY, color: '#fff', padding: 'max(12px, env(safe-area-inset-top)) 16px 12px', position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, maxWidth: 1080, margin: '0 auto' }}>
          <a href="/buchhaltung" style={{ color: GOLDL, fontSize: 15, fontWeight: 600, textDecoration: 'none' }}>‹ Buchhaltung</a>
          <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: -0.4 }}>📊 Auswertung</div>
          <div style={{ flex: 1 }} />
          {daten && <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)' }}>Stand {new Date(daten.stand).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>}
          <button onClick={() => load(true)} disabled={busy} title="Neu berechnen (dauert ~1 Min)"
            style={{ background: 'none', border: 'none', color: '#fff', fontSize: 17, cursor: 'pointer', padding: 4 }}>↻</button>
        </div>
      </header>

      <main style={{ maxWidth: 1080, margin: '0 auto', padding: '14px 16px calc(44px + env(safe-area-inset-bottom))', display: 'grid', gap: 16 }}>
        {err && (
          <div style={{ background: '#FFEBE9', color: RED, borderRadius: 12, padding: '11px 14px', fontSize: 14 }}>
            {err} <button onClick={() => load()} style={{ background: 'none', border: 'none', color: RED, fontWeight: 700, cursor: 'pointer' }}>Erneut laden</button>
          </div>
        )}
        {!daten && !err && <div style={CARD}><SkeletonRows kind="card" count={5} /></div>}

        {daten && (
          <>
            {/* ── Filter ── */}
            <div style={{ display: 'flex', gap: 7, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 2, margin: '0 -2px', paddingLeft: 2 }}>
              <Chip active={zeitraum === 'ytd'} onClick={() => setZeitraum('ytd')}>Jahr bis heute</Chip>
              {(['q1', 'q2', 'q3', 'q4'] as const).map((q) => (
                <Chip key={q} active={zeitraum === q} onClick={() => setZeitraum(q)}>{q.toUpperCase()}</Chip>
              ))}
              {alleMonate.map((m, i) => (
                <Chip key={m} active={zeitraum === m} onClick={() => setZeitraum(m)}>{MONATE[i]}</Chip>
              ))}
              <Chip active={zeitraum === 'jahr'} onClick={() => setZeitraum('jahr')}>Ganzes Jahr</Chip>
            </div>
            <div style={{ display: 'flex', gap: 7, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 2, margin: '-6px -2px 0', paddingLeft: 2 }}>
              <Chip active={einheit === 'alle'} onClick={() => setEinheit('alle')}>Alle Wohnungen</Chip>
              {daten.einheiten.map((e, i) => (
                <Chip key={e.id} active={einheit === i} onClick={() => setEinheit(i)}>{e.titel}</Chip>
              ))}
            </div>

            {/* ── KPI-Kacheln ── */}
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              {[
                { l: 'Einnahmen', v: eur0(S.einnahmen), d: <Delta curr={S.einnahmen} prev={V ? V.einnahmen : null} />, c: GREEN },
                { l: 'Ausgaben', v: eur0(S.ausgaben), d: <Delta curr={S.ausgaben} prev={V ? V.ausgaben : null} invers />, c: INK },
                { l: 'Überschuss', v: eur0(ueberschuss), d: <Delta curr={ueberschuss} prev={V ? V.einnahmen - V.ausgaben : null} />, c: ueberschuss >= 0 ? GOLD : RED },
                { l: 'Auslastung', v: auslastung == null ? '—' : Math.round(auslastung * 100) + ' %', d: vAusl != null && auslastung != null
                  ? <span style={{ fontSize: 11.5, fontWeight: 700, color: auslastung >= vAusl ? GREEN : RED }}>{auslastung >= vAusl ? '▲' : '▼'} {Math.abs(Math.round((auslastung - vAusl) * 100))} Pp zur Vorperiode</span>
                  : null, c: INK },
              ].map((k) => (
                <div key={k.l} style={{ ...CARD, padding: '15px 17px' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: SUB, letterSpacing: '0.03em' }}>{k.l.toUpperCase()}</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: k.c, letterSpacing: -0.6, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{k.v}</div>
                  <div style={{ marginTop: 3, minHeight: 15 }}>{k.d}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12.5, color: SUB, margin: '-8px 4px 0' }}>{zeitraumLabel}{einheit !== 'alle' ? ` · ${daten.einheiten[einheit]?.titel}` : ''} — Bruttowerte; Einnahmen nach Anreisetag</div>

            {/* ── Monats-Chart ── */}
            <div style={{ ...CARD, padding: '16px 16px 10px' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: INK, marginBottom: 10 }}>Entwicklung {JAHR} <span style={{ fontSize: 12, fontWeight: 600, color: SUB }}>— Monat antippen zum Filtern</span></div>
              <svg viewBox="0 0 744 190" style={{ width: '100%', height: 'auto', display: 'block' }}>
                {chart.map((c, i) => {
                  const x = 8 + i * 61
                  const hE = Math.round((c.einn / maxChart) * 140)
                  const hA = Math.round((c.ausg / maxChart) * 140)
                  const aktiv = zeitraumMonate.includes(c.m)
                  const zukunft = c.m > heuteM
                  return (
                    <g key={c.m} opacity={aktiv ? 1 : 0.32} style={{ cursor: 'pointer' }}
                      onClick={() => { haptic(); setZeitraum(c.m) }}>
                      <rect x={x} y={4} width={52} height={162} fill="transparent" />
                      <rect x={x} y={150 - hE} width={22} height={hE || 1} rx={4} fill={GOLD} opacity={zukunft ? 0.5 : 1} />
                      <rect x={x + 26} y={150 - hA} width={22} height={hA || 1} rx={4} fill="#9A9488" opacity={zukunft ? 0.5 : 1} />
                      <text x={x + 24} y={166} textAnchor="middle" fontSize={11.5} fontWeight={aktiv ? 700 : 500} fill={aktiv ? INK : SUB}>{MONATE[i]}</text>
                      {(c.einn > 0) && <text x={x + 11} y={Math.min(146, 145 - hE)} textAnchor="middle" fontSize={8.5} fill={SUB}>{Math.round(c.einn / 1000)}k</text>}
                    </g>
                  )
                })}
                <text x={8} y={184} fontSize={10.5} fill={SUB}>■ <tspan fill={GOLD}>Einnahmen</tspan>  ■ <tspan fill="#6B665C">Ausgaben</tspan> — blasser = gebuchte Zukunft</text>
              </svg>
            </div>

            {/* ── Einnahmen nach Kanal ── */}
            <div style={{ ...CARD, padding: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: INK, marginBottom: 12 }}>Einnahmen nach Kanal</div>
              {S.kanaele.size === 0 && <div style={{ fontSize: 13.5, color: SUB }}>Keine Einnahmen im Zeitraum.</div>}
              {[...S.kanaele.entries()].sort((a, b) => b[1] - a[1]).map(([k, sum]) => {
                const meta = KANAL_META[k] ?? { label: k, color: SUB }
                const pct = S.einnahmen ? sum / S.einnahmen : 0
                return (
                  <div key={k} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 92px', gap: 10, alignItems: 'center', padding: '5px 0' }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta.label}</div>
                    <div style={{ background: GROUP_BG, borderRadius: 6, height: 16, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(2, pct * 100)}%`, height: '100%', background: meta.color, borderRadius: 6 }} />
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: INK, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{eur0(sum)} <span style={{ color: SUB, fontWeight: 500 }}>{Math.round(pct * 100)}%</span></div>
                  </div>
                )
              })}
            </div>

            {/* ── Ausgaben nach Gruppen ── */}
            <div style={{ ...CARD, padding: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: INK, marginBottom: 12 }}>Ausgaben nach Kategorie <span style={{ fontSize: 12, fontWeight: 600, color: SUB }}>— antippen für Details</span></div>
              {S.gruppen.size === 0 && <div style={{ fontSize: 13.5, color: SUB }}>Keine Ausgaben im Zeitraum.</div>}
              {[...S.gruppen.entries()].sort((a, b) => b[1].sum - a[1].sum).map(([id, g]) => {
                const pct = S.ausgaben ? g.sum / S.ausgaben : 0
                const offen = offeneGruppe === id
                return (
                  <div key={id} style={{ borderBottom: `0.5px solid ${HAIRLINE}` }}>
                    <button onClick={() => { haptic(); setOffeneGruppe(offen ? null : id) }} style={{
                      width: '100%', display: 'grid', gridTemplateColumns: 'minmax(150px, 240px) 1fr 92px', gap: 10, alignItems: 'center',
                      padding: '8px 0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', WebkitTapHighlightColor: 'transparent',
                    }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{g.emoji} {g.label}</div>
                      <div style={{ background: GROUP_BG, borderRadius: 6, height: 16, overflow: 'hidden', minWidth: 0 }}>
                        <div style={{ width: `${Math.max(2, pct * 100)}%`, height: '100%', background: '#6B665C', borderRadius: 6 }} />
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: INK, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{eur0(g.sum)} <span style={{ color: SUB, fontWeight: 500 }}>{Math.round(pct * 100)}%</span></div>
                    </button>
                    {offen && (
                      <div style={{ padding: '2px 0 12px', display: 'grid', gap: 10 }}>
                        <div>
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: SUB, letterSpacing: '0.04em', marginBottom: 4 }}>KONTEN</div>
                          {[...g.konten.entries()].sort((a, b) => b[1].sum - a[1].sum).map(([nr, k]) => (
                            <div key={nr} style={{ display: 'flex', gap: 8, fontSize: 13, color: INK, padding: '2px 0' }}>
                              <span style={{ color: SUB, fontVariantNumeric: 'tabular-nums' }}>{nr}</span>
                              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.name || 'Konto'}</span>
                              <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{eur(k.sum)}</span>
                            </div>
                          ))}
                        </div>
                        <div>
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: SUB, letterSpacing: '0.04em', marginBottom: 4 }}>GRÖSSTE LIEFERANTEN</div>
                          {[...g.liefs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([lief, sum]) => (
                            <div key={lief} style={{ display: 'flex', gap: 8, fontSize: 13, color: INK, padding: '2px 0' }}>
                              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lief}</span>
                              <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{eur(sum)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* ── Wohnungs-Tabelle ── */}
            {einheit === 'alle' && (
              <div style={{ ...CARD }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: INK, padding: '14px 16px 6px' }}>Je Wohnung <span style={{ fontSize: 12, fontWeight: 600, color: SUB }}>— Zeile antippen zum Filtern</span></div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, minWidth: 560 }}>
                    <thead>
                      <tr style={{ color: SUB, fontSize: 11.5, textAlign: 'right' }}>
                        <th style={{ textAlign: 'left', padding: '6px 16px', fontWeight: 700 }}>WOHNUNG</th>
                        <th style={{ padding: '6px 8px', fontWeight: 700 }}>EINNAHMEN</th>
                        <th style={{ padding: '6px 8px', fontWeight: 700 }}>AUSGABEN</th>
                        <th style={{ padding: '6px 8px', fontWeight: 700 }}>ÜBERSCHUSS</th>
                        <th style={{ padding: '6px 8px', fontWeight: 700 }}>NÄCHTE</th>
                        <th style={{ padding: '6px 16px 6px 8px', fontWeight: 700 }}>AUSLASTUNG</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tabelle.map((z) => (
                        <tr key={z.idx} onClick={() => { haptic(); setEinheit(z.idx) }}
                          style={{ cursor: 'pointer', boxShadow: `inset 0 0.5px 0 ${HAIRLINE}` }}>
                          <td style={{ padding: '9px 16px', fontWeight: 600, color: INK, whiteSpace: 'nowrap' }}>{z.titel}</td>
                          <td style={{ padding: '9px 8px', textAlign: 'right', color: GREEN, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{z.kanzem ? '—' : eur0(z.einn)}</td>
                          <td style={{ padding: '9px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{eur0(z.ausg)}</td>
                          <td style={{ padding: '9px 8px', textAlign: 'right', fontWeight: 700, color: z.ueber >= 0 ? INK : RED, fontVariantNumeric: 'tabular-nums' }}>{eur0(z.ueber)}</td>
                          <td style={{ padding: '9px 8px', textAlign: 'right', color: SUB, fontVariantNumeric: 'tabular-nums' }}>{z.kanzem ? '—' : z.naechte}</td>
                          <td style={{ padding: '9px 16px 9px 8px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{z.ausl == null ? '—' : Math.round(z.ausl * 100) + ' %'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 12, color: SUB, padding: '8px 16px 13px' }}>Allgemeinkosten sind gleichmäßig auf alle Wohnungen verteilt · Kanzem = Aufbau-Standort (noch ohne Vermietung)</div>
              </div>
            )}

            {/* ── Neutral-Posten ── */}
            {S.neutral.size > 0 && (
              <div style={{ ...CARD, padding: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: INK, marginBottom: 8 }}>Nicht erfolgswirksam <span style={{ fontSize: 12, fontWeight: 600, color: SUB }}>— zählt nicht in die Ausgaben</span></div>
                {[...S.neutral.entries()].map(([id, n]) => (
                  <div key={id} style={{ display: 'flex', gap: 8, fontSize: 13.5, color: INK, padding: '3px 0' }}>
                    <span style={{ flex: 1 }}>{n.label}</span>
                    <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{eur0(n.sum)}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ fontSize: 12, color: SUB, lineHeight: 1.55, margin: '0 4px' }}>
              Bruttowerte (inkl. USt) · Einnahmen = bestätigte Buchungen nach Anreisetag (Website nur bezahlt) ·
              Ausgaben = gebuchte sevdesk-Belege nach Belegdatum · Abschreibungen laufen in sevdesk und sind hier nicht enthalten ·
              Datenstand alle 6 h, ↻ oben erzwingt eine Neuberechnung.
            </div>
          </>
        )}
      </main>
    </div>
  )
}
