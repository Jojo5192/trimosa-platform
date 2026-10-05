/**
 * ⭐ Bewertungs-Abruf: reine Protokoll-Bausteine (§314) OHNE Seiteneffekte — kein Supabase, kein Push, nur ein
 * Typ-Import. So lässt sich die Fortschreibung des Protokolls ohne Env und Datenbank testen (wie
 * lib/fewo-reviews.ts). Lesen/Schreiben, Status, Rotation und Alarm stehen in lib/reviews-sync-log.ts.
 */
import type { SyncSourceResult, SyncErrorKind } from '@/lib/reviews-sync'

export const PORTALE = ['airbnb', 'booking', 'vrbo', 'google'] as const
export type Portal = (typeof PORTALE)[number]
export const PORTAL_NAME: Record<Portal, string> = { airbnb: 'Airbnb', booking: 'Booking', vrbo: 'FeWo-direkt', google: 'Google' }
/** Portale, die über einen Apify-Scraper laufen (Google hat zusätzlich die offizielle Places-API). */
export const SCRAPER: readonly Portal[] = ['airbnb', 'booking', 'vrbo']

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
  /** Nur nach einem Teil-Lauf gesetzt: Kopf-versuchAm des vollen Laufs, zu dem dieser Eintrag weiter als Erfolg
   *  zählt (Portal war dort ok und der Teil-Lauf auch) — sonst null. Ohne das Feld gilt versuchAm. */
  vollLauf?: string | null
}
export interface ListingSyncLog {
  v: 1
  /** letzter VOLLER Lauf (alle hinterlegten Quellen) — ein Teil-Lauf (nurQuelle) ändert das nicht. */
  versuchAm: string | null
  origin: 'cron' | 'manuell' | null
  /** Läufe in Folge, in denen KEINE hinterlegte Scraper-Quelle geklappt hat (steuert die Rotation). */
  fehlLaeufe: number
  portale: Partial<Record<Portal, PortalLog>>
  verlauf: { am: string; origin: string; kurz: string }[]
}

export interface QuellenRow {
  id: string
  airbnb_url: string | null
  booking_url: string | null
  vrbo_url: string | null
  google_place_id: string | null
}

export const isPortal = (s: string): s is Portal => (PORTALE as readonly string[]).includes(s)

export function zielVon(l: QuellenRow, p: Portal): string | null {
  const v = p === 'google' ? l.google_place_id : p === 'airbnb' ? l.airbnb_url : p === 'booking' ? l.booking_url : l.vrbo_url
  return v && v.trim() ? v.trim() : null
}

export function parseLog(value: unknown): ListingSyncLog {
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

/** Zu welchem vollen Lauf (Kopf-versuchAm) zählt dieser Portal-Eintrag? */
const laufVon = (pl: PortalLog): string | null => (pl.vollLauf !== undefined ? pl.vollLauf : pl.versuchAm)

/**
 * Grundlage der Sperrfrist: Hat der letzte VOLLE Lauf bei ALLEN hinterlegten Portalen vollständig geklappt
 * (und wurde seither keine Quelle geändert)? Ein Teil-Lauf erzeugt diesen Zustand nie; er erhält ihn nur,
 * wenn er selbst klappt — scheitert er, ist die Sperre aufgehoben (ein voller Abruf ist dann sinnvoll).
 */
export function istVollerErfolg(log: ListingSyncLog, listing: QuellenRow): boolean {
  if (!log.versuchAm) return false
  const hinterlegt = PORTALE.filter((p) => zielVon(listing, p))
  return hinterlegt.length > 0 && hinterlegt.every((p) => {
    const pl = log.portale[p]
    return !!pl && pl.status === 'ok' && laufVon(pl) === log.versuchAm && pl.ziel === zielVon(listing, p)
  })
}

/**
 * Schreibt das Ergebnis EINES Abrufs ins Protokoll fort (rein: altes Protokoll rein, neues raus).
 * Angefasst werden nur die Portale, die in `results` stehen — alle anderen Einträge bleiben, wie sie sind.
 *
 * `teil: true` = Teil-Lauf (nurQuelle, z. B. nur FeWo-direkt): die Kopf-Felder versuchAm, origin und
 * fehlLaeufe gehören dem letzten VOLLEN Lauf und bleiben unverändert. Damit zählt der Teil-Lauf weder für
 * die Sperrfrist als voller Erfolg (istVollerErfolg: der Eintrag trägt vollLauf = null, solange das Portal
 * im letzten vollen Lauf nicht ok war) noch verschiebt er die Montags-Rotation (planCronAuswahl liest
 * fehlLaeufe und versuchAm). Eine LAUFENDE Sperre bleibt bestehen, wenn der Teil-Lauf klappt (vollLauf =
 * Kopf-versuchAm), und fällt weg, wenn er scheitert. Der Verlauf bekommt einen gekennzeichneten Eintrag.
 */
export function naechstesSyncLog(
  alt: ListingSyncLog,
  listing: QuellenRow,
  results: SyncSourceResult[],
  origin: 'cron' | 'manuell',
  now: string,
  opts: { teil?: boolean } = {},
): ListingSyncLog {
  const portale: ListingSyncLog['portale'] = { ...alt.portale }
  const kurz: string[] = []
  const namen: string[] = []
  let scraperHinterlegt = 0
  let scraperOk = 0

  for (const r of results) {
    if (!isPortal(r.source)) continue
    const p = r.source
    namen.push(PORTAL_NAME[p])
    const ziel = zielVon(listing, p)
    if (!ziel) { delete portale[p]; continue } // nicht (mehr) hinterlegt
    const vorher = portale[p]
    const istScraper = SCRAPER.includes(p)
    if (istScraper) scraperHinterlegt++
    // Teil-Lauf: zählte der bisherige Eintrag als Erfolg des letzten vollen Laufs, bleibt das bei eigenem Erfolg so
    const warVollOk = !!alt.versuchAm && vorher?.status === 'ok' && laufVon(vorher) === alt.versuchAm && vorher.ziel === ziel
    const marke = (voll: boolean) => (opts.teil ? { vollLauf: voll && warVollOk ? alt.versuchAm : null } : {})
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
        ...marke(voll),
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
        ...marke(false),
      }
      kurz.push(`${PORTAL_NAME[p]} FEHLER (${r.errorKind ?? 'sonst'})`)
    }
  }

  const text = kurz.join(' · ') || 'keine Quelle hinterlegt'
  const eintrag = { am: now, origin, kurz: opts.teil ? `nur ${namen.join(', ') || 'Teil-Lauf'}: ${text}` : text }
  return {
    v: 1,
    versuchAm: opts.teil ? alt.versuchAm : now,
    origin: opts.teil ? alt.origin : origin,
    fehlLaeufe: opts.teil ? alt.fehlLaeufe : scraperHinterlegt > 0 && scraperOk === 0 ? alt.fehlLaeufe + 1 : 0,
    portale,
    verlauf: [eintrag, ...alt.verlauf].slice(0, 10),
  }
}
