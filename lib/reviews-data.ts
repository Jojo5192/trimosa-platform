import { supabaseAdmin } from '@/lib/supabase-admin'
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

export async function getInitialReviews(listingRow: Record<string, unknown>, limit = 6): Promise<InitialReviews> {
  const listingId = String(listingRow.id)
  const { data, count } = await supabaseAdmin
    .from('reviews')
    .select('*', { count: 'exact' })
    .eq('listing_id', listingId)
    .order('review_date', { ascending: false })
    .range(0, limit - 1)
  const rating = buildCardRating(listingRow)
  return {
    reviews: (data ?? []) as InitialReviews['reviews'],
    total: count ?? (data?.length ?? 0),
    overall: rating ? { avg: rating.overall, count: rating.count } : null,
    sources: Object.fromEntries((rating?.platforms ?? []).map((p) => [p.source, { avg: p.score, count: p.count }])),
  }
}
