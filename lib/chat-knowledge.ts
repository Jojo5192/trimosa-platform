/**
 * Learning chat knowledge base.
 *
 * backfillSmoobuMessages(page) — one paginated pass over the Smoobu
 * reservation history: pulls every conversation's messages into
 * smoobu_message_archive (idempotent via smoobu_message_id unique). The
 * admin UI loops pages until hasMore is false.
 *
 * refreshChatKnowledge() — Claude distils ALL host replies (archive + live
 * platform chats) into one compact FAQ knowledge document per listing plus a
 * global one, stored in chat_knowledge. Runs weekly via cron or on demand.
 * The ✨ chat suggestions feed on these documents, so every synced or sent
 * reply sharpens the next distillate — the "gets better over time" loop.
 */
import { supabaseAdmin } from '@/lib/supabase-admin'
import { listReservations, getReservationMessages } from '@/lib/smoobu'
import { askClaude } from '@/lib/ai'

const BACKFILL_FROM = '2019-01-01'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function backfillSmoobuMessages(page: number): Promise<{
  page: number
  reservations: number
  imported: number
  hasMore: boolean
}> {
  const { reservations, hasMore } = await listReservations(BACKFILL_FROM, todayIso(), page)

  // Map Smoobu apartment ids → our listings
  const { data: listings } = await supabaseAdmin
    .from('listings')
    .select('id, smoobu_id')
    .not('smoobu_id', 'is', null)
  const listingBySmoobuId = new Map<number, string>(
    (listings ?? []).map((l) => [Number(l.smoobu_id), l.id as string])
  )

  let imported = 0
  for (const resv of reservations) {
    const messages = await getReservationMessages(resv.id)
    if (messages.length === 0) continue
    const listingId = resv.apartmentId != null ? listingBySmoobuId.get(resv.apartmentId) ?? null : null
    const rows = messages
      .filter((m) => (m.message ?? '').trim().length > 0)
      .map((m) => {
        // Smoobu's sender lives in `type` (senderType "owner"/"guest" or
        // direction "outgoing"/"incoming") — `sender` is just the NAME.
        const t = String(m.type ?? '').toLowerCase()
        const isHost = t === 'owner' || t === 'outgoing' || t === 'host'
        return {
          smoobu_reservation_id: resv.id,
          smoobu_message_id: `${resv.id}_${m.id}`,
          apartment_id: resv.apartmentId,
          listing_id: listingId,
          sender_type: isHost ? 'host' : 'guest',
          content: m.message.trim().slice(0, 4000),
          sent_at: m.date || null,
        }
      })
    if (rows.length > 0) {
      // Full upsert (no ignoreDuplicates) so a re-import CORRECTS existing rows
      const { error, count } = await supabaseAdmin
        .from('smoobu_message_archive')
        .upsert(rows, { onConflict: 'smoobu_message_id', count: 'exact' })
      if (error) console.error('[chat-knowledge] archive upsert failed:', error.message)
      else imported += count ?? rows.length
    }
  }

  return { page, reservations: reservations.length, imported, hasMore }
}

/** Q&A pairs: each host reply with the guest message it answered (context!). */
async function collectHostReplies(listingId: string | null): Promise<string[]> {
  const pairs: string[] = []

  // 1) Smoobu archive (years of history) — walk per reservation to pair Q&A
  let archiveQuery = supabaseAdmin
    .from('smoobu_message_archive')
    .select('smoobu_reservation_id, sender_type, content, sent_at')
    .order('smoobu_reservation_id', { ascending: false })
    .order('sent_at', { ascending: true })
    .limit(2000)
  archiveQuery = listingId
    ? archiveQuery.eq('listing_id', listingId)
    : archiveQuery.is('listing_id', null)
  const { data: archived } = await archiveQuery

  let lastGuest = ''
  let lastResv: number | null = null
  for (const m of archived ?? []) {
    if (m.smoobu_reservation_id !== lastResv) { lastGuest = ''; lastResv = m.smoobu_reservation_id }
    if (m.sender_type === 'guest') lastGuest = m.content
    else if (m.content.trim().length >= 25) {
      pairs.push(lastGuest
        ? `GAST: ${lastGuest.slice(0, 300)}\nANTWORT: ${m.content.slice(0, 500)}`
        : `ANTWORT: ${m.content.slice(0, 500)}`)
      lastGuest = ''
    }
  }

  // 2) Live platform chats (booking messages, host side)
  if (listingId) {
    const { data: bookingIds } = await supabaseAdmin
      .from('bookings').select('id').eq('listing_id', listingId).limit(300)
    const ids = (bookingIds ?? []).map((b) => b.id)
    if (ids.length > 0) {
      const { data: live } = await supabaseAdmin
        .from('messages')
        .select('content, sender_type, booking_id, created_at')
        .in('booking_id', ids)
        .order('booking_id').order('created_at', { ascending: true })
        .limit(1000)
      let lg = ''
      let lastBooking: string | null = null
      for (const m of live ?? []) {
        if (m.booking_id !== lastBooking) { lg = ''; lastBooking = m.booking_id }
        if (m.sender_type === 'guest') lg = m.content
        else if (m.sender_type === 'host' && (m.content ?? '').trim().length >= 25) {
          pairs.push(lg ? `GAST: ${lg.slice(0, 300)}\nANTWORT: ${m.content.slice(0, 500)}` : `ANTWORT: ${m.content.slice(0, 500)}`)
          lg = ''
        }
      }
    }
  }

  return pairs
}

