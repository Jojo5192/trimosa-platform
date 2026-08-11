import { supabaseAdmin } from '@/lib/supabase-admin'
import { getLockSettings, type LockRef } from '@/lib/locks'
import { resolvePlaceholders } from '@/lib/auto-messages'

/**
 * Text der Früh-Check-in-Nachricht (§231): kommt aus der Auto-Nachrichten-
 * Vorlage mit Trigger 'reinigung_fertig' (Editor: Name „Früher Check-in
 * möglich" — dort editierbar, per Schalter deaktivierbar, Wohnungs-Chips
 * gelten). Semantik: Vorlage vorhanden & AUS → keine Nachricht (bewusst);
 * KEINE Vorlage vorhanden → eingebauter Standardtext (funktioniert ab Werk).
 */
interface EarlyBooking {
  id: string; door_code: string | null; guest_name: string | null
  check_in: string; check_out: string
  adults: number | null; children: number | null; portal_token: string | null
}

async function renderEarlyCheckinText(
  listingId: string, listingTitle: string, arr: EarlyBooking, checkInTime: string, nowHour: number,
): Promise<{ text: string; templateId: string | null } | null> {
  let body: string | null = null
  let templateId: string | null = null
  try {
    const { data: rows } = await supabaseAdmin
      .from('auto_messages').select('*').eq('trigger_type', 'reinigung_fertig').order('sort')
    const list = (rows ?? []) as { id: string; enabled: boolean; body: string; listing_id: string | null; listing_ids: string[] | null }[]
    const match = list.find((t) => {
      const ids = Array.isArray(t.listing_ids) && t.listing_ids.length
        ? t.listing_ids : t.listing_id ? [t.listing_id] : null
      return !ids || ids.includes(listingId)
    })
    if (match) {
      if (!match.enabled) return null
      body = match.body
      templateId = match.id
    }
  } catch { /* Vorlagen nicht ladbar → Standardtext */ }

  // §231: frühester Check-in HEUTE — max(Code-Gültigkeits-Beginn, 10-Uhr-
  // Doktrin); ist es schon später (Reinigung z. B. um 13 Uhr fertig), wird
  // daraus „sofort". Gleiche Logik wie im Engine-Morgen-Pfad.
  let earliestHour = 10
  try { earliestHour = Math.max((await getLockSettings()).validFromHour, 10) } catch { /* Default 10 */ }
  const fruehesterCheckin = nowHour >= earliestHour ? 'sofort' : `${String(earliestHour).padStart(2, '0')}:00 Uhr`

  const fallback = 'Gute Nachricht, {vorname} 🎉 Deine Wohnung ist schon fertig vorbereitet — du kannst heute gern schon ab {fruehester_checkin} einchecken (statt regulär {checkin} Uhr).'
    + (arr.door_code ? ' Dein Türcode aus der Gästemappe funktioniert bereits.' : '')

  const fmtDate = (iso: string) => { const [y, m, d] = iso.split('-'); return `${Number(d)}.${Number(m)}.${y}` }
  const nights = Math.max(1, Math.round((Date.parse(arr.check_out) - Date.parse(arr.check_in)) / 86400_000))
  const vorname = (arr.guest_name ?? '').trim().split(/\s+/)[0] || 'lieber Gast'
  const ctx: Record<string, string> = {
    vorname, name: (arr.guest_name ?? '').trim() || 'Gast', wohnung: listingTitle,
    anreise: fmtDate(arr.check_in), abreise: fmtDate(arr.check_out),
    naechte: String(nights), gaeste: String((arr.adults ?? 1) + (arr.children ?? 0)),
    checkin: checkInTime, tuercode: arr.door_code ?? '',
    mappe: arr.portal_token ? `https://trimosa.de/mappe/${arr.portal_token}` : '',
    fruehester_checkin: fruehesterCheckin,
  }
  ctx.mappe_button = ctx.mappe
  let text = resolvePlaceholders(body ?? fallback, ctx)
  // Unaufgelöste Platzhalter nie an Gäste (Engine-Doktrin §148)
  text = text.replace(/\[\[MAPPE_BUTTON\]\]/g, ctx.mappe).replace(/\{\w+\}/g, '')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return text ? { text, templateId } : null
}

/**
 * 🧹 §231 Reinigungs-Abschluss vor Ort: Die Reinigungskraft scannt den
 * NFC-Tag in der Wohnung (URL /reinigung/<cleaning_token>) und tippt auf
 * „Fertig" — ohne Login. Absicherung dreifach: (1) Tag hängt versteckt,
 * (2) Meldung nur im offenen Reinigungsfenster (Abreise ≤ 14 Tage her,
 * Uhrzeit 06–20 Berlin, einmal je Slot), (3) Nuki-Log-Zeuge: wurde heute
 * ein Team-Code am Schloss benutzt? Nur BESTÄTIGTE Meldungen lösen die
 * Früh-Check-in-Nachricht an den heute anreisenden Gast aus.
 */

const WINDOW_DAYS = 14
const HOUR_FROM = 6
const HOUR_UNTIL = 20

