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
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host, is_staff').eq('id', user.id).maybeSingle()
  if (!me?.is_admin && !me?.is_host && !me?.is_staff) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  }

  const today = new Date().toISOString().slice(0, 10)

  // ?archiv=1 — „Ältere Chats laden": ALLE vergangenen Buchungen mit
  // Chat-Verlauf im Smoobu-Archiv, als einmalige Nachladung (kein Polling,
  // keine Unread-/Preview-Logik — der volle Verlauf kommt beim Öffnen). §129
  if (new URL(request.url).searchParams.get('archiv') === '1') {
    const { data: oldRows } = await supabaseAdmin
      .from('bookings')
      .select('id, guest_name, check_in, check_out, channel, source, status, smoobu_reservation_id, adults, children, listings(title)')
      .not('smoobu_reservation_id', 'is', null)
      .lt('check_out', today)
      .order('check_in', { ascending: false })
      .limit(2000)
    const rows = oldRows ?? []
    const resIds = [...new Set(rows.map((b) => Number(b.smoobu_reservation_id)).filter(Number.isFinite))]
    // Neueste Archiv-Nachricht je Reservierung — in ID-Chunks (URL-Länge!)
    const lastByRes: Record<number, { at: string; sender: 'guest' | 'host' }> = {}
    for (let i = 0; i < resIds.length; i += 300) {
      const { data: ms } = await supabaseAdmin
        .from('smoobu_message_archive')
        .select('smoobu_reservation_id, sent_at, sender_type')
        .in('smoobu_reservation_id', resIds.slice(i, i + 300))
        .order('sent_at', { ascending: false })
        .limit(5000)
      for (const m of ms ?? []) {
        if (!lastByRes[m.smoobu_reservation_id] && m.sent_at) {
          lastByRes[m.smoobu_reservation_id] = { at: m.sent_at, sender: m.sender_type === 'guest' ? 'guest' : 'host' }
        }
      }
    }
    const threads = rows
      .filter((b) => lastByRes[Number(b.smoobu_reservation_id)])
      .map((b) => {
        const last = lastByRes[Number(b.smoobu_reservation_id)]
        return {
          kind: 'booking' as const,
          id: b.id,
          guestName: b.guest_name || 'Gast',
          guestAvatar: null,
          listingTitle: ((Array.isArray(b.listings) ? b.listings[0] : b.listings) as { title: string } | null)?.title ?? null,
          platform: b.channel && b.channel !== 'direct' ? b.channel : b.source === 'trimosa' ? 'TRIMOSA' : 'Smoobu',
          checkIn: b.check_in,
          checkOut: b.check_out,
          guestStatus: (b.status === 'cancelled' ? 'cancelled' : 'past') as 'past' | 'cancelled',
          lastMessageAt: last.at,
          lastPreview: null,
          lastSender: last.sender,
          guestLang: null,
          noReplyNeeded: false,
          phoneResolved: false,
          adults: b.adults ?? null,
          children: b.children ?? null,
          unread: 0,
        }
      })
      .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
    return NextResponse.json({ archiv: true, threads })
  }

  const [{ data: conversations }, { data: bookings }] = await Promise.all([
    supabaseAdmin
      .from('conversations')
      .select('*, bookings(check_in, check_out, channel, listing_id, status, adults, children)')
      .order('last_message_at', { ascending: false }),
    supabaseAdmin
      .from('bookings')
      .select('id, guest_name, check_in, check_out, channel, source, status, listing_id, smoobu_reservation_id, created_at, adults, children, listings(title), conversations(id)')
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
      ? supabaseAdmin.from('messages')
          .select('conversation_id, sender_id, read_at, created_at')
          .in('conversation_id', convIds)
          .order('created_at', { ascending: false })
          .limit(800)
      : Promise.resolve({ data: [] }),
    guestIds.length
      ? supabaseAdmin.from('profiles').select('id, avatar_url, display_name').in('id', guestIds)
      : Promise.resolve({ data: [] }),
  ])
  // „Beantwortet = gelesen" (Pascal-Bug 19.7.): Gast-Nachrichten zählen nur
  // dann als ungelesen, wenn NACH ihnen keine Host-Antwort mehr kam — sonst
  // blieben via Smoobu/anderswo beantwortete Threads ewig „ungelesen".
  const convGuest = new Map((conversations ?? []).map((c) => [c.id as string, c.guest_id as string | null]))
  const unread: Record<string, number> = {}
  const dAnswered = new Set<string>()
  for (const r of (unreadRows ?? []) as { conversation_id: string; sender_id: string | null; read_at: string | null }[]) {
    const isGuest = r.sender_id != null && r.sender_id === convGuest.get(r.conversation_id)
    if (!isGuest) { dAnswered.add(r.conversation_id); continue }
    if (!dAnswered.has(r.conversation_id) && !r.read_at) {
      unread[r.conversation_id] = (unread[r.conversation_id] ?? 0) + 1
    }
  }
  const guestProfile = new Map((avatars ?? []).map((p) => [p.id, p]))

  // Booking threads: last message + unread from the booking-message world.
  // Live messages only exist once a thread was opened — for everything else
  // the Smoobu ARCHIVE (backfilled history) provides the true last-message
  // time, preview and sender.
  const bookingRows = (bookings ?? []).filter((b) => {
    const convs = b.conversations as { id: string }[] | { id: string } | null
    return !convs || (Array.isArray(convs) && convs.length === 0)
  })
  const bookingIds = bookingRows.map((b) => b.id)
  const smoobuIds = bookingRows.map((b) => Number(b.smoobu_reservation_id)).filter(Number.isFinite)

  type Last = { at: string; preview: string; sender: 'guest' | 'host'; noReply?: boolean; phone?: boolean }
  const lastLive: Record<string, Last> = {}
  const bUnread: Record<string, number> = {}
  // phone_resolved mit Deploy-sicherem Retry (Migration evtl. noch nicht gelaufen).
  // Breiter Response-Typ, weil supabase-js die beiden select-Strings verschieden typisiert.
  type MsgRes = { data: unknown[] | null; error: { message: string } | null }
  const B_COLS = 'booking_id, created_at, sender_type, read_at, content, content_de, lang, no_reply_needed'
  let bRes: MsgRes = bookingIds.length
    ? await supabaseAdmin
        .from('messages')
        .select(B_COLS + ', phone_resolved')
        .in('booking_id', bookingIds)
        .order('created_at', { ascending: false })
        .limit(800)
    : { data: [], error: null }
  if (bRes.error && /phone_resolved/i.test(bRes.error.message)) {
    bRes = await supabaseAdmin
      .from('messages')
      .select(B_COLS)
      .in('booking_id', bookingIds)
      .order('created_at', { ascending: false })
      .limit(800)
  }
  const bMsgs = (bRes.data ?? []) as unknown as Array<{
    booking_id: string | null; created_at: string; sender_type: string | null; read_at: string | null
    content: string | null; content_de: string | null; lang: string | null
    no_reply_needed?: boolean; phone_resolved?: boolean
  }>
  const bLang: Record<string, string> = {}
  // gleiches „beantwortet = gelesen"-Prinzip wie bei den Direkt-Threads:
  // bMsgs sind DESC sortiert — sobald eine Host-Nachricht gesehen wurde, sind
  // alle ÄLTEREN Gast-Nachrichten des Threads beantwortet und zählen nicht
  const bAnswered = new Set<string>()
  for (const m of bMsgs) {
    if (!m.booking_id) continue
    if (!bLang[m.booking_id] && m.sender_type === 'guest' && m.lang) bLang[m.booking_id] = m.lang
    if (!lastLive[m.booking_id]) {
      lastLive[m.booking_id] = {
        at: m.created_at,
        preview: (m.content_de || m.content || '').replace(/\s+/g, ' ').slice(0, 90),
        sender: m.sender_type === 'guest' ? 'guest' : 'host',
        noReply: !!m.no_reply_needed,
        phone: !!m.phone_resolved,
      }
    }
    if (m.sender_type !== 'guest') { bAnswered.add(m.booking_id); continue }
    if (!m.read_at && !bAnswered.has(m.booking_id)) bUnread[m.booking_id] = (bUnread[m.booking_id] ?? 0) + 1
  }

  const lastArchive: Record<number, Last> = {}
  const { data: aMsgs } = smoobuIds.length
    ? await supabaseAdmin
        .from('smoobu_message_archive')
        .select('smoobu_reservation_id, sent_at, sender_type, content')
        .in('smoobu_reservation_id', smoobuIds)
        .order('sent_at', { ascending: false })
        .limit(2000)
    : { data: [] }
  for (const m of aMsgs ?? []) {
    if (!lastArchive[m.smoobu_reservation_id] && m.sent_at) {
      lastArchive[m.smoobu_reservation_id] = {
        at: m.sent_at,
        preview: (m.content || '').replace(/\s+/g, ' ').slice(0, 90),
        sender: m.sender_type === 'guest' ? 'guest' : 'host',
      }
    }
  }

  function guestStatus(checkIn: string | null, checkOut: string | null, bookingStatus?: string | null): 'current' | 'upcoming' | 'past' | 'cancelled' | null {
    if (bookingStatus === 'cancelled') return 'cancelled'
    if (!checkIn || !checkOut) return null
    if (checkIn <= today && checkOut >= today) return 'current'
    if (checkIn > today) return 'upcoming'
    return 'past'
  }

  const D_COLS = 'conversation_id, created_at, sender_id, content, content_de, lang, no_reply_needed'
  let dRes: MsgRes = convIds.length
    ? await supabaseAdmin
        .from('messages')
        .select(D_COLS + ', phone_resolved')
        .in('conversation_id', convIds)
        .order('created_at', { ascending: false })
        .limit(400)
    : { data: [], error: null }
  if (dRes.error && /phone_resolved/i.test(dRes.error.message)) {
    dRes = await supabaseAdmin
      .from('messages')
      .select(D_COLS)
      .in('conversation_id', convIds)
      .order('created_at', { ascending: false })
      .limit(400)
  }
  const dMsgs = (dRes.data ?? []) as unknown as Array<{
    conversation_id: string | null; created_at: string; sender_id: string | null
    content: string | null; content_de: string | null; lang: string | null
    no_reply_needed?: boolean; phone_resolved?: boolean
  }>
  const lastDirect: Record<string, { preview: string; senderId: string | null; noReply?: boolean; phone?: boolean }> = {}
  const dLang: Record<string, string> = {}
  for (const m of dMsgs) {
    if (m.conversation_id && m.lang && !dLang[m.conversation_id]) dLang[m.conversation_id] = m.lang
    if (m.conversation_id && !lastDirect[m.conversation_id]) {
      lastDirect[m.conversation_id] = {
        preview: (m.content_de || m.content || '').replace(/\s+/g, ' ').slice(0, 90),
        senderId: m.sender_id ?? null,
        noReply: !!m.no_reply_needed,
        phone: !!m.phone_resolved,
      }
    }
  }

  const directThreads = (conversations ?? []).map((c) => {
    const b = c.bookings as { check_in?: string; check_out?: string; channel?: string; listing_id?: string; status?: string; adults?: number | null; children?: number | null } | null
    const gp = guestProfile.get(c.guest_id)
    const last = lastDirect[c.id]
    return {
      kind: 'direct' as const,
      id: c.id,
      // guestId: Client-Seite braucht sie, um Antworten ANDERER Team-Mitglieder
      // korrekt auf UNSERER Bubble-Seite zu rendern (§115-Fix)
      guestId: c.guest_id as string | null,
      guestName: gp?.display_name || c.guest_name || 'Gast',
      guestAvatar: gp?.avatar_url ?? null,
      listingTitle: b?.listing_id ? listingTitle.get(b.listing_id) ?? null : null,
      platform: 'TRIMOSA',
      checkIn: b?.check_in ?? null,
      checkOut: b?.check_out ?? null,
      guestStatus: guestStatus(b?.check_in ?? null, b?.check_out ?? null, b?.status ?? null),
      lastMessageAt: c.last_message_at,
      lastPreview: last?.preview ?? null,
      lastSender: last ? (last.senderId === c.guest_id ? 'guest' as const : 'host' as const) : null,
      guestLang: dLang[c.id] ?? null,
      noReplyNeeded: last?.noReply ?? false,
      phoneResolved: last?.phone ?? false,
      adults: b?.adults ?? null,
      children: b?.children ?? null,
      unread: unread[c.id] ?? 0,
    }
  })

  const bookingThreads = bookingRows
    // Only meaningful threads: has messages OR guest is current/upcoming.
    // Cancelled bookings count like 'past' — visible only with chat history.
    .filter((b) => {
      if (lastLive[b.id] || lastArchive[Number(b.smoobu_reservation_id)]) return true
      const st = guestStatus(b.check_in, b.check_out, b.status)
      return st === 'current' || st === 'upcoming'
    })
    .map((b) => {
      const last = lastLive[b.id] ?? lastArchive[Number(b.smoobu_reservation_id)] ?? null
      return {
        kind: 'booking' as const,
        id: b.id,
        guestName: b.guest_name || 'Gast',
        guestAvatar: null,
        listingTitle: ((Array.isArray(b.listings) ? b.listings[0] : b.listings) as { title: string } | null)?.title ?? null,
        platform: b.channel && b.channel !== 'direct' ? b.channel : b.source === 'trimosa' ? 'TRIMOSA' : 'Smoobu',
        checkIn: b.check_in,
        checkOut: b.check_out,
        guestStatus: guestStatus(b.check_in, b.check_out, b.status),
        lastMessageAt: last?.at ?? null,
        lastPreview: last?.preview ?? null,
        lastSender: last?.sender ?? null,
        guestLang: bLang[b.id] ?? null,
        noReplyNeeded: last && 'noReply' in last ? !!last.noReply : false,
        phoneResolved: last && 'phone' in last ? !!last.phone : false,
        adults: b.adults ?? null,
        children: b.children ?? null,
        unread: bUnread[b.id] ?? 0,
      }
    })

  // Threads WITH messages sort by recency; the rest (no chat yet) follow,
  // nearest arrival first — that's the natural priority order for the team.
  const withMsg = [...directThreads, ...bookingThreads].filter((t) => t.lastMessageAt)
    .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
  const withoutMsg = [...directThreads, ...bookingThreads].filter((t) => !t.lastMessageAt)
    .sort((a, b) => (a.checkIn ?? '9999').localeCompare(b.checkIn ?? '9999'))
  const threads = [...withMsg, ...withoutMsg]

  // Vornamen aller Team-Konten — die Bubbles zeigen, WER geantwortet hat
  let teamNames: Record<string, string> = {}
  try {
    const { data: teamProfiles } = await supabaseAdmin
      .from('profiles').select('id, display_name')
      .or('is_admin.eq.true,is_host.eq.true,is_staff.eq.true')
    teamNames = Object.fromEntries((teamProfiles ?? []).map((p) => [
      p.id, ((p.display_name ?? '').trim().split(/\s+/)[0] || 'Team'),
    ]))
  } catch { /* fail-soft */ }

  return NextResponse.json({ userId: user.id, threads, teamNames })
}

/**
 * PATCH /api/chat/inbox — "Keine Antwort erforderlich" für einen Thread
 * togglen. Setzt das Flag auf der NEUESTEN Nachricht des Threads; eine
 * spätere Gast-Nachricht macht den Thread automatisch wieder unbeantwortet.
 * Body: { kind: 'booking' | 'direct', id: string, value: boolean }
 */
export async function PATCH(req: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host, is_staff').eq('id', user.id).maybeSingle()
  if (!me?.is_admin && !me?.is_host && !me?.is_staff) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  }
  const { kind, id, value, field } = await req.json()
  if (!id || (kind !== 'booking' && kind !== 'direct') || typeof value !== 'boolean') {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }
  // field: 'no_reply' (Default, ✓) oder 'phone' (📞 per Telefonat geklärt)
  const column = field === 'phone' ? 'phone_resolved' : 'no_reply_needed'
  const col = kind === 'booking' ? 'booking_id' : 'conversation_id'
  const { data: last } = await supabaseAdmin
    .from('messages')
    .select('id')
    .eq(col, id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!last) return NextResponse.json({ error: 'Keine Nachricht im Thread.' }, { status: 404 })
  const { error } = await supabaseAdmin.from('messages').update({ [column]: value }).eq('id', last.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
