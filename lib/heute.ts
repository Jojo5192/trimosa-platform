/**
 * 🏠 §277 Heute-Bildschirm der Team-App (Pascals JUPAS-Referenz):
 * Datenaufbereitung für GET /api/heute — eigener Türcode, An-/Abreisen des
 * Tages mit Reinigungs-/Check-in-Stand (nur heute), Abreisen (mit Chat-
 * Abmeldung „ausgecheckt HH:MM (laut Gast)", lib/checkout-detect.ts), Vorschau auf
 * den Folgetag. Aufgaben + „Warten auf Antwort" holt der Client aus den
 * vorhandenen APIs (/api/tasks, /api/chat/inbox) — keine doppelte Logik.
 * Sichtbarkeit wie der Kalender (§111/§112): Admin alles, sonst
 * calendar_visibility, Dienstleister nur eigene Reinigungs-Wohnungen und
 * NIE Gastnamen. Server-Cache 2 Min je Nutzer+Tag.
 */
import { supabaseAdmin } from '@/lib/supabase-admin'
import { earlyCheckinBlock, pickEarlyTemplate, EARLY_LOG_CLAIM } from '@/lib/early-checkin'
import { getStaffCodes, getLockOpenLog, firstGuestOpenAt, type CleaningStart, type LockRef } from '@/lib/locks'
import { loadCleaningStarts, resolveCleaningStart, sharedLockKeys } from '@/lib/cleaning-start'
import type { TaskAuth } from '@/lib/tasks'
import { loadStayIndex } from '@/lib/stammgaeste'
import { loadCheckoutStates, detectChatCheckouts, type CheckoutEntry } from '@/lib/checkout-detect'

const TZ = 'Europe/Berlin'
export function berlinToday(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date())
}
export function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function berlinDay(iso: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date(iso))
}
/** „10:05" — auf 5 Minuten gerundet; „gestern 23:55" wenn nicht am Stichtag */
function hm5(iso: string, tag: string): string {
  const parts = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
  let [h, m] = parts.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return ''
  m = Math.round(m / 5) * 5
  if (m === 60) { m = 0; h = h + 1 }
  if (h >= 24) h -= 24
  const hm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  const day = berlinDay(iso)
  if (day === tag) return hm
  if (day === addDays(tag, -1)) return `gestern ${hm}`
  return `${day.slice(8, 10)}.${day.slice(5, 7)}. ${hm}`
}
/** „10:07" — minutengenau (Vier-Schritte-Leiste); '' bei ungültigem Zeitstempel */
function hmExakt(iso: string): string {
  if (Number.isNaN(Date.parse(iso))) return ''
  return new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}
