/**
 * ⭐ Bewertungs-Abruf: Protokoll, Status, Rotation und Alarm (§314).
 *
 * Hintergrund: Vom 24.7. bis 1.10.2026 kam für Airbnb und Booking nichts mehr an (erst Apify-Kontingent,
 * dann abgelehnte Sortier-Werte) — und niemand sah es, weil der Cron sein Ergebnis nur als JSON-Antwort
 * zurückgab und reviews_synced_at trotzdem setzte. Dieses Modul macht jeden Abruf dauerhaft sichtbar.
 *
 * Ablage in app_settings (existiert seit 20260716, KEINE neue Migration):
 *  - 'reviews_sync:<listingId>'  Protokoll je Wohnung. Ein eigener Schlüssel je Wohnung, damit parallele
 *                                Abrufe verschiedener Wohnungen sich nie gegenseitig überschreiben.
 *  - 'reviews_sync_cron'         Lebenszeichen des Crons + Merker für den einmaligen Nachhol-Lauf.
 *  - 'reviews_sync_alarm'        { [listingId]: Zeitpunkt des letzten Pushs } — höchstens 1 Push je Woche und Wohnung.
 * Alles fail-soft: fehlt die Tabelle oder scheitert ein Zugriff, bleibt die Funktion still inaktiv —
 * der eigentliche Abruf läuft unverändert weiter.
 *
 * Import von reviews-sync NUR als Typ (sonst Zirkelbezug: reviews-sync ruft writeSyncLog).
 */
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendPushToTeam } from '@/lib/push'
import type { SyncSourceResult, SyncErrorKind } from '@/lib/reviews-sync'

export const PORTALE = ['airbnb', 'booking', 'vrbo', 'google'] as const
export type Portal = (typeof PORTALE)[number]
export const PORTAL_NAME: Record<Portal, string> = { airbnb: 'Airbnb', booking: 'Booking', vrbo: 'FeWo-direkt', google: 'Google' }
/** Portale, die über einen Apify-Scraper laufen (Google hat zusätzlich die offizielle Places-API). */
const SCRAPER: readonly Portal[] = ['airbnb', 'booking', 'vrbo']
/** Ab so vielen Tagen ohne erfolgreichen Abruf gilt eine Quelle als überfällig (6 Wochen). */
export const STALE_TAGE = 42

const PREFIX = 'reviews_sync:'
const CRON_KEY = 'reviews_sync_cron'
const ALARM_KEY = 'reviews_sync_alarm'
const ALARM_PAUSE_MS = 6.5 * 86400_000 // „höchstens 1× pro Woche" — etwas unter 7 Tagen, der Cron läuft nie auf die Sekunde gleich

export interface PortalLog {
  versuchAm: string                 // letzter Versuch (egal mit welchem Ergebnis)
  status: 'ok' | 'teilweise' | 'error'
  fehler: string | null             // Fehlertext des letzten Versuchs (max. 300 Zeichen)
  fehlerArt: SyncErrorKind | null
  abgerufen: number                 // vom Portal geliefert (letzter Versuch)
  neu: number | null                // davon bisher unbekannt
  okAm: string | null               // letzter VOLLSTÄNDIG erfolgreicher Abruf
  okAbgerufen: number | null
  okNeu: number | null
  fehlerInFolge: number
  ziel: string | null               // URL/Place-ID, mit der abgerufen wurde (Sperrfrist nur bei unveränderter Quelle)
}
export interface ListingSyncLog {
  v: 1
  versuchAm: string | null
  origin: 'cron' | 'manuell' | null
  /** Läufe in Folge, in denen KEINE hinterlegte Scraper-Quelle geklappt hat (steuert die Rotation). */
  fehlLaeufe: number
  portale: Partial<Record<Portal, PortalLog>>
  verlauf: { am: string; origin: string; kurz: string }[]
}

interface QuellenRow {
  id: string
  airbnb_url: string | null
  booking_url: string | null
  vrbo_url: string | null
  google_place_id: string | null
}

