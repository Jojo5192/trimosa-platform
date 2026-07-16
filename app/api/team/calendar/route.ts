import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTaskAuth } from '@/lib/tasks'

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

  const start = new Date(Date.now() - 1 * 86400_000).toISOString().slice(0, 10)
  const end = new Date(Date.now() + 56 * 86400_000).toISOString().slice(0, 10)

  const [{ data: bookings }, { data: listings }] = await Promise.all([
    supabaseAdmin
      .from('bookings')
      .select('id, listing_id, check_in, check_out, guest_name, status, payment_status, source')
      .eq('status', 'confirmed')
      .lte('check_in', end)
      .gte('check_out', start)
      .limit(500),
    supabaseAdmin.from('listings').select('id, title, location_group'),
  ])

  // Unbezahlte Direkt-Buchungen ausblenden (Geister vor Webhook-Aufräumung)
  const stays = (bookings ?? [])
    .filter((b) => b.source !== 'trimosa' || b.payment_status === 'paid')
    .map((b) => ({
      id: b.id,
      listingId: b.listing_id,
      checkIn: b.check_in,
      checkOut: b.check_out,
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

  return NextResponse.json({
    role: auth.role,
    stays,
    tasks: tasks ?? [],
    listings: Object.fromEntries((listings ?? []).map((l) => [
      l.id, { title: l.title, group: (l.location_group ?? '').trim() || null },
    ])),
  }, NO_STORE)
}
