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

/* ── Template defaults for the three built-in policies ───────────── */

export const POLICY_TEMPLATES: Record<string, {
  freeDays: number
  freePercent: number
  partialDays: number | null
  partialPercent: number | null
}> = {
  flexibel: { freeDays: 1, freePercent: 100, partialDays: null, partialPercent: null },
  moderat:  { freeDays: 5, freePercent: 100, partialDays: null, partialPercent: null },
  strikt:   { freeDays: 14, freePercent: 50, partialDays: null, partialPercent: null },
}

/* ── Cancellation policy parameters ─────────────────────────────── */

export interface CancelPolicy {
  /** Days before check-in for "free" (highest-tier) refund */
  freeDays: number
  /** Refund percentage during free period (0-100) */
  freePercent: number
  /** Days before check-in for partial-refund tier (null = no partial tier) */
  partialDays: number | null
  /** Partial refund percentage (0-100) */
  partialPercent: number | null
}

/**
 * Resolves a listing's effective cancellation policy.
 * Uses custom values if set, otherwise falls back to the template.
 */
export function resolvePolicy(listing: {
  cancellation_policy?: string | null
  cancel_free_days?: number | null
  cancel_free_percent?: number | null
  cancel_partial_days?: number | null
  cancel_partial_percent?: number | null
}): CancelPolicy {
  const templateName = listing.cancellation_policy ?? 'moderat'
  const template = POLICY_TEMPLATES[templateName] ?? POLICY_TEMPLATES.moderat

  return {
    freeDays:       listing.cancel_free_days      ?? template.freeDays,
    freePercent:    listing.cancel_free_percent    ?? template.freePercent,
    partialDays:    listing.cancel_partial_days    ?? template.partialDays,
    partialPercent: listing.cancel_partial_percent ?? template.partialPercent,
  }
}

/**
 * Refund amount based on cancellation policy and days until check-in.
 *
 * Two tiers:
 *   1. freeDays+  before check-in → freePercent %
 *   2. partialDays+ before check-in → partialPercent %  (optional)
 *   3. Less than both → 0
 */
export function refundAmount(
  totalPrice: number,
  policy: CancelPolicy,
  checkIn: string,
  cancelledAt: Date = new Date(),
): number {
  const checkinDate = new Date(checkIn + 'T00:00:00')
  const daysUntil = Math.floor((checkinDate.getTime() - cancelledAt.getTime()) / 86400000)

  // Tier 1: full / free cancellation window
  if (daysUntil >= policy.freeDays) {
    return totalPrice * (policy.freePercent / 100)
  }

  // Tier 2: partial refund window
  if (policy.partialDays != null && policy.partialPercent != null && daysUntil >= policy.partialDays) {
    return totalPrice * (policy.partialPercent / 100)
  }

  // Outside all windows → no refund
  return 0
}

/**
 * Builds a human-readable description of a cancellation policy.
 */
export function policyDescription(p: CancelPolicy): string {
  const parts: string[] = []

  if (p.freePercent === 100) {
    parts.push(`Kostenlose Stornierung bis ${p.freeDays} ${p.freeDays === 1 ? 'Tag' : 'Tage'} vor Check-in.`)
  } else if (p.freePercent > 0) {
    parts.push(`${p.freePercent} % Erstattung bis ${p.freeDays} ${p.freeDays === 1 ? 'Tag' : 'Tage'} vor Check-in.`)
  }

  if (p.partialDays != null && p.partialPercent != null && p.partialPercent > 0) {
    parts.push(`${p.partialPercent} % Erstattung bis ${p.partialDays} ${p.partialDays === 1 ? 'Tag' : 'Tage'} vor Check-in.`)
  }

  parts.push('Danach keine Erstattung.')

  return parts.join(' ')
}
