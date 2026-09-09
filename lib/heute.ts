/**
 * 🏠 §277 Heute-Bildschirm der Team-App (Pascals JUPAS-Referenz):
 * Datenaufbereitung für GET /api/heute — eigener Türcode, An-/Abreisen des
 * Tages mit Reinigungs-/Check-in-Stand (nur heute), Abreisen, Vorschau auf
 * den Folgetag. Aufgaben + „Warten auf Antwort" holt der Client aus den
 * vorhandenen APIs (/api/tasks, /api/chat/inbox) — keine doppelte Logik.
 * Sichtbarkeit wie der Kalender (§111/§112): Admin alles, sonst
 * calendar_visibility, Dienstleister nur eigene Reinigungs-Wohnungen und
 * NIE Gastnamen. Server-Cache 2 Min je Nutzer+Tag.
 */
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getStaffCodes, firstCleaningOpenAt, firstGuestOpenAt, type LockRef } from '@/lib/locks'
import type { TaskAuth } from '@/lib/tasks'
import { loadStayIndex } from '@/lib/stammgaeste'

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
  const abreisen = rows.filter((b) => b.check_out === tag).map(toStay).sort(byTitle)
  const vorschau = {
    tag: tag1,
    anreisen: rows.filter((b) => b.check_in === tag1).map(toStay).sort(byTitle),
    abreisen: rows.filter((b) => b.check_out === tag1).map(toStay).sort(byTitle),
  }

  /* Status-Signale je Anreise */
  const arrivalIds = arrivals.map((b) => b.id)
  const listingIds = [...new Set(arrivals.map((b) => b.listing_id))]
  type Tpl = { id: string; trigger_type: string; enabled: boolean }
  type Log = { booking_id: string; auto_message_id: string; sent_at: string; channel: string | null }
  type Prev = { id: string; listing_id: string; check_out: string; source: string | null; payment_status: string | null }
  type Conf = { listing_id: string; slot_date: string; confirmed_at: string; started_at: string | null; duration_min: number | null }
  let templates: Tpl[] = []
  let logs: Log[] = []
  let prevs: Prev[] = []
  let confs: Conf[] = []
  if (arrivalIds.length) {
    const [t, l, p, c] = await Promise.all([
      supabaseAdmin.from('auto_messages').select('id, trigger_type, enabled'),
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
  const reinigungTpl = templates.filter((t) => t.trigger_type === 'reinigung_fertig')
  const reinigungIds = new Set(reinigungTpl.map((t) => t.id))
  const infoIds = new Set(templates.filter((t) => ['nach_buchung', 'vor_anreise', 'anreisetag'].includes(t.trigger_type)).map((t) => t.id))
  const okLog = (x: Log) => !!x.channel && !x.channel.startsWith('fehler') && x.channel !== 'sendet…'

  // Wechseltag-Reinigungen ohne Meldung: LIVE ins Schloss-Protokoll schauen
  // (parallel, je Wohnung max. 6 s — sonst „noch nicht begonnen")
  const lockOpen = new Map<string, string | null>()
  if (istHeute) {
    await Promise.all(listingIds.map(async (lid) => {
      const prev = prevs.find((p) => p.listing_id === lid)
      if (!prev || prev.check_out !== tag) return
      if (confs.some((c) => c.listing_id === lid && c.slot_date === tag)) return
      const l = byId.get(lid)
      const afterHm = (l?.check_out_time ?? '10:00').slice(0, 5)
      const iso = await withTimeout(firstCleaningOpenAt(l?.locks ?? [], afterHm, tag).catch(() => null), 6000, null)
      lockOpen.set(lid, iso)
    }))
  }

  // Paragraph 308: „eingecheckt" = erste Oeffnung mit Gast-Code heute ab 10:00 (Schlossprotokoll, je Wohnung max. 6 s)
  const guestOpen = new Map<string, string | null>()
  if (istHeute) {
    await Promise.all(arrivals.filter((b) => b.door_code).map(async (b) => {
      const l = byId.get(b.listing_id)
      const iso = await withTimeout(firstGuestOpenAt(l?.locks ?? [], '10:00', tag).catch(() => null), 6000, null)
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
        const open = lockOpen.get(b.listing_id) ?? null
        if (open) {
          const eta = new Date(Date.parse(open) + (minutes + 30) * 60_000).toISOString()
          reinigung = { status: 'laeuft', text: `läuft seit ${hm5(open, tag)} · fertig ~${hm5(eta, tag)}` }
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
    }
    return { ...base, infosRaus, codeDa: !!b.door_code, fertig, reinigung, checkin, eingecheckt: guestOpen.get(b.listing_id) ?? null }
  }).sort(byTitle)

  /* Eigener Türcode (§141) — nur der eigene, nie fremde */
  let doorCode: HeuteDaten['doorCode'] = null
  try {
    const sc = (await getStaffCodes())[auth.userId]
    if (sc?.code) doorCode = { code: sc.code, listings: sc.listingIds.map((id) => byId.get(id)?.title ?? '').filter(Boolean) }
  } catch { /* fail-soft */ }

  const heuteView: HeuteDaten['heuteView'] = auth.role === 'provider' ? (cleans ? 'cleaning' : 'provider') : 'full'
  const data: HeuteDaten = { tag, heute, stand: new Date().toISOString(), firstName, roleLabel, heuteView, doorCode, anreisen, abreisen, vorschau }
  cache.__heuteCache!.set(key, { at: Date.now(), data })
  return data
}
