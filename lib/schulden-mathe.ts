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
    // Monat: MM.YYYY oder YYYY-MM — Jahr plausibel (2000–2099, Review-Fund:
    // ein Zehner-Dreher wie „2924" würde sonst Hero/Chart vergiften)
    let monat: string | null = null
    const m1 = line.match(/\b(0[1-9]|1[0-2])\.(20\d{2})\b/)
    const m2 = line.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/)
    if (m1) monat = `${m1[2]}-${m1[1]}`
    else if (m2) monat = `${m2[1]}-${m2[2]}`
    if (!monat) { fehler.push(line.slice(0, 40)); continue }
    // Review-Fund: ALLE Datums-Vorkommen entfernen (auch eine zweite Spalte
    // wie „Zinsbindung 06.2030"), sonst zerfallen sie in Betrag-Kandidaten
    const rest = line
      .replace(/\b(0[1-9]|1[0-2])\.(20\d{2})\b/g, ' ')
      .replace(/\b(20\d{2})-(0[1-9]|1[0-2])\b/g, ' ')
    // Review-Fund (HOCH): kein Regex-Scan über Teilstrings — der zerhackte
    // „440000,00" in 3er-Chunks. Stattdessen je Whitespace-Token die GANZE
    // Zahl parsen (deckt 440.000,00 · 440000,00 · 440000 · 439400.55).
    const kandidaten = rest.split(/[\s;€]+/)
      .filter((t) => /^-?[\d.,]+$/.test(t))
      .map((t) => parseDeutsch(t))
      .filter((n): n is number => n != null && Number.isFinite(n) && n >= 0)
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

function lsqFit(seg: KreditMonat[]): AnnuitaetsFit | null {
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
  let zinsPa = iMonat * 12 * 100
  // Kosmetik (§272c): zinslose Darlehen fitten numerisch auf −0,000x % → „-0,00 %"
  if (Math.abs(zinsPa) < 0.005) zinsPa = 0
  // rate < 1 statt <= 0 (Review §272c, MITTEL): Stundungs-Verläufe (Restschuld
  // wächst durch Zinskapitalisierung, Salden cent-gerundet) fitten sonst auf
  // eine MIKRO-Rate aus dem Rundungsrauschen (0,00–0,20 €) mit exakt=true —
  // und die Fortschreibung nähme den Störfit statt der Vertragsfelder. Eine
  // echte Monatsrate unter 1 € existiert nicht.
  if (!Number.isFinite(zinsPa) || !Number.isFinite(rate) || rate < 1 || zinsPa < -1 || zinsPa > 25) return null
  return { zinsPa, rate, maxAbw, exakt: maxAbw < 1, monate: n }
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
  const basis = lsqFit(seg)
  if (basis?.exakt) return basis
  // Ausreißer-Robustheit (§272b, Zewen-Fund: EINE ~415-€-Sondertilgung im
  // Fenster drückte den Fit von echten 1,39 % auf 0,37 %): das längste
  // JÜNGSTE Teilfenster, das mathematisch exakt ist, gewinnt — sonst bleibt
  // der volle Fit als gekennzeichnete Schätzung (~) stehen. Läuft auch bei
  // basis == null (§272c, Sirzenich-2-Fund: VARIABLE Zinsphasen im Fenster
  // sprengen den Plausibilitäts-Guard des Voll-Fits — die stabile jüngste
  // Phase ist trotzdem exakt erkennbar).
  for (let len = seg.length - 1; len >= 6; len--) {
    const f = lsqFit(seg.slice(seg.length - len))
    if (f?.exakt) return f
  }
  return basis
}

/* ── Auto-Fortschreibung (§272c): endet der gepflegte Verlauf VOR dem
 *    heutigen Monat, läuft die Tilgung real ja trotzdem weiter — die Lücke
 *    wird mit den erkannten Konditionen (Fit; Fallback Vertragsfelder)
 *    annuitätisch bis heute hochgerechnet. NIE persistiert, nur berechnete
 *    Anzeige — echte nachgepflegte Werte ersetzen die Schätzung automatisch.
 *    Greift per Definition nur bei Krediten OHNE Zukunfts-/Planzeilen
 *    (letzter Monat < heute ⇒ alle Zeilen sind Ist ⇒ der interne Fit ist
 *    identisch mit dem Karten-Fit). ── */

export interface Fortschreibung {
  zeilen: KreditMonat[]        // NUR die ergänzten Monate (nach dem letzten echten)
  abMonat: string              // erster fortgeschriebener Monat
  letzterEchter: KreditMonat   // letzter gepflegter (echter) Stand
  basis: 'fit' | 'vertrag'
  zinsPa: number
  rate: number
}

export function fortschreibungBisHeute(
  k: Pick<Kredit, 'verlauf' | 'rate' | 'zinssatz'>,
  heute = heuteMonat(),
): Fortschreibung | null {
  if (!k.verlauf.length) return null
  const letzte = k.verlauf[k.verlauf.length - 1]
  const von = monatIndex(letzte.monat)
  const bis = monatIndex(heute)
  // Lücke > 10 Jahre = kaputter Datenstand, keine Schätzung darüber
  if (bis <= von || bis - von > 120) return null
  let zinsPa: number
  let rate: number
  let basis: Fortschreibung['basis']
  const fit = fitAnnuitaet(k.verlauf)
  if (fit && fit.rate > 0) { zinsPa = fit.zinsPa; rate = fit.rate; basis = 'fit' }
  else if (k.rate != null && k.rate > 0) { zinsPa = k.zinssatz ?? 0; rate = k.rate; basis = 'vertrag' }
  else return null
  const iMonat = zinsPa / 100 / 12
  const zeilen: KreditMonat[] = []
  let r = letzte.restschuld
  for (let m = von + 1; m <= bis; m++) {
    r = Math.max(0, r * (1 + iMonat) - rate)
    zeilen.push({ monat: indexMonat(m), restschuld: Math.round(r * 100) / 100 })
  }
  return { zeilen, abMonat: zeilen[0].monat, letzterEchter: letzte, basis, zinsPa, rate }
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
  let von = Math.min(...alle.map((k) => monatIndex(k.verlauf[0].monat)))
  const bis = Math.max(...alle.map((k) => monatIndex(k.verlauf[k.verlauf.length - 1].monat)))
  // Defensiv-Kappung (Review): ein Ausreißer-Jahr darf nie zehntausende
  // Chart-Punkte erzeugen — mehr als 100 Jahre Spanne kappt auf das Ende
  if (bis - von > 1200) von = bis - 1200
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

/* ── Ist/Plan-Trennung (§272b): Tilgungsplan-Tabellen enthalten Zukunfts-
 *    monate — „aktuell" ist immer der letzte Monat ≤ HEUTE, alles danach
 *    ist Plan (im Chart gestrichelt). ── */

export function heuteMonat(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Anzahl der Ist-Monate am Verlaufsanfang (Rest = Plan/Zukunft). */
export function istAnzahl(verlauf: KreditMonat[], heute = heuteMonat()): number {
  let n = 0
  for (const z of verlauf) { if (z.monat <= heute) n++; else break }
  return n
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