const isPortal = (s: string): s is Portal => (PORTALE as readonly string[]).includes(s)
const ts = (s?: string | null) => (s ? Date.parse(s) || 0 : 0)

function zielVon(l: QuellenRow, p: Portal): string | null {
  const v = p === 'google' ? l.google_place_id : p === 'airbnb' ? l.airbnb_url : p === 'booking' ? l.booking_url : l.vrbo_url
  return v && v.trim() ? v.trim() : null
}

function parseLog(value: unknown): ListingSyncLog {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<ListingSyncLog>
  return {
    v: 1,
    versuchAm: typeof v.versuchAm === 'string' ? v.versuchAm : null,
    origin: v.origin === 'cron' || v.origin === 'manuell' ? v.origin : null,
    fehlLaeufe: Number.isFinite(Number(v.fehlLaeufe)) ? Number(v.fehlLaeufe) : 0,
    portale: v.portale && typeof v.portale === 'object' ? v.portale : {},
    verlauf: Array.isArray(v.verlauf) ? v.verlauf : [],
  }
}

/* ── Protokoll schreiben / lesen ────────────────────────── */

/**
 * Schreibt das Ergebnis EINES Abrufs ins Protokoll der Wohnung. Wirft bei Lese- oder Schreibfehler
 * (der Aufrufer fängt das ab) — bei einem Lesefehler wird bewusst NICHT geschrieben, sonst ginge der
 * letzte erfolgreiche Abruf (okAm) verloren.
 */
export async function writeSyncLog(listing: QuellenRow, results: SyncSourceResult[], origin: 'cron' | 'manuell'): Promise<void> {
  const key = PREFIX + listing.id
  const { data, error } = await supabaseAdmin.from('app_settings').select('value').eq('key', key).maybeSingle()
  if (error) throw new Error(`Protokoll lesen: ${error.message}`)
  const alt = parseLog(data?.value)
  const now = new Date().toISOString()
  const portale: ListingSyncLog['portale'] = { ...alt.portale }
  const kurz: string[] = []
  let scraperHinterlegt = 0
  let scraperOk = 0

  for (const r of results) {
    if (!isPortal(r.source)) continue
    const p = r.source
    const ziel = zielVon(listing, p)
    if (!ziel) { delete portale[p]; continue } // nicht (mehr) hinterlegt
    const vorher = portale[p]
    const istScraper = SCRAPER.includes(p)
    if (istScraper) scraperHinterlegt++
    if (r.status === 'ok') {
      const voll = !r.partial
      if (istScraper) scraperOk++
      portale[p] = {
        versuchAm: now,
        status: voll ? 'ok' : 'teilweise',
        fehler: voll ? null : (r.detail ?? 'Volltexte nicht abrufbar').slice(0, 300),
        fehlerArt: voll ? null : r.errorKind ?? 'sonst',
        abgerufen: r.fetched,
        neu: r.neu ?? null,
        okAm: voll ? now : vorher?.okAm ?? null,
        okAbgerufen: voll ? r.fetched : vorher?.okAbgerufen ?? null,
        okNeu: voll ? r.neu ?? null : vorher?.okNeu ?? null,
        fehlerInFolge: voll ? 0 : (vorher?.fehlerInFolge ?? 0) + 1,
        ziel,
      }
      // „ohne Datum" > 0 heißt: der Actor liefert sein Datumsfeld nicht mehr wie erwartet (Heute-Rückfall)
      kurz.push(`${PORTAL_NAME[p]} ${voll ? 'ok' : 'teilweise'} ${r.fetched}/${r.neu ?? '?'} neu${r.ohneDatum ? ` (${r.ohneDatum} ohne Datum)` : ''}`)
    } else {
      // 'error' — oder 'skipped', obwohl die Quelle hinterlegt ist (Zugangsschlüssel fehlt)
      portale[p] = {
        versuchAm: now,
        status: 'error',
        fehler: (r.detail ?? 'unbekannter Fehler').slice(0, 300),
        fehlerArt: r.errorKind ?? 'sonst',
        abgerufen: r.fetched,
        neu: null,
        okAm: vorher?.okAm ?? null,
        okAbgerufen: vorher?.okAbgerufen ?? null,
        okNeu: vorher?.okNeu ?? null,
        fehlerInFolge: (vorher?.fehlerInFolge ?? 0) + 1,
        ziel,
      }
      kurz.push(`${PORTAL_NAME[p]} FEHLER (${r.errorKind ?? 'sonst'})`)
    }
  }

  const log: ListingSyncLog = {
    v: 1,
    versuchAm: now,
    origin,
    fehlLaeufe: scraperHinterlegt > 0 && scraperOk === 0 ? alt.fehlLaeufe + 1 : 0,
    portale,
    verlauf: [{ am: now, origin, kurz: kurz.join(' · ') || 'keine Quelle hinterlegt' }, ...alt.verlauf].slice(0, 10),
  }
  const { error: wErr } = await supabaseAdmin
    .from('app_settings').upsert({ key, value: log, updated_at: now }, { onConflict: 'key' })
  if (wErr) throw new Error(`Protokoll schreiben: ${wErr.message}`)
}

