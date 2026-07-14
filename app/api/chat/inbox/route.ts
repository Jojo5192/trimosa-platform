import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * GET /api/chat/inbox — the team's unified guest-communication inbox.
 *
 * Merges two thread sources into one list:
 *  - kind 'direct':  platform conversations (guests with a TRIMOSA account)
 *  - kind 'booking': bookings that came in via Smoobu (Airbnb/Booking/…) and
 *    have NO platform conversation — their messages flow through
 *    /api/messages/[bookingId] (bidirectional Smoobu sync).
 *
 * Access: team only (is_admin | is_host | is_staff). Guests keep using the
 * classic /api/chat endpoint through their own chat views.
 */
export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host, is_staff').eq('id', user.id).maybeSingle()
  if (!me?.is_admin && !me?.is_host && !me?.is_staff) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  }

  const today = new Date().toISOString().slice(0, 10)

  const [{ data: conversations }, { data: bookings }] = await Promise.all([
    supabaseAdmin
      .from('conversations')
      .select('*, bookings(check_in, check_out, channel, listing_id)')
      .order('last_message_at', { ascending: false }),
    supabaseAdmin
      .from('bookings')
      .select('id, guest_name, check_in, check_out, channel, source, listing_id, smoobu_reservation_id, created_at, listings(title), conversations(id)')
      .not('smoobu_reservation_id', 'is', null)
      .order('check_in', { ascending: false })
      .limit(400),
  ])

  // Listing titles for the conversation threads
  const listingIds = [...new Set([
    ...(conversations ?? []).map((c) => (c.bookings as { listing_id?: string } | null)?.listing_id).filter(Boolean),
  ])] as string[]
  const { data: listingRows } = listingIds.length
    ? await supabaseAdmin.from('listings').select('id, title').in('id', listingIds)
    : { data: [] }
  const listingTitle = new Map((listingRows ?? []).map((l) => [l.id, l.title]))

  // Unread counts + guest avatars for direct threads
  const convIds = (conversations ?? []).map((c) => c.id)
  const guestIds = [...new Set((conversations ?? []).map((c) => c.guest_id).filter(Boolean))]
  const [{ data: unreadRows }, { data: avatars }] = await Promise.all([
    convIds.length
      ? supabaseAdmin.from('messages').select('conversation_id').in('conversation_id', convIds).neq('sender_id', user.id).is('read_at', null)
      : Promise.resolve({ data: [] }),
    guestIds.length
      ? supabaseAdmin.from('profiles').select('id, avatar_url, display_name').in('id', guestIds)
      : Promise.resolve({ data: [] }),
  ])
  const unread: Record<string, number> = {}
  for (const r of unreadRows ?? []) unread[r.conversation_id] = (unread[r.conversation_id] ?? 0) + 1
  const guestProfile = new Map((avatars ?? []).map((p) => [p.id, p]))

  // Booking threads: last message + unread from the booking-message world
  const bookingRows = (bookings ?? []).filter((b) => {
    const convs = b.conversations as { id: string }[] | { id: string } | null
    return !convs || (Array.isArray(convs) && convs.length === 0)
  })
  const bookingIds = bookingRows.map((b) => b.id)
  const { data: bMsgs } = bookingIds.length
    ? await supabaseAdmin
        .from('messages')
        .select('booking_id, created_at, sender_type, read_at')
        .in('booking_id', bookingIds)
    : { data: [] }
  const lastMsg: Record<string, string> = {}
  const bUnread: Record<string, number> = {}
  for (const m of bMsgs ?? []) {
    if (!m.booking_id) continue
    if (!lastMsg[m.booking_id] || m.created_at > lastMsg[m.booking_id]) lastMsg[m.booking_id] = m.created_at
    if (m.sender_type === 'guest' && !m.read_at) bUnread[m.booking_id] = (bUnread[m.booking_id] ?? 0) + 1
  }

  function guestStatus(checkIn: string | null, checkOut: string | null): 'current' | 'upcoming' | 'past' | null {
    if (!checkIn || !checkOut) return null
    if (checkIn <= today && checkOut >= today) return 'current'
    if (checkIn > today) return 'upcoming'
    return 'past'
  }

  const directThreads = (conversations ?? []).map((c) => {
    const b = c.bookings as { check_in?: string; check_out?: string; channel?: string; listing_id?: string } | null
    const gp = guestProfile.get(c.guest_id)
    return {
      kind: 'direct' as const,
      id: c.id,
      guestName: gp?.display_name || c.guest_name || 'Gast',
      guestAvatar: gp?.avatar_url ?? null,
      listingTitle: b?.listing_id ? listingTitle.get(b.listing_id) ?? null : null,
      platform: 'TRIMOSA',
      checkIn: b?.check_in ?? null,
      checkOut: b?.check_out ?? null,
      guestStatus: guestStatus(b?.check_in ?? null, b?.check_out ?? null),
      lastMessageAt: c.last_message_at,
      unread: unread[c.id] ?? 0,
    }
  })

  const bookingThreads = bookingRows
    // Only meaningful threads: has messages OR guest is current/upcoming
    .filter((b) => lastMsg[b.id] || guestStatus(b.check_in, b.check_out) !== 'past')
    .map((b) => ({
      kind: 'booking' as const,
      id: b.id,
      guestName: b.guest_name || 'Gast',
      guestAvatar: null,
      listingTitle: ((Array.isArray(b.listings) ? b.listings[0] : b.listings) as { title: string } | null)?.title ?? null,
      platform: b.channel && b.channel !== 'direct' ? b.channel : b.source === 'trimosa' ? 'TRIMOSA' : 'Smoobu',
      checkIn: b.check_in,
      checkOut: b.check_out,
      guestStatus: guestStatus(b.check_in, b.check_out),
      lastMessageAt: lastMsg[b.id] ?? b.created_at,
      unread: bUnread[b.id] ?? 0,
    }))

  const threads = [...directThreads, ...bookingThreads]
    .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))

  return NextResponse.json({ userId: user.id, threads })
}
