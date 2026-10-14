// server-only (Kommentar-Konvention §243)
import { supabaseAdmin } from '@/lib/supabase-admin'
import { stripe } from '@/lib/stripe'
import { resolveOverbooking } from '@/lib/overbooking'
import { PENDING_PAYMENT_TTL_MIN } from '@/lib/booking-status'

/**
 * 🧹 Aufräumer für verfallene Sofortbuchungen (status 'pending_payment', älter als PENDING_PAYMENT_TTL_MIN).
 * Primär räumt der Stripe-Webhook checkout.session.expired auf; das hier ist das Sicherheitsnetz für
 * verlorene Webhook-Events und Buchungen, deren Stripe-Session nie entstand. Stripe bleibt die Wahrheit:
 * eine bezahlte oder noch offene Session wird NIE weggeräumt (dann bestätigt der Webhook bzw. die
 * Erfolgsseite, oder der nächste Lauf räumt nach Ablauf auf).
 * Läuft als Cron (/api/bookings/sweep, alle 15 Min) und gezielt je Wohnung vor jeder neuen Buchung.
 */
export async function sweepPendingPayments(opts: { listingId?: string } = {}): Promise<{
  geprueft: number; storniert: number; uebersprungen: number; fehler?: string
}> {
  const cutoff = new Date(Date.now() - PENDING_PAYMENT_TTL_MIN * 60_000).toISOString()
  let q = supabaseAdmin
    .from('bookings')
    .select('id, listing_id, check_in, check_out, stripe_checkout_session_id, payment_status, created_at')
    .eq('status', 'pending_payment')
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(50)
  if (opts.listingId) q = q.eq('listing_id', opts.listingId)
  const { data, error } = await q
  if (error) {
    console.error('[booking-sweep] Abfrage fehlgeschlagen:', error.message)
    return { geprueft: 0, storniert: 0, uebersprungen: 0, fehler: error.message }
  }

  let storniert = 0
  let uebersprungen = 0
  for (const b of data ?? []) {
    if (b.payment_status === 'paid') { uebersprungen++; continue } // Webhook/Erfolgsseite bestätigen gleich

    if (b.stripe_checkout_session_id) {
      try {
        const s = await stripe.checkout.sessions.retrieve(b.stripe_checkout_session_id)
        if (s.payment_status === 'paid') {
          console.warn('[booking-sweep] bezahlt, aber noch pending_payment — Webhook ausstehend, nicht angefasst:', b.id)
          uebersprungen++; continue
        }
        if (s.status === 'open') {
          // z. B. „Zahlung erneut starten": neue Session, alte Buchung — läuft von selbst ab
          uebersprungen++; continue
        }
      } catch (e) {
        // Unbekannter Stripe-Zustand → NICHT stornieren (Session könnte bezahlt sein, Webhook verzögert); der nächste
        // Lauf prüft erneut. Nur uralte Leichen (> 24 h, Session längst abgelaufen) räumt das Zeitfenster weg.
        const uralt = Date.parse(String(b.created_at)) < Date.now() - 24 * 3_600_000
        console.warn('[booking-sweep] Stripe-Session nicht abrufbar:', b.id, uralt ? '(> 24 h, Zeitfenster entscheidet)' : '(übersprungen bis zum nächsten Lauf)', e instanceof Error ? e.message : e)
        if (!uralt) { uebersprungen++; continue }
      }
    }

    // Bedingtes Update = idempotent gegen den parallel laufenden Webhook
    const { data: upd, error: updErr } = await supabaseAdmin
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('id', b.id)
      .eq('status', 'pending_payment')
      .neq('payment_status', 'paid')
      .select('id')
    if (updErr) { console.error('[booking-sweep] Storno fehlgeschlagen:', b.id, updErr.message); continue }
    if (!upd?.length) { uebersprungen++; continue }
    storniert++
    console.log('[booking-sweep] verfallene Sofortbuchung storniert:', b.id, b.check_in, '–', b.check_out)

    if (b.listing_id && b.check_in && b.check_out) {
      await resolveOverbooking({
        listingId: b.listing_id, checkIn: b.check_in, checkOut: b.check_out,
        grund: 'Die unbezahlte Website-Buchung ist verfallen (Checkout nicht abgeschlossen) — der Zeitraum ist wieder frei.',
      }).catch((e) => console.error('[booking-sweep] overbooking resolve:', e))
    }
  }
  return { geprueft: (data ?? []).length, storniert, uebersprungen }
}
