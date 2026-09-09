import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendPushToTeam } from '@/lib/push'

/**
 * 🚨 Überbuchungs-Meldung v2 (§274, Dominik 7.9.): Statt eines flüchtigen
 * Pushes „kollidiert mit einer bestehenden Buchung" (Tap → nur der Kalender)
 * entsteht eine ECHTE Aufgabe mit allen Daten BEIDER Buchungen — Namen,
 * Reisedaten, Portale, Buchungszeitpunkte auf die Sekunde — und der Push
 * springt per Deep-Link direkt auf diese Aufgabe.
 *
 * Dazu die ECHO-ERKENNUNG (Fall Jenny Pisulla 7.9.): Unsere eigene
 * Website-Buchung wird nach der Zahlung zu Smoobu gepusht; Smoobu spiegelt
 * sie als newReservation-Webhook zurück — und das Echo kann eintreffen,
 * BEVOR die Smoobu-Nummer bei uns gespeichert ist. Dann scheitert der
 * Insert am EXCLUDE-Constraint gegen die EIGENE Buchung (gleiche Wohnung,
 * gleiche Daten) und löste bisher einen Fehlalarm aus. Jetzt: erkannt,
 * Smoobu-Nummer nachgetragen, KEIN Alarm.
 *
 * Alle drei Alarm-Pfade laufen hier zusammen: Smoobu-Webhook (blocked mit
 * Gastname / EXCLUDE-Insert-Fehler) und der 2×/Std-Import-Wächter.
 */

export type OverbookingSide = {
  name: string | null
  checkIn: string
  checkOut: string
  channel: string | null
  smoobuId?: number | string | null
  /** Buchungszeitpunkt: ISO (DB) oder Smoobu-Form „YYYY-MM-DD HH:MM:SS" */
  bookedAt?: string | null
  bookingId?: string | null
  source?: string | null
  paidAt?: string | null
  price?: number | null
}

type BookingRow = {
  id: string
  guest_id: string | null
  guest_name: string | null
  check_in: string
  check_out: string
  channel: string | null
  source: string | null
  smoobu_reservation_id: number | string | null
  created_at: string | null
  paid_at: string | null
  payment_status: string | null
  total_price: number | string | null
}

const BERLIN = 'Europe/Berlin'

function fmtDate(iso: string): string {
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  return y && m && d ? `${d}.${m}.${y}` : String(iso)
}

export function fmtRange(checkIn: string, checkOut: string): string {
  return `${fmtDate(checkIn).slice(0, 6)}–${fmtDate(checkOut)}`
}

/** Sekundengenau in Berlin-Zeit; Smoobu-Zeitstempel („2026-09-07 09:36:40")
 *  werden unverändert ausgegeben (Smoobu liefert keine Zeitzone mit). */
function fmtStamp(value: string | null | undefined): string {
  if (!value) return 'Zeitpunkt unbekannt'
  const s = String(value)
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    const [d, t] = s.split(' ')
    return `${fmtDate(d)}, ${t} Uhr (Smoobu-Zeit)`
  }
  const dt = new Date(s)
  if (Number.isNaN(dt.getTime())) return s
  return dt.toLocaleString('de-DE', {
    timeZone: BERLIN, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).replace(', ', ', ') + ' Uhr'
}

export function channelLabel(channel: string | null | undefined, source?: string | null): string {
  const c = String(channel ?? '').trim()
  if (source === 'trimosa' || /^(direct|trimosa|website)$/i.test(c)) return 'Website (trimosa.de)'
  if (!c) return 'Smoobu'
  if (/fewo|homeaway|vrbo/i.test(c)) return 'FeWo-direkt'
  if (/direct booking/i.test(c)) return 'Direktbuchung (Smoobu)'
  return c
}

function nameTokens(name: string | null | undefined): Set<string> {
  return new Set(String(name ?? '').toLowerCase().split(/[^a-zäöüß]+/i).filter((t) => t.length >= 3))
}

async function guestNameFor(b: BookingRow): Promise<string | null> {
  if (b.guest_name && b.guest_name !== 'Externer Gast') return b.guest_name
  if (!b.guest_id) return b.guest_name
  const { data: p } = await supabaseAdmin
    .from('profiles').select('display_name, guest_first_name, guest_last_name, company_name')
    .eq('id', b.guest_id).maybeSingle()
  const full = [p?.guest_first_name, p?.guest_last_name].filter(Boolean).join(' ').trim()
  return (p?.company_name as string | null) || full || (p?.display_name as string | null) || b.guest_name
}

async function sideFromRow(b: BookingRow): Promise<OverbookingSide> {
  return {
    name: await guestNameFor(b),
    checkIn: b.check_in,
    checkOut: b.check_out,
    channel: b.channel,
    source: b.source,
    smoobuId: b.smoobu_reservation_id,
    bookedAt: b.created_at,
    paidAt: b.paid_at,
    bookingId: b.id,
    price: b.total_price == null ? null : Number(b.total_price),
  }
}