async function distil(listingTitle: string, pairs: string[]): Promise<string> {
  const system = `Du destillierst aus echten Gastgeber-Antworten von TRIMOSA Apartments & Homes
eine kompakte Wissensbasis für ${listingTitle}. Erstelle ein strukturiertes FAQ-Dokument
(Markdown, Abschnitte mit ###) mit den wiederkehrenden Themen und den BEWÄHRTEN Antworten
des Gastgebers: Check-in/Schlüssel, WLAN, Parken, Anreise, Ausstattung, Umgebungstipps,
Sonderwünsche, Storno — je nachdem, was in den Antworten tatsächlich vorkommt.

Regeln:
- NUR Fakten aus den vorliegenden Antworten — nichts erfinden oder verallgemeinern.
- Konkrete Details wörtlich erhalten (Codes-Prozedere, Uhrzeiten, Ortsnamen). Aber:
  konkrete Zahlencodes/Passwörter NICHT ins Dokument übernehmen — stattdessen das
  Prozedere beschreiben (z. B. "Code kommt am Anreisetag per Nachricht").
- Bei widersprüchlichen Antworten gilt die neueste (spätere Einträge sind neuer).
- Maximal ~600 Wörter. Antworte NUR mit dem Dokument.`
  // Newest first in the list — cap the volume, Claude weighs later entries as newer
  const user = pairs.slice(0, 220).map((p, i) => `[${i + 1}]\n${p}`).join('\n\n')
  return askClaude(system, user, 1400)
}

export async function refreshChatKnowledge(): Promise<{ scope: string; sources: number; status: string }[]> {
  const results: { scope: string; sources: number; status: string }[] = []
  const { data: listings } = await supabaseAdmin
    .from('listings').select('id, title').eq('is_active', true)

  for (const listing of listings ?? []) {
    const pairs = await collectHostReplies(listing.id)
    if (pairs.length < 5) {
      results.push({ scope: listing.title, sources: pairs.length, status: 'übersprungen (zu wenig Material)' })
      continue
    }
    try {
      const content = await distil(`die Ferienwohnung „${listing.title}“`, pairs)
      const { error } = await supabaseAdmin.from('chat_knowledge').upsert(
        { scope: 'listing', listing_id: listing.id, content, source_count: pairs.length, updated_at: new Date().toISOString() },
        { onConflict: 'scope,listing_id' },
      )
      results.push({ scope: listing.title, sources: pairs.length, status: error ? `Fehler: ${error.message}` : 'ok' })
    } catch (err) {
      results.push({ scope: listing.title, sources: pairs.length, status: `Fehler: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  // Global document from unmatched archive messages (old/unmapped apartments)
  const globalPairs = await collectHostReplies(null)
  if (globalPairs.length >= 5) {
    try {
      const content = await distil('alle TRIMOSA-Wohnungen (allgemein)', globalPairs)
      const { error } = await supabaseAdmin.from('chat_knowledge').upsert(
        { scope: 'global', listing_id: null, content, source_count: globalPairs.length, updated_at: new Date().toISOString() },
        { onConflict: 'scope,listing_id' },
      )
      results.push({ scope: 'Allgemein', sources: globalPairs.length, status: error ? `Fehler: ${error.message}` : 'ok' })
    } catch (err) {
      results.push({ scope: 'Allgemein', sources: globalPairs.length, status: `Fehler: ${err instanceof Error ? err.message : String(err)}` })
    }
  } else {
    results.push({ scope: 'Allgemein', sources: globalPairs.length, status: 'übersprungen (zu wenig Material)' })
  }

  return results
}

/** Knowledge for the ✨ chat suggestion: listing doc + global doc. */
export async function getChatKnowledge(listingId: string | null): Promise<string> {
  const { data } = await supabaseAdmin
    .from('chat_knowledge')
    .select('scope, listing_id, content')
    .or(listingId ? `scope.eq.global,listing_id.eq.${listingId}` : 'scope.eq.global')
  const listingDoc = (data ?? []).find((d) => d.scope === 'listing')?.content
  const globalDoc = (data ?? []).find((d) => d.scope === 'global')?.content
  return [listingDoc, globalDoc].filter(Boolean).join('\n\n---\n\n')
}
