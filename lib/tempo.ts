/**
 * ⏱ Gefühlte Geschwindigkeit (Pascal, Chefsache 7.10.2026, Gestaltungsbereich 11) — reine Logik.
 *
 * Die Team-App misst, wo Nutzer warten: je Aufruf an /api/* nur Methode, Routen-MUSTER (IDs, Zahlen,
 * Tokens → :id, ohne Query), Dauer bis zur Antwort und Statusklasse — nie Inhalte. Dazu eine Kennzahl
 * „App-Start" (Seitenstart → App bedienbar). Gesammelt wird je Berliner Tag in EINER app_settings-Zeile
 * (tempo:YYYY-MM-DD) mit Histogramm-Eimern; daraus schätzt die Auswertung Median und p90.
 *
 * Keine Server- und keine Browser-Abhängigkeit: läuft im Client (lib/tempo-client.ts), in der Route
 * (app/api/tempo/route.ts) und im Node-Testskript.
 */

export const TEMPO_ROUTE = '/api/tempo'
export const TEMPO_PREFIX = 'tempo:'
/** Pseudo-Eintrag für die Kennzahl „App-Start" */
export const APP_START_METHODE = 'APP'
export const APP_START_MUSTER = '/app-start'

export const METHODEN = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', APP_START_METHODE] as const
export type Methode = (typeof METHODEN)[number]
export const STATUS_KLASSEN = ['2xx', '3xx', '4xx', '5xx', 'netz'] as const
export type StatusKlasse = (typeof STATUS_KLASSEN)[number]

/** Eimer-Obergrenzen in ms: <100 · <300 · <1000 · <3000 · <10000 · ≥10000 (6 Eimer) */
export const EIMER_GRENZEN = [100, 300, 1000, 3000, 10_000] as const
export const EIMER_ANZAHL = EIMER_GRENZEN.length + 1
export const MAX_DAUER = 120_000
/** max. Messungen je Sendung (Client teilt größere Puffer auf) */
export const MAX_EINTRAEGE = 200
/** Schutz gegen ausufernde Muster (z. B. eine verpasste ID-Sorte): neue Muster darüber werden verworfen */
export const MAX_MUSTER_JE_TAG = 400
/** Muster haben höchstens so viele Segmente (inkl. „api"); der Rest wird zu :rest */
export const MAX_SEGMENTE = 8
export const MAX_MUSTER_LAENGE = 150
export const AUFBEWAHREN_TAGE = 14
export const AUSWERTUNG_TAGE = 7

export interface Messung {
  m: Methode
  r: string
  d: number
  s: StatusKlasse
}

/* ───────────────────────── Routen-Muster ───────────────────────── */

const PLATZHALTER = new Set([':id', ':rest'])
/** Statisches Segment = nur Kleinbuchstaben mit - und _ (alle festen API-Ordner sehen so aus) */
const WORT = /^[a-z][a-z_-]{0,31}$/

function segmentMuster(seg: string): string {
  if (PLATZHALTER.has(seg)) return seg
  let roh: string
  try { roh = decodeURIComponent(seg) } catch { return ':id' }
  if (!WORT.test(roh)) return ':id' // Ziffern, Großbuchstaben, Punkte, @, Umlaute … → Daten
  // lange Buchstabenketten ohne Trenner sind eher Tokens als Ordnernamen
  if (roh.length > 20 && !/[-_]/.test(roh)) return ':id'
  return roh
}

/**
 * Pfad → Routen-Muster, z. B. /api/team-chat/9b2c…/upload?x=1 → /api/team-chat/:id/upload.
 * Nur /api/*-Pfade (sonst null). Idempotent: ein Muster ergibt wieder sich selbst.
 */