/** Protokoll EINER Wohnung; null bei Fehler oder wenn noch keines existiert. */
export async function readSyncLog(listingId: string): Promise<ListingSyncLog | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('app_settings').select('value').eq('key', PREFIX + listingId).maybeSingle()
    if (error || !data) return null
    return parseLog(data.value)
  } catch {
    return null
  }
}

/** Alle Protokolle (listingId → Protokoll). Fehler → leere Map (Karte zeigt dann „noch kein Abruf protokolliert"). */
export async function readAllSyncLogs(): Promise<Map<string, ListingSyncLog>> {
  const out = new Map<string, ListingSyncLog>()
  try {
    const { data, error } = await supabaseAdmin
      .from('app_settings').select('key, value').like('key', `${PREFIX}%`)
    if (error) { console.error('[reviews-sync-log] Protokolle lesen:', error.message); return out }
    for (const row of data ?? []) out.set(String(row.key).slice(PREFIX.length), parseLog(row.value))
  } catch (e) {
    console.error('[reviews-sync-log] Protokolle lesen:', e)
  }
  return out
}

/**
 * Sperrfrist für den Handabruf (jeder Lauf kostet ca. 0,25 $ Apify-Guthaben): Minuten seit dem letzten
 * Lauf, wenn dieser weniger als `stunden` zurückliegt, ALLE hinterlegten Portale vollständig geklappt
 * haben und keine Quelle seither geändert wurde — sonst null (Abruf erlaubt).
 */
export async function minutenSeitVollemErfolg(listing: QuellenRow, stunden = 6): Promise<number | null> {
  const log = await readSyncLog(listing.id)
  if (!log?.versuchAm) return null
  const alter = Date.now() - ts(log.versuchAm)
  if (alter < 0 || alter > stunden * 3600_000) return null
  const hinterlegt = PORTALE.filter((p) => zielVon(listing, p))
  if (!hinterlegt.length) return null
  const alleOk = hinterlegt.every((p) => {
    const pl = log.portale[p]
    return !!pl && pl.status === 'ok' && pl.versuchAm === log.versuchAm && pl.ziel === zielVon(listing, p)
  })
  return alleOk ? Math.max(1, Math.round(alter / 60_000)) : null
}

/* ── Status je Wohnung × Portal ─────────────────────────── */

export interface StatusZelle {
  portal: Portal
  name: string
  konfiguriert: boolean
  ampel: 'gruen' | 'gelb' | 'rot' | 'aus'
  status: 'aus' | 'nie' | 'ok' | 'teilweise' | 'error'
  okAm: string | null             // letzter erfolgreicher Abruf laut Protokoll
  versuchAm: string | null        // letzter Versuch
  fehler: string | null
  fehlerArt: SyncErrorKind | null
  fehlerInFolge: number
  abgerufen: number | null
  neu: number | null
  anzahl: number                  // gespeicherte Bewertungen dieser Wohnung bei diesem Portal
  neuesteBewertung: string | null // jüngstes Bewertungsdatum in der DB
  letzterImport: string | null    // wann zuletzt eine NEUE Bewertung in die DB kam
  tageSeit: number | null         // Tage seit dem letzten belegten Erfolg (okAm, sonst letzterImport)
  ueberfaellig: boolean
}
export interface StatusZeile {
  id: string
  title: string
  reviewsSyncedAt: string | null
  versuchAm: string | null
  zellen: StatusZelle[]
}

