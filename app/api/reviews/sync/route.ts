import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { snapshotScores } from '@/lib/score-history'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { syncListingReviews } from '@/lib/reviews-sync'
import { buildSyncStatus, checkSyncAlerts, minutenSeitVollemErfolg, planCronAuswahl, readAllSyncLogs, readCronState, writeCronState, type StatusZeile } from '@/lib/reviews-sync-log'

// Scraper runs can take a couple of minutes — allow the full fluid-compute window.
export const maxDuration = 300

const LISTING_FIELDS = 'id, host_id, airbnb_url, booking_url, vrbo_url, google_place_id'
const CRON_FIELDS = 'id, host_id, reviews_synced_at, airbnb_url, booking_url, vrbo_url, google_place_id'

/**
 * POST /api/reviews/sync — { listingId, force?, nurQuelle? }
 * Manually triggered from the listing editor and the team card „⭐ Bewertungs-Abruf".
 * Host of the listing (or admin) only. Jeder Lauf kostet ca. 0,25 $ Apify-Guthaben — deshalb eine
 * Sperrfrist: lief der letzte Abruf vor weniger als 6 Stunden komplett erfolgreich (und wurde seither
 * keine Quelle geändert), wird nicht erneut gescrapt (force: true hebt das auf).
 * nurQuelle: 'vrbo' ruft NUR FeWo-direkt ab (kein Airbnb/Booking/Google, keine KI-Zusammenfassung; wenige
 * Cent statt ca. 0,25 $). Ein solcher Teil-Lauf ändert im Protokoll nur den FeWo-Eintrag und zählt nicht als
 * voller Lauf: reviews_synced_at und Montags-Rotation bleiben, wie sie sind; er löst nie eine Sperrfrist aus,
 * eine laufende bleibt bestehen, wenn er klappt (scheitert er, ist sie aufgehoben — lib/reviews-sync-protokoll.ts).
 */
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const { listingId, force, nurQuelle } = await req.json()
  if (!listingId) return NextResponse.json({ error: 'listingId erforderlich' }, { status: 400 })
  if (nurQuelle !== undefined && nurQuelle !== null && nurQuelle !== 'vrbo') {
    return NextResponse.json({ error: "nurQuelle: nur 'vrbo' (FeWo-direkt) wird unterstützt" }, { status: 400 })
  }
  const nurFewo = nurQuelle === 'vrbo'

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

  // Nur-FeWo-Abruf: nur für fewo-direkt.de-Adressen (eine vrbo.com-Adresse liefe in den bezahlten Sammel-Actor)
  if (nurFewo && !/fewo-direkt\.de/i.test(listing.vrbo_url ?? '')) {
    return NextResponse.json({ error: 'Für diese Wohnung ist keine FeWo-direkt-Adresse hinterlegt' }, { status: 400 })
  }

  if (force !== true) {
    const min = await minutenSeitVollemErfolg(listing).catch(() => null)
    if (min !== null) {
      const vor = min < 90 ? `${min} Min.` : `${Math.round(min / 60)} Std.`
      const detail = `Bereits vor ${vor} vollständig abgerufen — ein erneuter Abruf würde nur Apify-Guthaben kosten. Frühestens 6 Stunden nach dem letzten Erfolg wieder möglich.`
      // `results` mitgeben: der Editor (ReviewsManager) rendert die Antwort direkt als Ergebnisliste
      return NextResponse.json({ listingId, error: detail, gesperrt: true, results: [{ source: 'hinweis', status: 'skipped', fetched: 0, upserted: 0, detail }] }, { status: 429 })
    }
  }

  const results = await syncListingReviews(listing, { origin: 'manuell', ...(nurFewo ? { nurQuelle: 'vrbo' as const } : {}) })
  return NextResponse.json({ listingId, ...(nurFewo ? { nurQuelle: 'vrbo' } : {}), results })
}

