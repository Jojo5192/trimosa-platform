import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * §274 Doppel-Push-Schutz: Nach einer bezahlten Website-Buchung pushen ZWEI
 * Pfade zu Smoobu — der Stripe-Webhook (checkout.session.completed) und
 * die Erfolgsseite /booking/success (Fallback für ausgebliebene Webhooks).
 * Beide lasen bisher nur „smoobu_reservation_id ist null" und liefen dann
 * praktisch gleichzeitig los → im schlimmsten Fall ZWEI Reservierungen in
 * Smoobu (die zweite = echte Überbuchung dort), mindestens aber zwei Echos.
 *
 * Der Claim ist eine atomare bedingte UPDATE-Anweisung: nur EIN Pfad
 * bekommt die Zeile zurück und darf pushen. Ein liegengebliebener Claim
 * (Function starb mitten im Smoobu-Call) verfällt nach 2 Minuten.
 *
 * Deploy-sicher: fehlt die Spalte (Migration 20260907 noch nicht ausgeführt),
 * antwortet 'unsupported' — dann verhalten sich beide Pfade wie bisher.
 */
export async function claimSmoobuPush(bookingId: string): Promise<'claimed' | 'taken' | 'unsupported'> {
  const stale = new Date(Date.now() - 2 * 60_000).toISOString()
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .update({ smoobu_push_claimed_at: new Date().toISOString() })
    .eq('id', bookingId)
    .is('smoobu_reservation_id', null)
    .or(`smoobu_push_claimed_at.is.null,smoobu_push_claimed_at.lt.${stale}`)
    .select('id')
  if (error) {
    console.warn('[smoobu-claim] Claim nicht möglich (Migration 20260907 fehlt?):', error.message)
    return 'unsupported'
  }
  return data && data.length > 0 ? 'claimed' : 'taken'
}

/** Push gescheitert → Claim freigeben, damit der andere Pfad / ein Retry darf. */
export async function releaseSmoobuPush(bookingId: string): Promise<void> {
  await supabaseAdmin
    .from('bookings')
    .update({ smoobu_push_claimed_at: null })
    .eq('id', bookingId)
    .is('smoobu_reservation_id', null)
    .then(({ error }) => { if (error) console.warn('[smoobu-claim] release:', error.message) })
}
