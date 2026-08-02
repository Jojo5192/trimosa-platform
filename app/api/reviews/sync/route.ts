import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { snapshotScores } from '@/lib/score-history'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { syncListingReviews } from '@/lib/reviews-sync'

// Scraper runs can take a couple of minutes — allow the full fluid-compute window.
export const maxDuration = 300

const LISTING_FIELDS = 'id, host_id, airbnb_url, booking_url, vrbo_url, google_place_id'

/**
 * POST /api/reviews/sync — { listingId }
 * Manually triggered from the listing editor. Host of the listing (or admin) only.
 */
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const { listingId } = await req.json()
  if (!listingId) return NextResponse.json({ error: 'listingId erforderlich' }, { status: 400 })

  const { data: listing } = await supabaseAdmin
    .from('listings')
    .select(LISTING_FIELDS)
    .eq('id', listingId)
    .single()
  if (!listing) return NextResponse.json({ error: 'Inserat nicht gefunden' }, { status: 404 })

  if (listing.host_id !== user.id) {
    const { data: profile } = await supabaseAdmin
      .from('profiles').select('is_admin, is_host').eq('id', user.id).maybeSingle()
    if (!profile?.is_admin && !profile?.is_host) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })
  }

  const results = await syncListingReviews(listing)
  return NextResponse.json({ listingId, results })
}

/**
 * GET /api/reviews/sync — daily Vercel cron.
 * Mondays only: Apify-syncs the 1 stalest listing (~7-week rotation, §243ai);
 * every day: the free score snapshot for the trend charts (§171).
 * Auth: Vercel sends "Authorization: Bearer ${CRON_SECRET}" for cron calls.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  // §243ai-Kosten (2.8.): Apify-Scrape nur noch MONTAGS, 1 Inserat/Woche —
  // jede Wohnung alle ~7 Wochen automatisch frisch. Die Bezahl-Actors
  // rechnen je gescraptem Review und holen bei JEDEM Lauf ALLE Reviews
  // neu (~$0,50/Inserat-Sync); täglich lief das auf ~$15–45/Monat.
  // Wöchentlich sind es ~$2/Monat → das $5-Free-Guthaben reicht inkl.
  // manueller Editor-Syncs (Starter-Abo gekündigt, endet 12.8.).
  // Der Cron selbst bleibt TÄGLICH: der Score-Snapshot (§171) unten
  // braucht tägliche Datenpunkte und kostet nichts.
  const scrapeToday = new Date().getUTCDay() === 1
  const listingsRes = scrapeToday
    ? await supabaseAdmin
        .from('listings')
        .select(LISTING_FIELDS)
        .eq('is_active', true)
        // any of the four sources configured
        .or('airbnb_url.not.is.null,booking_url.not.is.null,vrbo_url.not.is.null,google_place_id.not.is.null')
        .order('reviews_synced_at', { ascending: true, nullsFirst: true })
        .limit(1)
    : null

  const out = []
  for (const listing of listingsRes?.data ?? []) {
    out.push({ listingId: listing.id, results: await syncListingReviews(listing) })
  }

  // 🎯 Das Property-Review-Matching läuft als EIGENER Cron um 4:25
  // (/api/reviews/match, §126) — als Anhang hier riss der Lauf das
  // 300s-Limit und ließ re-importierte Kopien liegen.

  // §171: täglicher Score-Snapshot für die Entwicklungs-Grafiken (billig,
  // fail-soft — bricht den Sync nie)
  const snapshot = await snapshotScores().catch(() => ({ rows: 0 }))

  return NextResponse.json({ synced: out.length, snapshot, details: out })
}
