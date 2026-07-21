import { supabaseAdmin } from '@/lib/supabase-admin'
import { listReservations } from '@/lib/smoobu'
import { sendNewBookingPush } from '@/lib/push'

/**
 * 🛟 Buchungs-Sicherheitsnetz (§137): importiert Smoobu-Reservierungen,
 * die der Webhook verpasst hat — der Webhook-Ausfall vom 21.7. (Eintrag
 * in Smoobu weg/falsch) ließ 10 Buchungen still fehlen, inkl. einer
 * Anreise am selben Tag. Läuft 2×/Stunde im Poll-Cron: idempotent,
 * NEUE Buchungen lösen (verspätet, aber sicher) den Buchungs-Push aus.
 */
export async function importMissingReservations(): Promise<{ imported: number; skipped: number; failed: number }> {
  const { data: listings } = await supabaseAdmin
    .from('listings').select('id, smoobu_id').not('smoobu_id', 'is', null)
  const bySmoobuId = new Map((listings ?? []).map((l) => [Number(l.smoobu_id), l.id as string]))

  // existing-Set range-paginiert (PostgREST cappt bei 1000, §129)
  const existing = new Set<number>()
  for (let off = 0; off < 10000; off += 1000) {
    const { data: rows } = await supabaseAdmin
      .from('bookings').select('smoobu_reservation_id').not('smoobu_reservation_id', 'is', null).range(off, off + 999)
    for (const b of rows ?? []) existing.add(Number(b.smoobu_reservation_id))
    if (!rows || rows.length < 1000) break
  }

  const from = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)
  const to = new Date(Date.now() + 120 * 86400_000).toISOString().slice(0, 10)
  let imported = 0, skipped = 0, failed = 0
  for (let p = 1; p <= 5; p++) {
    const { reservations, hasMore } = await listReservations(from, to, p, 100)
    for (const r of reservations) {
      if (r.cancelled || r.blocked || !r.arrival || !r.departure || existing.has(r.id)) { skipped++; continue }
      const { data: inserted, error } = await supabaseAdmin.from('bookings').insert({
        smoobu_reservation_id: r.id,
        listing_id: r.apartmentId != null ? bySmoobuId.get(r.apartmentId) ?? null : null,
        guest_name: r.guestName,
        check_in: r.arrival,
        check_out: r.departure,
        total_price: Math.round(r.price ?? 0),
        status: 'confirmed',
        channel: r.channelName ?? 'Smoobu',
        source: 'smoobu_webhook',
      }).select('id').single()
      if (error || !inserted) { failed++; console.error('[booking-import]', r.id, error?.message); continue }
      imported++
      existing.add(r.id)
      console.log('[booking-import] verpasste Buchung importiert:', r.id, r.guestName, r.arrival)
      // Buchungs-Push nachholen — await Pflicht (§135)
      await sendNewBookingPush(inserted.id).catch((e) => console.error('[booking-import] push:', e))
    }
    if (!hasMore) break
  }
  if (imported > 0) {
    console.warn(`[booking-import] ⚠️ ${imported} Buchung(en) kamen NICHT per Webhook — Smoobu-Webhook-Konfiguration prüfen!`)
  }
  return { imported, skipped, failed }
}
