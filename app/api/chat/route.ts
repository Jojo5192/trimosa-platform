import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getReservationMessages, sendMessageToHost, isSmoobuSystemMessage } from '@/lib/smoobu'
import { translateIncoming, LANG_FLAGS } from '@/lib/translate'
import { sendPushToTeam } from '@/lib/push'
import { makeTr } from '@/lib/static-translate'
import { getUiLang } from '@/lib/i18n-server'

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
      // Smoobu-Automatik-/Schloss-Protokolle nie in den Chat holen (§143)
      if (isSmoobuSystemMessage(sm.subject)) continue
      const msgId  = String(sm.id)
      const content = sm.message.trim()

      // ── Step 1: Skip if already synced by smoobu_message_id ──────────────────
      const { data: existing } = await supabaseAdmin
        .from('messages')
        .select('id')
        .eq('smoobu_message_id', msgId)
        .maybeSingle()
      if (existing) continue

      // ── Step 2: Content-based linking ────────────────────────────────────────
      // If Trimosa sent this message but the smoobu_message_id wasn't saved back
      // (Smoobu may not return an ID, or there was a race with the webhook), the
      // original DB record has correct sender_id but null smoobu_message_id.
      // Instead of inserting a duplicate with wrong sender, just link the ID.
      const { data: unlinked } = await supabaseAdmin
        .from('messages')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('content', content)
        .is('smoobu_message_id', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (unlinked) {
        await supabaseAdmin
          .from('messages')
          .update({ smoobu_message_id: msgId })
          .eq('id', unlinked.id)
        console.log('[Chat] Linked smoobu_message_id', msgId, '→ existing msg', unlinked.id)
        continue
      }

      // ── Step 3: New Smoobu-originated message — detect sender and insert ─────
      // Smoobu may use various type/sender conventions. Check every known pattern.
      //
      // typeStr: "host","host_message","host_to_guest","outgoing","sent","owner","1" → HOST
      //          "guest","guest_message","incoming","guest_to_host","2"              → GUEST
      //
      // subject fallback (most reliable for Trimosa-forwarded messages):
      //   subject contains "nachricht von gast" / "via trimosa" → GUEST
      //   subject contains "nachricht von trimosa"              → HOST
      //
      // Unknown type → HOST (automated booking messages typically come from host)
      const typeStr    = (sm.type   ?? '').toLowerCase()
      const senderStr  = (sm.sender ?? '').toLowerCase()
      const subjectStr = (sm.subject ?? '').toLowerCase()

      const subjectIsGuest = subjectStr.includes('nachricht von gast') || subjectStr.includes('via trimosa')
      const subjectIsHost  = subjectStr.includes('nachricht von trimosa')

      // §49: Smoobus numerischer Typ ist verlässlich — '2' = an den Gast (von
      // uns/Host), '1' = vom Gast. Der EXPLIZITE Typ gewinnt jetzt über den
      // Betreff. Vorher entschied der Betreff zuerst → ein Gast-REPLY
      // „Re: Nachricht von Trimosa" wurde fälschlich als Host eingestuft (§146).
      const typeIsGuest = typeStr === '1' || typeStr.includes('guest') || typeStr === 'incoming' || typeStr === 'guest_to_host'
      const typeIsHost  = typeStr === '2' || typeStr.includes('host') || typeStr === 'outgoing' || typeStr === 'sent'
                        || typeStr === 'host_to_guest' || typeStr === 'automated' || typeStr === 'owner'
                        || senderStr.includes('host') || senderStr.includes('gastgeber')
      const isHost = typeIsHost ? true
                   : typeIsGuest ? false
                   : subjectIsHost ? true
                   : subjectIsGuest ? false
                   : true   // unbekannt → Host (Buchungsbestätigungen/System)

      console.log('[Chat] syncMsg id:', sm.id,
        '| type:', JSON.stringify(sm.type), '| sender:', JSON.stringify(sm.sender),
        '| subject:', sm.subject?.slice(0, 50),
        '| → isHost:', isHost)

      // Gast-Nachrichten, die der Gast NATIV auf der Website schrieb, tragen ihre
      // smoobu_message_id (Step 1 überspringt sie) oder werden per Content
      // gelinkt (Step 2) → hier landen nur NEUE Nachrichten. Host-Mails +
      // echte Gast-E-Mail-Antworten (Smoobu-Relay) werden korrekt importiert.
      const senderId = isHost ? hostId : (guestId ?? hostId)  // fallback to hostId if guestId is null

      const { error } = await supabaseAdmin
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: senderId,
          content,
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

// Module-level sync cache: avoid hitting Smoobu API on every 5s poll
// Key = conversationId, Value = last sync timestamp (ms)
const syncCache = new Map<string, number>()
const SYNC_COOLDOWN_MS = 30_000

// GET /api/chat?conversationId=... — get messages for a conversation
// GET /api/chat — get all conversations for current user
export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const conversationId = req.nextUrl.searchParams.get('conversationId')
  // §156 Performance: ?fast=1 = nur DB-Stand (kein Sync-Trigger, keine
  // Übersetzung) — Client rendert instant und holt den vollen Stand nach
  const fast = req.nextUrl.searchParams.get('fast') === '1'

  if (conversationId) {
    // Load conversation metadata to know booking / Smoobu link
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('host_id, guest_id, booking_id, bookings(smoobu_reservation_id)')
      .eq('id', conversationId)
      .maybeSingle()

    // Pull in new Smoobu messages — throttled to once per 30s per conversation
    const smoobuId = (conv?.bookings as unknown as { smoobu_reservation_id: number | null } | null)?.smoobu_reservation_id
    if (!fast && conv && smoobuId) {
      const lastSync = syncCache.get(conversationId) ?? 0
      if (Date.now() - lastSync >= SYNC_COOLDOWN_MS) {
        syncCache.set(conversationId, Date.now())
        const { data: hostProfile } = await supabaseAdmin
          .from('profiles')
          .select('smoobu_api_key')
          .eq('id', conv.host_id)
          .maybeSingle()
        const hostApiKey = (hostProfile as Record<string, unknown> | null)?.smoobu_api_key as string | undefined
        // Run sync without blocking the response
        syncSmoobuMessages(conversationId, smoobuId, conv.host_id, conv.guest_id, hostApiKey)
          .catch(e => console.error('[Chat] background sync error:', e))
      }
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

    // Translate untranslated guest-side messages to German once (cached)
    let out = messages ?? []
    const guestSide = fast ? [] : out.filter((m) =>
      conv && m.sender_id !== conv.host_id && !m.lang && (m.content ?? '').trim().length > 0)
    if (guestSide.length > 0) {
      const map = await translateIncoming(guestSide.slice(0, 25).map((m) => ({ id: m.id, text: m.content })))
      out = out.map((m) => {
        const t = map.get(m.id)
        return t ? { ...m, lang: t.lang, content_de: t.german } : m
      })
    }

    // Guest view in a non-German UI language: show host/system messages
    // translated (AI, cached per text) — the guest's own messages stay as sent.
    if (conv && user.id === conv.guest_id) {
      try {
        const uiLang = await getUiLang()
        if (uiLang !== 'de') {
          const foreign = out.filter((m) => m.sender_id !== user.id && (m.content ?? '').trim().length > 1)
          const T = await makeTr(uiLang, foreign.map((m) => m.content))
          out = out.map((m) => (m.sender_id !== user.id && m.content ? { ...m, content: T(m.content) } : m))
        }
      } catch (err) {
        console.error('[Chat] guest translate failed:', err)
      }
    }

    return NextResponse.json(out)
  }

  // All conversations for this user (as host or guest)
  const { data: conversations } = await supabaseAdmin
    .from('conversations')
    .select('*, bookings(check_in, check_out)')
    .or(`host_id.eq.${user.id},guest_id.eq.${user.id}`)
    .order('last_message_at', { ascending: false })

  // Get unread counts + avatar_urls for all involved users (parallel)
  const ids = (conversations ?? []).map(c => c.id)
  const allUserIds = [...new Set((conversations ?? []).flatMap(c => [c.guest_id, c.host_id].filter(Boolean)))]

  const [unreadResult, avatarResult] = await Promise.all([
    ids.length > 0
      ? supabaseAdmin
          .from('messages')
          .select('conversation_id')
          .in('conversation_id', ids)
          .neq('sender_id', user.id)
          .is('read_at', null)
      : Promise.resolve({ data: [] }),
    allUserIds.length > 0
      ? supabaseAdmin
          .from('profiles')
          .select('id, avatar_url')
          .in('id', allUserIds)
      : Promise.resolve({ data: [] }),
  ])

  const unreadMap: Record<string, number> = {}
  for (const row of (unreadResult as { data: { conversation_id: string }[] | null }).data ?? []) {
    unreadMap[row.conversation_id] = (unreadMap[row.conversation_id] ?? 0) + 1
  }

  const avatarMap: Record<string, string | null> = {}
  for (const p of (avatarResult as { data: { id: string; avatar_url: string | null }[] | null }).data ?? []) {
    avatarMap[p.id] = p.avatar_url ?? null
  }

  const result = (conversations ?? []).map(c => {
    const booking = (c as Record<string, unknown>).bookings as { check_in?: string; check_out?: string } | null
    return {
      ...c,
      bookings: undefined, // strip nested object, move fields to top level
      check_in: booking?.check_in ?? null,
      check_out: booking?.check_out ?? null,
      guest_avatar_url: avatarMap[c.guest_id] ?? null,
      host_avatar_url: avatarMap[c.host_id] ?? null,
      unread: unreadMap[c.id] ?? 0,
    }
  })
  return NextResponse.json(result)
}

// POST /api/chat — send a message (or create conversation if needed)
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const body = await req.json()
  const { conversationId, content, contentDe, lang, listingId, hostId, guestName, listingTitle } = body

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
    .insert({
      conversation_id: convId, sender_id: user.id, content: content.trim(),
      content_de: typeof contentDe === 'string' && contentDe.trim() ? contentDe.trim() : null,
      lang: typeof lang === 'string' && /^[a-z]{2}$/.test(lang) ? lang : null,
    })
    .select('*')
    .single()

  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 })

  // Update last_message_at on conversation
  await supabaseAdmin
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', convId)

  // Guest wrote via the website → buzz the team. Translate first so the
  // notification + inbox preview show German (cached on the row); fail-soft
  // to the original text. AWAITED — fire-and-forget stirbt in Serverless (§135).
  // Nur bei Nachrichten des GASTS (guest_id) — Team-Antworten anderer
  // Mitglieder (Vanessa/Pascal, nicht host_id) sind kein Gast-Ereignis.
  {
    const { data: convMeta } = await supabaseAdmin
      .from('conversations').select('host_id, guest_id, guest_name, listing_title').eq('id', convId).maybeSingle()
    if (convMeta && convMeta.guest_id === user.id) {
      await (async () => {
        const tr = await translateIncoming([{ id: message.id, text: content.trim() }])
        const t = tr.get(message.id)
        const flag = t?.lang && t.lang !== 'de' ? `${LANG_FLAGS[t.lang] ?? '🌐'} ` : ''
        await sendPushToTeam(
          `💬 ${flag}${convMeta.guest_name ?? 'Gast'}${convMeta.listing_title ? ` · ${convMeta.listing_title}` : ''}`,
          t?.german ?? content.trim(),
          '/team',
          { guestChat: true },
        )
      })().catch((e) => console.error('[push] chat trigger:', e))
    }
  }

  // Forward to Smoobu if host is sending and booking has smoobu_reservation_id
  type ConvForSend = { host_id: string | null; guest_id: string | null; guest_name: string | null; listing_title: string | null }
  let smoobuDelivered = false
  let teamSender = false
  let convForSend: ConvForSend | null = null
  try {
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('host_id, guest_id, guest_name, listing_title, bookings(smoobu_reservation_id)')
      .eq('id', convId)
      .maybeSingle()
    // NICHT `typeof convForSend`: TS nähme dort den GENARROWTEN Typ (null)
    // und machte die Variable dauerhaft null → never nach dem Guard (§140)
    convForSend = conv as unknown as ConvForSend | null

    const smoobuId = (conv?.bookings as unknown as { smoobu_reservation_id: number | null } | null)?.smoobu_reservation_id
    // TEAM-Absender (nicht nur der Listing-Host): die Unified Inbox lässt
    // jedes Team-Mitglied antworten — deren Nachrichten gehen als HOST-Seite
    // zu Smoobu (vorher wurden sie fälschlich als Gast-Nachricht gepusht).
    let isHost = conv?.host_id === user.id
    if (!isHost && conv && user.id !== conv.guest_id) {
      const { data: meProf } = await supabaseAdmin
        .from('profiles').select('is_admin, is_host, is_staff').eq('id', user.id).maybeSingle()
      isHost = !!meProf?.is_admin || !!meProf?.is_host || !!meProf?.is_staff
    }
    teamSender = isHost

    if (smoobuId) {
      // Load host's API key (needed for both directions)
      const { data: hp } = await supabaseAdmin
        .from('profiles')
        .select('smoobu_api_key')
        .eq('id', conv?.host_id ?? '')
        .maybeSingle()
      const hKey = (hp as Record<string, unknown> | null)?.smoobu_api_key as string | undefined

      let smoobuMsgId: number | null = null
      if (isHost) {
        // §151: Host-/Team-Antworten an WEBSITE-Gäste gehen NICHT mehr über
        // Smoobu — Smoobu würde sie dem Gast selbst per Mail zustellen
        // (fremdes Layout, keine Antwort-Brücke, Doppel-Risiko). Stattdessen
        // greift unten IMMER unsere gebrandete E-Mail (smoobuDelivered bleibt
        // false) — identisch zur Auto-Nachrichten-Engine (§148).
        console.log('[Chat] Host→Website-Gast: eigener Chat + eigene Mail (kein Smoobu-Umweg)')
      } else {
        const { data: guestProfile } = await supabaseAdmin
          .from('profiles')
          .select('display_name, guest_first_name, guest_last_name')
          .eq('id', user.id)
          .maybeSingle()
        const gp = guestProfile as Record<string, unknown> | null
        const resolvedGuestName = (gp?.guest_first_name && gp?.guest_last_name)
          ? `${gp.guest_first_name} ${gp.guest_last_name}`
          : (gp?.display_name as string) || 'Gast'
        console.log('[Chat] Guest→Smoobu: forwarding from', resolvedGuestName, 'to reservation', smoobuId)
        smoobuMsgId = await sendMessageToHost(smoobuId, content.trim(), resolvedGuestName, hKey)
      }
      // Save smoobu_message_id so the sync skips this message (prevents duplicate + wrong sender_id)
      if (smoobuMsgId && message?.id) {
        if (isHost) smoobuDelivered = true
        await supabaseAdmin
          .from('messages')
          .update({ smoobu_message_id: String(smoobuMsgId) })
          .eq('id', message.id)
        console.log('[Chat] Saved smoobu_message_id', smoobuMsgId, 'on message', message.id)
      }
    }
  } catch (err) {
    console.error('[Chat] Smoobu forward failed', err)
  }

  // 📧-Fallback (§140): Host-Antwort in einem Direkt-Chat OHNE Smoobu-Weg
  // (Konversation ohne Buchung/Reservierungs-ID oder Push fehlgeschlagen) →
  // E-Mail an die Login-Mail des Gast-Kontos. Der Gast bekommt sonst nichts
  // mit, bis er zufällig die Website öffnet. Antworten auf die Mail fließen
  // über die Inbound-Pipeline zurück in diese Konversation.
  if (convForSend && teamSender && !smoobuDelivered && convForSend.guest_id && convForSend.guest_id !== user.id) {
    try {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(convForSend.guest_id)
      const to = u?.user?.email ?? null
      if (to) {
        const { sendGuestChatEmail } = await import('@/lib/email')
        await sendGuestChatEmail({
          to,
          guestName: convForSend.guest_name,
          listingTitle: convForSend.listing_title,
          text: content.trim(),
          lang: typeof lang === 'string' ? lang : null,
        })
        console.log('[Chat] Antwort per E-Mail an Website-Gast:', to)
      }
    } catch (err) {
      console.error('[Chat] Gast-Mail-Fallback failed:', err)
    }
  }

  return NextResponse.json({ message, conversationId: convId })
}
