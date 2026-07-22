import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendMessageToGuest, getReservationMessages, isSmoobuSystemMessage } from '@/lib/smoobu'
import { translateIncoming } from '@/lib/translate'

/**
 * GET /api/messages/[bookingId]
 * Returns all messages for a booking (from our DB + synced from Smoobu).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bookingId: string }> }
) {
  const { bookingId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 })

  // Verify the user has access to this booking
  const { data: booking } = await supabaseAdmin
    .from('bookings')
    .select('id, guest_id, smoobu_reservation_id, listings(host_id)')
    .eq('id', bookingId)
    .single()

  if (!booking) return NextResponse.json({ error: 'Buchung nicht gefunden' }, { status: 404 })

  const listing = booking.listings as unknown as { host_id: string } | null
  // Team access: the listing's host plus every admin/host/staff member —
  // the unified inbox lets the whole team answer guests.
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host, is_staff').eq('id', user.id).maybeSingle()
  const isHost = listing?.host_id === user.id || !!me?.is_admin || !!me?.is_host || !!me?.is_staff
  const isGuest = booking.guest_id === user.id
  if (!isHost && !isGuest) return NextResponse.json({ error: 'Kein Zugriff' }, { status: 403 })

  // If connected to Smoobu, pull fresh messages and sync them — throttled to
  // once per 30s per booking (the panel polls every 5s; without a cooldown
  // every poll pays a full Smoobu roundtrip and the chat feels sluggish)
  const g = globalThis as typeof globalThis & { __bookingSyncCache?: Map<string, number> }
  const syncCache = (g.__bookingSyncCache ??= new Map<string, number>())
  const lastSync = syncCache.get(bookingId) ?? 0
  if (booking.smoobu_reservation_id && Date.now() - lastSync >= 30_000) {
    syncCache.set(bookingId, Date.now())
    try {
      const smoobuMessages = await getReservationMessages(Number(booking.smoobu_reservation_id))
      const ids = smoobuMessages.map((sm) => String(sm.id))
      const { data: already } = ids.length
        ? await supabaseAdmin.from('messages').select('smoobu_message_id').in('smoobu_message_id', ids)
        : { data: [] }
      const known = new Set((already ?? []).map((m) => m.smoobu_message_id))
      // Web-app sent messages without a claimed Smoobu id (older sends /
      // Smoobu send response without id): adopt them instead of re-importing,
      // and heal rows that were already duplicated by earlier syncs.
      const { data: unclaimed } = await supabaseAdmin
        .from('messages')
        .select('id, content, created_at')
        .eq('booking_id', bookingId)
        .eq('sender_type', 'host')
        .is('smoobu_message_id', null)
      const unclaimedByContent = new Map<string, { id: string; created_at: string }[]>()
      for (const r of unclaimed ?? []) {
        const k = (r.content ?? '').trim()
        if (!unclaimedByContent.has(k)) unclaimedByContent.set(k, [])
        unclaimedByContent.get(k)!.push(r)
      }
      const takeUnclaimed = (content: string) => {
        const list = unclaimedByContent.get(content)
        if (!list?.length) return null
        // don't touch rows younger than 90s — their own Smoobu copy may still be in flight
        const idx = list.findIndex((r) => Date.now() - new Date(r.created_at).getTime() > 90_000)
        if (idx === -1) return null
        return list.splice(idx, 1)[0]
      }
      for (const sm of smoobuMessages) {
        if (!sm.message?.trim()) continue
        // Smoobu-Automatik-/Schloss-Protokolle nicht in den Chat holen (§143)
        if (isSmoobuSystemMessage(sm.subject)) continue
        const content = sm.message.trim()
        const fromHost = ['2', 'owner', 'outgoing', 'host'].includes(String(sm.type ?? '').toLowerCase())
        if (known.has(String(sm.id))) {
          // already imported — if an unclaimed local twin exists, it IS the
          // duplicate the team sees: remove it (self-healing)
          if (fromHost) {
            const twin = takeUnclaimed(content)
            if (twin) await supabaseAdmin.from('messages').delete().eq('id', twin.id)
          }
          continue
        }
        if (fromHost) {
          const twin = takeUnclaimed(content)
          if (twin) {
            // our own web-app message came back from Smoobu → claim, don't duplicate
            await supabaseAdmin.from('messages').update({ smoobu_message_id: String(sm.id) }).eq('id', twin.id)
            continue
          }
        }
        // insert (not upsert): the partial unique index on smoobu_message_id
        // doesn't match ON CONFLICT without its predicate
        const { error } = await supabaseAdmin.from('messages').insert({
          booking_id: bookingId,
          smoobu_message_id: String(sm.id),
          sender_type: fromHost ? 'host' : 'guest',
          content,
          created_at: sm.date || undefined,
        })
        if (error) console.error('[Messages] insert failed:', error.message)
      }
    } catch (err) {
      console.error('[Messages] Smoobu sync failed:', err)
    }
  }

  // Reading as team marks guest messages as read (inbox unread counter)
  if (isHost) {
    await supabaseAdmin
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('booking_id', bookingId)
      .eq('sender_type', 'guest')
      .is('read_at', null)
  }

  const { data: messages } = await supabaseAdmin
    .from('messages')
    .select('*')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: true })

  // Translate new guest messages to German once (cached in lang/content_de)
  let out = messages ?? []
  const untranslated = out.filter((m) => m.sender_type === 'guest' && !m.lang && (m.content ?? '').trim().length > 0)
  if (untranslated.length > 0) {
    const map = await translateIncoming(untranslated.slice(0, 25).map((m) => ({ id: m.id, text: m.content })))
    out = out.map((m) => {
      const t = map.get(m.id)
      return t ? { ...m, lang: t.lang, content_de: t.german } : m
    })
  }

  return NextResponse.json({ messages: out })
}

/**
 * POST /api/messages/[bookingId]
 * Body: { content: string }
 * Saves message to DB and pushes to Smoobu if connected.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ bookingId: string }> }
) {
  const { bookingId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 })

  const { content, contentDe, lang } = await request.json()
  if (!content?.trim()) return NextResponse.json({ error: 'Nachricht leer' }, { status: 400 })

  const { data: booking } = await supabaseAdmin
    .from('bookings')
    .select('id, guest_id, guest_name, guest_email, smoobu_reservation_id, listings(host_id, title)')
    .eq('id', bookingId)
    .single()

  if (!booking) return NextResponse.json({ error: 'Buchung nicht gefunden' }, { status: 404 })

  const listing = booking.listings as unknown as { host_id: string; title?: string | null } | null
  // Team access: the listing's host plus every admin/host/staff member —
  // the unified inbox lets the whole team answer guests.
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host, is_staff').eq('id', user.id).maybeSingle()
  const isHost = listing?.host_id === user.id || !!me?.is_admin || !!me?.is_host || !!me?.is_staff
  const isGuest = booking.guest_id === user.id
  if (!isHost && !isGuest) return NextResponse.json({ error: 'Kein Zugriff' }, { status: 403 })

  const senderType = isHost ? 'host' : 'guest'

  // Save to our DB
  const { data: msg, error } = await supabaseAdmin
    .from('messages')
    .insert({
      booking_id: bookingId,
      sender_type: senderType,
      sender_id: user.id,
      content: content.trim(),
      // Outgoing translation flow: content = sent (guest-language) version,
      // content_de = the team's German original, lang = sent language
      content_de: typeof contentDe === 'string' && contentDe.trim() ? contentDe.trim() : null,
      lang: typeof lang === 'string' && /^[a-z]{2}$/.test(lang) ? lang : null,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: 'Speichern fehlgeschlagen' }, { status: 500 })

  // Push to Smoobu (only host messages — we send to guest via Smoobu).
  // Store the returned Smoobu message id on our row: the next sync would
  // otherwise re-import our own message as a "new" one → duplicate bubble.
  let smoobuDelivered = false
  if (isHost && booking.smoobu_reservation_id) {
    try {
      const smoobuMsgId = await sendMessageToGuest(Number(booking.smoobu_reservation_id), content.trim())
      if (smoobuMsgId != null) smoobuDelivered = true
      if (smoobuMsgId != null && msg?.id) {
        await supabaseAdmin.from('messages').update({ smoobu_message_id: String(smoobuMsgId) }).eq('id', msg.id)
      }
    } catch (err) {
      console.error('[Messages] Smoobu push failed:', err)
    }
  }

  // 📧-Fallback (§140): Erreicht die Antwort den Gast NICHT über Smoobu
  // (keine Reservierungs-ID oder Push fehlgeschlagen), geht sie per E-Mail
  // raus — an bookings.guest_email (FeWo-Relay/Mail-Anreicherung) bzw. die
  // Login-Mail des Gast-Kontos. Antworten fließen über die Inbound-Pipeline
  // zurück in diesen Thread.
  if (isHost && !smoobuDelivered) {
    try {
      let to = (booking.guest_email as string | null)?.trim() || null
      if (!to && booking.guest_id) {
        const { data: u } = await supabaseAdmin.auth.admin.getUserById(booking.guest_id)
        to = u?.user?.email ?? null
      }
      if (to) {
        const { sendGuestChatEmail } = await import('@/lib/email')
        await sendGuestChatEmail({
          to,
          guestName: booking.guest_name,
          listingTitle: listing?.title ?? null,
          text: content.trim(),
          lang: typeof lang === 'string' ? lang : null,
        })
        console.log('[Messages] Antwort per E-Mail an Gast:', to)
      } else {
        console.log('[Messages] Antwort NICHT zustellbar (kein Smoobu, keine E-Mail):', bookingId)
      }
    } catch (err) {
      console.error('[Messages] Gast-Mail-Fallback failed:', err)
    }
  }

  return NextResponse.json({ message: msg })
}
