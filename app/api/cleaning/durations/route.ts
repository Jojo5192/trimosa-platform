import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { firstCleaningOpenAt, type LockRef } from '@/lib/locks'

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

  // Diagnose: ALLE Meldungen (auch ohne gemessene Dauer) — zeigt, ob/wann
  // überhaupt gemeldet wurde und ob die Dauer-Messung griff.
  if (req.nextUrl.searchParams.get('debug') === '1') {
    const { data } = await supabaseAdmin
      .from('cleaning_confirmations')
      .select('listing_id, slot_date, person_name, verify_status, duration_min, started_at, confirmed_at')
      .order('confirmed_at', { ascending: false }).limit(30)
    return NextResponse.json({ meldungen: data ?? [] }, NO_STORE)
  }

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
  const median = (xs: number[]) => {
    if (!xs.length) return 0
    const s = [...xs].sort((a, b) => a - b)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
  }
  // Trend: Median der NEUEREN Hälfte vs. der ÄLTEREN Hälfte (chronologisch).
  // deltaMin>0 = langsamer geworden, <0 = schneller. Erst ab 4 Messungen.
  // `chrono` = Dauern in zeitlicher Reihenfolge (alt → neu).
  const trend = (chrono: number[]): { deltaMin: number; olderMed: number; newerMed: number } | null => {
    if (chrono.length < 4) return null
    const half = Math.floor(chrono.length / 2)
    const olderMed = median(chrono.slice(0, half))
    const newerMed = median(chrono.slice(half))
    return { deltaMin: newerMed - olderMed, olderMed, newerMed }
  }

  // Aggregat je Wohnung / je Person — Werte NACH DATUM sortiert (alt → neu)
  // sammeln, damit Trend + Verlauf chronologisch stimmen.
  const asc = [...rows].sort((a, b) => (a.confirmed_at ?? '').localeCompare(b.confirmed_at ?? ''))
  const byListing = new Map<string, number[]>()
  const byPerson = new Map<string, number[]>()
  const push = (m: Map<string, number[]>, key: string, v: number) => {
    const arr = m.get(key); if (arr) arr.push(v); else m.set(key, [v])
  }
  for (const r of asc) {
    push(byListing, r.listing_id, r.duration_min)
    push(byPerson, (r.person_name ?? 'Unbekannt').trim() || 'Unbekannt', r.duration_min)
  }
  const allChrono = asc.map((r) => r.duration_min)

  return NextResponse.json({
    gesamt: {
      count: rows.length, avgMin: avg(allChrono), medMin: median(allChrono),
      trend: trend(allChrono),
      // Verlauf für die Sparkline: chronologische Einzelwerte (max. letzte 40)
      verlauf: allChrono.slice(-40),
    },
    wohnungen: [...byListing.entries()]
      .map(([id, xs]) => ({
        title: titles.get(id) ?? 'Wohnung', count: xs.length,
        avgMin: avg(xs), medMin: median(xs), minMin: Math.min(...xs), maxMin: Math.max(...xs),
        trend: trend(xs),
      }))
      .sort((a, b) => b.medMin - a.medMin),
    personen: [...byPerson.entries()]
      .map(([name, xs]) => ({ name, count: xs.length, avgMin: avg(xs), medMin: median(xs) }))
      .sort((a, b) => b.count - a.count),
    letzte: rows.slice(0, 40).map((r) => ({
      title: titles.get(r.listing_id) ?? 'Wohnung',
      slotDate: r.slot_date, person: r.person_name, durationMin: r.duration_min,
      startedAt: r.started_at, confirmedAt: r.confirmed_at,
    })),
    // §266b: ALLE gemessenen Einsätze chronologisch (alt → neu) — der
    // Wohnungs-Filter im Client rechnet Median/Ø/Trend/Sparkline daraus.
    einsaetze: asc.map((r) => ({
      title: titles.get(r.listing_id) ?? 'Wohnung',
      slotDate: r.slot_date, person: r.person_name, durationMin: r.duration_min,
      startedAt: r.started_at, confirmedAt: r.confirmed_at,
    })),
  }, NO_STORE)
}

/**
 * POST { action: 'backfill' } — misst kürzliche Fertigmeldungen OHNE Dauer
 * nachträglich (Start aus dem Schloss-Protokoll). Nur was im Log-Fenster
 * liegt (Nuki ~letzte Tage) bekommt eine Dauer; ältere bleiben leer.
 */
export async function POST(req: NextRequest) {
  if (!(await requireChef())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  if (body.action !== 'backfill') return NextResponse.json({ error: 'Unbekannte Aktion.' }, { status: 400 })

  // Ungemessene Meldungen der letzten 5 Tage (weiter zurück reicht das Log nicht)
  const since = new Date(Date.now() - 5 * 86400_000).toISOString()
  const { data: conf } = await supabaseAdmin
    .from('cleaning_confirmations')
    .select('listing_id, slot_date, confirmed_at')
    .is('duration_min', null)
    .gte('confirmed_at', since)
    .order('confirmed_at', { ascending: false })
  const rows = (conf ?? []) as { listing_id: string; slot_date: string; confirmed_at: string }[]
  if (!rows.length) return NextResponse.json({ gemessen: 0, geprueft: 0 }, NO_STORE)

  // Schlösser + Check-out-Zeit je Wohnung
  const ids = [...new Set(rows.map((r) => r.listing_id))]
  const { data: ls } = await supabaseAdmin.from('listings').select('id, locks, check_out_time').in('id', ids)
  const cfg = new Map((ls ?? []).map((l) => [l.id as string, l as { locks: LockRef[] | null; check_out_time: string | null }]))
  const dayOf = (iso: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date(iso))

  let gemessen = 0
  for (const r of rows) {
    const c = cfg.get(r.listing_id)
    if (!c?.locks?.length) continue
    const cleaningDay = dayOf(r.confirmed_at)            // Tag der Meldung = Reinigungstag
    const afterHm = cleaningDay === r.slot_date ? (c.check_out_time ?? '10:00').slice(0, 5) : '06:00'
    try {
      const startedAt = await firstCleaningOpenAt(c.locks, afterHm, cleaningDay)
      if (!startedAt) continue
      const mins = Math.round((Date.parse(r.confirmed_at) - Date.parse(startedAt)) / 60000)
      if (mins < 1 || mins > 12 * 60) continue
      await supabaseAdmin.from('cleaning_confirmations')
        .update({ started_at: startedAt, duration_min: mins })
        .eq('listing_id', r.listing_id).eq('slot_date', r.slot_date)
      gemessen++
    } catch { /* Schloss nicht erreichbar → überspringen */ }
  }
  return NextResponse.json({ gemessen, geprueft: rows.length }, NO_STORE)
}
