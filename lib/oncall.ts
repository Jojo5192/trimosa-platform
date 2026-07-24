import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * ☎️ Bereitschaft (§175): steuert, WER akute Telefon-Meldungen sieht und
 * gepusht bekommt. Gespeichert in app_settings 'oncall_settings'
 * { userIds: string[] } — KEINE Migration nötig.
 * LEERE Liste = Fallback „alle im Team" (nichts darf verloren gehen).
 */
export async function getOncallIds(): Promise<string[]> {
  try {
    const { data } = await supabaseAdmin
      .from('app_settings').select('value').eq('key', 'oncall_settings').maybeSingle()
    const ids = (data?.value as { userIds?: unknown } | null)?.userIds
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export async function saveOncallIds(userIds: string[]): Promise<void> {
  await supabaseAdmin.from('app_settings').upsert({ key: 'oncall_settings', value: { userIds } })
}

/** Ist dieser Nutzer „im Dienst"? Leere Liste = alle. */
export async function isOncall(userId: string): Promise<boolean> {
  const ids = await getOncallIds()
  return ids.length === 0 || ids.includes(userId)
}