export function musterAusPfad(pfad: string): string | null {
  if (typeof pfad !== 'string') return null
  const ohneQuery = pfad.split(/[?#]/)[0]
  const segs = ohneQuery.split('/').filter(Boolean)
  if (segs[0] !== 'api' || segs.length < 2) return null
  let teile = ['api', ...segs.slice(1).map(segmentMuster)]
  if (teile.length > MAX_SEGMENTE) teile = [...teile.slice(0, MAX_SEGMENTE - 1), ':rest']
  const muster = '/' + teile.join('/')
  return muster.length <= MAX_MUSTER_LAENGE ? muster : null
}

export function statusKlasse(status: number): StatusKlasse {
  if (status >= 200 && status < 300) return '2xx'
  if (status >= 300 && status < 400) return '3xx'
  if (status >= 400 && status < 500) return '4xx'
  if (status >= 500 && status < 600) return '5xx'
  return 'netz'
}

/** Als Fehler zählen Server-Fehler und Netzfehler — 4xx sind oft gewollt (z. B. Sichtbarkeits-Proben) */
export function istFehler(s: StatusKlasse): boolean {
  return s === '5xx' || s === 'netz'
}

/* ───────────────────────── Eingabe prüfen ───────────────────────── */

const MUSTER_ZEICHEN = /^\/[a-z0-9/:_-]{1,149}$/

export type Pruefung = { ok: true; messungen: Messung[] } | { ok: false; grund: string }

/** Strenge Prüfung einer Sendung { e: Messung[] } — ein ungültiger Eintrag verwirft die ganze Sendung */
export function pruefeEingabe(body: unknown): Pruefung {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, grund: 'kein Objekt' }
  const e = (body as { e?: unknown }).e
  if (!Array.isArray(e)) return { ok: false, grund: 'e fehlt' }
  if (e.length > MAX_EINTRAEGE) return { ok: false, grund: 'zu viele Einträge' }
  const messungen: Messung[] = []
  for (const x of e) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return { ok: false, grund: 'Eintrag ungültig' }
    const { m, r, d, s } = x as Record<string, unknown>
    if (typeof m !== 'string' || !(METHODEN as readonly string[]).includes(m)) return { ok: false, grund: 'Methode ungültig' }
    if (typeof r !== 'string' || !MUSTER_ZEICHEN.test(r)) return { ok: false, grund: 'Muster ungültig' }
    if (m === APP_START_METHODE) {
      if (r !== APP_START_MUSTER) return { ok: false, grund: 'Muster ungültig' }
    } else {
      // nur normalisierte Muster (keine rohen IDs) und nie die Messung selbst
      if (musterAusPfad(r) !== r) return { ok: false, grund: 'Muster nicht normalisiert' }
      if (r === TEMPO_ROUTE || r.startsWith(TEMPO_ROUTE + '/')) return { ok: false, grund: 'Muster ungültig' }
    }
    if (typeof d !== 'number' || !Number.isFinite(d) || d < 0 || d > MAX_DAUER) return { ok: false, grund: 'Dauer ungültig' }
    if (typeof s !== 'string' || !(STATUS_KLASSEN as readonly string[]).includes(s)) return { ok: false, grund: 'Status ungültig' }
    messungen.push({ m: m as Methode, r, d: Math.round(d), s: s as StatusKlasse })
  }
  return { ok: true, messungen }
}

/* ───────────────────────── Tages-Sammelzeile ───────────────────────── */

export interface MusterStat {
  n: number
  summe: number
  eimer: number[]
  fehler: number
  max: number
}
/** value der app_settings-Zeile tempo:YYYY-MM-DD; v = Versionszähler für konfliktfreies Schreiben */
export interface TagesWert {
  v: number
  muster: Record<string, MusterStat>
}

export function eimerIndex(d: number): number {
  for (let i = 0; i < EIMER_GRENZEN.length; i++) if (d < EIMER_GRENZEN[i]) return i
  return EIMER_GRENZEN.length
}

const zahl = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0)

/** Robust lesen — fehlende/kaputte Werte ergeben einen leeren Tag mit v = 0 */
export function tagLesen(value: unknown): TagesWert {
  const out: TagesWert = { v: 0, muster: {} }
  if (!value || typeof value !== 'object') return out
  const raw = value as { v?: unknown; muster?: unknown }
  out.v = typeof raw.v === 'number' && Number.isInteger(raw.v) ? raw.v : 0
  if (raw.muster && typeof raw.muster === 'object') {
    for (const [k, st] of Object.entries(raw.muster as Record<string, unknown>)) {
      if (!st || typeof st !== 'object') continue
      const s = st as Partial<Record<keyof MusterStat, unknown>>
      const eimer = Array.isArray(s.eimer) ? s.eimer.slice(0, EIMER_ANZAHL).map(zahl) : []
      while (eimer.length < EIMER_ANZAHL) eimer.push(0)
      out.muster[k] = { n: zahl(s.n), summe: zahl(s.summe), eimer, fehler: zahl(s.fehler), max: zahl(s.max) }
    }
  }
  return out
}

export const musterSchluessel = (m: Methode, r: string) => `${m} ${r}`

/** Neue Messungen einrechnen — liefert einen NEUEN Wert mit v + 1 (alt bleibt unverändert) */
export function tagEinrechnen(alt: TagesWert, messungen: Messung[]): TagesWert {
  const muster: Record<string, MusterStat> = {}
  for (const [k, st] of Object.entries(alt.muster)) muster[k] = { ...st, eimer: [...st.eimer] }
  let anzahl = Object.keys(muster).length
  for (const x of messungen) {
    const k = musterSchluessel(x.m, x.r)
    let st = muster[k]
    if (!st) {
      if (anzahl >= MAX_MUSTER_JE_TAG) continue
      st = muster[k] = { n: 0, summe: 0, eimer: new Array(EIMER_ANZAHL).fill(0), fehler: 0, max: 0 }
      anzahl++
    }
    st.n++
    st.summe += x.d
    st.eimer[eimerIndex(x.d)]++
    if (istFehler(x.s)) st.fehler++
    if (x.d > st.max) st.max = x.d
  }
  return { v: alt.v + 1, muster }
}

