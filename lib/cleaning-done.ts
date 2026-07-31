import { supabaseAdmin } from '@/lib/supabase-admin'
import { staffCodeUsedToday, type LockRef } from '@/lib/locks'

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
    .select('id, title, cleaning_token, cleaning_responsible, check_in_time, locks')
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

  // Nuki-Zeuge: Team-Code heute an der Tür benutzt?
  const used = await staffCodeUsedToday((l.locks ?? []) as LockRef[])
  const verify = used === true ? 'bestaetigt' : used === false ? 'unbestaetigt' : 'nicht_pruefbar'

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

  // 🔔 Team-Push — immer, damit Fehlmeldungen sofort auffallen (§135: awaited)
  const verifyLabel = verify === 'bestaetigt' ? '✓ Schloss-Bestätigung'
    : verify === 'unbestaetigt' ? '⚠️ OHNE Schloss-Bestätigung' : 'Schloss nicht prüfbar'
  let earlyCheckinSent = false

  // 🎉 Früh-Check-in: nur bei BESTÄTIGTER Meldung, Anreise heute, vor der
  // Check-in-Zeit — Zustellung über den bewährten Gast-Kanal (§220).
  if (verify === 'bestaetigt') {
    try {
      const { data: arr } = await supabaseAdmin
        .from('bookings')
        .select('id, source, payment_status, door_code')
        .eq('listing_id', l.id).eq('status', 'confirmed').eq('check_in', now.date)
        .maybeSingle()
      const paidOk = arr && (arr.source !== 'trimosa' || arr.payment_status === 'paid')
      const checkInTime = (l.check_in_time ?? '16:00').slice(0, 5)
      if (arr && paidOk && now.hm < checkInTime) {
        const { deliverToGuest } = await import('@/lib/voice')
        const text = `Gute Nachricht 🎉 Deine Wohnung ist schon fertig vorbereitet — du kannst heute gern auch früher als ${checkInTime} Uhr einchecken.`
          + (arr.door_code ? ' Dein Türcode aus der Gästemappe funktioniert bereits.' : '')
        const res = await deliverToGuest(arr.id, text, { testMode: false })
        earlyCheckinSent = res.delivery === 'smoobu' || res.delivery === 'email'
      }
    } catch (e) {
      console.error('[cleaning-done] Früh-Check-in-Nachricht fehlgeschlagen:', e)
    }
  }

  try {
    const { sendPushToTeam } = await import('@/lib/push')
    await sendPushToTeam(
      `🧹 ${l.title ?? 'Wohnung'} als gereinigt gemeldet`,
      `${personName ?? 'Vor Ort'} · ${now.hm} Uhr · ${verifyLabel}`
        + (earlyCheckinSent ? ' · Früh-Check-in-Info an den Gast gesendet' : ''),
      '/team',
    )
  } catch (e) {
    console.error('[cleaning-done] Team-Push fehlgeschlagen:', e)
  }

  return { ok: true, status: 'gemeldet', verify, earlyCheckinSent }
}
