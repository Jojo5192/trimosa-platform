/**
 * 🏦 §272 Schuldenstand — CLIENT-SICHERE Mathe/Parser (keine Server-Imports!
 *  §155-Lektion: Panel importiert von hier, supabaseAdmin darf nie in den
 *  Client-Bundle). Die Annuitäts-Fit-Mathe wurde vorab in Python an den
 *  echten Minden-Daten validiert (Fit 06.2025–12.2026: 4,200 % p.a. ·
 *  2.328,17 €/Monat · 0,00 € Abweichung — exakte Annuität).
 */

export interface KreditMonat { monat: string /* 'YYYY-MM' */; restschuld: number }

export interface Kredit {
  id: string
  name: string
  standort: string
  firma: 'gbr' | 'ug' | 'aeh'
  bank?: string | null
  /** manuell hinterlegter Vertragszins (% p.a.) — überschreibt die Anzeige des Fits nicht, steht daneben */
  zinssatz?: number | null
  rate?: number | null
  zinsbindungBis?: string | null /* 'YYYY-MM' */
  notiz?: string | null
  verlauf: KreditMonat[]
}

export const FIRMEN: Record<string, string> = {
  gbr: 'GbR', ug: 'Immobilien UG', aeh: 'Apartments & Homes',
}

/* ── Monats-Arithmetik über 'YYYY-MM'-Strings ── */

export function monatIndex(m: string): number {
  return Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1
}
export function indexMonat(i: number): string {
  const y = Math.floor(i / 12)
  const m = (i % 12) + 1
  return `${y}-${String(m).padStart(2, '0')}`
}
export function fmtMonat(m: string): string {
  return `${m.slice(5, 7)}.${m.slice(0, 4)}`
}

/* ── Bulk-Parser: Excel-Spalten „07.2024  440.000,00 €" (oder ; / Tab / 2024-07) ── */

export function parseVerlaufBulk(text: string): { zeilen: KreditMonat[]; fehler: string[] } {
  const zeilen: KreditMonat[] = []
  const fehler: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    // Monat: MM.YYYY oder YYYY-MM
    let monat: string | null = null
    const m1 = line.match(/\b(0[1-9]|1[0-2])\.(\d{4})\b/)
    const m2 = line.match(/\b(\d{4})-(0[1-9]|1[0-2])\b/)
    if (m1) monat = `${m1[2]}-${m1[1]}`
    else if (m2) monat = `${m2[1]}-${m2[2]}`
    if (!monat) { fehler.push(line.slice(0, 40)); continue }
    // Betrag: deutscher Stil (Tausenderpunkte + Komma) — Monat vorher aus der
    // Zeile entfernen, damit „07.2024" nicht als Betrag durchgeht
    const rest = line.replace(m1?.[0] ?? m2?.[0] ?? '', ' ')
    const b = rest.match(/-?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|-?\d+(?:[.,]\d{1,2})?/g)
    const kandidaten = (b ?? [])
      .map((s) => parseDeutsch(s))
      .filter((n): n is number => n != null && Number.isFinite(n) && Math.abs(n) >= 0)
    if (!kandidaten.length) { fehler.push(line.slice(0, 40)); continue }
    // größter Kandidat = die Restschuld (kleine Zahlen wären z. B. Zeilen-Nrn.)
    const restschuld = Math.max(...kandidaten)
    zeilen.push({ monat, restschuld: Math.round(restschuld * 100) / 100 })
  }
  // je Monat der letzte Wert gewinnt, sortiert
  const map = new Map<string, number>()
  for (const z of zeilen) map.set(z.monat, z.restschuld)
  return {
    zeilen: [...map.entries()].map(([monat, restschuld]) => ({ monat, restschuld }))
      .sort((a, b) => a.monat.localeCompare(b.monat)),
    fehler,
  }
}

function parseDeutsch(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'))
  // nur Punkte: „440.000" = Tausender, „440000.55" = Dezimal
  if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''))
  return Number(t)
}

