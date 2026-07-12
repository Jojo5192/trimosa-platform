/**
 * Shared pricing utilities — per-host markup logic.
 *
 * Each host sets a single markup (profiles.markup_pct) that applies to all of
 * their listings. Prices shown/charged = raw Smoobu price × (1 + markup/100).
 */
import { supabaseAdmin } from '@/lib/supabase-admin'

function toMultiplier(pct: unknown): number {
  const n = parseFloat(String(pct ?? 0))
  return isNaN(n) ? 1 : 1 + n / 100
}

/**
 * Markup multiplier for a single host, e.g. 15% → 1.15.
 * Returns 1 (no markup) when no host is given or the host has none set.
 */
export async function getMarkupMultiplier(hostId?: string): Promise<number> {
  if (!hostId) return 1
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('markup_pct')
    .eq('id', hostId)
    .maybeSingle()
  return toMultiplier(data?.markup_pct)
}

/**
 * Markup multipliers for several hosts at once (one query), keyed by host id.
 * Used on the homepage where many listings from (potentially) different hosts
 * are priced together. Missing hosts default to 1.
 */
export async function getHostMarkupMap(hostIds: string[]): Promise<Record<string, number>> {
  const ids = [...new Set(hostIds.filter(Boolean))]
  if (ids.length === 0) return {}
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, markup_pct')
    .in('id', ids)
  const map: Record<string, number> = {}
  for (const row of (data ?? []) as { id: string; markup_pct: unknown }[]) {
    map[row.id] = toMultiplier(row.markup_pct)
  }
  return map
}