/* ───────────────────────── Auswertung ───────────────────────── */

/**
 * Quantil aus den Histogramm-Eimern schätzen: lineare Verteilung innerhalb des Eimers; der oberste
 * belegte Eimer endet beim gemessenen Höchstwert (sonst wäre ≥ 10 s nach oben offen).
 */
export function quantilAusEimern(eimer: number[], q: number, max = 0): number {
  const gesamt = eimer.reduce((a, b) => a + b, 0)
  if (!gesamt) return 0
  const ziel = Math.min(Math.max(q, 0), 1) * gesamt
  let kum = 0
  for (let i = 0; i < eimer.length; i++) {
    const c = eimer[i]
    if (!c) continue
    if (kum + c >= ziel) {
      const unten = i === 0 ? 0 : EIMER_GRENZEN[i - 1]
      let oben: number = i < EIMER_GRENZEN.length ? EIMER_GRENZEN[i] : Math.max(max, unten * 2)
      if (max > 0) oben = Math.min(oben, Math.max(max, unten))
      const anteil = (ziel - kum) / c
      return Math.round(unten + (oben - unten) * anteil)
    }
    kum += c
  }
  return Math.round(max)
}

export interface TempoZeile {
  methode: Methode
  muster: string
  name: string
  aufrufe: number
  median: number
  p90: number
  mittel: number
  fehlerQuote: number
  /** gefühlte Wartelast = Aufrufe × p90 (ms) — Sortierschlüssel */
  last: number
  eimer: number[]
}

export interface TempoAuswertung {
  zeilen: TempoZeile[]
  appStart: TempoZeile | null
  aufrufeGesamt: number
}

/** Tage zusammenführen und je Muster Kennzahlen bilden — sortiert nach gefühlter Wartelast */
export function auswerten(tage: TagesWert[]): TempoAuswertung {
  const summe = new Map<string, MusterStat>()
  for (const t of tage) {
    for (const [k, st] of Object.entries(t.muster)) {
      const z = summe.get(k)
      if (!z) { summe.set(k, { ...st, eimer: [...st.eimer] }); continue }
      z.n += st.n
      z.summe += st.summe
      z.fehler += st.fehler
      z.max = Math.max(z.max, st.max)
      for (let i = 0; i < EIMER_ANZAHL; i++) z.eimer[i] += st.eimer[i] ?? 0
    }
  }
  const zeilen: TempoZeile[] = []
  let appStart: TempoZeile | null = null
  let aufrufeGesamt = 0
  for (const [k, st] of summe) {
    if (!st.n) continue
    const leer = k.indexOf(' ')
    const methode = k.slice(0, leer) as Methode
    const muster = k.slice(leer + 1)
    if (!(METHODEN as readonly string[]).includes(methode)) continue
    const p90 = quantilAusEimern(st.eimer, 0.9, st.max)
    const zeile: TempoZeile = {
      methode, muster, name: lesbarerName(methode, muster),
      aufrufe: st.n,
      median: quantilAusEimern(st.eimer, 0.5, st.max),
      p90,
      mittel: Math.round(st.summe / st.n),
      fehlerQuote: st.fehler / st.n,
      last: st.n * p90,
      eimer: st.eimer,
    }
    if (methode === APP_START_METHODE) { appStart = zeile; continue }
    aufrufeGesamt += st.n
    zeilen.push(zeile)
  }
  zeilen.sort((a, b) => b.last - a.last || b.aufrufe - a.aufrufe)
  return { zeilen, appStart, aufrufeGesamt }
}

/* ───────────────────────── Verständliche Namen ───────────────────────── */