/* ── Annuitäts-Fit (LSQ über y = A − i·R auf den jüngsten Monaten) ── */

export interface AnnuitaetsFit {
  zinsPa: number      // % p.a.
  rate: number        // €/Monat
  maxAbw: number      // € — max. Abweichung des Modells vom echten Verlauf
  exakt: boolean      // maxAbw < 1 € → mathematisch exakte Annuität erkannt
  monate: number      // wie viele Monatsschritte im Fit
}

export function fitAnnuitaet(verlauf: KreditMonat[], maxMonate = 18): AnnuitaetsFit | null {
  // nur LÜCKENLOSE, direkt aufeinanderfolgende Monate vom Ende her nehmen —
  // Lücken würden die Differenzen (Mehr-Monats-Tilgung) verfälschen
  const sorted = [...verlauf].sort((a, b) => a.monat.localeCompare(b.monat))
  const seg: KreditMonat[] = []
  for (let k = sorted.length - 1; k >= 0 && seg.length < maxMonate + 1; k--) {
    if (seg.length && monatIndex(seg[0].monat) - monatIndex(sorted[k].monat) !== 1) break
    seg.unshift(sorted[k])
  }
  if (seg.length < 5) return null
  const xs: number[] = []
  const ys: number[] = []
  for (let k = 0; k < seg.length - 1; k++) {
    xs.push(seg[k].restschuld)
    ys.push(seg[k].restschuld - seg[k + 1].restschuld)
  }
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxx = 0; let sxy = 0
  for (let k = 0; k < n; k++) { sxx += (xs[k] - mx) ** 2; sxy += (xs[k] - mx) * (ys[k] - my) }
  if (sxx < 1) return null // Restschuld praktisch konstant — kein Fit möglich
  const iMonat = -(sxy / sxx)
  const rate = my + iMonat * mx
  let maxAbw = 0
  for (let k = 0; k < n; k++) maxAbw = Math.max(maxAbw, Math.abs(ys[k] - (rate - iMonat * xs[k])))
  const zinsPa = iMonat * 12 * 100
  if (!Number.isFinite(zinsPa) || !Number.isFinite(rate) || rate <= 0 || zinsPa < -1 || zinsPa > 25) return null
  return { zinsPa, rate, maxAbw, exakt: maxAbw < 1, monate: n }
}

/** Monate bis Restschuld 0 bei (zinsPa, rate) — null wenn die Rate die Zinsen nicht deckt. */
export function projektionMonate(restschuld: number, zinsPa: number, rate: number): number | null {
  const i = zinsPa / 100 / 12
  if (rate <= restschuld * i) return null
  let r = restschuld
  let m = 0
  while (r > 0 && m < 720) { r = r * (1 + i) - rate; m++ }
  return m >= 720 ? null : m
}

/* ── Gesamt-Verlauf über alle Kredite (Step-Interpolation) ── */

export function summenVerlauf(kredite: Kredit[]): KreditMonat[] {
  const alle = kredite.filter((k) => k.verlauf.length)
  if (!alle.length) return []
  const von = Math.min(...alle.map((k) => monatIndex(k.verlauf[0].monat)))
  const bis = Math.max(...alle.map((k) => monatIndex(k.verlauf[k.verlauf.length - 1].monat)))
  const out: KreditMonat[] = []
  for (let i = von; i <= bis; i++) {
    let sum = 0
    for (const k of alle) {
      // letzter bekannter Wert ≤ Monat; vor dem ersten Verlaufsmonat zählt der
      // Kredit mit 0 (er existierte noch nicht)
      let v = 0
      for (const z of k.verlauf) {
        if (monatIndex(z.monat) > i) break
        v = z.restschuld
      }
      sum += v
    }
    out.push({ monat: indexMonat(i), restschuld: Math.round(sum * 100) / 100 })
  }
  return out
}

/* ── Format-Helfer ── */

export function eur0(n: number): string {
  return n.toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' €'
}
export function eur2(n: number): string {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}
export function pct2(n: number): string {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' %'
}