type Aggregat = { anzahl: number; neuesteBewertung: string | null; letzterImport: string | null }

/** Anzahl, jüngstes Bewertungsdatum und letzter Import je Wohnung × Portal — ein paginierter Scan. */
async function reviewAggregate(): Promise<Map<string, Aggregat>> {
  const out = new Map<string, Aggregat>()
  for (let page = 0; page < 30; page++) {
    const { data, error } = await supabaseAdmin
      .from('reviews')
      .select('listing_id, source, review_date, created_at')
      .in('source', [...PORTALE])
      .order('id', { ascending: true })
      .range(page * 1000, page * 1000 + 999)
    if (error) throw new Error(`Bewertungen lesen: ${error.message}`)
    for (const r of data ?? []) {
      const k = `${r.listing_id}:${r.source}`
      const a = out.get(k) ?? { anzahl: 0, neuesteBewertung: null, letzterImport: null }
      a.anzahl++
      if (r.review_date && (!a.neuesteBewertung || r.review_date > a.neuesteBewertung)) a.neuesteBewertung = r.review_date
      if (r.created_at && ts(r.created_at) > ts(a.letzterImport)) a.letzterImport = r.created_at
      out.set(k, a)
    }
    if (!data || data.length < 1000) break
  }
  return out
}

/** Fehler, die sich nicht von selbst erledigen — die Ampel springt sofort auf Rot. */
const HARTE_FEHLER: SyncErrorKind[] = ['eingabe', 'token', 'actor', 'leer', 'kontingent']

/**
 * Status aller aktiven Wohnungen × Portale: Protokoll + DB-Bestand zusammengeführt. Solange für eine
 * Quelle noch kein erfolgreicher Abruf protokolliert ist, dient der letzte Import (created_at der
 * jüngsten Zeile) als ehrlicher Ersatz-Beleg. Wirft bei DB-Fehlern (nie „leer" als Ergebnis ausgeben).
 */
export async function buildSyncStatus(): Promise<StatusZeile[]> {
  const { data: listings, error } = await supabaseAdmin
    .from('listings')
    .select('id, title, reviews_synced_at, airbnb_url, booking_url, vrbo_url, google_place_id')
    .eq('is_active', true)
    .order('title', { ascending: true })
  if (error) throw new Error(`Wohnungen lesen: ${error.message}`)
  const [logs, agg] = await Promise.all([readAllSyncLogs(), reviewAggregate()])
  const now = Date.now()

  return (listings ?? []).map((l) => {
    const log = logs.get(l.id)
    const zellen = PORTALE.map((p): StatusZelle => {
      const konfiguriert = !!zielVon(l, p)
      const pl = log?.portale?.[p]
      const a = agg.get(`${l.id}:${p}`)
      const okAm = pl?.okAm ?? null
      const referenz = okAm ?? a?.letzterImport ?? null
      const tageSeit = referenz ? Math.max(0, Math.floor((now - ts(referenz)) / 86400_000)) : null
      const ueberfaellig = konfiguriert && (tageSeit === null || tageSeit > STALE_TAGE)
      const status: StatusZelle['status'] = !konfiguriert ? 'aus' : !pl ? 'nie' : pl.status
      const harterFehler = status === 'error' && (HARTE_FEHLER.includes(pl?.fehlerArt ?? 'sonst') || (pl?.fehlerInFolge ?? 0) >= 2)
      const ampel: StatusZelle['ampel'] = !konfiguriert ? 'aus'
        : ueberfaellig || harterFehler ? 'rot'
        : status === 'error' || status === 'teilweise' ? 'gelb'
        : 'gruen'
      return {
        portal: p,
        name: PORTAL_NAME[p],
        konfiguriert,
        ampel,
        status,
        okAm,
        versuchAm: pl?.versuchAm ?? null,
        fehler: pl && pl.status !== 'ok' ? pl.fehler : null,
        fehlerArt: pl && pl.status !== 'ok' ? pl.fehlerArt : null,
        fehlerInFolge: pl?.fehlerInFolge ?? 0,
        abgerufen: pl ? pl.abgerufen : null,
        neu: pl ? pl.neu : null,
        anzahl: a?.anzahl ?? 0,
        neuesteBewertung: a?.neuesteBewertung ?? null,
        letzterImport: a?.letzterImport ?? null,
        tageSeit,
        ueberfaellig,
      }
    })
    return { id: l.id, title: l.title ?? 'Wohnung', reviewsSyncedAt: l.reviews_synced_at ?? null, versuchAm: log?.versuchAm ?? null, zellen }
  })
}

