/**
 * 📣 Vier-Schritte-Leiste (1.10., Pascal 17.9.): „Gast jetzt informieren" — der MANUELLE Weg für
 * Schritt 3. Sendet die Vorlage „Früher Check-in möglich" (Trigger 'reinigung_fertig') über
 * denselben Weg wie die NFC-Fertigmeldung (renderEarlyCheckinText + deliverToGuest), aber nur auf
 * ausdrücklichen Tipp eines Admins/Gastgebers (POST /api/heute/inform). Nichts hier läuft automatisch.
 *
 * Schutz: Anreise heute · bezahlt · vor der regulären Check-in-Zeit · keine Early-Check-in-Sperre ·
 * nicht stummgeschaltet · 🚦-Master-Schalter an · Vorlage vorhanden und an · Türcode vorhanden ·
 * Claim im auto_message_log (unique auto_message_id+booking_id) gegen Doppelversand — auch gegen
 * den NFC-Pfad und den Morgen-Pfad der Engine. Ein hängender Claim („sendet…" älter als 5 Minuten)
 * wird nur nach zweiter Bestätigung übernommen (die erste Nachricht kann trotzdem angekommen sein).
 */
import { supabaseAdmin } from '@/lib/supabase-admin'
import { earlyCheckinBlock, EARLY_LOG_CLAIM } from '@/lib/early-checkin'
import { renderEarlyCheckinText } from '@/lib/cleaning-done'
import type { LockRef } from '@/lib/locks'

export type InformCode =
  | 'gesendet' | 'nicht_gefunden' | 'nicht_heute' | 'unbezahlt' | 'zu_spaet' | 'gesperrt' | 'stumm'
  | 'versand_aus' | 'vorlage_aus' | 'keine_vorlage' | 'tuercode_fehlt'
  | 'schon_gesendet' | 'laeuft' | 'unklar' | 'nicht_zustellbar' | 'fehler'

export interface InformResult {
  ok: boolean
  code: InformCode
  /** deutscher Klartext für den Toast */
  message: string
  delivery?: 'smoobu' | 'email'
}

const STUCK_MS = 5 * 60_000
const no = (code: InformCode, message: string): InformResult => ({ ok: false, code, message })

function berlinNow(): { date: string; hm: string; hour: number } {
  const now = new Date()
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(now)
  const hm = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
  return { date, hm, hour: Number(hm.slice(0, 2)) }
}

/**
 * Claim VOR dem Senden. 'ok' = dieser Aufruf darf senden · 'gesendet' = es gibt schon eine
 * zugestellte Meldung · 'laeuft' = ein anderer Versand läuft gerade · 'unklar' = ein Versand hängt
 * (älter als 5 min) — Übernahme nur mit takeoverStuck. Andere DB-Fehler werfen (lieber keine als
 * eine doppelte Gast-Nachricht).
 */
async function claimEarlyLog(templateId: string, bookingId: string, takeoverStuck: boolean): Promise<'ok' | 'gesendet' | 'laeuft' | 'unklar'> {
  const key = { auto_message_id: templateId, booking_id: bookingId }
  const { error } = await supabaseAdmin.from('auto_message_log').insert({ ...key, channel: EARLY_LOG_CLAIM })
  if (!error) return 'ok'
  if (error.code !== '23505' && !/duplicate|unique/i.test(error.message)) throw new Error(error.message)

  // 1) gescheiterte Zustellung übernehmen — atomar: nur wer die Fehlerzeile umschreibt, sendet
  const nowIso = new Date().toISOString()
  const { data: retry } = await supabaseAdmin.from('auto_message_log')
    .update({ channel: EARLY_LOG_CLAIM, sent_at: nowIso }).match(key).like('channel', 'fehler%').select('booking_id')
  if (retry?.length) return 'ok'

  const { data: row } = await supabaseAdmin.from('auto_message_log').select('channel, sent_at').match(key).maybeSingle()
  const ch = String(row?.channel ?? '')
  if (ch !== EARLY_LOG_CLAIM && ch !== 'reinigung-event') return 'gesendet'
  if (Date.now() - Date.parse(String(row?.sent_at ?? '')) <= STUCK_MS) return 'laeuft'
  if (!takeoverStuck) return 'unklar'
  // 2) hängenden Claim übernehmen (nur nach ausdrücklicher zweiter Bestätigung)
  const { data: taken } = await supabaseAdmin.from('auto_message_log')
    .update({ channel: EARLY_LOG_CLAIM, sent_at: nowIso }).match(key)
    .in('channel', [EARLY_LOG_CLAIM, 'reinigung-event']).lt('sent_at', new Date(Date.now() - STUCK_MS).toISOString())
    .select('booking_id')
  return taken?.length ? 'ok' : 'laeuft'
}

