import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getReservationMessages, sendMessageToGuest, sendMessageToHost } from '@/lib/smoobu'

// ── Smoobu sync helper ───────────────────────────────────────
async function syncSmoobuMessages(
  conversationId: string,
  smoobuReservationId: number,
  hostId: string,
  guestId: string,
  hostApiKey?: string,
) {
  try {
    const smoobuMsgs = await getReservationMessages(smoobuReservationId, hostApiKey)
    if (!smoobuMsgs.length) return

    for (const sm of smoobuMsgs) {
      if (!sm.message?.trim()) continue
      const msgId = String(sm.id)

      // Skip if already synced by smoobu_message_id
      const { data: existing } = await supabaseAdmin
        .from('messages')
        .select('id')
        .eq('smoobu_message_id', msgId)
        .maybeSingle()
      if (existing) continue

      // Check by content match: messages sent via Trimosa have no smoobu_message_id yet
      // but already exist in DB with correct sender_id. Link them instead of duplicating.
      const msgContent = sm.message.trim()
      if (msgContent) {
        const msgTs = sm.date ? new Date(sm.date) : null
        if (msgTs && !isNaN(msgTs.getTime())) {
          const windowStart = new Date(msgTs.getTime() - 4 * 3600 * 1000).toISOString()
          const windowEnd   = new Date(msgTs.getTime() + 4 * 3600 * 1000).toISOString()
          const { data: contentMatch } = await supabaseAdmin
            .from('messages')
            .select('id')
            .eq('conversation_id', conversationId)
            .eq('content', msgContent)
            .gte('created_at', windowStart)
            .lte('created_at', windowEnd)
            .is('smoobu_message_id', null)
            .maybeSingle()
          if (contentMatch) {
            // Attach smoobu_message_id to the original message (preserves correct sender_id)
            await supabaseAdmin
              .from('messages')
              .update({ smoobu_message_id: msgId })
              .eq('id', contentMatch.id)
            console.log('[Chat] syncMsg: linked existing message', contentMatch.id, '↔ smoobu', msgId)
            continue
          }
        }
      }

      // Smoobu isHost detection — covers all known formats:
      // String: "host", "host_message", "host_to_guest", "outgoing", "sent"
      // Numeric: type=1 (often guest) OR type=2 (often host) — both conventions seen in the wild
      // Sender: "Host", "Gastgeber", or the actual host name
      // Guest indicators: "guest", "guest_message", "incoming", type=1
      const typeStr = (sm.type ?? '').toLowerCase()
      const senderStr = (sm.sender ?? '').toLowerCase()
      const isGuestType = typeStr.includes('guest') || typeStr === 'incoming' || typeStr === '1'
      const isHostType = typeStr.includes('host') || typeStr === 'outgoing' || typeStr === 'sent' || typeStr === '2'
        || senderStr.includes('host') || senderStr.includes('gastgeber')
      // If we can positively identify it as guest → guest. If host indicator → host.
      // If unknown type → fall back to host (most automated Smoobu messages are from host).
      const isHost = !isGuestType && (isHostType || typeStr === '')
      console.log('[Chat] syncMsg id:', sm.id, 'type:', sm.type, 'sender:', sm.sender, '→ isHost:', isHost, '(guestType:', isGuestType, 'hostType:', isHostType, ')')
      const senderId = isHost ? hostId : guestId

      const { error } = await supabaseAdmin
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: senderId,
          content: sm.message.trim(),
          smoobu_message_id: msgId,
          created_at: sm.date || new Date().toISOString(),
        })
      if (error) {
        console.error('[Chat] Smoobu sync insert error:', error.message, 'id:', msgId)
      }
    }
  } catch (err) {
    console.error('[Chat] syncSmoobuMessages failed:', err)
  }
}

