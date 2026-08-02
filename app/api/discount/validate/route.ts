import { NextRequest, NextResponse } from 'next/server'
import { findActiveDiscount } from '@/lib/discounts'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * 🏷 Gutscheincode-Prüfung (§243af) — public (der Gast tippt den Code vor
 * dem Login ein), nur für die ANZEIGE in der BookingBox. Autoritativ
 * angewendet wird der Code serverseitig in /api/bookings.
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

export async function POST(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim()
  if (!(await checkRateLimit(`discount:${ip}`, 30, 3600))) {
    return NextResponse.json({ ok: false, error: 'Zu viele Versuche.' }, { status: 429 })
  }
  const b = await req.json().catch(() => ({}))
  const hit = await findActiveDiscount(String(b.code ?? ''))
  if (!hit) return NextResponse.json({ ok: false }, NO_STORE)
  return NextResponse.json({ ok: true, code: hit.code, pct: hit.pct }, NO_STORE)
}