/**
 * GET /api/reviews/sync — daily Vercel cron.
 * Mondays only: Apify-syncs 2 listings (~3.5-week rotation; overdue ones first, §314);
 * every day: the free score snapshot for the trend charts (§171) and the
 * „seit über 6 Wochen kein Abruf"-Alarm (§314).
 * Auth: Vercel sends "Authorization: Bearer ${CRON_SECRET}" for cron calls.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  /* Kosten-Drossel. Die Bezahl-Actors rechnen JE gescraptem Review; früher
   * holte jeder Lauf ALLE Bewertungen neu (~0,50 $/Inserat) und täglich
   * ergab das 15–45 $/Monat. Seit das Limit bei 40 NEUESTEN liegt, kostet
   * ein Inserat ~0,25 $ — deshalb zwei Inserate pro Montag statt einem:
   * jede Wohnung ist alle ~3,5 Wochen frisch, macht ~2 $/Monat und lässt
   * im 5-$-Gratisrahmen noch Luft für manuelle Editor-Syncs.
   * Der Cron selbst bleibt TÄGLICH: der Score-Snapshot (§171) unten
   * braucht tägliche Datenpunkte und kostet nichts. */
  const started = Date.now()
  const scrapeToday = new Date().getUTCDay() === 1
  const PRO_LAUF = 2
  /* §314 Nachhol-Lauf: Vom 24.7. bis 1.10.2026 kam für Airbnb/Booking nichts an. Solange mehr als
   * PRO_LAUF Wohnungen eine überfällige Quelle haben, darf der Montags-Lauf EINMALIG bis zu 4 Wohnungen
   * holen (Merker nachholAm im Cron-Lebenszeichen) — danach wieder 2 je Montag, Überfällige zuerst. */
  const NACHHOL_MAX = 4
  /* Zeitbudget (maxDuration 300 s): Wohnungen laufen NACHEINANDER (parallel sprengt das Speicherlimit des
   * Apify-Free-Plans). Jede bekommt höchstens 110 s Actor-Wartezeit; eine weitere startet nur, wenn danach
   * noch Platz für Google-Places (20 s), Abbruch-Puffer (15 s), Schreiben und die KI-Zusammenfassung bleibt
   * (RESERVE). Schlimmster Fall (alle Actors laufen ins Zeitlimit): 2 Wohnungen enden bei ~290 s. Üblich
   * (60–80 s je Wohnung): 3 Wohnungen; 4 nur, wenn jede unter ~50 s bleibt. Was nicht mehr passt, wird
   * nicht angefangen (ausgelassen) und ist am nächsten Montag wieder vorn.
   * FeWo-direkt: Stufe A (ohne Browser) und Stufe B (Browser) teilen sich dasselbe Fenster je Wohnung
   * (FEWO_ZEIT in lib/fewo-reviews.ts) — der Zweig dauert weiter höchstens Wartezeit + 15 s. */
  const BUDGET_MS = 290_000
  const RESERVE_MS = 50_000
  const MIN_TIMEOUT_MS = 75_000

  // §171: täglicher Score-Snapshot ZUERST (billig, fail-soft) — er darf nicht am 300-s-Limit hängen,
  // wenn die Scraper-Läufe lange brauchen. Nach einem Abruf läuft er unten noch einmal (Upsert je Tag).
  let snapshot = await snapshotScores().catch(() => ({ rows: 0 }))

  const { state: cronState, lesbar: cronLesbar } = await readCronState()
  const out = []
  let ausgelassen = 0
  let nachhol = false
  if (scrapeToday) {
    const { data: alle } = await supabaseAdmin
      .from('listings')
      .select(CRON_FIELDS)
      .eq('is_active', true)
      // any of the four sources configured
      .or('airbnb_url.not.is.null,booking_url.not.is.null,vrbo_url.not.is.null,google_place_id.not.is.null')
      .order('reviews_synced_at', { ascending: true, nullsFirst: true })
    const [zeilen, logs] = await Promise.all([
      buildSyncStatus().catch((): StatusZeile[] => []),
      readAllSyncLogs(),
    ])
    const plan = planCronAuswahl(alle ?? [], zeilen, logs, {
      proLauf: PRO_LAUF, nachholMax: NACHHOL_MAX, nachholErlaubt: cronLesbar && !cronState.nachholAm,
    })
    nachhol = plan.nachhol
    for (const listing of plan.auswahl) {
      const timeoutMs = Math.min(110_000, BUDGET_MS - (Date.now() - started) - RESERVE_MS)
      if (timeoutMs < MIN_TIMEOUT_MS) { ausgelassen++; continue }
      out.push({ listingId: listing.id, results: await syncListingReviews(listing, { origin: 'cron', timeoutMs }) })
    }
    if (out.length) snapshot = await snapshotScores().catch(() => snapshot)
  }

  // 🎯 Das Property-Review-Matching läuft als EIGENER Cron um 4:25
  // (/api/reviews/match, §126) — als Anhang hier riss der Lauf das
  // 300s-Limit und ließ re-importierte Kopien liegen.

  // §314: täglicher Alarm — Quelle seit über 6 Wochen ohne erfolgreichen Abruf → Team-Push
  // (höchstens 1× pro Woche je Wohnung). Fail-soft.
  const alarm = await buildSyncStatus()
    .then((zeilen) => checkSyncAlerts(zeilen))
    .catch((e) => { console.error('[reviews-sync] Alarm:', e); return { ueberfaellig: -1, gemeldet: 0 } })

  // Lebenszeichen für die Status-Karte. Der Nachhol-Merker wird erst gesetzt, wenn wirklich mehr als
  // PRO_LAUF Wohnungen liefen UND mindestens ein Scraper-Portal geklappt hat — sonst bleibt er scharf.
  const scraperOk = out.some((o) => o.results.some((r) => ['airbnb', 'booking', 'vrbo'].includes(r.source) && r.status === 'ok'))
  if (cronLesbar) {
    await writeCronState({
      ...(cronState.nachholAm ? { nachholAm: cronState.nachholAm } : {}),
      ...(nachhol && out.length > PRO_LAUF && scraperOk ? { nachholAm: new Date().toISOString() } : {}),
      at: new Date().toISOString(),
      // an Nicht-Montagen den letzten Montags-Lauf stehen lassen
      ...(scrapeToday ? { gescraptAm: new Date().toISOString() } : cronState.gescraptAm ? { gescraptAm: cronState.gescraptAm } : {}),
      gescrapt: scrapeToday ? out.map((o) => o.listingId) : cronState.gescrapt ?? [],
      ausgelassen: scrapeToday ? ausgelassen : cronState.ausgelassen ?? 0,
      snapshotRows: snapshot.rows,
      alarm: alarm.gemeldet,
    })
  }

  return NextResponse.json({ synced: out.length, nachhol, ausgelassen, snapshot, alarm, details: out })
}
