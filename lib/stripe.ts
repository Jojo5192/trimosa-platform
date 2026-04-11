/**
 * Stripe server-side client — server-only, never import in client components
 */
import Stripe from 'stripe'

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('[Stripe] STRIPE_SECRET_KEY not set — payment features disabled')
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder', {
  apiVersion: '2025-02-24.acacia',
})

export const PLATFORM_FEE_PCT = 0.10  // 10% commission

/** Calculate the Stripe amount in cents */
export function toCents(euros: number): number {
  return Math.round(euros * 100)
}

/** Refund amount based on cancellation policy and days until check-in */
export function refundAmount(
  totalPrice: number,
  policy: string,
  checkIn: string,
  cancelledAt: Date = new Date(),
): number {
  const checkinDate = new Date(checkIn + 'T00:00:00')
  const daysUntil = Math.floor((checkinDate.getTime() - cancelledAt.getTime()) / 86400000)

  if (policy === 'flexibel') {
    return daysUntil >= 1 ? totalPrice : 0
  }
  if (policy === 'moderat') {
    return daysUntil >= 5 ? totalPrice : 0
  }
  if (policy === 'strikt') {
    // Free cancellation within 48h of booking AND at least 14 days before check-in
    // We store the booking created_at - for now use 50% as safe fallback
    return daysUntil >= 14 ? totalPrice * 0.5 : 0
  }
  return 0
}
