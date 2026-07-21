import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * 💬 Chat in der Gästemappe (§136): token-basiert (portal_token der Buchung
 * = Auth, wie die Mappe selbst) — damit können auch Portal-Gäste (Airbnb/
 * Booking/FeWo) direkt mit uns schreiben, am Portal vorbei.
 *
 * Einsortierung wie bei der Mail-Pipeline (§134): Hat die Buchung eine
 * conversation (Website-Gast mit Konto) → Direkt-Chat-Welt; sonst
 * booking-Welt (Team-Inbox-Thread). Der Gast sieht in beiden Fällen den
 * kompletten Verlauf — Host-Antworten werden ohnehin in der Gastsprache
 * GESENDET (content = übersetzte Fassung), also direkt anzeigbar.
 *
 * Chat offen bis 30 Tage nach Abreise (späte Fragen: Rechnung, Fundsachen).
 */
export const dynamic = 'force-dynamic'

type Ctx = { booking: { id: string; guest_id: string | null; guest_name: string | null; check_out: string; conversations: unknown } }

async function resolveToken(token: string): Promise<Ctx['booking'] | null> {
  if (!token || token.length < 20) return null
  const { data: b } = await supabaseAdmin
    .from('bookings')
    .select('id, guest_id, guest_name, check_out, status, conversations(id, guest_id)')
    .eq('portal_token', token)
    .maybeSingle()
  if (!b || b.status === 'cancelled') return null
  const closed = new Date(b.check_out + 'T00:00:00Z').getTime() + 30 * 86400_000 < Date.now()
  if (closed) return null
  return b
}

function convOf(b: Ctx['booking']): { id: string; guest_id: string | null } | null {
  const raw = b.conversations
  return (Array.isArray(raw) ? raw[0] : raw) as { id: string; guest_id: string | null } | null
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? ''
  if (!(await checkRateLimit(`mappe-chat:${token.slice(0, 12)}`, 240, 3600))) {
    return NextResponse.json({ error: 'Zu viele Anfragen.' }, { status: 429 })
  }
  const b = await resolveToken(token)
  if (!b) return NextResponse.json({ error: 'Nicht gefunden.' }, { status: 404 })

  const conv = convOf(b)
  let rows: { id: string; content: string | null; created_at: string; mine: boolean }[] = []
  if (conv?.id) {
    const { data } = await supabaseAdmin
      .from('messages')
      .select('id, content, created_at, sender_id')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true })
      .limit(60)
    rows = (data ?? []).map((m) => ({
      id: m.id, content: m.content, created_at: m.created_at,
      mine: m.sender_id != null && m.sender_id === (conv.guest_id ?? b.guest_id),
    }))
  } else {
    const { data } = await supabaseAdmin
      .from('messages')
      .select('id, content, created_at, sender_type')
      .eq('booking_id', b.id)
      .order('created_at', { ascending: true })
      .limit(60)
    rows = (data ?? []).map((m) => ({
      id: m.id, content: m.content, created_at: m.created_at,
      mine: m.sender_type === 'guest',
    }))
  }
  return NextResponse.json(
    { messages: rows.filter((m) => (m.content ?? '').trim()) },
    { headers: { 'Cache-Control': 'no-store, must-revalidate' } },
  )
}

export async function POST(req: NextRequest) {
  const { token, text } = await req.json().catch(() => ({}))
  const clean = String(text ?? '').trim()
  if (!clean || clean.length > 2000) return NextResponse.json({ error: 'Ungültige Nachricht.' }, { status: 400 })
  if (!(await checkRateLimit(`mappe-chat-post:${String(token ?? '').slice(0, 12)}`, 30, 3600))) {
    return NextResponse.json({ error: 'Zu viele Nachrichten — bitte kurz warten.' }, { status: 429 })
  }
  const b = await resolveToken(String(token ?? ''))
  if (!b) return NextResponse.json({ error: 'Nicht gefunden.' }, { status: 404 })

  const conv = convOf(b)
  let insertedId: string | null = null
  let pushUrl = ''
  if (conv?.id && (conv.guest_id ?? b.guest_id)) {
    const { data, error } = await supabaseAdmin.from('messages')
      .insert({ conversation_id: conv.id, sender_id: conv.guest_id ?? b.guest_id, content: clean })
      .select('id').single()
    if (error) return NextResponse.json({ error: 'Senden fehlgeschlagen.' }, { status: 500 })
    insertedId = data?.id ?? null
    pushUrl = '/team?conv=' + conv.id
    await supabaseAdmin.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conv.id)
  } else {
    const { data, error } = await supabaseAdmin.from('messages')
      .insert({ booking_id: b.id, sender_type: 'guest', content: clean })
      .select('id').single()
    if (error) return NextResponse.json({ error: 'Senden fehlgeschlagen.' }, { status: 500 })
    insertedId = data?.id ?? null
    pushUrl = '/team?conv=' + b.id
  }

  // Übersetzung für die Team-Anzeige + Push — beides AWAITED (§135)
  try {
    const { translateIncoming } = await import('@/lib/translate')
    if (insertedId) await translateIncoming([{ id: insertedId, text: clean }])
  } catch { /* best effort */ }
  try {
    const { sendPushToTeam } = await import('@/lib/push')
    await sendPushToTeam(
      `💬 ${b.guest_name ?? 'Gast'} · Gästemappe`,
      clean.replace(/\s+/g, ' ').slice(0, 120),
      pushUrl,
      { guestChat: true },
    )
  } catch { /* best effort */ }

  return NextResponse.json({ ok: true })
}
