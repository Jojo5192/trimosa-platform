import type { CardRating } from '@/components/ScoreBadge'

/**
 * Weighted review rating from the synced per-platform score columns on a
 * listings row (airbnb/booking/google/vrbo _score + _review_count).
 */
export function buildCardRating(l: Record<string, unknown>): CardRating | undefined {
  const platforms: CardRating['platforms'] = []
  for (const src of ['airbnb', 'booking', 'google', 'vrbo']) {
    const score = l[`${src}_score`]
    const count = l[`${src}_review_count`]
    if (score != null && count != null && Number(count) > 0) {
      platforms.push({ source: src, score: Math.round(Number(score) * 10) / 10, count: Number(count) })
    }
  }
  if (platforms.length === 0) return undefined
  const total = platforms.reduce((s, p) => s + p.score * p.count, 0)
  const count = platforms.reduce((s, p) => s + p.count, 0)
  return { overall: Math.round((total / count) * 100) / 100, count, platforms }
}
