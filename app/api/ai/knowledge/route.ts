import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { refreshStaleTranslations } from '@/lib/listing-translate'
import { backfillSmoobuMessages, refreshChatKnowledge } from '@/lib/chat-knowledge'
import { REGIONS } from '@/lib/regions'
import { PROMPT_DEFAULTS, getPrompt, invalidatePromptCache } from '@/lib/prompts'
import { askClaude } from '@/lib/ai'

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
    // Daily cron with a 6-day freshness window: each doc is re-distilled
    // roughly weekly, and the time budget spreads the work across days.
    const results = await refreshChatKnowledge(144)
    // Piggyback: re-translate listings whose German texts changed (budgeted).
    let translations: unknown = null
    try { translations = await refreshStaleTranslations(2) } catch (err) { console.error('[cron] translations:', err) }
    return NextResponse.json({ cron: true, results, translations })
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

  const { action, page, key, content, instruction, historic, bookingId, guestName } = await request.json()

  // 🎯 Property-Reviews den richtigen Wohnungen zuordnen (§124):
  // { action: 'review-match', dryRun?: true }
  if (action === 'review-match') {
    const { matchPropertyReviews } = await import('@/lib/review-match')
    const report = await matchPropertyReviews(false)
    return NextResponse.json(report)
  }
  if (action === 'review-match-dry') {
    const { matchPropertyReviews } = await import('@/lib/review-match')
    const report = await matchPropertyReviews(true)
    return NextResponse.json(report)
  }

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
  if (action === 'fix-conv-senders') {
    // §146: falsch als Host gespeicherte GAST-Nachrichten einer Direkt-Chat-
    // Konversation korrigieren (Betreff-Bug „Re: Nachricht von Trimosa").
    // Nicht-löschend: nur sender_id per echtem Smoobu-Typ richtiggestellt.
    // dryRun (Default) ZÄHLT nur; korrigiert bei { content: 'FIX' }.
    if (!bookingId) return NextResponse.json({ error: 'bookingId fehlt.' }, { status: 400 })
    const { data: bk } = await supabaseAdmin
      .from('bookings').select('guest_id, listing_id, smoobu_reservation_id').eq('id', String(bookingId)).maybeSingle()
    if (!bk?.smoobu_reservation_id || !bk.guest_id) return NextResponse.json({ error: 'Buchung/Reservierung/Gast fehlt.' }, { status: 404 })
    const { data: conv } = await supabaseAdmin
      .from('conversations').select('id, host_id, guest_id').eq('guest_id', bk.guest_id).eq('listing_id', bk.listing_id).maybeSingle()
    if (!conv) return NextResponse.json({ error: 'Keine Konversation gefunden.' }, { status: 404 })
    const { getReservationMessages, isSmoobuSystemMessage } = await import('@/lib/smoobu')
    const msgs = await getReservationMessages(Number(bk.smoobu_reservation_id))
    const doFix = content === 'FIX'
    const corrections: { smoobuId: string; von: string; nach: string; text: string }[] = []
    for (const sm of msgs) {
      if (isSmoobuSystemMessage(sm.subject)) continue
      const t = String(sm.type ?? '').toLowerCase()
      const s = String(sm.sender ?? '').toLowerCase()
      const isHost = (t === '2' || t.includes('host') || t === 'outgoing' || t === 'sent' || t === 'owner' || t === 'automated' || s.includes('host') || s.includes('gastgeber'))
        ? true : (t === '1' || t.includes('guest') || t === 'incoming') ? false : true
      const correct = isHost ? conv.host_id : conv.guest_id
      const { data: row } = await supabaseAdmin
        .from('messages').select('id, sender_id').eq('conversation_id', conv.id).eq('smoobu_message_id', String(sm.id)).maybeSingle()
      if (row && row.sender_id !== correct) {
        corrections.push({ smoobuId: String(sm.id), von: row.sender_id === conv.host_id ? 'host' : 'gast', nach: isHost ? 'host' : 'gast', text: sm.message.slice(0, 50) })
        if (doFix) {
          await supabaseAdmin.from('messages').update({ sender_id: correct, lang: null, content_de: null }).eq('id', row.id)
        }
      }
    }
    return NextResponse.json({ konversation: conv.id, korrekturen: corrections.length, modus: doFix ? 'KORRIGIERT' : 'nur gezählt', details: corrections })
  }
  if (action === 'google-review-dedupe') {
    // §174: Dieselbe Google-Rezension liegt teils DOPPELT vor — die zwei
    // Google-Quellen (Places-API-Fallback vs. Apify-Actor) nutzen
    // verschiedene source_review_id-Räume; über mehrere Sync-Läufe hinweg
    // entstanden Text-Duplikate (z. B. „Dami- D" 2× auf Panorama). Je
    // Fingerprint (listing + Autor + Text) bleibt die ÄLTESTE Zeile,
    // jüngere Kopien werden gelöscht. dryRun (Default) LÖSCHT NICHTS.
    const { data: rows } = await supabaseAdmin
      .from('reviews')
      .select('id, listing_id, author_name, review_text, source_review_id, created_at')
      .eq('source', 'google')
      .order('created_at', { ascending: true })
      .limit(2000)
    const groups = new Map<string, { id: string; source_review_id: string }[]>()
    for (const r of rows ?? []) {
      if (!r.review_text || !r.review_text.trim()) continue
      const key = `${r.listing_id}|${(r.author_name ?? '').trim().toLowerCase()}|${r.review_text.trim().slice(0, 60).toLowerCase()}`
      const arr = groups.get(key) ?? []
      arr.push({ id: r.id, source_review_id: r.source_review_id })
      groups.set(key, arr)
    }
    const toDelete: string[] = []
    const beispiele: string[] = []
    for (const [key, arr] of groups) {
      if (arr.length < 2) continue
      // älteste (Index 0, created_at asc) bleibt — Rest weg
      toDelete.push(...arr.slice(1).map((x) => x.id))
      beispiele.push(`${arr.length}× ${key.slice(37, 95)}`)
    }
    const doDelete = content === 'DELETE'
    if (doDelete && toDelete.length) {
      for (let i = 0; i < toDelete.length; i += 100) {
        await supabaseAdmin.from('reviews').delete().in('id', toDelete.slice(i, i + 100))
      }
    }
    return NextResponse.json({
      duplikatGruppen: beispiele.length,
      zuLoeschen: toDelete.length,
      geloescht: doDelete ? toDelete.length : 0,
      modus: doDelete ? 'GELÖSCHT' : 'nur gezählt (dry-run)',
      beispiele: beispiele.slice(0, 12),
    })
  }
  if (action === 'lock-msg-cleanup') {
    // §143: bereits synchronisierte Smoobu-Schloss-/Automatik-Meldungen aus
    // der messages-Tabelle finden (Betreff nicht gespeichert → Content-Muster,
    // eng gefasst auf die Lock-Notifications). dryRun (Default) LÖSCHT NICHTS.
    const patterns = ['%granted access to apartment%', '%will be granted access%', '%wurde Zugriff auf das Apartment%', '%erhält Zugang zur Wohnung%']
    const seen = new Map<string, { id: string; content: string; sender_type: string | null }>()
    for (const p of patterns) {
      const { data } = await supabaseAdmin
        .from('messages').select('id, content, sender_type').ilike('content', p).limit(500)
      for (const m of data ?? []) seen.set(m.id, m)
    }
    const rows = [...seen.values()]
    const doDelete = content === 'DELETE' // nur bei explizitem { content: 'DELETE' }
    if (doDelete && rows.length) {
      const ids = rows.map((r) => r.id)
      for (let i = 0; i < ids.length; i += 100) {
        await supabaseAdmin.from('messages').delete().in('id', ids.slice(i, i + 100))
      }
    }
    return NextResponse.json({
      gefunden: rows.length,
      geloescht: doDelete ? rows.length : 0,
      modus: doDelete ? 'GELÖSCHT' : 'nur gezählt (dry-run)',
      beispiele: rows.slice(0, 8).map((r) => ({ sender: r.sender_type, content: (r.content ?? '').slice(0, 70) })),
    })
  }
  if (action === 'smoobu-test') {
    // X-ray one reservation's messages: rohe normalisierte Felder
    // (type/sender/subject) — optional { bookingId } oder { guestName }
    // gezielt (§143: Lock-System-Meldungen erkennen).
    let query = supabaseAdmin.from('bookings').select('smoobu_reservation_id').not('smoobu_reservation_id', 'is', null)
    if (bookingId) query = query.eq('id', String(bookingId))
    else if (guestName) query = query.ilike('guest_name', `%${String(guestName)}%`)
    else query = query.order('created_at', { ascending: false })
    const { data: booking } = await query.limit(1).maybeSingle()
    if (!booking?.smoobu_reservation_id) return NextResponse.json({ error: 'Keine Smoobu-Buchung gefunden.' })
    const { getReservationMessages } = await import('@/lib/smoobu')
    const msgs = await getReservationMessages(Number(booking.smoobu_reservation_id))
    return NextResponse.json({
      reservation: booking.smoobu_reservation_id,
      count: msgs.length,
      sample: msgs.slice(0, 12).map((m) => ({ type: m.type, sender: m.sender, subject: m.subject, content: m.message.slice(0, 90) })),
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
  if (action === 'booking-sync') {
    // §139: kompletter Kalender-Abgleich mit Smoobu — fehlende Buchungen
    // importieren (MIT Push), stornierte/gelöschte austragen. Fenster bis
    // 540 Tage in die Zukunft.
    const { importMissingReservations } = await import('@/lib/booking-import')
    const result = await importMissingReservations(540)
    return NextResponse.json(result)
  }
  if (action === 'bookings-backfill') {
    // One-off: import Smoobu reservations (recent past + future) into the
    // bookings table so external guests (Airbnb/Booking) appear as inbox
    // threads. Cancelled reservations and calendar blocks are skipped; the
    // no-overlap EXCLUDE constraint tolerates duplicates by skipping them.
    const { listReservations } = await import('@/lib/smoobu')
    const { data: listings } = await supabaseAdmin
      .from('listings').select('id, smoobu_id').not('smoobu_id', 'is', null)
    const bySmoobuId = new Map((listings ?? []).map((l) => [Number(l.smoobu_id), l.id as string]))
    // 1000er-Seiten — PostgREST cappt jede Antwort bei 1000, und die Tabelle
    // hat seit dem Historien-Backfill (§129) deutlich mehr Zeilen
    const existing = new Set<number>()
    for (let off = 0; off < 10000; off += 1000) {
      const { data: existingRows } = await supabaseAdmin
        .from('bookings').select('smoobu_reservation_id').not('smoobu_reservation_id', 'is', null).range(off, off + 999)
      for (const b of existingRows ?? []) existing.add(Number(b.smoobu_reservation_id))
      if (!existingRows || existingRows.length < 1000) break
    }

    // historic: alle ALTEN Reservierungen (2019 → Standardfenster-Beginn),
    // aber NUR solche mit Chat-Verlauf im Smoobu-Archiv — alte Buchungen ohne
    // je eine Nachricht braucht niemand als Inbox-Thread (§129)
    const withChat = new Set<number>()
    if (historic === true) {
      for (let off = 0; off < 20000; off += 1000) {
        const { data: rows } = await supabaseAdmin
          .from('smoobu_message_archive').select('smoobu_reservation_id').range(off, off + 999)
        for (const row of rows ?? []) withChat.add(Number(row.smoobu_reservation_id))
        if (!rows || rows.length < 1000) break
      }
    }
    const from = historic === true
      ? '2019-01-01'
      : new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10)
    const to = historic === true
      ? new Date(Date.now() - 59 * 86400_000).toISOString().slice(0, 10)
      : new Date(Date.now() + 540 * 86400_000).toISOString().slice(0, 10)
    let imported = 0, skipped = 0, failed = 0
    for (let p = 1; p <= 40; p++) {
      const { reservations, hasMore } = await listReservations(from, to, p, 100)
      for (const r of reservations) {
        if (r.cancelled || r.blocked || !r.arrival || !r.departure || existing.has(r.id)) { skipped++; continue }
        if (historic === true && !withChat.has(r.id)) { skipped++; continue }
        const { error } = await supabaseAdmin.from('bookings').insert({
          smoobu_reservation_id: r.id,
          listing_id: r.apartmentId != null ? bySmoobuId.get(r.apartmentId) ?? null : null,
          guest_name: r.guestName,
          check_in: r.arrival,
          check_out: r.departure,
          total_price: Math.round(r.price ?? 0),
          status: 'confirmed',
          channel: r.channelName ?? 'Smoobu',
          source: 'smoobu_backfill',
        })
        if (error) { failed++; console.error('[bookings-backfill]', r.id, error.message) }
        else { imported++; existing.add(r.id) }
      }
      if (!hasMore) break
    }
    return NextResponse.json({ imported, skipped, failed })
  }
  if (action === 'prompts-list') {
    const out = []
    for (const [key, def] of Object.entries(PROMPT_DEFAULTS)) {
      const { data } = await supabaseAdmin.from('ai_prompts').select('content, updated_at').eq('key', key).maybeSingle()
      out.push({ key, label: def.label, content: data?.content ?? def.content, isCustom: !!data, default: def.content })
    }
    return NextResponse.json({ prompts: out })
  }
  if (action === 'prompt-save') {
    if (typeof key !== 'string' || !(key in PROMPT_DEFAULTS) || typeof content !== 'string' || !content.trim()) {
      return NextResponse.json({ error: 'Ungültiger Prompt.' }, { status: 400 })
    }
    const { error } = await supabaseAdmin.from('ai_prompts').upsert(
      { key, content: content.trim(), updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    invalidatePromptCache(key)
    return NextResponse.json({ ok: true })
  }
  if (action === 'prompt-reset') {
    if (typeof key !== 'string' || !(key in PROMPT_DEFAULTS)) {
      return NextResponse.json({ error: 'Ungültiger Prompt.' }, { status: 400 })
    }
    await supabaseAdmin.from('ai_prompts').delete().eq('key', key)
    invalidatePromptCache(key)
    return NextResponse.json({ ok: true, content: PROMPT_DEFAULTS[key].content })
  }
  if (action === 'prompt-improve') {
    // "Per KI anpassen": Claude rewrites the prompt according to the admin's
    // instruction — returned as a proposal, saved only via prompt-save.
    if (typeof key !== 'string' || !(key in PROMPT_DEFAULTS) || typeof instruction !== 'string' || !instruction.trim()) {
      return NextResponse.json({ error: 'Anweisung fehlt.' }, { status: 400 })
    }
    const current = typeof content === 'string' && content.trim() ? content : await getPrompt(key)
    const meta = `Du überarbeitest den SYSTEM-PROMPT eines KI-Assistenten für ${PROMPT_DEFAULTS[key].label} der
Ferienwohnungs-Plattform TRIMOSA. Setze die Änderungswünsche des Admins um, erhalte dabei
alle Sicherheitsregeln (nichts erfinden, keine ungeprüften Zusagen) — außer der Admin hebt
sie ausdrücklich auf. Antworte NUR mit dem vollständigen neuen Prompt.`
    try {
      const proposal = await askClaude(meta, `AKTUELLER PROMPT:\n${current}\n\nÄNDERUNGSWUNSCH: ${instruction.slice(0, 500)}`)
      return NextResponse.json({ proposal })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'KI-Fehler.' }, { status: 502 })
    }
  }
  return NextResponse.json({ error: 'Unbekannte Aktion.' }, { status: 400 })
}
