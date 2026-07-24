import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { refreshPriceFrom } from '@/lib/price-from'

/**
 * 💶 „ab X €/Nacht"-Cache (§161-Jupas ②):
 *  GET  → Vercel-Cron (täglich) — günstigster verfügbarer Nachtpreis der
 *         nächsten 90 Tage je Listing aus Smoobu (Bearer CRON_SECRET).
 *  POST → Admin/Gastgeber: manueller Lauf.
 */
export const maxDuration = 120
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 401 })
  }
  try {
    return NextResponse.json(await refreshPriceFrom())
  } catch (err) {
    console.error('[price-from] cron:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host').eq('id', user.id).maybeSingle()
  if (!me?.is_admin && !me?.is_host) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  try {
    return NextResponse.json(await refreshPriceFrom())
  } catch (err) {
    const detail = String(err instanceof Error ? err.message : err).slice(0, 300)
    return NextResponse.json({ error: `Lauf fehlgeschlagen: ${detail}` }, { status: 500 })
  }
}
