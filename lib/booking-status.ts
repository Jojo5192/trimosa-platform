/**
 * Buchungsstatus (bookings.status) — eine Quelle für die Bedeutung der Werte:
 *   'pending_payment'  Sofortbuchung angelegt, Stripe-Checkout läuft (≤ 30 Min). Reserviert den Zeitraum über den
 *                      DB-Overlap-Schutz, ist aber noch KEINE Buchung: keine Mail, kein Türcode, keine Gästemappe,
 *                      kein Smoobu-Push. Wird vom Stripe-Webhook 'confirmed' oder vom Aufräumer 'cancelled'.
 *   'pending'          Anfrage (booking_type 'request'), wartet auf den Gastgeber.
 *   'confirmed'        Bestätigt (bezahlt bzw. Portal-Import).
 *   'cancelled'        Storniert, verfallen oder abgebrochen.
 *   'completed'        Nur in Anzeige-Labels, kein Schreiber im Code.
 * Eingeführt mit dem Sicherheits-Fix 14.10.2026 (Geisterbuchungen vor Zahlung, HANDOFF §343).
 */

/** Nach so vielen Minuten gilt ein pending_payment ohne Zahlung als verfallen (Stripe-Session läuft nach 30 Min ab). */
export const PENDING_PAYMENT_TTL_MIN = 40

/** Storniert ODER noch unbezahlte Sofortbuchung — für Gästemappe, Rechnung, Chat, Zahllinks keine lebende Buchung. */
export function istInaktiveBuchung(status: string | null | undefined): boolean {
  return status === 'cancelled' || status === 'pending_payment'
}
