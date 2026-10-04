/**
 * 🧹 Reinigungsstart (1.10.): gemeinsame Auflösung für Heute-Karte, NFC-Fertigmeldung und
 * Dauer-Backfill — mit GEDÄCHTNIS.
 *
 * Ein erkannter Start wird je Wohnung + Tag in einem EIGENEN app_settings-Schlüssel
 * (`cleaning_start:<listingId>|<tag>`) gemerkt und danach nicht mehr live im Schloss-
 * Protokoll gesucht. So kann ein späterer Nuki-Fehler/Timeout oder ein volles Protokoll
 * den Start nicht wieder „vergessen" (Fälle City Home 11.9. / Panorama Home 13.9.).
 * Eigener Schlüssel je Eintrag = kein Lesen-Ändern-Schreiben an einem Sammel-Objekt,
 * parallele Heute-Abrufe überschreiben sich nicht. Keine Migration nötig (app_settings besteht).
 *
 * Die Erkennungs-Regel selbst steht in lib/locks.ts (detectCleaningStart).
 */
import { supabaseAdmin } from '@/lib/supabase-admin'
import { detectCleaningStart, getLockOpenLog, type CleaningStart, type LockOpenLogEntry, type LockRef } from '@/lib/locks'

const KEY_PREFIX = 'cleaning_start:'
/** Erst merken, wenn die Öffnung so alt ist — vorher kann der abreisende Gast seinen Code
 *  noch einmal benutzen (dann zählt erst die NÄCHSTE Team-Öffnung). Bis dahin wird live geprüft.
 *  Am Abreisetag wird zusätzlich erst ab der Check-out-Zeit gemerkt (bis dahin ist der Gast
 *  regulär im Haus). Ein trotzdem falsch gemerkter Start lässt sich nur von Hand löschen:
 *  app_settings-Zeile `cleaning_start:<listingId>|<tag>`. */
const SETTLE_MS = 15 * 60_000
/** Gemerkte Starts älter als so viele Tage werden beim nächsten Merken entfernt. */
const KEEP_DAYS = 60

type StoredStart = { at: string; who: string | null; lockId: string | null; day: string; savedAt: string }

export function cleaningStartKey(listingId: string, day: string): string {
  return `${KEY_PREFIX}${listingId}|${day}`
}

/** Gemerkte Starts der Wohnungen an diesem Tag (Map listingId → Start). Fail-soft: leere Map. */
export async function loadCleaningStarts(listingIds: string[], day: string): Promise<Map<string, CleaningStart>> {
  const out = new Map<string, CleaningStart>()
  if (!listingIds.length) return out
  try {
    const { data, error } = await supabaseAdmin
      .from('app_settings').select('key, value')
      .in('key', listingIds.map((id) => cleaningStartKey(id, day)))
    if (error) { console.error('[cleaning-start] Gemerkte Starts nicht lesbar:', error.message); return out }
    for (const r of (data ?? []) as { key: string; value: Partial<StoredStart> | null }[]) {
      const v = r.value
      if (!v?.at || Number.isNaN(Date.parse(v.at))) continue
      const listingId = r.key.slice(KEY_PREFIX.length).split('|')[0]
      out.set(listingId, { status: 'found', at: v.at, who: v.who ?? null, lockId: v.lockId ?? null })
    }
  } catch (e) {
    console.error('[cleaning-start] Gemerkte Starts nicht lesbar:', e)
  }
  return out
}

/** Start merken (eigener Schlüssel, upsert) + alte Einträge aufräumen. Wirft nie. */
async function rememberCleaningStart(listingId: string, day: string, s: CleaningStart): Promise<void> {
  if (!s.at) return
  try {
    const value: StoredStart = { at: s.at, who: s.who, lockId: s.lockId, day, savedAt: new Date().toISOString() }
    const { error } = await supabaseAdmin.from('app_settings').upsert({ key: cleaningStartKey(listingId, day), value }, { onConflict: 'key' })
    if (error) { console.error('[cleaning-start] Merken fehlgeschlagen:', error.message); return }
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10)
    const { error: delErr } = await supabaseAdmin.from('app_settings').delete().like('key', `${KEY_PREFIX}%`).lt('value->>day', cutoff)
    if (delErr) console.error('[cleaning-start] Aufräumen fehlgeschlagen:', delErr.message)
  } catch (e) {
    console.error('[cleaning-start] Merken fehlgeschlagen:', e)
  }
}

const lockKey = (l: LockRef) => `${l.provider}:${l.id}`

/** Schlösser, die an MEHR ALS EINER Wohnung hängen (z. B. die Haustür Sirzenich). */
export function sharedLockKeys(all: { locks: LockRef[] | null }[]): Set<string> {
  const count = new Map<string, number>()
  for (const l of all) {
    for (const k of new Set((Array.isArray(l.locks) ? l.locks : []).map(lockKey))) count.set(k, (count.get(k) ?? 0) + 1)
  }
  return new Set([...count].filter(([, n]) => n >= 2).map(([k]) => k))
}