/** Kurzanzeige unter dem Schritt: am Stichtag „10:07", sonst „gestern" bzw. „28.09." (passt in eine Spalte bei 375 px) */
function zeitKurz(iso: string, tag: string): string | null {
  const hm = hmExakt(iso)
  if (!hm) return null
  const day = berlinDay(iso)
  if (day === tag) return hm
  if (day === addDays(tag, -1)) return 'gestern'
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.`
}
/** Langform für den Detailtext: „10:07" · „gestern 17:42" · „28.09. 17:42" */
function zeitLang(iso: string, tag: string): string {
  const hm = hmExakt(iso)
  if (!hm) return ''
  const day = berlinDay(iso)
  if (day === tag) return `${hm} Uhr`
  if (day === addDays(tag, -1)) return `gestern ${hm} Uhr`
  return `${day.slice(8, 10)}.${day.slice(5, 7)}. ${hm} Uhr`
}
/** Kanal aus auto_message_log.channel als feste Beschriftung — nie den Rohtext an den Client.
 *  Reihenfolge wichtig: 'email (smoobu-fehler)' ist eine E-Mail. */
function kanalLabel(channel: string): string {
  const c = channel.toLowerCase()
  const wie = c.includes('chat+email') ? 'Chat + E-Mail'
    : c.includes('email') ? 'E-Mail'
    : c.includes('smoobu') ? 'Portal-Nachricht'
    : c.startsWith('chat') ? 'nur Chat, keine E-Mail'
    : 'gesendet'
  return c.startsWith('manuell') ? `${wie} · von Hand` : wie
}
/** „16 Uhr" / „15:30 Uhr" */
function uhr(t: string | null | undefined, fallback = '16:00'): string {
  const v = (t ?? fallback).slice(0, 5)
  return v.endsWith(':00') ? `${Number(v.slice(0, 2))} Uhr` : `${v} Uhr`
}

/** Kanal-Normalisierung — §140/§262-Substring-Falle: fewo VOR direkt VOR booking */
export function portalOf(channel: string | null | undefined, source?: string | null): string {
  const v = (channel ?? '').toLowerCase()
  if (/fewo|homeaway|vrbo|abritel/.test(v)) return 'FeWo-direkt'
  if (source === 'trimosa' || /website|trimosa/.test(v)) return 'Website'
  if (/direct|direkt/.test(v)) return 'Direkt'
  if (/airbnb/.test(v)) return 'Airbnb'
  if (/booking/.test(v)) return 'Booking.com'
  if (/hometogo/.test(v)) return 'HomeToGo'
  return channel?.trim() || 'Direkt'
}

export interface HeuteStay {
  bookingId: string
  listingId: string
  listingTitle: string
  /** null für Dienstleister (datensparsam) */
  guestName: string | null
  checkIn: string
  checkOut: string
  persons: number | null
  platform: string
  /** Paragraph 308: Check-in-/Check-out-Zeit der Wohnung (fuer Reinigung/Handwerker) */
  checkInTime: string
  checkOutTime: string
  /** §290 Stammgast: Aufenthalte gesamt (≥ 2 = Wiederkehrer) + laufende Nummer */
  stays?: number
  stayNr?: number
  /** Check-out-Erkennung (nur Abreisen des angezeigten Tags): der Gast hat seine Abreise im Chat gemeldet.
   *  at = Sendezeitpunkt dieser Nachricht (ISO). Nur die Uhrzeit, keine Gastdaten — fehlt in alten Snapshots. */
  checkout?: { at: string; quelle: 'chat' } | null
}
/** Vier-Schritte-Leiste (1.10., Pascal 17.9.): erledigt = grün · aktiv = gelb · offen = grau · fehler = rot */
export type SchrittStatus = 'erledigt' | 'aktiv' | 'offen' | 'fehler'
export interface HeuteSchritt {
  key: 'begonnen' | 'fertig' | 'informiert' | 'eingecheckt'
  status: SchrittStatus
  /** ISO-Zeitpunkt des Schritts, wenn bekannt */
  at: string | null
  /** fertige Kurzanzeige unter dem Symbol: „10:07" · „gestern" · „~12:30" · „frei" · „gesperrt" · „ab 16:00"; null = „–" */
  zeit: string | null
  /** Detailtext (aufgeklappte Leiste) — ohne Gastdaten */
  text: string
}
export interface HeuteProzess {
  /** immer genau vier: begonnen · fertig · informiert · eingecheckt */
  schritte: HeuteSchritt[]
  /** Textzeilen unter der Leiste — nur Auffälliges (z. B. „Meldung nicht zugestellt") */
  hinweise: { ton: 'red' | 'yellow' | 'grey'; text: string }[]
  /** Knopf „Gast jetzt informieren" — nur Admin/Gastgeber, Schritt 3 offen, nicht gesperrt, vor der Check-in-Zeit.
   *  Reine Freischaltung des Knopfs: gesendet wird NUR per Tipp (POST /api/heute/inform), nie automatisch. */
  kannInformieren: boolean
  /** Warnung für den Bestätigungsdialog (Reinigung nicht als fertig gemeldet) */
  warnung: string | null
}
export interface HeuteAnreise extends HeuteStay {
  /** ✉ Anreise-Infos (Auto-Nachricht) sind raus */
  infosRaus: boolean
  /** 🔑 Türcode liegt bereit */
  codeDa: boolean
  /** ✓ „Wohnung ist fertig" an den Gast gemeldet */
  fertig: 'ja' | 'nein' | 'gesperrt' | 'fehler'
  /** nur am HEUTIGEN Tag befüllt */
  reinigung: { status: 'fertig' | 'laeuft' | 'frei' | 'offen' | 'unklar'; text: string } | null
  checkin: { status: 'green' | 'yellow' | 'red' | 'grey'; text: string } | null
  /** Paragraph 308: erste Tuer-Oeffnung mit Gast-Code heute (ISO) = eingecheckt, Wohnung belegt */
  eingecheckt: string | null
  /** Paragraph 309: Early-Check-in gesperrt (Grund) - dann keine Frueh-Check-in-Nachricht */
  earlyBlock: string | null
  /** Vier-Schritte-Leiste — nur am HEUTIGEN Tag; fehlt in alten Snapshots/Offline-Antworten (dann alte Punkte) */
  prozess?: HeuteProzess | null
}
export interface HeuteDaten {
  tag: string
  heute: string
  stand: string
  firstName: string | null
  /** Pascal 9.9. (Chefsache): Rolle hinter dem Namen auf der Türcode-Karte — CEO · Reinigung · Handwerker · Team */
  roleLabel: string | null
  /** Paragraph 308: Rollen-Ansicht - Reinigungs-Dienstleister / Handwerker / alles */
  heuteView: 'full' | 'cleaning' | 'provider'
  doorCode: { code: string; listings: string[] } | null
  anreisen: HeuteAnreise[]
  abreisen: HeuteStay[]
  vorschau: { tag: string; anreisen: HeuteStay[]; abreisen: HeuteStay[] }
}

type ListingRow = {
  id: string; title: string; check_in_time: string | null; check_out_time: string | null
  cleaning_minutes: number | null; locks: LockRef[] | null; cleaning_responsible: string | null
}
type BookingRow = {
  id: string; listing_id: string; check_in: string; check_out: string; guest_name: string | null; guest_id: string | null
  channel: string | null; source: string | null; payment_status: string | null
  adults: number | null; children: number | null; door_code: string | null
}

const cache = (globalThis as unknown as { __heuteCache?: Map<string, { at: number; data: HeuteDaten }> })
cache.__heuteCache ??= new Map()
const TTL_MS = 120_000
/** Nach einem manuellen Versand (POST /api/heute/inform): Server-Cache leeren. Wirkt nur in DIESER
 *  Server-Instanz — der Client lädt danach zusätzlich mit fresh=1. */
export function invalidateHeuteCache(): void {
  cache.__heuteCache!.clear()
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))])
}

export async function buildHeute(auth: TaskAuth, tag: string, fresh = false): Promise<HeuteDaten> {
  const key = `${auth.userId}:${tag}`
  const hit = cache.__heuteCache!.get(key)
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.data

  const heute = berlinToday()
  const istHeute = tag === heute
  const tag1 = addDays(tag, 1)

  const [listingsRes, meRes] = await Promise.all([
    supabaseAdmin.from('listings').select('id, title, check_in_time, check_out_time, cleaning_minutes, locks, cleaning_responsible'),
    supabaseAdmin.from('profiles').select('display_name').eq('id', auth.userId).maybeSingle(),
  ])
  const listings = (listingsRes.data ?? []) as ListingRow[]
  const byId = new Map(listings.map((l) => [l.id, l]))
  const firstName = (meRes.data?.display_name ?? '').trim().split(/\s+/)[0] || null
  // Rolle für die Türcode-Karte (Pascal 9.9.): Admin/Gastgeber = CEO; wer für Reinigung
  // verantwortlich ist = Reinigung; sonstige Dienstleister = Handwerker; sonstige Mitarbeiter = Team
  const cleans = listings.some((l) => l.cleaning_responsible === auth.userId)
  const roleLabel = auth.role === 'admin' ? 'CEO' : cleans ? 'Reinigung' : auth.role === 'provider' ? 'Handwerker' : 'Team'

  /* Sichtbarkeit — höchste Rolle gewinnt (wie /api/team/calendar) */
  let visible: Set<string> | null = null
  if (auth.role !== 'admin') {
    try {
      const { data: setting } = await supabaseAdmin.from('app_settings').select('value').eq('key', 'calendar_visibility').maybeSingle()
      const mine = ((setting?.value ?? {}) as Record<string, string[]>)[auth.userId]
      if (Array.isArray(mine) && mine.length) visible = new Set(mine)
    } catch { /* keine Einschränkung */ }
    if (!visible && auth.role === 'provider') {
      const owned = listings.filter((l) => l.cleaning_responsible === auth.userId).map((l) => l.id)
      if (owned.length) visible = new Set(owned)
    }
  }
  const sichtbar = (b: { listing_id: string; source: string | null; payment_status: string | null }) =>
    (b.source !== 'trimosa' || b.payment_status === 'paid') && (!visible || visible.has(b.listing_id))

  /* An-/Abreisen des Tages + Folgetag */
  const { data: bks } = await supabaseAdmin
    .from('bookings')
    .select('id, listing_id, check_in, check_out, guest_name, guest_id, channel, source, payment_status, adults, children, door_code')
    .eq('status', 'confirmed')
    .or(`check_in.eq.${tag},check_in.eq.${tag1},check_out.eq.${tag},check_out.eq.${tag1}`)
  const rows = ((bks ?? []) as BookingRow[]).filter(sichtbar)
  // Website-Gäste tragen den Namen im PROFIL, nicht auf der Buchung (wie die Inbox)
  const nameByGuest = new Map<string, string>()
  const guestIds = [...new Set(rows.filter((b) => !b.guest_name && b.guest_id).map((b) => b.guest_id as string))]
  if (guestIds.length) {
    const { data: gp } = await supabaseAdmin.from('profiles').select('id, display_name, guest_first_name, guest_last_name, company_name').in('id', guestIds)
    for (const p of (gp ?? []) as { id: string; display_name: string | null; guest_first_name: string | null; guest_last_name: string | null; company_name: string | null }[]) {
      const n = (p.display_name ?? '').trim() || [p.guest_first_name, p.guest_last_name].filter(Boolean).join(' ').trim() || (p.company_name ?? '').trim()
      if (n) nameByGuest.set(p.id, n)
    }
  }
  const stayIdx = await loadStayIndex().catch(() => null)
  const toStay = (b: BookingRow): HeuteStay => ({
    bookingId: b.id,
    stays: stayIdx?.byBooking.get(b.id)?.stays ?? 1,
    stayNr: stayIdx?.byBooking.get(b.id)?.nr ?? 1,
    listingId: b.listing_id,
    listingTitle: byId.get(b.listing_id)?.title ?? 'Wohnung',
    guestName: auth.role === 'provider' ? null : (b.guest_name ?? (b.guest_id ? nameByGuest.get(b.guest_id) ?? null : null) ?? 'Gast'),
    checkIn: b.check_in,
    checkOut: b.check_out,
    persons: ((b.adults ?? 0) + (b.children ?? 0)) || null,
    platform: portalOf(b.channel, b.source),
    checkInTime: (byId.get(b.listing_id)?.check_in_time ?? '16:00').slice(0, 5),
    checkOutTime: (byId.get(b.listing_id)?.check_out_time ?? '10:00').slice(0, 5),
  })
  const byTitle = (a: HeuteStay, b: HeuteStay) => a.listingTitle.localeCompare(b.listingTitle, 'de')
  const arrivals = rows.filter((b) => b.check_in === tag)
  // 👋 Check-out-Erkennung (lib/checkout-detect.ts): „Gast hat sich im Chat abgemeldet" je Abreise.
  // Wird hier nur GESTARTET (läuft parallel zu den Anreise-Abfragen) und unten abgeholt. Klassifiziert
  // wird ausschließlich am heutigen Tag, hart auf 4 s begrenzt; andere Tage zeigen nur den gemerkten
  // Stand. Fail-soft: ohne Ergebnis bleibt es bei „bis HH:MM".
  const departures = rows.filter((b) => b.check_out === tag)
  const coPromise: Promise<Map<string, CheckoutEntry>> = (async () => {
    if (!departures.length || tag > heute) return new Map<string, CheckoutEntry>()
    const ids = departures.map((b) => b.id)
    const stored = await loadCheckoutStates(ids)
    if (!istHeute) return stored
    return withTimeout(detectChatCheckouts(ids, tag, stored).catch(() => stored), 4000, stored)
  })().catch(() => new Map<string, CheckoutEntry>())
  const vorschau = {
    tag: tag1,
    anreisen: rows.filter((b) => b.check_in === tag1).map(toStay).sort(byTitle),
    abreisen: rows.filter((b) => b.check_out === tag1).map(toStay).sort(byTitle),
  }

  /* Status-Signale je Anreise */
  const arrivalIds = arrivals.map((b) => b.id)
  const listingIds = [...new Set(arrivals.map((b) => b.listing_id))]
  type Tpl = { id: string; trigger_type: string; enabled: boolean; sort?: number | null; send_hour?: number | null; listing_id?: string | null; listing_ids?: string[] | null }
  type Log = { booking_id: string; auto_message_id: string; sent_at: string; channel: string | null }
  type Prev = { id: string; listing_id: string; check_out: string; source: string | null; payment_status: string | null }
  type Conf = { listing_id: string; slot_date: string; confirmed_at: string; started_at: string | null; duration_min: number | null }
  let templates: Tpl[] = []
  let logs: Log[] = []
  let prevs: Prev[] = []
  let confs: Conf[] = []
  if (arrivalIds.length) {
    const [t, l, p, c] = await Promise.all([
      // select('*'): Wohnungs-Chips (listing_ids) + sort für die Vorlagen-Auswahl der Leiste — robust vor/nach Migrationen
      supabaseAdmin.from('auto_messages').select('*'),
      supabaseAdmin.from('auto_message_log').select('booking_id, auto_message_id, sent_at, channel').in('booking_id', arrivalIds),
      istHeute
        ? supabaseAdmin.from('bookings').select('id, listing_id, check_out, source, payment_status')
          .eq('status', 'confirmed').in('listing_id', listingIds)
          .lte('check_out', tag).gte('check_out', addDays(tag, -14))
          .order('check_out', { ascending: false }).limit(200)
        : Promise.resolve({ data: [] as Prev[] }),
      istHeute
        ? supabaseAdmin.from('cleaning_confirmations').select('listing_id, slot_date, confirmed_at, started_at, duration_min')
          .in('listing_id', listingIds).gte('slot_date', addDays(tag, -14)).lte('slot_date', tag)
        : Promise.resolve({ data: [] as Conf[] }),
    ])
    templates = (t.data ?? []) as Tpl[]
    logs = (l.data ?? []) as Log[]
    prevs = ((p.data ?? []) as Prev[]).filter((b) => b.source !== 'trimosa' || b.payment_status === 'paid')
    confs = (c.data ?? []) as Conf[]
  }
  const reinigungTpl = templates.filter((t) => t.trigger_type === 'reinigung_fertig').sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
  const reinigungIds = new Set(reinigungTpl.map((t) => t.id))
  const infoIds = new Set(templates.filter((t) => ['nach_buchung', 'vor_anreise', 'anreisetag'].includes(t.trigger_type)).map((t) => t.id))
  const okLog = (x: Log) => !!x.channel && !x.channel.startsWith('fehler') && x.channel !== 'sendet…'

  // Vier-Schritte-Leiste: 🚦-Master-Schalter + Stummschalter je Buchung (eigene Abfrage, deploy-sicher:
  // fehlt die Spalte msg_mute noch, gibt es schlicht keine Stummschaltung)
  let autoOn = false
  const muteMap = new Map<string, string>()
  if (istHeute && arrivalIds.length) {
    try {
      const [sw, mu] = await Promise.all([
        supabaseAdmin.from('app_settings').select('value').eq('key', 'auto_messages').maybeSingle(),
        supabaseAdmin.from('bookings').select('id, msg_mute').in('id', arrivalIds).not('msg_mute', 'is', null),
      ])
      autoOn = (sw.data?.value as { sendEnabled?: boolean } | null)?.sendEnabled === true
      if (!mu.error) for (const r of (mu.data ?? []) as { id: string; msg_mute: string | null }[]) if (r.msg_mute) muteMap.set(String(r.id), String(r.msg_mute))
    } catch { /* fail-soft: Knopf bleibt aus */ }
  }

  // Wechseltag-Reinigungen ohne Meldung — Reinigungsstart (1.10.): erst der GEMERKTE Start
  // (app_settings `cleaning_start:<Wohnung>|<Tag>`), sonst LIVE ins Schloss-Protokoll
  // (parallel, je Wohnung max. 6 s). Regel: erste Team-Öffnung ab 06:00 (Keypad-Code/App,
  // kein Gast-Code, nicht von innen, keine Fern-Öffnung) nach der letzten Code-Nutzung der
  // ABREISENDEN Buchung; geteilte Haustüren zählen nur ohne eigenes Schloss.
  // „Nicht prüfbar" (status unknown) ist NICHT „noch nicht begonnen" — siehe Anzeige unten.
  const lockOpen = new Map<string, CleaningStart>()
  if (istHeute) {
    const wechselOhneMeldung = listingIds
      .map((lid) => ({ lid, prev: prevs.find((p) => p.listing_id === lid) }))
      .filter((x) => !!x.prev && x.prev.check_out === tag && !confs.some((c) => c.listing_id === x.lid && c.slot_date === tag))
    if (wechselOhneMeldung.length) {
      const stored = await loadCleaningStarts(wechselOhneMeldung.map((x) => x.lid), tag)
      const live = wechselOhneMeldung.some((x) => !stored.has(x.lid))
      const shared = sharedLockKeys(listings)
      const remoteOpens = live ? await getLockOpenLog() : []
      await Promise.all(wechselOhneMeldung.map(async ({ lid, prev }) => {
        lockOpen.set(lid, await resolveCleaningStart({
          listingId: lid, locks: byId.get(lid)?.locks ?? [], day: tag,
          departingBookingId: prev?.id ?? null, checkOutHm: byId.get(lid)?.check_out_time ?? '10:00',
          stored, shared, remoteOpens, budgetMs: 6000,
        }))
      }))
    }
  }

  // Paragraph 308: „eingecheckt" = erste Oeffnung mit Gast-Code heute ab 10:00 (Schlossprotokoll, je Wohnung max. 6 s)
  const guestOpen = new Map<string, string | null>()
  // Paragraph 309: Early-Check-in-Sperre je Anreise (manuell oder Arbeiten eingeplant)
  const earlyBlk = new Map<string, string | null>()
  await Promise.all(arrivals.map(async (b) => {
    const r = await earlyCheckinBlock({ id: b.id, listing_id: b.listing_id, check_in: b.check_in }).catch(() => ({ blocked: false, reason: null }))
    earlyBlk.set(b.id, r.blocked ? r.reason ?? 'gesperrt' : null)
  }))
  if (istHeute) {
    await Promise.all(arrivals.filter((b) => b.door_code).map(async (b) => {
      const l = byId.get(b.listing_id)
      // nur der Code DIESER Buchung zählt (nicht der abreisende Gast, nicht fremde Gäste an geteilten Türen)
      const iso = await withTimeout(firstGuestOpenAt(l?.locks ?? [], '10:00', tag, `TRIMOSA ${b.id.slice(0, 8)}`).catch(() => null), 6000, null)
      guestOpen.set(b.listing_id, iso)
    }))
  }

  const anreisen: HeuteAnreise[] = arrivals.map((b) => {
    const base = toStay(b)
    const l = byId.get(b.listing_id)
    const myLogs = logs.filter((x) => x.booking_id === b.id)
    const rLog = myLogs.find((x) => reinigungIds.has(x.auto_message_id))
    const infosRaus = myLogs.some((x) => infoIds.has(x.auto_message_id) && okLog(x))
    const gesperrt = reinigungTpl.length > 0 && reinigungTpl.every((t) => !t.enabled)
    const fertig: HeuteAnreise['fertig'] = rLog ? (okLog(rLog) ? 'ja' : 'fehler') : gesperrt ? 'gesperrt' : 'nein'

    let reinigung: HeuteAnreise['reinigung'] = null
    let checkin: HeuteAnreise['checkin'] = null
    let prozess: HeuteProzess | null = null
    if (istHeute) {
      const prev = prevs.find((p) => p.listing_id === b.listing_id && p.id !== b.id)
      const wechsel = !!prev && prev.check_out === tag
      const conf = prev ? confs.find((c) => c.listing_id === b.listing_id && c.slot_date === prev.check_out) : undefined
      const minutes = l?.cleaning_minutes ?? 120
      if (!prev) {
        reinigung = { status: 'frei', text: 'Wohnung war frei · sauber' }
      } else if (conf) {
        const start = conf.started_at ? hm5(conf.started_at, tag) : null
        const done = hm5(conf.confirmed_at, tag)
        reinigung = wechsel
          ? { status: 'fertig', text: start ? `Start ${start} · fertig ${done}` : `fertig ${done} gemeldet` }
          : { status: 'frei', text: `Wohnung war frei · sauber (${done} gemeldet)` }
      } else if (wechsel) {
        const open = lockOpen.get(b.listing_id)
        if (open?.status === 'found' && open.at) {
          const etaMs = Date.parse(open.at) + (minutes + 30) * 60_000
          // Wer geöffnet hat (Code-Name) — nur fürs Team, Dienstleister sehen ihn nicht
          const name = (open.who ?? '').replace(/^TRIMOSA-Team\s*/i, '').trim()
          const wer = auth.role !== 'provider' && name && !/^zutrittscode$/i.test(name) ? ` (${name})` : ''
          // Start erkannt, aber über eine Stunde über der erwarteten Dauer ohne Fertigmeldung → nicht mehr „läuft"
          reinigung = Date.now() > etaMs + 60 * 60_000
            ? { status: 'unklar', text: `begonnen ${hm5(open.at, tag)}${wer} · keine Fertigmeldung` }
            : { status: 'laeuft', text: `läuft seit ${hm5(open.at, tag)}${wer} · fertig ~${hm5(new Date(etaMs).toISOString(), tag)}` }
        } else if (open?.status === 'unknown') {
          // nicht prüfbar (Nuki-Fehler/Timeout) — bewusst der vorhandene Status „unklar" (gelb), kein neuer Wert
          reinigung = { status: 'unklar', text: 'Schloss-Protokoll nicht lesbar' }
        } else if (open?.status === 'nolock') {
          // kein auslesbares Schloss (z. B. nur TTLock): der Start ist nicht messbar, es zählt allein die Fertigmeldung
          reinigung = { status: 'offen', text: 'noch nicht gemeldet' }
        } else {
          reinigung = { status: 'offen', text: 'noch nicht begonnen' }
        }
      } else {
        reinigung = { status: 'unklar', text: `Wohnung war frei · Reinigung (${prev.check_out.slice(8, 10)}.${prev.check_out.slice(5, 7)}.) nicht gemeldet` }
      }

      const ci = uhr(l?.check_in_time)
      if (rLog && okLog(rLog)) checkin = { status: 'green', text: `bereit · ${hm5(rLog.sent_at, tag)} gemeldet` }
      else if (rLog) checkin = { status: 'red', text: `Meldung nicht zugestellt (${hm5(rLog.sent_at, tag)})` }
      else if (gesperrt) checkin = { status: 'grey', text: `ab ${ci} · Early gesperrt` }
      else if (reinigung.status === 'laeuft') checkin = { status: 'yellow', text: `ab ${ci} · Meldung folgt` }
      else if (reinigung.status === 'fertig') checkin = { status: 'yellow', text: `ab ${ci} · fertig, Meldung fehlt` }
      else if (!wechsel) checkin = { status: 'grey', text: `ab ${ci} · Vornacht war frei` }
      else checkin = { status: 'grey', text: `ab ${ci}` }

      /* ── Vier-Schritte-Leiste (1.10.): begonnen → fertig → informiert → eingecheckt ──
         Reine Anzeige aus vorhandenen Daten (cleaning_confirmations, Schloss-Protokoll, auto_message_log).
         KEINE Zeit-Automatik: gesendet wird nur vom NFC-Scan/der Engine wie bisher oder per Knopf. */
      const nowHm = hmExakt(new Date().toISOString())
      const ciTime = (l?.check_in_time ?? '16:00').slice(0, 5)
      const eing = guestOpen.get(b.listing_id) ?? null
      const block = earlyBlk.get(b.id) ?? null
      const stumm = muteMap.get(b.id) === 'alle'
      const tpl = pickEarlyTemplate(reinigungTpl, b.listing_id)
      const hinweise: HeuteProzess['hinweise'] = []
      const S = (key: HeuteSchritt['key'], status: SchrittStatus, at: string | null, zeit: string | null, text: string): HeuteSchritt =>
        ({ key, status, at, zeit: zeit ?? (at ? zeitKurz(at, tag) : null), text })
      const abreiseTag = prev ? `${prev.check_out.slice(8, 10)}.${prev.check_out.slice(5, 7)}.` : ''

      // Schritt 1 + 2 — Reinigung
      let s1: HeuteSchritt
      let s2: HeuteSchritt
      if (!prev) {
        s1 = S('begonnen', 'erledigt', null, 'frei', 'Wohnung war frei – keine Reinigung nötig')
        s2 = S('fertig', 'erledigt', null, 'frei', 'Wohnung war frei · sauber')
      } else if (conf) {
        s1 = S('begonnen', 'erledigt', conf.started_at, null, conf.started_at ? `begonnen ${zeitLang(conf.started_at, tag)}` : 'Startzeit nicht erfasst')
        s2 = S('fertig', 'erledigt', conf.confirmed_at, null, `fertig gemeldet ${zeitLang(conf.confirmed_at, tag)}${wechsel ? '' : ` (Abreise ${abreiseTag})`}`)
      } else if (wechsel) {
        const open = lockOpen.get(b.listing_id)
        if (open?.status === 'found' && open.at) {
          const etaMs = Date.parse(open.at) + (minutes + 30) * 60_000
          const ueber = Date.now() > etaMs + 60 * 60_000
          const name = (open.who ?? '').replace(/^TRIMOSA-Team\s*/i, '').trim()
          const wer = auth.role !== 'provider' && name && !/^zutrittscode$/i.test(name) ? ` (${name})` : ''
          const eta = hm5(new Date(etaMs).toISOString(), tag)
          s1 = S('begonnen', 'erledigt', open.at, null, `Tür geöffnet ${zeitLang(open.at, tag)}${wer}`)
          s2 = S('fertig', 'aktiv', null, ueber ? null : `~${eta}`, ueber ? 'keine Fertigmeldung' : `läuft · voraussichtlich fertig ~${eta} Uhr`)
          if (ueber) hinweise.push({ ton: 'yellow', text: `Reinigung seit ${hmExakt(open.at)} Uhr ohne Fertigmeldung` })
        } else if (open?.status === 'unknown') {
          s1 = S('begonnen', 'offen', null, '?', 'Schloss-Protokoll nicht lesbar – Start unbekannt')
          s2 = S('fertig', 'aktiv', null, null, 'noch nicht gemeldet')
          hinweise.push({ ton: 'yellow', text: 'Schloss-Protokoll nicht lesbar' })
        } else if (open?.status === 'nolock') {
          s1 = S('begonnen', 'offen', null, '?', 'Start nicht messbar (kein auslesbares Schloss)')
          s2 = S('fertig', 'aktiv', null, null, 'noch nicht gemeldet')
        } else {
          s1 = S('begonnen', 'aktiv', null, null, 'noch nicht begonnen')
          s2 = S('fertig', 'offen', null, null, 'folgt nach dem Start')
        }
      } else {
        // Vornacht frei, aber die Reinigung nach der letzten Abreise wurde nie gemeldet
        s1 = S('begonnen', 'offen', null, '?', `Reinigung nach Abreise ${abreiseTag} nicht gemeldet`)
        s2 = S('fertig', 'offen', null, '?', 'keine Fertigmeldung')
        hinweise.push({ ton: 'yellow', text: `Reinigung nach Abreise ${abreiseTag} nicht gemeldet` })
      }

      // Schritt 3 — „Wohnung ist bereit" an den Gast (auto_message_log der Vorlage reinigung_fertig)
      const ch = String(rLog?.channel ?? '')
      // laufender Versand: Claim-Marker der Engine/des Knopfs bzw. der nackte NFC-Claim; älter als 5 min = hängt
      const inFlug = !!rLog && (ch === EARLY_LOG_CLAIM || ch === 'reinigung-event')
      const haengt = !!rLog && inFlug && Date.now() - Date.parse(rLog.sent_at) > 5 * 60_000
      let s3: HeuteSchritt
      if (rLog && inFlug && !haengt) {
        s3 = S('informiert', 'aktiv', null, 'sendet', 'wird gerade gesendet …')
      } else if (rLog && inFlug) {
        s3 = S('informiert', 'fehler', rLog.sent_at, null, 'Versand hängt – Zustellung unklar')
        hinweise.push({ ton: 'red', text: `Versand hängt seit ${hmExakt(rLog.sent_at)} Uhr – Zustellung unklar, bitte im Chat prüfen` })
      } else if (rLog && okLog(rLog)) {
        s3 = S('informiert', 'erledigt', rLog.sent_at, null, `„Wohnung ist bereit“ gesendet ${zeitLang(rLog.sent_at, tag)} · ${kanalLabel(ch)}`)
      } else if (rLog) {
        s3 = S('informiert', 'fehler', rLog.sent_at, null, 'Meldung nicht zugestellt')
        hinweise.push({ ton: 'red', text: `Meldung nicht zugestellt (${hmExakt(rLog.sent_at)} Uhr)` })
      } else if (eing) {
        s3 = S('informiert', 'offen', null, null, 'nicht mehr nötig – Gast ist da')
      } else if (block) {
        s3 = S('informiert', 'offen', null, 'gesperrt', 'Early Check-in gesperrt – keine Früh-Meldung')
      } else if (stumm) {
        s3 = S('informiert', 'offen', null, 'stumm', 'Nachrichten für diese Buchung sind stummgeschaltet')
      } else if (!tpl || !tpl.enabled || !autoOn) {
        s3 = S('informiert', 'offen', null, 'aus', !tpl ? 'keine Vorlage „Früher Check-in möglich“ vorhanden' : !tpl.enabled ? 'Vorlage „Früher Check-in möglich“ ist ausgeschaltet' : 'Auto-Versand (🚦) ist ausgeschaltet')
      } else if (nowHm >= ciTime) {
        s3 = S('informiert', 'offen', null, null, `keine Früh-Meldung mehr – regulärer Check-in ab ${uhr(ciTime)}`)
      } else if (s2.status === 'erledigt') {
        const autoAb = conf && berlinDay(conf.confirmed_at) !== tag && Number(nowHm.slice(0, 2)) < (tpl.send_hour ?? 0)
        s3 = S('informiert', 'aktiv', null, null, autoAb ? `noch nicht informiert · automatisch ab ${tpl.send_hour} Uhr` : 'noch nicht informiert')
      } else {
        s3 = S('informiert', 'offen', null, null, 'folgt nach der Reinigung')
      }

      // Schritt 4 — Gast hat seinen Türcode benutzt
      const hatLog = (Array.isArray(l?.locks) ? l.locks : []).some((x) => x.provider === 'nuki' || x.provider === 'tedee')
      let s4: HeuteSchritt
      if (eing) s4 = S('eingecheckt', 'erledigt', eing, null, `Türcode benutzt ${zeitLang(eing, tag)} · Wohnung belegt`)
      else if (!b.door_code) s4 = S('eingecheckt', 'offen', null, '?', 'kein Türcode – Check-in nicht messbar')
      else if (!hatLog) s4 = S('eingecheckt', 'offen', null, '?', 'Schloss liefert kein Protokoll – Check-in nicht messbar')
      else if (s3.status === 'erledigt') s4 = S('eingecheckt', 'aktiv', null, null, 'wartet auf den Gast · früher Check-in möglich')
      else s4 = S('eingecheckt', nowHm >= ciTime ? 'aktiv' : 'offen', null, `ab ${ciTime}`, `wartet auf den Gast · Check-in ab ${uhr(ciTime)}`)

      // Knopf „Gast jetzt informieren" — Schritt 3 offen (kein Log-Eintrag oder Fehler), nicht gesperrt,
      // vor der regulären Check-in-Zeit. Der Server prüft beim Tipp alles noch einmal (lib/early-inform.ts).
      const kannInformieren = auth.role === 'admin' && (!rLog || s3.status === 'fehler') && !eing && !block && !stumm
        && !!tpl?.enabled && autoOn && nowHm < ciTime
      const warnung = s2.status === 'erledigt' ? null
        : wechsel ? 'Die Reinigung ist noch NICHT als fertig gemeldet.'
        : 'Für diese Wohnung liegt keine Fertigmeldung der Reinigung vor.'
      prozess = { schritte: [s1, s2, s3, s4], hinweise, kannInformieren, warnung: kannInformieren ? warnung : null }
    }
    return { ...base, infosRaus, codeDa: !!b.door_code, fertig, reinigung, checkin, eingecheckt: guestOpen.get(b.listing_id) ?? null, earlyBlock: earlyBlk.get(b.id) ?? null, prozess }
  }).sort(byTitle)

  /* Eigener Türcode (§141) — nur der eigene, nie fremde */
  let doorCode: HeuteDaten['doorCode'] = null
  try {
    const sc = (await getStaffCodes())[auth.userId]
    if (sc?.code) doorCode = { code: sc.code, listings: sc.listingIds.map((id) => byId.get(id)?.title ?? '').filter(Boolean) }
  } catch { /* fail-soft */ }

  const coState = await coPromise
  const abreisen: HeuteStay[] = departures.map((b) => {
    const e = coState.get(b.id)
    const at = e && !e.locked && e.day === tag && e.at && berlinDay(e.at) === tag ? e.at : null
    return { ...toStay(b), checkout: at ? { at, quelle: 'chat' as const } : null }
  }).sort(byTitle)

  const heuteView: HeuteDaten['heuteView'] = auth.role === 'provider' ? (cleans ? 'cleaning' : 'provider') : 'full'
  const data: HeuteDaten = { tag, heute, stand: new Date().toISOString(), firstName, roleLabel, heuteView, doorCode, anreisen, abreisen, vorschau }
  // „Schloss-Protokoll nicht lesbar" nicht 2 Minuten festhalten — höchstens 20 s
  const lockUnknown = [...lockOpen.values()].some((r) => r.status === 'unknown')
  cache.__heuteCache!.set(key, { at: lockUnknown ? Date.now() - TTL_MS + 20_000 : Date.now(), data })
  return data
}
