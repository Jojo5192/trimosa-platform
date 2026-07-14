import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendMessageToGuest, getReservationMessages } from '@/lib/smoobu'

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

  // If connected to Smoobu, pull fresh messages and sync them
  if (booking.smoobu_reservation_id) {
    try {
      const smoobuMessages = await getReservationMessages(Number(booking.smoobu_reservation_id))
      const ids = smoobuMessages.map((sm) => String(sm.id))
      const { data: already } = ids.length
        ? await supabaseAdmin.from('messages').select('smoobu_message_id').in('smoobu_message_id', ids)
        : { data: [] }
      const known = new Set((already ?? []).map((m) => m.smoobu_message_id))
      for (const sm of smoobuMessages) {
        if (!sm.message?.trim() || known.has(String(sm.id))) continue
        // insert (not upsert): the partial unique index on smoobu_message_id
        // doesn't match ON CONFLICT without its predicate
        const { error } = await supabaseAdmin.from('messages').insert({
          booking_id: bookingId,
          smoobu_message_id: String(sm.id),
          sender_type: ['1', 'owner', 'outgoing', 'host'].includes(String(sm.type ?? '').toLowerCase()) ? 'host' : 'guest',
          content: sm.message.trim(),
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

  return NextResponse.json({ messages: messages ?? [] })
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

  const { content } = await request.json()
  if (!content?.trim()) return NextResponse.json({ error: 'Nachricht leer' }, { status: 400 })

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

  const senderType = isHost ? 'host' : 'guest'

  // Save to our DB
  const { data: msg, error } = await supabaseAdmin
    .from('messages')
    .insert({
      booking_id: bookingId,
      sender_type: senderType,
      sender_id: user.id,
      content: content.trim(),
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: 'Speichern fehlgeschlagen' }, { status: 500 })

  // Push to Smoobu (only host messages — we send to guest via Smoobu)
  if (isHost && booking.smoobu_reservation_id) {
    try {
      await sendMessageToGuest(Number(booking.smoobu_reservation_id), content.trim())
    } catch (err) {
      console.error('[Messages] Smoobu push failed:', err)
    }
  }

  return NextResponse.json({ message: msg })
}
