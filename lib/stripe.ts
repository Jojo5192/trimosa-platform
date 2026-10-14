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

/* ── Stornierungsbedingungen: reine Funktionen in lib/cancel-policy.ts (ohne Stripe-Import, auch für
   Client-Komponenten); hier nur re-exportiert, damit bestehende Importe weiter funktionieren ── */
export { POLICY_TEMPLATES, resolvePolicy, refundAmount, policyDescription } from '@/lib/cancel-policy'
export type { CancelPolicy } from '@/lib/cancel-policy'
