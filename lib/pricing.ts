/**
 * Shared pricing utilities — platform markup logic
 */
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * Reads the platform markup percentage from platform_settings (row id=1)
 * and returns a multiplier, e.g. 15% → 1.15
 */
export async function getMarkupMultiplier(): Promise<number> {
  const { data } = await supabaseAdmin
    .from('platform_settings')
    .select('platform_markup_pct')
    .eq('id', 1)
    .single()
  const pct = parseFloat(data?.platform_markup_pct ?? process.env.TRIMOSA_MARKUP_PCT ?? '0')
  return isNaN(pct) ? 1 : 1 + pct / 100
}
