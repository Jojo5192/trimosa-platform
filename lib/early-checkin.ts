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
    const { data: tasks } = await supabaseAdmin
      .from('tasks').select('title, status')
      .eq('listing_id', b.listing_id).eq('due_date', b.check_in).in('status', ['offen', 'in_arbeit']).limit(3)
    if (tasks && tasks.length) {
      return { blocked: true, reason: `Arbeiten geplant: ${tasks.map((t) => String(t.title).slice(0, 40)).join(', ')}` }
    }
  } catch { /* fail-soft */ }
  return { blocked: false, reason: null }
}
