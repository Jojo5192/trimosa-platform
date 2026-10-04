import { NextRequest, NextResponse } from 'next/server'
import { getTaskAuth } from '@/lib/tasks'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkRateLimit } from '@/lib/rate-limit'
import { informGuestReady } from '@/lib/early-inform'
import { invalidateHeuteCache } from '@/lib/heute'

/**
 * 📣 POST /api/heute/inform — Knopf „Gast jetzt informieren" der Heute-Seite (Vier-Schritte-Leiste,
 * Schritt 3). NUR Admin/Gastgeber. Body: { bookingId, bestaetigt: true, erneut?: true }.
 * Sendet die Vorlage „Früher Check-in möglich" einmalig an den heute anreisenden Gast — alle
 * Prüfungen (Sperren, Master-Schalter, Claim gegen Doppelversand) stehen in lib/early-inform.ts.
 * Ohne `bestaetigt: true` wird nie gesendet (der Client fragt vorher nach).
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'no-store, must-revalidate' }

export async function POST(req: NextRequest) {
  const auth = await getTaskAuth()
  if (!auth || auth.role !== 'admin') {
    return NextResponse.json({ ok: false, code: 'fehler', message: 'Nur für Admins und Gastgeber.' }, { status: 403, headers: NO_STORE })
  }
  const body = await req.json().catch(() => ({})) as { bookingId?: unknown; bestaetigt?: unknown; erneut?: unknown }
  const bookingId = String(body.bookingId ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(bookingId) || body.bestaetigt !== true) {
    return NextResponse.json({ ok: false, code: 'fehler', message: 'Ungültige Anfrage.' }, { status: 400, headers: NO_STORE })
  }
  if (!(await checkRateLimit(`heute-inform:${auth.userId}`, 30, 3600))) {
    return NextResponse.json({ ok: false, code: 'fehler', message: 'Zu viele Versuche – bitte später erneut.' }, { status: 429, headers: NO_STORE })
  }
  try {
    const { data: me } = await supabaseAdmin.from('profiles').select('display_name').eq('id', auth.userId).maybeSingle()
    const actorName = String(me?.display_name ?? '').trim().split(/\s+/)[0] || 'Team'
    const r = await informGuestReady({ bookingId, actorName, erneut: body.erneut === true })
    invalidateHeuteCache()
    const status = r.ok ? 200 : r.code === 'nicht_gefunden' ? 404 : r.code === 'fehler' ? 500 : r.code === 'nicht_zustellbar' ? 502 : 409
    return NextResponse.json(r, { status, headers: NO_STORE })
  } catch (e) {
    console.error('[heute/inform]', e)
    invalidateHeuteCache()
    return NextResponse.json({ ok: false, code: 'fehler', message: 'Senden fehlgeschlagen – bitte im Chat prüfen, ob die Nachricht angekommen ist.' }, { status: 500, headers: NO_STORE })
  }
}