/* ── Montags-Rotation ───────────────────────────────────── */

/**
 * Wählt die Wohnungen für den Montags-Cron.
 *  1. Wohnungen mit einer ÜBERFÄLLIGEN Quelle (> 6 Wochen ohne Erfolg) zuerst — außer die Quelle ist
 *     schon zweimal in Folge gescheitert (Dauer-Fehler dürfen keinen Platz dauerhaft blockieren).
 *  2. Danach reihum nach reviews_synced_at (ältester Stand zuerst). Das wird nur bei Erfolg gesetzt —
 *     eine gescheiterte Wohnung kommt also am nächsten Montag wieder dran. Nach zwei Fehl-Läufen in
 *     Folge zählt stattdessen der letzte VERSUCH, damit sie sich hinten einreiht statt alle anderen
 *     auszuhungern.
 * Nachhol-Lauf: Solange `nachholErlaubt` (einmalig) und mehr als `proLauf` Wohnungen überfällig sind,
 * dürfen es bis zu `nachholMax` sein.
 */
export function planCronAuswahl<T extends { id: string; reviews_synced_at: string | null }>(
  listings: T[],
  zeilen: StatusZeile[],
  logs: Map<string, ListingSyncLog>,
  opts: { proLauf: number; nachholMax: number; nachholErlaubt: boolean },
): { auswahl: T[]; nachhol: boolean; ueberfaellig: number } {
  const dringend = new Set<string>()
  for (const z of zeilen) {
    const log = logs.get(z.id)
    if (z.zellen.some((c) => c.konfiguriert && c.ueberfaellig && (log?.portale?.[c.portal]?.fehlerInFolge ?? 0) < 2)) dringend.add(z.id)
  }
  const stand = (l: T) => {
    const log = logs.get(l.id)
    const basis = ts(l.reviews_synced_at)
    return log && log.fehlLaeufe >= 2 ? Math.max(basis, ts(log.versuchAm)) : basis
  }
  const sortiert = [...listings].sort((a, b) => {
    const da = dringend.has(a.id) ? 0 : 1
    const db = dringend.has(b.id) ? 0 : 1
    return da - db || stand(a) - stand(b)
  })
  const offen = listings.filter((l) => dringend.has(l.id)).length
  const nachhol = opts.nachholErlaubt && offen > opts.proLauf
  const n = nachhol ? Math.min(opts.nachholMax, offen) : opts.proLauf
  return { auswahl: sortiert.slice(0, n), nachhol, ueberfaellig: offen }
}

/* ── Cron-Lebenszeichen ─────────────────────────────────── */

export interface CronState {
  at?: string               // letzter Cron-Durchlauf (täglich — Snapshot + Alarm)
  gescraptAm?: string       // letzter Montags-Abruf
  gescrapt?: string[]
  ausgelassen?: number      // gewählte Wohnungen, die nicht mehr ins Zeitbudget passten
  snapshotRows?: number
  alarm?: number            // Wohnungen im letzten Push
  nachholAm?: string        // einmaliger Nachhol-Lauf (bis zu 4 Wohnungen) wurde verbraucht
}

