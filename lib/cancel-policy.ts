/**
 * Stornierungsbedingungen — REINE Funktionen ohne Stripe-Import, damit auch Client-Komponenten
 * (Buchungsbox) denselben Text zeigen wie Bestätigungsmail, Gastbereich und Erstattungslogik
 * (Audit 14.10.2026: die Buchungsbox hatte eigene, abweichende Texte, u. a. eine 48-h-Regel, die es
 * im Code nie gab). lib/stripe.ts re-exportiert alles für bestehende Importe.
 */
import { t, type UiLang } from '@/lib/i18n'

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

/** Resolves a listing's effective cancellation policy (custom values, else template). */
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
 * Two tiers: ≥ freeDays before check-in → freePercent; ≥ partialDays → partialPercent; else 0.
 */
export function refundAmount(totalPrice: number, policy: CancelPolicy, checkIn: string, cancelledAt: Date = new Date()): number {
  const checkinDate = new Date(checkIn + 'T00:00:00')
  const daysUntil = Math.floor((checkinDate.getTime() - cancelledAt.getTime()) / 86400000)
  if (daysUntil >= policy.freeDays) return totalPrice * (policy.freePercent / 100)
  if (policy.partialDays != null && policy.partialPercent != null && daysUntil >= policy.partialDays) {
    return totalPrice * (policy.partialPercent / 100)
  }
  return 0
}

/** Lesbarer Text der Bedingungen in der gewünschten Sprache (Buchungsbox, Gastbereich). */
export function policyText(p: CancelPolicy, lang: UiLang = 'de'): string {
  const tage = (n: number) => (n === 1 ? t(lang, 'Tag') : t(lang, 'Tage'))
  const parts: string[] = []
  if (p.freePercent === 100) {
    parts.push(t(lang, 'Kostenlose Stornierung bis {n} {d} vor Check-in.', { n: p.freeDays, d: tage(p.freeDays) }))
  } else if (p.freePercent > 0) {
    parts.push(t(lang, '{p} % Erstattung bis {n} {d} vor Check-in.', { p: p.freePercent, n: p.freeDays, d: tage(p.freeDays) }))
  }
  if (p.partialDays != null && p.partialPercent != null && p.partialPercent > 0) {
    parts.push(t(lang, '{p} % Erstattung bis {n} {d} vor Check-in.', { p: p.partialPercent, n: p.partialDays, d: tage(p.partialDays) }))
  }
  parts.push(t(lang, 'Danach keine Erstattung.'))
  return parts.join(' ')
}

/** Deutsche Beschreibung (Mails, Erstattungs-Chat) — identisch mit policyText(p, 'de'). */
export function policyDescription(p: CancelPolicy): string {
  return policyText(p, 'de')
}
