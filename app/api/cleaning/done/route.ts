import { NextRequest, NextResponse } from 'next/server'
import { confirmCleaning } from '@/lib/cleaning-done'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * 🧹 §231: Fertigmeldung vom NFC-Tag (öffentliche Seite /reinigung/<token>).
 * Kein Login — Absicherung über Token + Reinigungsfenster + Nuki-Log-Zeuge
 * (lib/cleaning-done.ts). Rate-Limit gegen Durchprobieren.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim()
  const allowed = await checkRateLimit(`cleaning-done:${ip}`, 30, 3600)
  if (!allowed) {
    return NextResponse.json({ ok: false, status: 'fehler', error: 'Zu viele Versuche.' }, { status: 429 })
  }
  const body = await req.json().catch(() => ({}))
  const token = String(body.token ?? '')
  if (!token) return NextResponse.json({ ok: false, status: 'unbekannt' }, { status: 400 })
  try {
    const result = await confirmCleaning(token)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store, must-revalidate' } })
  } catch (e) {
    console.error('[cleaning-done] POST fehlgeschlagen:', e)
    return NextResponse.json({ ok: false, status: 'fehler' }, { status: 500 })
  }
}
