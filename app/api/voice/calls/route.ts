import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

/**
 * ☎️ §227c: Anruf-Archiv (Inhaber-Auftrag 31.7.) — Liste aller Telefonate
 * der KI-Assistentin fürs TEAM (nie Dienstleister, nie Gäste): Zeit,
 * Anrufer, Zusammenfassung, Transkript + Buchungs-Zuordnung. Audio läuft
 * über /api/voice/calls/[id]/audio (ElevenLabs-Proxy).
 * ?bookingId=… = nur die Anrufe EINER Buchung (Gast-Thread-Ansicht).
 */
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host, is_staff').eq('id', user.id).maybeSingle()
  if (!me?.is_admin && !me?.is_host && !me?.is_staff) {
    return NextResponse.json({ error: 'Nicht berechtigt' }, { status: 403 })
  }

  const url = new URL(request.url)
  const bookingId = url.searchParams.get('bookingId')

  let q = supabaseAdmin
    .from('voice_calls')
    .select('id, conversation_id, booking_id, caller_number, summary, transcript, guest_inquiry, created_at')
    .order('created_at', { ascending: false })
    .limit(100)
  if (bookingId) q = q.eq('booking_id', bookingId)
  const { data: calls, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Buchungs-Zuordnung (Gast + Wohnung) in einem Batch nachladen
  const bIds = [...new Set((calls ?? []).map((c) => c.booking_id).filter(Boolean))] as string[]
  const bMap = new Map<string, { guest: string | null; checkIn: string; checkOut: string; listingId: string | null }>()
  if (bIds.length) {
    const { data: bookings } = await supabaseAdmin
      .from('bookings').select('id, guest_name, check_in, check_out, listing_id').in('id', bIds)
    for (const b of bookings ?? []) {
      bMap.set(b.id as string, {
        guest: (b.guest_name as string | null),
        checkIn: b.check_in as string, checkOut: b.check_out as string,
        listingId: (b.listing_id as string | null),
      })
    }
  }
  const lIds = [...new Set([...bMap.values()].map((b) => b.listingId).filter(Boolean))] as string[]
  const lMap = new Map<string, string>()
  if (lIds.length) {
    const { data: listings } = await supabaseAdmin.from('listings').select('id, title').in('id', lIds)
    for (const l of listings ?? []) lMap.set(l.id as string, l.title as string)
  }

  return NextResponse.json({
    calls: (calls ?? []).map((c) => {
      const b = c.booking_id ? bMap.get(c.booking_id as string) : null
      return {
        id: c.id,
        createdAt: c.created_at,
        caller: c.caller_number,
        summary: c.summary,
        transcript: c.transcript,
        guestInquiry: c.guest_inquiry === true,
        bookingId: c.booking_id,
        guest: b?.guest ?? null,
        apartment: b?.listingId ? lMap.get(b.listingId) ?? null : null,
        zeitraum: b ? `${b.checkIn}–${b.checkOut}` : null,
        hasAudio: !!c.conversation_id,
      }
    }),
  })
}