/** Lebenszeichen lesen. `lesbar: false` heißt: Zustand unbekannt → der Aufrufer bleibt im Normalbetrieb. */
export async function readCronState(): Promise<{ state: CronState; lesbar: boolean }> {
  try {
    const { data, error } = await supabaseAdmin.from('app_settings').select('value').eq('key', CRON_KEY).maybeSingle()
    if (error) return { state: {}, lesbar: false }
    return { state: (data?.value && typeof data.value === 'object' ? data.value : {}) as CronState, lesbar: true }
  } catch {
    return { state: {}, lesbar: false }
  }
}

export async function writeCronState(state: CronState): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from('app_settings').upsert({ key: CRON_KEY, value: state, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    if (error) console.error('[reviews-sync-log] Cron-Lebenszeichen:', error.message)
  } catch (e) {
    console.error('[reviews-sync-log] Cron-Lebenszeichen:', e)
  }
}

/* ── Alarm ──────────────────────────────────────────────── */

/**
 * Team-Push (Kategorie „system"), wenn eine hinterlegte Quelle seit über 6 Wochen keinen erfolgreichen
 * Abruf hatte. Höchstens 1× pro Woche je Wohnung; mehrere Wohnungen kommen in EINEM Push.
 * Der Merker wird VOR dem Senden geschrieben — scheitert das Lesen oder Schreiben, gibt es keinen Push
 * (sonst käme er täglich).
 */
export async function checkSyncAlerts(zeilen: StatusZeile[]): Promise<{ ueberfaellig: number; gemeldet: number }> {
  const betroffen = zeilen
    .map((z) => ({ z, portale: z.zellen.filter((c) => c.konfiguriert && c.ueberfaellig) }))
    .filter((x) => x.portale.length > 0)
  if (!betroffen.length) return { ueberfaellig: 0, gemeldet: 0 }

  const { data, error } = await supabaseAdmin.from('app_settings').select('value').eq('key', ALARM_KEY).maybeSingle()
  if (error) { console.error('[reviews-sync-log] Alarm-Merker lesen:', error.message); return { ueberfaellig: betroffen.length, gemeldet: 0 } }
  const merker = (data?.value && typeof data.value === 'object' ? data.value : {}) as Record<string, string>
  const now = Date.now()
  const faellig = betroffen.filter((x) => now - ts(merker[x.z.id]) >= ALARM_PAUSE_MS)
  if (!faellig.length) return { ueberfaellig: betroffen.length, gemeldet: 0 }

  // Merker zuerst (nur noch existierende Wohnungen behalten), dann senden
  const aktiv = new Set(zeilen.map((z) => z.id))
  const neu: Record<string, string> = {}
  for (const [id, at] of Object.entries(merker)) if (aktiv.has(id)) neu[id] = at
  const stamp = new Date(now).toISOString()
  for (const x of faellig) neu[x.z.id] = stamp
  const { error: wErr } = await supabaseAdmin
    .from('app_settings').upsert({ key: ALARM_KEY, value: neu, updated_at: stamp }, { onConflict: 'key' })
  if (wErr) { console.error('[reviews-sync-log] Alarm-Merker schreiben:', wErr.message); return { ueberfaellig: betroffen.length, gemeldet: 0 } }

  const teile = faellig.slice(0, 4).map((x) => `${x.z.title} (${x.portale.map((c) => c.name).join(', ')})`)
  const rest = faellig.length - teile.length
  const body = `Seit über 6 Wochen kein erfolgreicher Abruf: ${teile.join(' · ')}${rest > 0 ? ` und ${rest} weitere` : ''}. Details im Kalender → Belegung → ⭐ Bewertungs-Abruf.`
  await sendPushToTeam('⭐ Bewertungs-Abruf hängt', body, '/team?tab=kalender', { category: 'system' })
    .catch((e) => console.error('[reviews-sync-log] Alarm-Push:', e))
  return { ueberfaellig: betroffen.length, gemeldet: faellig.length }
}