function describe(label: string, s: OverbookingSide): string {
  const lines = [
    `${label}: ${s.name?.trim() || 'Gast unbekannt'}`,
    `   Zeitraum: ${fmtRange(s.checkIn, s.checkOut)}`,
    `   Portal: ${channelLabel(s.channel, s.source)}${s.smoobuId ? ` · Smoobu-Nr. ${s.smoobuId}` : ''}`,
    `   Gebucht: ${fmtStamp(s.bookedAt)}`,
  ]
  if (s.paidAt) lines.push(`   Bezahlt: ${fmtStamp(s.paidAt)}`)
  if (s.price != null && s.price > 0) lines.push(`   Betrag: ${s.price.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €`)
  return lines.join('\n')
}

function sourceRef(listingId: string, s: OverbookingSide): string {
  return `ueb:${listingId}:${s.checkIn}:${s.checkOut}:${s.smoobuId ?? s.bookingId ?? s.name ?? '?'}`
}

/**
 * Meldet eine Überbuchung — oder erkennt das Smoobu-Echo der eigenen
 * Website-Buchung und trägt in dem Fall nur die Smoobu-Nummer nach.
 *
 * @param neu      die NEU eingetroffene Reservierung (Smoobu-Seite)
 * @param gegen    optional die bekannte Gegenseite (Import-Wächter: beide
 *                 Seiten kommen aus Smoobu); ohne Angabe wird die
 *                 kollidierende Buchung in unserer DB gesucht
 */
export async function reportOverbooking(input: {
  listingId: string
  neu: OverbookingSide
  gegen?: OverbookingSide
  quelle: string
}): Promise<{ echo: boolean; taskId: string | null; alreadyOpen: boolean }> {
  const { listingId, neu, quelle } = input
  const { data: lst } = await supabaseAdmin.from('listings').select('title').eq('id', listingId).maybeSingle()
  const title = (lst?.title as string | undefined) ?? 'Wohnung'

  // Kollidierende Buchungen in unserer DB (bestätigt, überlappend)
  let clashQ = supabaseAdmin
    .from('bookings')
    .select('id, guest_id, guest_name, check_in, check_out, channel, source, smoobu_reservation_id, created_at, paid_at, payment_status, total_price')
    .eq('listing_id', listingId)
    .eq('status', 'confirmed')
    .lt('check_in', neu.checkOut)
    .gt('check_out', neu.checkIn)
    .order('created_at', { ascending: true })
    .limit(5)
  if (neu.bookingId) clashQ = clashQ.neq('id', neu.bookingId)
  const { data: clashRows } = await clashQ
  const clashes = (clashRows ?? []) as BookingRow[]

  // ── ECHO-ERKENNUNG (Pisulla-Fall) ─────────────────────────────────────
  // Eigene Website-Buchung, exakt gleiche Daten, Smoobu-Nummer noch nicht
  // (oder genau diese) gespeichert, und die neue Reservierung kommt über
  // unseren Website-Kanal ODER trägt denselben Gastnamen → kein Alarm.
  if (neu.smoobuId != null) {
    for (const b of clashes) {
      if (b.source !== 'trimosa') continue
      if (b.check_in !== neu.checkIn || b.check_out !== neu.checkOut) continue
      const sameOrNoId = b.smoobu_reservation_id == null || String(b.smoobu_reservation_id) === String(neu.smoobuId)
      if (!sameOrNoId) continue
      const viaWebsite = /website|trimosa|direct/i.test(String(neu.channel ?? ''))
      const own = await guestNameFor(b)
      const a = nameTokens(neu.name), o = nameTokens(own)
      const nameMatch = [...a].some((t) => o.has(t))
      if (!viaWebsite && !nameMatch) continue
      if (b.smoobu_reservation_id == null) {
        await supabaseAdmin.from('bookings')
          .update({ smoobu_reservation_id: neu.smoobuId })
          .eq('id', b.id).is('smoobu_reservation_id', null)
      }
      console.log('[overbooking] Echo der eigenen Website-Buchung erkannt — kein Alarm:', quelle, title, neu.checkIn, 'Smoobu', neu.smoobuId, '→ Buchung', b.id)
      return { echo: true, taskId: null, alreadyOpen: false }
    }
  }

  // ── Dedupe: gleiche Konstellation schon als offene Aufgabe? ───────────
  const ref = sourceRef(listingId, neu)
  const { data: openTask } = await supabaseAdmin
    .from('tasks').select('id').eq('source', 'ueberbuchung').eq('source_ref', ref)
    .in('status', ['offen', 'in_arbeit']).limit(1).maybeSingle()
  if (openTask?.id) {
    console.log('[overbooking] Aufgabe existiert bereits, kein zweiter Alarm:', openTask.id)
    return { echo: false, taskId: openTask.id as string, alreadyOpen: true }
  }

  // ── Gegenseite(n) beschreiben ─────────────────────────────────────────
  const others: OverbookingSide[] = input.gegen ? [input.gegen] : []
  for (const b of clashes) {
    if (input.gegen && input.gegen.bookingId && input.gegen.bookingId === b.id) continue
    if (input.gegen && input.gegen.smoobuId != null && String(input.gegen.smoobuId) === String(b.smoobu_reservation_id)) continue
    others.push(await sideFromRow(b))
  }

  const now = new Date().toISOString()
  const description = [
    `🚨 Zwei Buchungen für ${title} überschneiden sich. Bitte SOFORT klären, welche bleibt (Portal-Storno / Umquartierung / Gast anrufen).`,
    '',
    describe('NEU EINGETROFFEN', neu),
    ...(others.length
      ? others.map((o, i) => '\n' + describe(others.length > 1 ? `BESTEHENDE BUCHUNG ${i + 1}` : 'BESTEHENDE BUCHUNG', o))
      : ['\nBESTEHENDE BUCHUNG: in unserer Datenbank nicht auffindbar — Kollision wurde von Smoobu gemeldet (Buchungen dort prüfen).']),
    '',
    `Erkannt: ${fmtStamp(now)} · Quelle: ${quelle}`,
    'Diese Aufgabe schließt sich automatisch, sobald eine der beiden Buchungen storniert wird.',
  ].join('\n').slice(0, 2000)

  const { data: inserted, error } = await supabaseAdmin.from('tasks').insert({
    title: `🚨 Überbuchung: ${title} · ${fmtRange(neu.checkIn, neu.checkOut)}`.slice(0, 120),
    description,
    source: 'ueberbuchung',
    source_ref: ref,
    listing_id: listingId,
    is_general: false,
    prio: 'hoch',
    status: 'offen',
    visibility: 'team',
  }).select('id').single()
  if (error || !inserted) console.error('[overbooking] Aufgabe konnte nicht angelegt werden:', error?.message)
  const taskId = (inserted?.id as string | undefined) ?? null

  const gegenText = others.length
    ? others.map((o) => `${o.name?.trim() || 'Gast unbekannt'} (${fmtRange(o.checkIn, o.checkOut)}, ${channelLabel(o.channel, o.source)})`).join(' + ')
    : 'bestehende Buchung (nur in Smoobu sichtbar)'
  await sendPushToTeam(
    `🚨 ÜBERBUCHUNG · ${title}`,
    `${neu.name?.trim() || 'Gast unbekannt'} (${fmtRange(neu.checkIn, neu.checkOut)}, ${channelLabel(neu.channel, neu.source)}) ↔ ${gegenText} — alle Daten in der Aufgabe.`,
    taskId ? `/team?tab=aufgaben&task=${taskId}` : '/team?tab=aufgaben',
    { category: 'system' },
  ).catch((e) => console.error('[overbooking] push:', e))
  console.error('[overbooking] 🚨 ÜBERBUCHUNG gemeldet:', quelle, title, neu.name, neu.checkIn, '↔', gegenText, 'Aufgabe', taskId)
  return { echo: false, taskId, alreadyOpen: false }
}

