import { NextRequest, NextResponse } from 'next/server'
import { getTaskAuth } from '@/lib/tasks'
import { buildHeute, berlinToday } from '@/lib/heute'
import { checkRateLimit } from '@/lib/rate-limit'
import { classifyCheckoutMessage } from '@/lib/checkout-detect'

/**
 * GET /api/heute?tag=YYYY-MM-DD[&fresh=1] — Daten des Heute-Bildschirms
 * (§277). Alle Team-Rollen inkl. Dienstleister (die bekommen keine
 * Gastnamen). Server-Cache 2 Min je Nutzer+Tag, fresh=1 umgeht ihn.
 *
 * POST /api/heute { action: 'checkout-probe', text, sentHm? } — NUR Admin: prüft den
 * Klassifikator der Check-out-Erkennung an einem frei eingegebenen Satz (lib/checkout-detect.ts).
 * Liest und schreibt KEINE Buchung/Nachricht — reine Diagnose ohne echten Gast.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const auth = await getTaskAuth()
  if (!auth) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const p = req.nextUrl.searchParams
  const tagParam = p.get('tag') ?? ''
  const tag = /^\d{4}-\d{2}-\d{2}$/.test(tagParam) ? tagParam : berlinToday()
  try {
    const data = await buildHeute(auth, tag, p.get('fresh') === '1')
    return NextResponse.json({ ...data, role: auth.role }, { headers: { 'Cache-Control': 'no-store, must-revalidate' } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[heute]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await getTaskAuth()
  if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const body = await req.json().catch(() => ({})) as { action?: unknown; text?: unknown; sentHm?: unknown }
  const text = String(body.text ?? '').trim()
  if (body.action !== 'checkout-probe' || text.length < 2 || text.length > 800) {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }
  if (!(await checkRateLimit(`checkout-probe:${auth.userId}`, 40, 3600))) {
    return NextResponse.json({ error: 'Zu viele Versuche – bitte später erneut.' }, { status: 429 })
  }
  const sentHm = /^\d{2}:\d{2}$/.test(String(body.sentHm ?? '')) ? String(body.sentHm) : '09:00'
  const ja = await classifyCheckoutMessage(text, sentHm)
  return NextResponse.json(
    { ok: ja !== null, ausgecheckt: ja, hinweis: ja === null ? 'KI nicht erreichbar (ANTHROPIC_API_KEY/Zeitlimit) – siehe Server-Log.' : undefined },
    { headers: { 'Cache-Control': 'no-store, must-revalidate' } },
  )
}
