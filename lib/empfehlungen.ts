/**
 * Server-side loader for the hosts' personal recommendations ("Empfohlen
 * von…"). Written via /dashboard/empfehlungen, displayed on the region and
 * erlebnis pages as a speech bubble with the host's face.
 *
 * Fails soft: if the table is missing or the query errors, every map is
 * simply empty and the pages render without recommendations.
 */
import { supabaseAdmin } from '@/lib/supabase-admin'

export interface EmpfehlungView {
  /** First name of the recommending host, e.g. "Johannes" */
  name: string
  avatarUrl: string | null
  comment: string
}

export interface EmpfehlungenMap {
  /** keyed by Poi.slug */
  poi: Record<string, EmpfehlungView[]>
  /** keyed by KulinarikTipp.name */
  kulinarik: Record<string, EmpfehlungView[]>
  /** keyed by KomootTour.embedUrl */
  tour: Record<string, EmpfehlungView[]>
}

export const EMPTY_EMPFEHLUNGEN: EmpfehlungenMap = { poi: {}, kulinarik: {}, tour: {} }

export async function getEmpfehlungen(): Promise<EmpfehlungenMap> {
  try {
    const { data, error } = await supabaseAdmin
      .from('empfehlungen')
      .select('item_type, item_key, comment, profiles:author_id (display_name, avatar_url)')
      .order('created_at', { ascending: true })
    if (error || !data) {
      if (error) console.error('[empfehlungen] load failed:', error.message)
      return EMPTY_EMPFEHLUNGEN
    }
    const map: EmpfehlungenMap = { poi: {}, kulinarik: {}, tour: {} }
    for (const row of data) {
      const type = row.item_type as keyof EmpfehlungenMap
      if (!(type in map)) continue
      // Supabase types joined rows as array or object depending on relation
      const profile = (Array.isArray(row.profiles) ? row.profiles[0] : row.profiles) as
        { display_name: string | null; avatar_url: string | null } | null
      const view: EmpfehlungView = {
        name: profile?.display_name?.trim().split(/\s+/)[0] || 'TRIMOSA',
        avatarUrl: profile?.avatar_url || null,
        comment: row.comment,
      }
      ;(map[type][row.item_key] ??= []).push(view)
    }
    return map
  } catch (err) {
    console.error('[empfehlungen] load error:', err)
    return EMPTY_EMPFEHLUNGEN
  }
}