/**
 * Entwarnung: Eine der beteiligten Buchungen ist weg (Website-Checkout
 * verfallen, Portal-Storno, Reservierung nachträglich sauber importiert) →
 * offene Überbuchungs-Aufgaben der Wohnung im Zeitraum werden geschlossen
 * und das Team bekommt „✅ aufgelöst" (§273-Idee).
 */
export async function resolveOverbooking(input: {
  listingId: string
  checkIn: string
  checkOut: string
  grund: string
}): Promise<number> {
  const { listingId, checkIn, checkOut, grund } = input
  const { data: open } = await supabaseAdmin
    .from('tasks').select('id, description, source_ref')
    .eq('source', 'ueberbuchung').eq('listing_id', listingId)
    .in('status', ['offen', 'in_arbeit']).limit(20)
  const hits = (open ?? []).filter((t) => {
    const parts = String(t.source_ref ?? '').split(':')
    const tIn = parts[2], tOut = parts[3]
    if (!tIn || !tOut) return true
    return tIn < checkOut && tOut > checkIn
  })
  if (!hits.length) return 0
  const stamp = fmtStamp(new Date().toISOString())
  for (const t of hits) {
    await supabaseAdmin.from('tasks').update({
      status: 'erledigt',
      completed_at: new Date().toISOString(),
      description: `${String(t.description ?? '')}\n\n✅ AUFGELÖST ${stamp}: ${grund}`.slice(0, 2000),
    }).eq('id', t.id)
  }
  const { data: lst } = await supabaseAdmin.from('listings').select('title').eq('id', listingId).maybeSingle()
  await sendPushToTeam(
    `✅ Überbuchung aufgelöst · ${(lst?.title as string | undefined) ?? 'Wohnung'}`,
    `${fmtRange(checkIn, checkOut)}: ${grund}`,
    `/team?tab=aufgaben&task=${hits[0].id}`,
    { category: 'system' },
  ).catch((e) => console.error('[overbooking] resolve push:', e))
  console.log('[overbooking] ✅ aufgelöst:', listingId, checkIn, checkOut, grund, hits.length)
  return hits.length
}