function berlinNow(): { date: string; hm: string; hour: number } {
  const now = new Date()
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(now) // "2026-08-01"
  const hm = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now) // "12:41"
  return { date, hm, hour: Number(hm.slice(0, 2)) }
}

interface ListingRow {
  id: string
  title: string | null
  cleaning_token?: string
  cleaning_responsible?: string | null
  check_in_time?: string | null
  check_out_time?: string | null
  locks?: LockRef[] | null
}

export interface CleaningState {
  listingId: string
  title: string
  /** offener Reinigungs-Slot (= Abreisetag) oder null */
  slotDate: string | null
  /** bereits gemeldet? (dann Uhrzeit der Meldung) */
  alreadyAt: string | null
  nextCheckIn: string | null
}

async function listingByToken(token: string): Promise<ListingRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null
  const { data, error } = await supabaseAdmin
    .from('listings')
    .select('id, title, cleaning_token, cleaning_responsible, check_in_time, check_out_time, locks')
    .eq('cleaning_token', token)
    .maybeSingle()
  if (error) {
    // Migration 20260801_cleaning_done.sql noch nicht gelaufen → fail-soft
    console.error('[cleaning-done] listings-Select fehlgeschlagen (Migration offen?):', error.message)
    return null
  }
  return (data as ListingRow | null) ?? null
}

export async function getCleaningState(token: string): Promise<CleaningState | null> {
  const l = await listingByToken(token)
  if (!l) return null
  const { date: today } = berlinNow()
  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString().slice(0, 10)

  const { data: dep } = await supabaseAdmin
    .from('bookings')
    .select('check_out')
    .eq('listing_id', l.id).eq('status', 'confirmed')
    .lte('check_out', today).gte('check_out', since)
    .order('check_out', { ascending: false })
    .limit(1).maybeSingle()
  const slotDate = (dep?.check_out as string | undefined) ?? null

  let alreadyAt: string | null = null
  if (slotDate) {
    const { data: conf } = await supabaseAdmin
      .from('cleaning_confirmations')
      .select('confirmed_at')
      .eq('listing_id', l.id).eq('slot_date', slotDate)
      .maybeSingle()
    alreadyAt = (conf?.confirmed_at as string | undefined) ?? null
  }

  let nextCheckIn: string | null = null
  if (slotDate) {
    const { data: arr } = await supabaseAdmin
      .from('bookings')
      .select('check_in')
      .eq('listing_id', l.id).eq('status', 'confirmed')
      .gte('check_in', slotDate)
      .order('check_in', { ascending: true })
      .limit(1).maybeSingle()
    nextCheckIn = (arr?.check_in as string | undefined) ?? null
  }

  return { listingId: l.id, title: l.title ?? 'Wohnung', slotDate, alreadyAt, nextCheckIn }
}

export interface ConfirmResult {
  ok: boolean
  status: 'gemeldet' | 'schon_gemeldet' | 'kein_slot' | 'zeitfenster' | 'unbekannt' | 'fehler'
  verify?: 'bestaetigt' | 'unbestaetigt' | 'nicht_pruefbar'
  earlyCheckinSent?: boolean
  /** §255: gemessene Reinigungsdauer (erste Türöffnung → Meldung), wenn ermittelbar */
  durationMin?: number | null
}