async function finishEarlyLog(templateId: string, bookingId: string, channel: string): Promise<void> {
  const { error } = await supabaseAdmin.from('auto_message_log')
    .update({ channel: channel.slice(0, 160), sent_at: new Date().toISOString() })
    .match({ auto_message_id: templateId, booking_id: bookingId })
  // bleibt die Zeile auf „sendet…", sieht es nach 5 Minuten wie ein Hänger aus — deshalb laut
  if (error) console.error('[early-inform] Log-Update fehlgeschlagen:', error.message, bookingId.slice(0, 8))
}

export async function informGuestReady(o: {
  bookingId: string
  /** Vorname des auslösenden Admins — landet im Log-Kanal („manuell (email) · Pascal") */
  actorName: string
  /** zweite Bestätigung: hängenden Versand übernehmen */
  erneut?: boolean
}): Promise<InformResult> {
  const now = berlinNow()

  const { data: b } = await supabaseAdmin
    .from('bookings')
    .select('id, listing_id, status, source, payment_status, door_code, guest_name, check_in, check_out, adults, children, portal_token')
    .eq('id', o.bookingId).maybeSingle()
  if (!b || b.status !== 'confirmed' || !b.listing_id) return no('nicht_gefunden', 'Buchung nicht gefunden oder nicht bestätigt.')
  if (b.check_in !== now.date) return no('nicht_heute', 'Die Anreise ist nicht heute.')
  if (b.source === 'trimosa' && b.payment_status !== 'paid') return no('unbezahlt', 'Die Buchung ist noch nicht bezahlt.')

  const { data: l } = await supabaseAdmin
    .from('listings').select('id, title, check_in_time, locks').eq('id', b.listing_id).maybeSingle()
  if (!l) return no('nicht_gefunden', 'Wohnung nicht gefunden.')
  const checkInTime = String(l.check_in_time ?? '16:00').slice(0, 5)
  if (now.hm >= checkInTime) return no('zu_spaet', `Die reguläre Check-in-Zeit (${checkInTime} Uhr) ist erreicht – keine Früh-Meldung mehr.`)

  const blk = await earlyCheckinBlock({ id: b.id, listing_id: b.listing_id, check_in: b.check_in })
  if (blk.blocked) return no('gesperrt', `Early Check-in gesperrt — ${blk.reason ?? 'gesperrt'}`)

  // Stummschalter (Paragraph 305) — eigene Abfrage, deploy-sicher (Spalte kann fehlen)
  try {
    const { data: m, error } = await supabaseAdmin.from('bookings').select('msg_mute').eq('id', b.id).maybeSingle()
    if (!error && m?.msg_mute === 'alle') return no('stumm', 'Nachrichten für diese Buchung sind stummgeschaltet.')
  } catch { /* Spalte fehlt noch */ }

  const { getAutoSendEnabled } = await import('@/lib/auto-messages-engine')
  if (!(await getAutoSendEnabled())) return no('versand_aus', 'Der Auto-Versand (🚦) ist ausgeschaltet – es wird nichts gesendet.')

  const title = String(l.title ?? 'Wohnung')
  const probe = await renderEarlyCheckinText(l.id, title, { ...b, door_code: b.door_code ?? null }, checkInTime, now.hour)
  if (!probe) return no('vorlage_aus', 'Die Vorlage „Früher Check-in möglich“ ist ausgeschaltet.')
  // ohne Vorlage kein Claim möglich (auto_message_log.auto_message_id ist Pflicht) → kein Versand ohne Protokoll
  if (!probe.templateId) return no('keine_vorlage', 'Es gibt keine Vorlage „Früher Check-in möglich“ für diese Wohnung (Auto-Nachrichten).')
  const templateId = probe.templateId

  // Türcode: Früh-Check-in ohne funktionierenden Code ist sinnlos (gilt nur für Wohnungen MIT Schloss)
  let doorCode: string | null = b.door_code ?? null
  const hasLocks = Array.isArray(l.locks) && (l.locks as LockRef[]).length > 0
  if (!doorCode && hasLocks) {
    try {
      const { ensureDoorCode } = await import('@/lib/locks')
      doorCode = await ensureDoorCode(b.id)
    } catch (e) {
      console.error('[early-inform] Türcode-Anlage fehlgeschlagen:', e)
    }
    if (!doorCode) return no('tuercode_fehlt', 'Für diese Buchung liegt kein Türcode bereit – bitte zuerst den Türcode anlegen.')
  }
  const rendered = doorCode === (b.door_code ?? null)
    ? probe
    : await renderEarlyCheckinText(l.id, title, { ...b, door_code: doorCode }, checkInTime, now.hour)
  if (!rendered || rendered.templateId !== templateId) return no('vorlage_aus', 'Die Vorlage „Früher Check-in möglich“ wurde gerade geändert – bitte erneut versuchen.')

  let claim: Awaited<ReturnType<typeof claimEarlyLog>>
  try {
    claim = await claimEarlyLog(templateId, b.id, o.erneut === true)
  } catch (e) {
    console.error('[early-inform] Claim fehlgeschlagen:', e)
    return no('fehler', 'Protokoll nicht erreichbar – nichts gesendet. Bitte erneut versuchen.')
  }
  if (claim === 'gesendet') return no('schon_gesendet', 'Der Gast wurde bereits informiert.')
  if (claim === 'laeuft') return no('laeuft', 'Die Nachricht wird gerade gesendet – bitte kurz warten.')
  if (claim === 'unklar') return no('unklar', 'Ein früherer Versand hängt – die Nachricht ist evtl. schon beim Gast.')

  try {
    const { deliverToGuest } = await import('@/lib/voice')
    const res = await deliverToGuest(b.id, rendered.text, { testMode: false })
    if (res.delivery === 'smoobu' || res.delivery === 'email') {
      // nie res.detail ins Log — dort steht bei E-Mail die Adresse des Gastes
      const wer = o.actorName.replace(/[^\p{L}\p{N} .-]/gu, '').trim().slice(0, 30) || 'Team'
      await finishEarlyLog(templateId, b.id, `manuell (${res.delivery}) · ${wer}`)
      console.log('[early-inform] gesendet:', b.id.slice(0, 8), res.delivery, 'von', wer)
      return { ok: true, code: 'gesendet', message: res.delivery === 'email' ? 'Gast per E-Mail informiert.' : 'Gast per Portal-Nachricht informiert.', delivery: res.delivery }
    }
    await finishEarlyLog(templateId, b.id, `fehler: nicht zustellbar (${res.delivery === 'none' ? res.detail ?? 'kein Kanal' : res.delivery})`)
    return no('nicht_zustellbar', 'Nicht zustellbar – kein Portal-Chat und keine E-Mail-Adresse. Bitte den Gast anrufen.')
  } catch (e) {
    console.error('[early-inform] Versand fehlgeschlagen:', e)
    await finishEarlyLog(templateId, b.id, `fehler: ${e instanceof Error ? e.message : String(e)}`)
    return no('fehler', 'Senden fehlgeschlagen – bitte im Chat prüfen, ob die Nachricht angekommen ist.')
  }
}
