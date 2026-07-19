import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTaskAuth } from '@/lib/tasks'
import { getCleaningSettings, holidaysInRange } from '@/lib/cleaning'

/**
 * 📅 Kalender der Team-App: An-/Abreisen aller Wohnungen (heute − 1 Tag bis
 * + 8 Wochen) + OFFENE Aufgaben (fällige für die Agenda, alle fürs Matching
 * mit Leerstands-Fenstern). DATENSPARSAM: Dienstleister bekommen KEINE
 * Gastnamen. Aufgaben folgen den Aufgaben-Rechten (Rolle + visibility).
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

export async function GET() {
  const auth = await getTaskAuth()
  if (!auth) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  // −7 Tage Rückblick fürs Belegungs-Grid (Agenda zeigt weiter nur ab heute)
  const start = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)
  const end = new Date(Date.now() + 56 * 86400_000).toISOString().slice(0, 10)

  const [{ data: bookings }, listingsRes] = await Promise.all([
    supabaseAdmin
      .from('bookings')
      .select('id, listing_id, check_in, check_out, guest_name, channel, status, payment_status, source')
      .eq('status', 'confirmed')
      .lte('check_in', end)
      .gte('check_out', start)
      .limit(500),
    // Reinigungs-Spalten mit Deploy-Retry (Migration 20260719_cleaning evtl. offen)
    (async () => {
      const withCleaning = await supabaseAdmin
        .from('listings').select('id, title, location_group, cleaning_responsible, cleaning_minutes')
      if (!withCleaning.error) return withCleaning
      return supabaseAdmin.from('listings').select('id, title, location_group')
    })(),
  ])
  const listings = (listingsRes.data ?? []) as Array<{
    id: string; title: string; location_group: string | null
    cleaning_responsible?: string | null; cleaning_minutes?: number | null
  }>

  /* Sichtbarkeits-Auflösung — HÖCHSTE ROLLE GEWINNT (Inhaber 19.7.):
     1. Admin/Gastgeber: immer alles.
     2. Explizite Admin-Zuordnung (calendar_visibility) gewinnt für alle anderen.
     3. Staff ohne Zuordnung: alles (z. B. Vanessa trotz Reinigungs-Verantwortung).
     4. Provider ohne Zuordnung: Reinigungs-Verantwortung beschränkt auf die
        eigenen Wohnungen; ohne Verantwortung (Patrick) → alles. */
  let visibleIds: Set<string> | null = null
  if (auth.role !== 'admin') {
    try {
      const { data: setting } = await supabaseAdmin
        .from('app_settings').select('value').eq('key', 'calendar_visibility').maybeSingle()
      const mine = ((setting?.value ?? {}) as Record<string, string[]>)[auth.userId]
      if (Array.isArray(mine) && mine.length) visibleIds = new Set(mine)
    } catch { /* keine Einschränkung */ }
    if (!visibleIds && auth.role === 'provider') {
      const owned = listings.filter((l) => l.cleaning_responsible === auth.userId).map((l) => l.id)
      if (owned.length) visibleIds = new Set(owned)
    }
  }

  /* 🧹 Reinigungs-Kontext für den Planer */
  const cleaningSettings = await getCleaningSettings()
  const responsibleIds = [...new Set(listings.map((l) => l.cleaning_responsible).filter(Boolean))] as string[]
  const { data: respProfiles } = responsibleIds.length
    ? await supabaseAdmin.from('profiles').select('id, display_name').in('id', responsibleIds)
    : { data: [] as { id: string; display_name: string | null }[] }
  const respName = new Map((respProfiles ?? []).map((p) => [p.id, (p.display_name ?? '').trim().split(/\s+/)[0] || '—']))

  // Unbezahlte Direkt-Buchungen ausblenden (Geister vor Webhook-Aufräumung)
  const stays = (bookings ?? [])
    .filter((b) => b.source !== 'trimosa' || b.payment_status === 'paid')
    .filter((b) => !visibleIds || visibleIds.has(b.listing_id))
    .map((b) => ({
      id: b.id,
      listingId: b.listing_id,
      checkIn: b.check_in,
      checkOut: b.check_out,
      channel: (b as { channel?: string | null }).channel ?? null,
      // Gastnamen nur fürs interne Team, nie für Dienstleister
      guestName: auth.role === 'provider' ? null : (b.guest_name ?? null),
    }))

  // ALLE offenen Aufgaben (auch ohne Rotfrist) — Panel nutzt fällige für die
  // Agenda und alle für die Leerstands-Gelegenheiten je Wohnung.
  let taskQuery = supabaseAdmin
    .from('tasks')
    .select('id, title, due_date, status, prio, listing_id, location_group, is_general')
    .in('status', ['offen', 'in_arbeit'])
    .limit(300)
  if (auth.role !== 'admin') {
    // gleiche Sichtbarkeits-Logik wie /api/tasks (Aufgaben-Rechte + visibility)
    const own = `assignee_id.eq.${auth.userId},created_by.eq.${auth.userId}`
    if (!auth.viewAll) taskQuery = taskQuery.or(own)
    else if (auth.role === 'staff') taskQuery = taskQuery.or(`${own},visibility.in.(team,alle)`)
    else taskQuery = taskQuery.or(`${own},visibility.eq.alle`)
  }
  const { data: tasks } = await taskQuery

  // 🧾 Geplante QS-Termine (Admins alle, sonst nur die eigenen) — fail-soft,
  // falls die qs_checks-Migration noch nicht gelaufen ist
  let qs: { id: string; listingId: string; dueDate: string }[] = []
  try {
    let qsQuery = supabaseAdmin
      .from('qs_checks')
      .select('id, listing_id, due_date, assignee_id')
      .eq('status', 'geplant')
      .lte('due_date', end)
      .limit(50)
    if (auth.role !== 'admin') qsQuery = qsQuery.eq('assignee_id', auth.userId)
    const { data } = await qsQuery
    qs = (data ?? [])
      .filter((c) => !visibleIds || visibleIds.has(c.listing_id))
      .map((c) => ({ id: c.id, listingId: c.listing_id, dueDate: c.due_date }))
  } catch { /* Tabelle fehlt noch */ }

  return NextResponse.json({
    role: auth.role,
    stays,
    tasks: tasks ?? [],
    qs,
    listings: Object.fromEntries(listings
      .filter((l) => !visibleIds || visibleIds.has(l.id))
      .map((l) => [
        l.id, { title: l.title, group: (l.location_group ?? '').trim() || null },
      ])),
    cleaning: {
      settings: { avoidSundays: cleaningSettings.avoidSundays, avoidHolidays: cleaningSettings.avoidHolidays },
      // 💶 Kosten-Sätze NUR für Admins/Gastgeber (Finanz-Daten!)
      rates: auth.role === 'admin' ? {
        hourlyRate: cleaningSettings.hourlyRate,
        travelFee: cleaningSettings.travelFee,
        sundaySurchargePct: cleaningSettings.sundaySurchargePct,
        holidaySurchargePct: cleaningSettings.holidaySurchargePct,
      } : null,
      holidays: holidaysInRange(start, 70),
      responsible: Object.fromEntries(listings
        .filter((l) => l.cleaning_responsible && (!visibleIds || visibleIds.has(l.id)))
        .map((l) => [l.id, { id: l.cleaning_responsible, name: respName.get(l.cleaning_responsible!) ?? '—' }])),
      minutes: Object.fromEntries(listings
        .filter((l) => l.cleaning_minutes && (!visibleIds || visibleIds.has(l.id)))
        .map((l) => [l.id, l.cleaning_minutes])),
      mine: listings.filter((l) => l.cleaning_responsible === auth.userId).map((l) => l.id),
    },
  }, NO_STORE)
}