export async function confirmCleaning(token: string): Promise<ConfirmResult> {
  const l = await listingByToken(token)
  if (!l) return { ok: false, status: 'unbekannt' }
  const state = await getCleaningState(token)
  if (!state) return { ok: false, status: 'unbekannt' }
  if (!state.slotDate) return { ok: false, status: 'kein_slot' }
  if (state.alreadyAt) return { ok: true, status: 'schon_gemeldet' }
  const now = berlinNow()
  if (now.hour < HOUR_FROM || now.hour >= HOUR_UNTIL) return { ok: false, status: 'zeitfenster' }

  // §248c/Inhaber-Entscheid 7.8.: Der Nuki-Zeuge ist RAUS — er produzierte
  // nur „unbestätigt"-Rauschen (Reinigungsteam nutzt Alt-Dauercodes) und
  // blockierte die Früh-Check-in-Automatik. Schutz gegen Fehlmeldungen
  // bleibt: verstecktes Tag, Server-Zeitfenster, einmal je Slot, Team-Push.
  const verify = 'nicht_pruefbar' as const

  // Person aus der Wohnungs-Zuordnung (Reinigungs-Management)
  let personName: string | null = null
  if (l.cleaning_responsible) {
    const { data: p } = await supabaseAdmin
      .from('profiles').select('display_name').eq('id', l.cleaning_responsible).maybeSingle()
    personName = ((p?.display_name as string | undefined) ?? '').trim().split(/\s+/)[0] || null
  }

  const { error: insErr } = await supabaseAdmin.from('cleaning_confirmations').insert({
    listing_id: l.id, slot_date: state.slotDate,
    person_id: l.cleaning_responsible ?? null, person_name: personName,
    verify_status: verify, source: 'nfc',
  })
  if (insErr) {
    // Unique-Index → parallel schon gemeldet; alles andere = echter Fehler
    if (/duplicate|unique/i.test(insErr.message)) return { ok: true, status: 'schon_gemeldet' }
    console.error('[cleaning-done] Insert fehlgeschlagen:', insErr.message)
    return { ok: false, status: 'fehler' }
  }

  // ⏱ §255: Reinigungs-DAUER — Start = erste Türöffnung ohne Gast-Codes am
  // heutigen Tag (Schloss-Protokoll), Ende = diese Fertigmeldung. Grenze:
  // am Abreisetag selbst zählt erst ab Check-out-Zeit (der Gast öffnet
  // morgens ja noch selbst); an späteren Tagen ab 06:00.
  let durationLabel = ''
  let durationMin: number | null = null
  try {
    const afterHm = state.slotDate === now.date
      ? ((l.check_out_time ?? '10:00').slice(0, 5))
      : '06:00'
    const { firstCleaningOpenAt } = await import('@/lib/locks')
    const startedAt = await firstCleaningOpenAt((l.locks as LockRef[] | null) ?? [], afterHm)
    if (startedAt) {
      const mins = Math.round((Date.now() - Date.parse(startedAt)) / 60000)
      if (mins >= 1 && mins <= 12 * 60) {
        durationMin = mins
        await supabaseAdmin.from('cleaning_confirmations')
          .update({ started_at: startedAt, duration_min: mins })
          .eq('listing_id', l.id).eq('slot_date', state.slotDate)
        const h = Math.floor(mins / 60)
        durationLabel = ` · Dauer ${h ? `${h} h ` : ''}${mins % 60} min`
      }
    }
  } catch (e) {
    // Migration 20260811_cleaning_duration.sql offen oder Schloss nicht
    // erreichbar → Meldung läuft normal weiter, nur ohne Dauer
    console.error('[cleaning-done] Dauer-Messung fehlgeschlagen:', e)
  }

  let earlyCheckinSent = false

  // 🎉 Früh-Check-in bei JEDER Fertigmeldung (Zeugen-Bedingung entfernt,
  // Inhaber 7.8.): Anreise heute, vor der Check-in-Zeit — Text kommt aus
  // der Auto-Nachrichten-Vorlage (Trigger „Reinigung gemeldet", im Editor
  // an/aus & editierbar), Zustellung über den bewährten Gast-Kanal (§220).
  // Respektiert den 🚦-Master-Schalter.
  {
    try {
      const { data: arr } = await supabaseAdmin
        .from('bookings')
        .select('id, source, payment_status, door_code, guest_name, check_in, check_out, adults, children, portal_token')
        .eq('listing_id', l.id).eq('status', 'confirmed').eq('check_in', now.date)
        .maybeSingle()
      const paidOk = arr && (arr.source !== 'trimosa' || arr.payment_status === 'paid')
      const checkInTime = (l.check_in_time ?? '16:00').slice(0, 5)
      if (arr && paidOk && now.hm < checkInTime) {
        const { getAutoSendEnabled } = await import('@/lib/auto-messages-engine')
        const rendered = (await getAutoSendEnabled())
          ? await renderEarlyCheckinText(l.id, l.title ?? 'Wohnung', arr, checkInTime, now.hour)
          : null
        // Dedupe gegen den Anreisetag-Morgen-Pfad der Engine (§231): Claim-
        // Insert ins auto_message_log — existiert der Eintrag schon, hat die
        // Engine heute Morgen bereits versendet.
        let claimed = true
        if (rendered?.templateId) {
          const { error: logErr } = await supabaseAdmin.from('auto_message_log').insert({
            auto_message_id: rendered.templateId, booking_id: arr.id, channel: 'reinigung-event',
          })
          if (logErr && /duplicate|unique/i.test(logErr.message)) claimed = false
        }
        if (rendered && claimed) {
          const { deliverToGuest } = await import('@/lib/voice')
          const res = await deliverToGuest(arr.id, rendered.text, { testMode: false })
          earlyCheckinSent = res.delivery === 'smoobu' || res.delivery === 'email'
        }
      }
    } catch (e) {
      console.error('[cleaning-done] Früh-Check-in-Nachricht fehlgeschlagen:', e)
    }
  }

  try {
    const { sendPushToTeam } = await import('@/lib/push')
    await sendPushToTeam(
      `🧹 ${l.title ?? 'Wohnung'} als gereinigt gemeldet`,
      `${personName ?? 'Vor Ort'} · ${now.hm} Uhr${durationLabel}`
        + (earlyCheckinSent ? ' · Früh-Check-in-Info an den Gast gesendet' : ''),
      // v4: eigene Kategorie 'reinigung' — Fertigmeldungen sind einzeln
      // abschaltbar, ohne die Aufgaben-Zuweisungen (tasks) mitzukillen
      '/team', { category: 'reinigung' },
    )
  } catch (e) {
    console.error('[cleaning-done] Team-Push fehlgeschlagen:', e)
  }

  return { ok: true, status: 'gemeldet', verify, earlyCheckinSent, durationMin }
}
