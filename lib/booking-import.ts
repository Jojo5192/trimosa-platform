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
export async function importMissingReservations(futureDays = 120): Promise<{ imported: number; skipped: number; failed: number; cancelled: number; updated: number }> {
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
  const to = new Date(Date.now() + futureDays * 86400_000).toISOString().slice(0, 10)
  let imported = 0, skipped = 0, failed = 0
  // Für Storno- und Feld-Abgleich: alles merken, was Smoobu im Fenster kennt
  type Res = Awaited<ReturnType<typeof listReservations>>['reservations'][number]
  const seen = new Map<number, Res>()
  let windowComplete = true
  const maxPages = futureDays > 200 ? 12 : 5
  for (let p = 1; p <= maxPages; p++) {
    const { reservations, hasMore } = await listReservations(from, to, p, 100)
    for (const r of reservations) {
      seen.set(r.id, r)
      if (r.cancelled || r.blocked || !r.arrival || !r.departure || existing.has(r.id)) { skipped++; continue }
      const { data: inserted, error } = await supabaseAdmin.from('bookings').insert({
        smoobu_reservation_id: r.id,
        listing_id: r.apartmentId != null ? bySmoobuId.get(r.apartmentId) ?? null : null,
        guest_name: r.guestName,
        check_in: r.arrival,
        check_out: r.departure,
        total_price: Math.round(r.price ?? 0),
        adults: (r.adults ?? 0) > 0 ? r.adults : 1,
        children: r.children ?? 0,
        status: 'confirmed',
        channel: r.channelName ?? 'Smoobu',
        source: 'smoobu_webhook',
        booking_type: 'instant',
      }).select('id').single()
      if (error || !inserted) { failed++; console.error('[booking-import]', r.id, error?.message); continue }
      imported++
      existing.add(r.id)
      console.log('[booking-import] verpasste Buchung importiert:', r.id, r.guestName, r.arrival)
      // Buchungs-Push nachholen — await Pflicht (§135)
      await sendNewBookingPush(inserted.id).catch((e) => console.error('[booking-import] push:', e))
    }
    if (!hasMore) break
    if (p === maxPages && hasMore) windowComplete = false
  }
  if (imported > 0) {
    console.warn(`[booking-import] ⚠️ ${imported} Buchung(en) kamen NICHT per Webhook — Smoobu-Webhook-Konfiguration prüfen!`)
  }

  // 🧹 STORNO-Abgleich (§138 — der Webhook-Storno-Zweig war seit jeher tot,
  // Altlasten wie „Hanna Kütt" blieben als confirmed liegen): Buchungen,
  // die Smoobu als storniert führt ODER die (bei vollständigem Fenster)
  // gar nicht mehr in Smoobu existieren (gelöscht) → bei uns cancelled.
  let cancelled = 0
  let updated = 0
  const { data: ours } = await supabaseAdmin
    .from('bookings')
    .select('id, smoobu_reservation_id, guest_name, check_in, check_out, adults, children, total_price, source')
    .eq('status', 'confirmed')
    .not('smoobu_reservation_id', 'is', null)
    .gte('check_in', from)
    .lte('check_out', to)
    .limit(1000)
  for (const b of ours ?? []) {
    const sid = Number(b.smoobu_reservation_id)
    const r = seen.get(sid)
    const smoobuCancelled = r?.cancelled === true
    const missingInSmoobu = windowComplete && !seen.has(sid)
    if (smoobuCancelled || missingInSmoobu) {
      const { error } = await supabaseAdmin.from('bookings').update({ status: 'cancelled' }).eq('id', b.id)
      if (!error) {
        cancelled++
        console.log('[booking-import] Storno-Abgleich → cancelled:', b.guest_name, b.check_in, smoobuCancelled ? '(in Smoobu storniert)' : '(in Smoobu gelöscht)')
      }
      continue
    }

    // 🔄 FELD-Abgleich (§176-Nachspiel „Michiel"): Smoobu ist für externe
    // Buchungen die Wahrheit — Gästezahl (unser Import las sie früher gar
    // nicht → Default 1) und Preis (Anpassungen in Smoobu) nachziehen.
    if (!r) continue
    const upd: Record<string, unknown> = {}
    const dbAdults = Number(b.adults ?? 0)
    const smAdults = r.adults ?? 0
    if (smAdults > 0 && dbAdults <= 1 && (smAdults + (r.children ?? 0)) > (dbAdults + Number(b.children ?? 0))) {
      upd.adults = smAdults
      upd.children = r.children ?? 0
    }
    const dbPrice = Number(b.total_price ?? 0)
    if (b.source !== 'trimosa' && (r.price ?? 0) > 0 && Math.abs((r.price ?? 0) - dbPrice) > 1) {
      upd.total_price = Math.round(r.price ?? 0)
    }
    if (Object.keys(upd).length) {
      const { error } = await supabaseAdmin.from('bookings').update(upd).eq('id', b.id)
      if (!error) {
        updated++
        console.log('[booking-import] Feld-Abgleich:', b.guest_name, b.check_in, JSON.stringify(upd))
      }
    }
  }

  return { imported, skipped, failed, cancelled, updated }
}
