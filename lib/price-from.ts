import { supabaseAdmin } from '@/lib/supabase-admin'
import { getApartmentRates } from '@/lib/smoobu'
import { getMarkupMultiplier } from '@/lib/pricing'

/**
 * §161-Jupas ②: „ab X €/Nacht" VOR der Datumswahl — der günstigste
 * verfügbare Smoobu-Nachtpreis der nächsten 90 Tage je Listing, täglich
 * per Cron gecacht (app_settings 'price_from', KEINE Migration nötig).
 * Host-Markup wird wie an allen Preisstellen angewendet.
 */
const KEY = 'price_from'
const g = globalThis as typeof globalThis & { __priceFromCache?: { at: number; map: Record<string, number> } }

type StoredMap = Record<string, { amount: number; updatedAt: string }>

async function loadStored(): Promise<StoredMap> {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', KEY).maybeSingle()
  return (data?.value as StoredMap | null) ?? {}
}

/** Günstigster Nachtpreis je Listing (In-Process-Cache 10 Min, fail-soft {}). */
export async function getPriceFromMap(): Promise<Record<string, number>> {
  if (g.__priceFromCache && Date.now() - g.__priceFromCache.at < 10 * 60_000) return g.__priceFromCache.map
  try {
    const stored = await loadStored()
    const map = Object.fromEntries(Object.entries(stored).map(([id, v]) => [id, v.amount]))
    g.__priceFromCache = { at: Date.now(), map }
    return map
  } catch {
    return {}
  }
}

/** Cron-Kern: alle aktiven Listings mit Smoobu-ID durchrechnen. */
export async function refreshPriceFrom(): Promise<{ updated: number; skipped: number; fehler: string[] }> {
  const { data: listings } = await supabaseAdmin
    .from('listings').select('id, title, host_id, smoobu_id').eq('is_active', true)
  const from = new Date().toISOString().slice(0, 10)
  const to = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10)
  const map = await loadStored() // Fehl-Läufe behalten alte Werte
  const report = { updated: 0, skipped: 0, fehler: [] as string[] }
  for (const l of listings ?? []) {
    if (!l.smoobu_id) { report.skipped++; continue }
    try {
      const rates = await getApartmentRates(l.smoobu_id, from, to)
      const mult = await getMarkupMultiplier(l.host_id)
      const prices = Object.values(rates)
        .filter((r) => r && Number(r.available) > 0 && Number(r.price) > 0)
        .map((r) => Number(r.price) * mult)
      if (!prices.length) { report.skipped++; continue }
      map[l.id] = { amount: Math.round(Math.min(...prices)), updatedAt: new Date().toISOString() }
      report.updated++
    } catch (e) {
      report.fehler.push(`${l.title}: ${e instanceof Error ? e.message : e}`)
    }
  }
  await supabaseAdmin.from('app_settings').upsert({ key: KEY, value: map }, { onConflict: 'key' })
  g.__priceFromCache = undefined
  return report
}
