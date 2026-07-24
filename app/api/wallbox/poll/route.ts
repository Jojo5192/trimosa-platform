import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { pollWallboxCharges } from '@/lib/wallbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * ⚡ Wallbox-Poll (§185): alle 15 Min — neue Ladevorgänge erkennen und
 * Start-/Ende-Pushes an Admins schicken (Präferenzen im ⚙️-Tab).
 * Kein Webhook verfügbar (Monta Public API) → Polling; 2–3 Requests/Lauf
 * bei Rate-Limit 10/Min. Envs fehlen/Monta down → Lauf scheitert leise
 * mit Log, nächster Lauf versucht es erneut.
 *  GET  = Vercel-Cron (Bearer CRON_SECRET)
 *  POST = manueller Lauf (Admin)
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht berechtigt' }, { status: 401 })
  }
  try {
    const result = await pollWallboxCharges()
    if (result.startPushed || result.endPushed) console.log('[wallbox] Poll:', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (e) {
    console.error('[wallbox] Poll fehlgeschlagen:', e)
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 })
  }
}

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  if (!me?.is_admin) return NextResponse.json({ error: 'Nicht berechtigt' }, { status: 403 })
  try {
    return NextResponse.json(await pollWallboxCharges())
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 })
  }
}
