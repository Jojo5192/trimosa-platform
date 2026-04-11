import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getReservationMessages, sendMessageToGuest } from '@/lib/smoobu'

// ── Smoobu sync helper ───────────────────────────────────────
async function syncSmoobuMessages(
  conversationId: string,
  smoobuReservationId: number,
  hostId: string,
  guestId: string,
) {
  try {
    const smoobuMsgs = await getReservationMessages(smoobuReservationId)
    for (const sm of smoobuMsgs) {
      const isGuestMsg = sm.type?.toLowerCase().includes('guest') || sm.sender?.toLowerCase().includes('guest')
      const senderId = isGuestMsg ? guestId : hostId

      const { error } = await supabaseAdmin
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: senderId,
          content: sm.message ?? '',
          smoobu_message_id: String(sm.id),
          created_at: sm.date ?? new Date().toISOString(),
        })
      if (error && !error.message?.includes('unique') && error.code !== '23505') {
        console.error('[Chat] syncSmoobuMessages insert error', error)
      }
    }
  } catch (err) {
    console.error('[Chat] syncSmoobuMessages failed', err)
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

    // Pull in new Smoobu messages if the booking is linked
    const smoobuId = (conv?.bookings as unknown as { smoobu_reservation_id: number | null } | null)?.smoobu_reservation_id
    if (conv && smoobuId) {
      await syncSmoobuMessages(conversationId, smoobuId, conv.host_id, conv.guest_id)
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
    if (smoobuId && conv?.host_id === user.id) {
      await sendMessageToGuest(smoobuId, content.trim())
    }
  } catch (err) {
    console.error('[Chat] Smoobu forward failed', err)
  }

  return NextResponse.json({ message, conversationId: convId })
}
