import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * 🏷 GUTSCHEINCODES (§243af) — Verwaltung in app_settings 'discount_codes'
 * (Admin-Karte im Dashboard), Anwendung SERVERSEITIG in /api/bookings
 * (der Preis wird dort autoritativ berechnet — §3-Doktrin). Der Client
 * (BookingBox) validiert nur für die Anzeige.
 */

export interface DiscountCode {
  code: string
  pct: number
  aktiv: boolean
}

const KEY = 'discount_codes'

export function normCode(raw: string): string {
  return String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 24)
}

export async function getDiscountCodes(): Promise<DiscountCode[]> {
  try {
    const { data: row } = await supabaseAdmin
      .from('app_settings').select('value').eq('key', KEY).maybeSingle()
    const arr = (row?.value as { codes?: unknown } | null)?.codes
    if (!Array.isArray(arr)) return []
    return arr
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
      .map((c) => ({
        code: normCode(String(c.code ?? '')),
        pct: Number(c.pct ?? 0),
        aktiv: c.aktiv !== false,
      }))
      .filter((c) => c.code.length >= 3 && c.pct > 0 && c.pct <= 50)
  } catch {
    return []
  }
}

export async function saveDiscountCodes(codes: DiscountCode[]): Promise<void> {
  await supabaseAdmin.from('app_settings')
    .upsert({ key: KEY, value: { codes } }, { onConflict: 'key' })
}

/** Aktiven Code auflösen — null, wenn unbekannt/deaktiviert. */
export async function findActiveDiscount(raw: string): Promise<DiscountCode | null> {
  const code = normCode(raw)
  if (!code) return null
  const codes = await getDiscountCodes()
  return codes.find((c) => c.code === code && c.aktiv) ?? null
}
