import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { backfillSmoobuMessages, refreshChatKnowledge } from '@/lib/chat-knowledge'
import { REGIONS } from '@/lib/regions'

/**
 * Chat knowledge base management.
 *   GET  ?secret=CRON_SECRET  → weekly cron: re-distil the knowledge documents
 *   GET  (admin)              → status (archive size, documents, last update)
 *   POST (admin) { action: 'backfill', page } → one history-import page
 *   POST (admin) { action: 'refresh' }        → re-distil now
 */
export const maxDuration = 300

async function requireAdmin() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabaseAdmin
    .from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  return profile?.is_admin ? user : null
}

export async function GET(request: Request) {
  // Vercel cron calls arrive with "Authorization: Bearer ${CRON_SECRET}"
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && request.headers.get('authorization') === `Bearer ${cronSecret}`) {
    const results = await refreshChatKnowledge()
    return NextResponse.json({ cron: true, results })
  }

  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  const [{ count: archiveCount }, { count: hostCount }, { data: docs }] = await Promise.all([
    supabaseAdmin.from('smoobu_message_archive').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('smoobu_message_archive').select('id', { count: 'exact', head: true }).eq('sender_type', 'host'),
    supabaseAdmin.from('chat_knowledge').select('scope, listing_id, source_count, updated_at, listings(title)'),
  ])
  return NextResponse.json({
    archiveCount: archiveCount ?? 0,
    hostCount: hostCount ?? 0,
    documents: (docs ?? []).map((d) => ({
      scope: d.scope,
      title: d.scope === 'global' ? 'Allgemein' : ((Array.isArray(d.listings) ? d.listings[0] : d.listings) as { title: string } | null)?.title ?? '—',
      sources: d.source_count,
      updatedAt: d.updated_at,
    })),
  })
}

export async function POST(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  const { action, page } = await request.json()

  if (action === 'backfill') {
    const p = Number.isInteger(page) && page > 0 ? page : 1
    const result = await backfillSmoobuMessages(p)
    return NextResponse.json(result)
  }
  if (action === 'refresh') {
    const results = await refreshChatKnowledge()
    return NextResponse.json({ results })
  }
  if (action === 'places-test') {
    // Diagnosis for the Kulinarik rating badges: runs both Places calls for
    // one query and returns every intermediate result (admin-only).
    const key = process.env.GOOGLE_PLACES_API_KEY
    if (!key) return NextResponse.json({ step: 'env', error: 'GOOGLE_PLACES_API_KEY fehlt' })
    const query = 'Zum Domstein Hauptmarkt Trier'
    const search = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id,places.displayName' },
      body: JSON.stringify({ textQuery: query, languageCode: 'de' }),
      cache: 'no-store',
    })
    const searchBody = await search.text()
    let placeId: string | undefined
    try { placeId = JSON.parse(searchBody)?.places?.[0]?.id } catch { /* keep raw body */ }
    let detailStatus: number | null = null
    let detailBody = ''
    if (placeId) {
      const detail = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=de`, {
        headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'rating,userRatingCount' },
        cache: 'no-store',
      })
      detailStatus = detail.status
      detailBody = (await detail.text()).slice(0, 400)
    }
    return NextResponse.json({
      query,
      searchStatus: search.status,
      searchBody: searchBody.slice(0, 400),
      placeId: placeId ?? null,
      detailStatus,
      detailBody,
    })
  }
  if (action === 'smoobu-test') {
    // X-ray one real reservation's messages: shows the raw normalised fields
    // (type/sender) so the host/guest detection can be matched exactly.
    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('smoobu_reservation_id')
      .not('smoobu_reservation_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!booking?.smoobu_reservation_id) return NextResponse.json({ error: 'Keine Smoobu-Buchung gefunden.' })
    const { getReservationMessages } = await import('@/lib/smoobu')
    const msgs = await getReservationMessages(Number(booking.smoobu_reservation_id))
    return NextResponse.json({
      reservation: booking.smoobu_reservation_id,
      count: msgs.length,
      sample: msgs.slice(0, 8).map((m) => ({ type: m.type, sender: m.sender, subject: m.subject, content: m.message.slice(0, 60) })),
    })
  }
  if (action === 'places-resolve') {
    // Resolve ALL kulinarik googleQuery entries to place ids (run once when
    // quota is available; result gets pasted into regions.ts as googlePlaceId).
    const key = process.env.GOOGLE_PLACES_API_KEY
    if (!key) return NextResponse.json({ error: 'GOOGLE_PLACES_API_KEY fehlt' })
    const out: Record<string, string | null> = {}
    for (const region of Object.values(REGIONS)) {
      for (const k of region.kulinarik ?? []) {
        if (!k.googleQuery || k.googlePlaceId) continue
        const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id,places.displayName' },
          body: JSON.stringify({ textQuery: k.googleQuery, languageCode: 'de' }),
          cache: 'no-store',
        })
        if (!res.ok) return NextResponse.json({ error: `HTTP ${res.status} bei „${k.name}“`, teilergebnis: out })
        const place = (await res.json())?.places?.[0]
        out[k.name] = place ? `${place.id} (${place.displayName?.text ?? '?'})` : null
      }
    }
    return NextResponse.json({ resolved: out })
  }
  return NextResponse.json({ error: 'Unbekannte Aktion.' }, { status: 400 })
}