// GET /api/chat?conversationId=... — get messages for a conversation
// GET /api/chat — get all conversations for current user
export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const conversationId = req.nextUrl.searchParams.get('conversationId')

  if (conversationId) {
    // Load conversation metadata to know booking / Smoobu link
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('host_id, guest_id, booking_id, bookings(smoobu_reservation_id)')
      .eq('id', conversationId)
      .maybeSingle()

    // Pull in new Smoobu messages using the host's own API key
    const smoobuId = (conv?.bookings as unknown as { smoobu_reservation_id: number | null } | null)?.smoobu_reservation_id
    if (conv && smoobuId) {
      const { data: hostProfile } = await supabaseAdmin
        .from('profiles')
        .select('smoobu_api_key')
        .eq('id', conv.host_id)
        .maybeSingle()
      const hostApiKey = (hostProfile as Record<string, unknown> | null)?.smoobu_api_key as string | undefined
      await syncSmoobuMessages(conversationId, smoobuId, conv.host_id, conv.guest_id, hostApiKey)
    }

    // Mark messages as read
    await supabaseAdmin
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .neq('sender_id', user.id)
      .is('read_at', null)

    const { data: messages } = await supabaseAdmin
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })

    return NextResponse.json(messages ?? [])
  }

  // All conversations for this user (as host or guest)
  const { data: conversations } = await supabaseAdmin
    .from('conversations')
    .select('*')
    .or(`host_id.eq.${user.id},guest_id.eq.${user.id}`)
    .order('last_message_at', { ascending: false })

  // Get unread counts
  const ids = (conversations ?? []).map(c => c.id)
  const { data: unreadRows } = ids.length > 0
    ? await supabaseAdmin
        .from('messages')
        .select('conversation_id')
        .in('conversation_id', ids)
        .neq('sender_id', user.id)
        .is('read_at', null)
    : { data: [] }

  const unreadMap: Record<string, number> = {}
  for (const row of unreadRows ?? []) {
    unreadMap[row.conversation_id] = (unreadMap[row.conversation_id] ?? 0) + 1
  }

  const result = (conversations ?? []).map(c => ({ ...c, unread: unreadMap[c.id] ?? 0 }))
  return NextResponse.json(result)
}

// POST /api/chat — send a message (or create conversation if needed)
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const body = await req.json()
  const { conversationId, content, listingId, hostId, guestName, listingTitle } = body

  if (!content?.trim()) return NextResponse.json({ error: 'Kein Inhalt' }, { status: 400 })

  let convId = conversationId

  // Create conversation if new
  if (!convId) {
    if (!listingId || !hostId) return NextResponse.json({ error: 'listingId und hostId erforderlich' }, { status: 400 })

    const { data: existing } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('listing_id', listingId)
      .eq('guest_id', user.id)
      .maybeSingle()

    if (existing) {
      convId = existing.id
    } else {
      const { data: newConv, error: convErr } = await supabaseAdmin
        .from('conversations')
        .insert({
          listing_id: listingId,
          host_id: hostId,
          guest_id: user.id,
          guest_name: guestName ?? user.user_metadata?.name ?? user.email,
          listing_title: listingTitle ?? '',
          last_message_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (convErr || !newConv) return NextResponse.json({ error: 'Konversation konnte nicht erstellt werden' }, { status: 500 })
      convId = newConv.id
    }
  }

  // Insert message
  const { data: message, error: msgErr } = await supabaseAdmin
    .from('messages')
    .insert({ conversation_id: convId, sender_id: user.id, content: content.trim() })
    .select('*')
    .single()

  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 })

  // Update last_message_at on conversation
  await supabaseAdmin
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', convId)

  // Forward to Smoobu if host is sending and booking has smoobu_reservation_id
  try {
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('host_id, bookings(smoobu_reservation_id)')
      .eq('id', convId)
      .maybeSingle()

    const smoobuId = (conv?.bookings as unknown as { smoobu_reservation_id: number | null } | null)?.smoobu_reservation_id
    const isHost = conv?.host_id === user.id

    if (smoobuId) {
      // Load host's API key (needed for both directions)
      const { data: hp } = await supabaseAdmin
        .from('profiles')
        .select('smoobu_api_key')
        .eq('id', conv?.host_id ?? '')
        .maybeSingle()
      const hKey = (hp as Record<string, unknown> | null)?.smoobu_api_key as string | undefined

      if (isHost) {
        // Host → Guest: forward host's message to Smoobu
        console.log('[Chat] Host→Smoobu: forwarding to reservation', smoobuId)
        await sendMessageToGuest(smoobuId, content.trim(), hKey)
      } else {
        // Guest → Host: forward guest's message to Smoobu so host sees it there too
        const { data: guestProfile } = await supabaseAdmin
          .from('profiles')
          .select('display_name, guest_first_name, guest_last_name')
          .eq('id', user.id)
          .maybeSingle()
        const gp = guestProfile as Record<string, unknown> | null
        const guestName = (gp?.guest_first_name && gp?.guest_last_name)
          ? `${gp.guest_first_name} ${gp.guest_last_name}`
          : (gp?.display_name as string) || 'Gast'
        console.log('[Chat] Guest→Smoobu: forwarding from', guestName, 'to reservation', smoobuId)
        await sendMessageToHost(smoobuId, content.trim(), guestName, hKey)
      }
    }
  } catch (err) {
    console.error('[Chat] Smoobu forward failed', err)
  }

  return NextResponse.json({ message, conversationId: convId })
}
