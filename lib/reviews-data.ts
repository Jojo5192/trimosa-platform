import { getReviewsPage } from '@/lib/public-data'
import { buildCardRating } from '@/lib/rating'

/**
 * §161-Jupas ①: Bewertungen SERVERSEITIG für die Listing-Detailseite —
 * die ersten Reviews landen im initialen HTML (Google sieht echte Texte
 * statt „Laden…") und speisen aggregateRating + review-Items im JSON-LD.
 * Gleiche Datenform wie GET /api/reviews (ReviewsSection-initial).
 */
export interface InitialReviews {
  reviews: {
    id: string; source: string; author_name: string; author_avatar?: string
    rating: number; review_text?: string; review_date: string; verified?: boolean
  }[]
  total: number
  overall: { avg: number; count: number } | null
  sources: Record<string, { avg: number; count: number }>
}

/** Zusammensetzen aus einer (gecachten) Review-Seite + den Score-Spalten der Inserats-Zeile — kein I/O. */
export function buildInitialReviews(listingRow: Record<string, unknown>, page: { reviews: unknown[]; total: number }): InitialReviews {
  const rating = buildCardRating(listingRow)
  return {
    reviews: page.reviews as InitialReviews['reviews'],
    total: page.total,
    overall: rating ? { avg: rating.overall, count: rating.count } : null,
    sources: Object.fromEntries((rating?.platforms ?? []).map((p) => [p.source, { avg: p.score, count: p.count }])),
  }
}

export async function getInitialReviews(listingRow: Record<string, unknown>, limit = 6): Promise<InitialReviews> {
  const page = await getReviewsPage(String(listingRow.id), limit).catch(() => ({ reviews: [], total: 0 }))
  return buildInitialReviews(listingRow, page)
}
