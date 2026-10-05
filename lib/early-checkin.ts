import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * Paragraph 309 (Pascal 9.9. 19:25): Early-Check-in-Sperre.
 * Gesperrt, wenn (a) die Buchung manuell gesperrt ist (bookings.early_checkin_blocked, Migration
 * 20260910_early_checkin_block.sql - Abfrage ist deploy-sicher) oder (b) am Anreisetag eine offene/laufende
 * Aufgabe fuer diese Wohnung eingeplant ist (Handwerker im Haus). Ergebnis mit lesbarem Grund fuer Heute.
 */
export async function earlyCheckinBlock(b: { id: string; listing_id: string | null; check_in: string }): Promise<{ blocked: boolean; reason: string | null }> {
  try {
    const { data, error } = await supabaseAdmin
      .from('bookings').select('early_checkin_blocked, early_checkin_block_reason').eq('id', b.id).maybeSingle()
    if (!error && data?.early_checkin_blocked) {
      return { blocked: true, reason: String(data.early_checkin_block_reason ?? 'manuell gesperrt') }
    }
  } catch { /* Spalte fehlt noch */ }
  if (!b.listing_id) return { blocked: false, reason: null }
  try {
    // 4.10.2026 (live gesehen an Magnolia Flat): Die automatisch erzeugte Aufgabe „📮 FeWo-direkt: Gastdaten
    // fehlen …" (source 'system', fällig heute) sperrte den Early Check-in als „Arbeiten geplant". Sperren dürfen
    // nur Aufgaben, hinter denen wirklich jemand in der Wohnung arbeitet – also keine System-, Anruf- oder
    // Überbuchungs-Aufgaben. KI-Aufgaben (ki_nachricht/ki_bewertung) sperren WEITER: als 'vorschlag' zählen
    // sie ohnehin nicht, und ein vom Admin angenommener Mangel („Duschkopf tauschen") ist echte Arbeit.
    const KEINE_ARBEIT = new Set(['system', 'anruf', 'ueberbuchung'])
    const { data: rows } = await supabaseAdmin
      .from('tasks').select('title, status, source')
      .eq('listing_id', b.listing_id).eq('due_date', b.check_in).in('status', ['offen', 'in_arbeit']).limit(12)
    const tasks = (rows ?? []).filter((t) => !KEINE_ARBEIT.has(String((t as { source?: string | null }).source ?? '')) && !/^(📮|☎️|💬)/u.test(String(t.title ?? '').trim())).slice(0, 3)
    if (tasks.length) {
      return { blocked: true, reason: `Arbeiten geplant: ${tasks.map((t) => String(t.title).slice(0, 40)).join(', ')}` }
    }
  } catch { /* fail-soft */ }
  return { blocked: false, reason: null }
}

/** Vier-Schritte-Leiste (1.10.): Claim-Marker im auto_message_log, solange ein Versand läuft —
 *  dieselbe Schreibweise wie die Engine (EIN Zeichen U+2026, nicht drei Punkte). */
export const EARLY_LOG_CLAIM = 'sendet…'

export interface EarlyTpl { id: string; enabled: boolean; listing_id?: string | null; listing_ids?: string[] | null }

/**
 * Die EINE Auswahl der Vorlage „Früher Check-in möglich" (Trigger 'reinigung_fertig') für eine
 * Wohnung: erste passende Vorlage der nach `sort` sortierten Liste (ohne Wohnungs-Chips = gilt für
 * alle). null = keine passt. Gemeinsam für Versand (lib/cleaning-done.ts) und Heute-Anzeige.
 */
export function pickEarlyTemplate<T extends EarlyTpl>(list: T[], listingId: string): T | null {
  return list.find((t) => {
    const ids = Array.isArray(t.listing_ids) && t.listing_ids.length
      ? t.listing_ids : t.listing_id ? [t.listing_id] : null
    return !ids || ids.includes(listingId)
  }) ?? null
}
