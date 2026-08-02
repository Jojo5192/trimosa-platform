import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAuswertung } from '@/lib/auswertung'

/**
 * 📊 AUSWERTUNG (§243ae) — liefert den kompakten Statistik-Datensatz
 * (Ausgaben je Konto mit Einheiten-Anteilen + Buchungen + Einheiten).
 * Admin-only wie /buchhaltung; 6-h-Cache, ?refresh=1 erzwingt frisch
 * (baut ALLE sevdesk-Belege neu — dauert ~30–60 s).
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  if (!me?.is_admin) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  try {
    const daten = await getAuswertung(req.nextUrl.searchParams.get('refresh') === '1')
    return NextResponse.json(daten, NO_STORE)
  } catch (e) {
    console.error('[auswertung]', e)
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 })
  }
}
