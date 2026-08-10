import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * ⏱ §255: Reinigungs-Dauer-Auswertung — NUR für Chefs (is_admin).
 * Quelle: cleaning_confirmations.duration_min (erste Türöffnung → NFC-
 * Fertigmeldung, §255). ?probe=1 = Sichtbarkeits-Check fürs Mehr-Tab.
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

async function requireChef(): Promise<string | null> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabaseAdmin.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  return me?.is_admin ? user.id : null
}

export async function GET(req: NextRequest) {
  if (!(await requireChef())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  if (req.nextUrl.searchParams.get('probe') === '1') return NextResponse.json({ ok: true }, NO_STORE)

  // Letzte 180 Tage, nur gemessene Reinigungen
  const since = new Date(Date.now() - 180 * 86400_000).toISOString().slice(0, 10)
  const { data, error } = await supabaseAdmin
    .from('cleaning_confirmations')
    .select('listing_id, slot_date, person_name, duration_min, started_at, confirmed_at')
    .not('duration_min', 'is', null)
    .gte('slot_date', since)
    .order('confirmed_at', { ascending: false })
    .limit(300)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as {
    listing_id: string; slot_date: string; person_name: string | null
    duration_min: number; started_at: string | null; confirmed_at: string | null
  }[]

  // Wohnungstitel nachladen
  const ids = [...new Set(rows.map((r) => r.listing_id))]
  const titles = new Map<string, string>()
  if (ids.length) {
    const { data: ls } = await supabaseAdmin.from('listings').select('id, title').in('id', ids)
    for (const l of ls ?? []) titles.set(l.id as string, (l.title as string) ?? 'Wohnung')
  }

  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0)

  // Aggregat je Wohnung / je Person
  const byListing = new Map<string, number[]>()
  const byPerson = new Map<string, number[]>()
  const push = (m: Map<string, number[]>, key: string, v: number) => {
    const arr = m.get(key); if (arr) arr.push(v); else m.set(key, [v])
  }
  for (const r of rows) {
    push(byListing, r.listing_id, r.duration_min)
    push(byPerson, (r.person_name ?? 'Unbekannt').trim() || 'Unbekannt', r.duration_min)
  }

  return NextResponse.json({
    gesamt: { count: rows.length, avgMin: avg(rows.map((r) => r.duration_min)) },
    wohnungen: [...byListing.entries()]
      .map(([id, xs]) => ({ title: titles.get(id) ?? 'Wohnung', count: xs.length, avgMin: avg(xs), minMin: Math.min(...xs), maxMin: Math.max(...xs) }))
      .sort((a, b) => b.avgMin - a.avgMin),
    personen: [...byPerson.entries()]
      .map(([name, xs]) => ({ name, count: xs.length, avgMin: avg(xs) }))
      .sort((a, b) => b.count - a.count),
    letzte: rows.slice(0, 40).map((r) => ({
      title: titles.get(r.listing_id) ?? 'Wohnung',
      slotDate: r.slot_date, person: r.person_name, durationMin: r.duration_min,
      startedAt: r.started_at, confirmedAt: r.confirmed_at,
    })),
  }, NO_STORE)
}