/** Die häufigsten Muster der Team-App → Name in Alltagssprache (Rest: lesbares Muster) */
export const TEMPO_NAMEN: Record<string, string> = {
  'APP /app-start': 'App-Start',
  'GET /api/heute': 'Heute-Übersicht laden',
  'GET /api/chat/inbox': 'Gäste-Inbox laden',
  'PATCH /api/chat/inbox': 'Gäste-Thread markieren',
  'GET /api/messages/:id': 'Gäste-Chat öffnen',
  'POST /api/messages/:id': 'Gäste-Nachricht senden',
  'GET /api/chat': 'Gäste-Chat (Konto) laden',
  'POST /api/chat': 'Gäste-Nachricht (Konto) senden',
  'POST /api/ai/chat-suggest': 'KI-Antwortvorschlag',
  'POST /api/ai/translate': 'Übersetzen',
  'POST /api/ai/call-suggest': 'KI-Vorschlag zum Anruf',
  'GET /api/team-chat': 'Intern-Chats laden',
  'POST /api/team-chat': 'Intern-Chat anlegen',
  'GET /api/team-chat/:id': 'Intern-Chat öffnen',
  'POST /api/team-chat/:id': 'Intern-Nachricht senden',
  'PATCH /api/team-chat/:id': 'Intern-Chat bearbeiten',
  'POST /api/team-chat/:id/upload': 'Datei im Intern-Chat hochladen',
  'POST /api/team-chat/:id/react': 'Reaktion im Intern-Chat',
  'GET /api/tasks': 'Aufgaben laden',
  'POST /api/tasks': 'Aufgabe anlegen',
  'PATCH /api/tasks/:id': 'Aufgabe ändern',
  'DELETE /api/tasks/:id': 'Aufgabe löschen',
  'GET /api/tasks/:id/comments': 'Kommentare laden',
  'POST /api/tasks/:id/comments': 'Kommentar senden',
  'POST /api/tasks/:id/photos': 'Aufgaben-Foto hochladen',
  'POST /api/tasks/suggest': 'Aufgabe vorschlagen',
  'GET /api/team/calendar': 'Belegung laden',
  'GET /api/qs': 'Qualitätssicherung laden',
  'PATCH /api/qs/:id': 'QS-Protokoll ändern',
  'POST /api/qs/:id/photos': 'QS-Foto hochladen',
  'GET /api/kennzahlen': 'Kennzahlen laden',
  'GET /api/cleaning-invoices': 'Reinigungs-Abrechnung laden',
  'GET /api/material': 'Material laden',
  'POST /api/material': 'Material melden',
  'GET /api/locks/control': 'Türschlösser laden',
  'POST /api/locks/control': 'Tür öffnen',
  'GET /api/invoices/:id': 'Rechnungs-Stand laden',
  'POST /api/invoices/:id': 'Rechnung erstellen',
  'POST /api/zahlung/link': 'Zahllink erstellen',
  'GET /api/push/prefs': 'Mitteilungs-Einstellungen laden',
  'PATCH /api/push/prefs': 'Mitteilungs-Einstellung ändern',
  'GET /api/push/log': 'Mitteilungen laden',
  'GET /api/voice/calls': 'Anrufe laden',
  'GET /api/wallbox': 'Wallbox laden',
  'GET /api/schulden': 'Schuldenstand laden',
  'GET /api/stammgaeste': 'Stammgäste laden',
  'GET /api/auto-messages': 'Auto-Nachrichten laden',
  'GET /api/team/vorschau': 'Rollen-Vorschau laden',
}

const VERB: Record<string, string> = { GET: 'laden', POST: 'senden', PUT: 'ändern', PATCH: 'ändern', DELETE: 'löschen' }

/** Name für die Oberfläche: Tabelle, sonst das Muster lesbar gemacht („tasks › … › comments – laden") */
export function lesbarerName(m: Methode, r: string): string {
  const fest = TEMPO_NAMEN[musterSchluessel(m, r)]
  if (fest) return fest
  if (m === APP_START_METHODE) return 'App-Start'
  const pfad = r.replace(/^\/api\//, '').split('/').map((s) => (s.startsWith(':') ? '…' : s)).join(' › ')
  return `${pfad} – ${VERB[m] ?? m.toLowerCase()}`
}

/* ───────────────────────── Datum (Europe/Berlin) ───────────────────────── */

export function berlinDatum(d: Date = new Date()): string {
  const teile = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const get = (t: string) => teile.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Berliner Kalendertag minus n Tage (über UTC gerechnet — sommerzeitfest) */
export function tagMinus(datum: string, n: number): string {
  const [y, m, d] = datum.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10)
}

/** Schlüssel der letzten n Berliner Tage, heute zuerst */
export function letzteTageSchluessel(n: number, jetzt: Date = new Date()): string[] {
  const heute = berlinDatum(jetzt)
  return Array.from({ length: n }, (_, i) => TEMPO_PREFIX + tagMinus(heute, i))
}

/** Zeilen mit Schlüssel < diesem Wert sind älter als AUFBEWAHREN_TAGE und dürfen weg */
export function aufraeumGrenze(jetzt: Date = new Date()): string {
  return TEMPO_PREFIX + tagMinus(berlinDatum(jetzt), AUFBEWAHREN_TAGE)
}
