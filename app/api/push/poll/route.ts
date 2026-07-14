import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getReservationMessages } from '@/lib/smoobu'
import { sendPushToTeam } from '@/lib/push'

/**
 * Cron (every 10 min): polls Smoobu messages for RELEVANT bookings (guests
 * currently in house, arriving within 14 days, or departed within the last
 * 3 days), stores new ones and pushes a notification for new GUEST messages.
 * This is what makes the team's phone buzz when an Airbnb/Booking guest
 * writes — without anyone having the app open.
 */
export const maxDuration = 300

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 401 })
  }

  const today = new Date()
  const soon = new Date(today.getTime() + 14 * 86400_000).toISOString().slice(0, 10)
  const recent = new Date(today.getTime() - 3 * 86400_000).toISOString().slice(0, 10)

  const { data: bookings } = await supabaseAdmin
    .from('bookings')
    .select('id, guest_name, smoobu_reservation_id, listings(title)')
    .not('smoobu_reservation_id', 'is', null)
    .neq('status', 'cancelled')
    .lte('check_in', soon)
    .gte('check_out', recent)
    .limit(60)

  let newMessages = 0
  let pushes = 0
  for (const b of bookings ?? []) {
    try {
      const msgs = await getReservationMessages(Number(b.smoobu_reservation_id))
      if (!msgs.length) continue
      const ids = msgs.map((m) => String(m.id))
      const { data: known } = await supabaseAdmin
        .from('messages').select('smoobu_message_id').in('smoobu_message_id', ids)
      const knownSet = new Set((known ?? []).map((m) => m.smoobu_message_id))
      for (const sm of msgs) {
        if (!sm.message?.trim() || knownSet.has(String(sm.id))) continue
        const isHost = ['2', 'owner', 'outgoing', 'host'].includes(String(sm.type ?? '').toLowerCase())
        if (isHost) {
          // Web-app sent message coming back from Smoobu: claim the local
          // row instead of importing a duplicate (see messages/[bookingId])
          const { data: twin } = await supabaseAdmin
            .from('messages')
            .select('id')
            .eq('booking_id', b.id)
            .eq('sender_type', 'host')
            .is('smoobu_message_id', null)
            .eq('content', sm.message.trim())
            .limit(1)
            .maybeSingle()
          if (twin) {
            await supabaseAdmin.from('messages').update({ smoobu_message_id: String(sm.id) }).eq('id', twin.id)
            continue
          }
        }
        const { error } = await supabaseAdmin.from('messages').insert({
          booking_id: b.id,
          smoobu_message_id: String(sm.id),
          sender_type: isHost ? 'host' : 'guest',
          content: sm.message.trim(),
          created_at: sm.date || undefined,
        })
        if (error) continue
        newMessages++
        if (!isHost) {
          const listing = (Array.isArray(b.listings) ? b.listings[0] : b.listings) as { title: string } | null
          await sendPushToTeam(
            `💬 ${b.guest_name ?? 'Gast'}${listing?.title ? ` · ${listing.title}` : ''}`,
            sm.message.trim(),
            '/team',
          )
          pushes++
        }
      }
    } catch (err) {
      console.error('[push-poll]', b.smoobu_reservation_id, err)
    }
  }

  return NextResponse.json({ checked: (bookings ?? []).length, newMessages, pushes })
}
