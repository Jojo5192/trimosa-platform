import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * §171: Score-Entwicklung — täglicher Snapshot der Bewertungs-Scores aus
 * den autoritativen listings-Spalten in score_history (ein Datenpunkt je
 * Wohnung × Quelle × Tag; 'overall' = review_count-gewichteter Schnitt).
 * Läuft am Ende des täglichen Review-Sync-Crons + auf Abruf. Fail-soft:
 * ohne Migration passiert nichts Schlimmes.
 */
const SOURCES = ['airbnb', 'booking', 'google', 'vrbo'] as const

export async function snapshotScores(): Promise<{ rows: number; error?: string }> {
  try {
    const { data: listings } = await supabaseAdmin
      .from('listings')
      .select('id, airbnb_score, airbnb_review_count, booking_score, booking_review_count, google_score, google_review_count, vrbo_score, vrbo_review_count')
      .eq('is_active', true)
    const rows: { listing_id: string; source: string; score: number; review_count: number }[] = []
    for (const l of listings ?? []) {
      const rec = l as Record<string, unknown>
      let wSum = 0
      let cSum = 0
      for (const src of SOURCES) {
        const score = Number(rec[`${src}_score`])
        const count = Number(rec[`${src}_review_count`])
        if (!Number.isFinite(score) || !Number.isFinite(count) || count <= 0) continue
        rows.push({ listing_id: l.id, source: src, score: Math.round(score * 100) / 100, review_count: count })
        wSum += score * count
        cSum += count
      }
      if (cSum > 0) {
        rows.push({ listing_id: l.id, source: 'overall', score: Math.round((wSum / cSum) * 100) / 100, review_count: cSum })
      }
    }
    if (!rows.length) return { rows: 0 }
    const { error } = await supabaseAdmin
      .from('score_history')
      .upsert(rows.map((r) => ({ ...r, captured_on: new Date().toISOString().slice(0, 10) })), {
        onConflict: 'listing_id,source,captured_on',
      })
    if (error) return { rows: 0, error: error.message }
    return { rows: rows.length }
  } catch (e) {
    return { rows: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

export interface ScorePoint { listingId: string; source: string; score: number; count: number; date: string }

export async function getScoreHistory(days = 365): Promise<ScorePoint[]> {
  const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)
  const out: ScorePoint[] = []
  // >1000 Zeilen möglich (7 Wohnungen × 5 Quellen × 365 Tage) → range-paginieren (§129-Lektion)
  for (let page = 0; page < 20; page++) {
    const { data, error } = await supabaseAdmin
      .from('score_history')
      .select('listing_id, source, score, review_count, captured_on')
      .gte('captured_on', from)
      .order('captured_on', { ascending: true })
      .range(page * 1000, page * 1000 + 999)
    if (error) break
    for (const r of data ?? []) {
      out.push({ listingId: r.listing_id, source: r.source, score: Number(r.score), count: r.review_count, date: r.captured_on })
    }
    if (!data || data.length < 1000) break
  }
  return out
}

/** Globaler (review_count-gewichteter) Schnitt einer Quelle am jüngsten
 *  Snapshot ≤ dem Stichtag — für die Trend-Zeile im Wochenbericht. */
export function globalScoreAt(points: ScorePoint[], source: string, onOrBefore: string): { score: number; count: number } | null {
  const bySrc = points.filter((p) => p.source === source && p.date <= onOrBefore)
  if (!bySrc.length) return null
  const latestDate = bySrc.reduce((m, p) => (p.date > m ? p.date : m), '')
  const day = bySrc.filter((p) => p.date === latestDate)
  const cSum = day.reduce((s, p) => s + p.count, 0)
  if (cSum <= 0) return null
  const wSum = day.reduce((s, p) => s + p.score * p.count, 0)
  return { score: Math.round((wSum / cSum) * 100) / 100, count: cSum }
}