/** Die Schlösser, die für den Reinigungsstart DIESER Wohnung zählen: ihre eigenen.
 *  Geteilte Schlösser zählen nur, wenn die Wohnung gar kein eigenes Schloss hat. */
export function ownLocks(locks: LockRef[] | null, shared: Set<string>): LockRef[] {
  const all = Array.isArray(locks) ? locks : []
  const own = all.filter((l) => !shared.has(lockKey(l)))
  return own.length ? own : all
}

const UNKNOWN: CleaningStart = { status: 'unknown', at: null, who: null, lockId: null }

/** Ist die Check-out-Zeit (HH:MM) am Berlin-Tag `day` schon erreicht? Vergangene Tage: ja. */
function checkOutPassed(day: string, checkOutHm: string): boolean {
  const now = new Date()
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(now)
  if (day !== today) return day < today
  const hm = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
  return hm >= checkOutHm
}

/**
 * Reinigungsstart einer Wohnung an einem Tag: (1) gemerkter Start, sonst (2) live aus dem
 * Schloss-Protokoll. `stored`/`shared`/`remoteOpens` kann der Aufrufer vorab laden (Heute:
 * einmal für alle Wohnungen), sonst lädt die Funktion selbst. status 'unknown' = nicht
 * prüfbar (Fehler stehen im Server-Log) — NIE als „noch nicht begonnen" anzeigen.
 */
export async function resolveCleaningStart(i: {
  listingId: string
  locks: LockRef[] | null
  /** Berlin-Tag der Reinigung */
  day: string
  /** Buchung, die an diesem Tag abreist (ihr Türcode heißt „TRIMOSA <id8>") */
  departingBookingId?: string | null
  /** Check-out-Zeit der Wohnung (HH:MM[:SS]) — NUR übergeben, wenn `day` ein ABREISETAG ist.
   *  Wirkung: tedee-Ereignisse ohne PIN zählen erst ab dann (der Gast erzeugt sie beim Gehen
   *  selbst), und der Start wird nicht vor dieser Uhrzeit dauerhaft gemerkt. */
  checkOutHm?: string | null
  stored?: Map<string, CleaningStart>
  shared?: Set<string>
  remoteOpens?: LockOpenLogEntry[]
  /** Gesamtbudget fürs Schloss-Protokoll (Default 6 s) */
  budgetMs?: number
  /** false = gefundenen Start nicht merken (NFC-Meldung/Backfill schreiben started_at ohnehin fest) */
  persist?: boolean
}): Promise<CleaningStart> {
  const budget = i.budgetMs ?? 6000
  const checkOutHm = /^\d{2}:\d{2}/.test(i.checkOutHm ?? '') ? (i.checkOutHm as string).slice(0, 5) : null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const known = (i.stored ?? await loadCleaningStarts([i.listingId], i.day)).get(i.listingId)
    if (known) return known

    let shared = i.shared
    if (!shared) {
      const { data } = await supabaseAdmin.from('listings').select('id, locks')
      shared = sharedLockKeys((data ?? []) as { locks: LockRef[] | null }[])
    }
    // Eigene Fern-Öffnungen dieser Wohnung (Team-App) — die zählen nie als Reinigungsstart
    const remoteOpenAt = (i.remoteOpens ?? await getLockOpenLog())
      .filter((e) => e.ok && e.listingId === i.listingId)
      .map((e) => Date.parse(e.at)).filter(Number.isFinite)

    const live = detectCleaningStart(ownLocks(i.locks, shared), {
      day: i.day,
      departingAlias: i.departingBookingId ? `TRIMOSA ${i.departingBookingId.slice(0, 8)}` : null,
      budgetMs: budget,
      remoteOpenAt,
      tedeeAnonEarliestHm: checkOutHm,
    })
    const r = await Promise.race([
      live,
      new Promise<null>((res) => { timer = setTimeout(() => res(null), budget + 500) }),
    ])
    if (!r) {
      console.error('[cleaning-start] Zeitbudget überschritten · Wohnung', i.listingId, '· Tag', i.day)
      return UNKNOWN
    }
    // Merken nur, wenn der Treffer belastbar ist: Protokoll vollständig gelesen (sonst kann eine
    // frühere Öffnung fehlen), alt genug und — am Abreisetag — die Check-out-Zeit ist erreicht
    if (r.status === 'found' && r.at && i.persist !== false && r.complete !== false
      && Date.now() - Date.parse(r.at) >= SETTLE_MS
      && (!checkOutHm || checkOutPassed(i.day, checkOutHm))) {
      await rememberCleaningStart(i.listingId, i.day, r)
    }
    return r
  } catch (e) {
    console.error('[cleaning-start] Prüfung fehlgeschlagen · Wohnung', i.listingId, e)
    return UNKNOWN
  } finally {
    if (timer) clearTimeout(timer)
  }
}
