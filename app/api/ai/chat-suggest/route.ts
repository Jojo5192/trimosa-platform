import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkRateLimit } from '@/lib/rate-limit'
import { askClaude } from '@/lib/ai'
import { getChatKnowledge } from '@/lib/chat-knowledge'
import { getPrompt } from '@/lib/prompts'

/**
 * POST /api/ai/chat-suggest { conversationId } — drafts a host reply to the
 * guest's latest message. Only the conversation's host (or an admin) may ask;
 * the history is loaded server-side, never trusted from the client. The
 * suggestion lands in the composer as an editable draft — never auto-sent.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  const allowed = await checkRateLimit(`ai-chat:${user.id}`, 30, 3600)
  if (!allowed) return NextResponse.json({ error: 'Zu viele KI-Anfragen — bitte kurz warten.' }, { status: 429 })

  const { conversationId, bookingId, instruction, currentDraft } = await request.json()
  if (typeof conversationId !== 'string' && typeof bookingId !== 'string') {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host, is_staff').eq('id', user.id).maybeSingle()
  const isTeam = !!profile?.is_admin || !!profile?.is_host || !!profile?.is_staff

  // Two thread sources share this endpoint: platform conversations and
  // Smoobu booking threads (unified inbox). Normalise to conv shape.
  let conv: { id: string; host_id: string; guest_id: string | null; listing_id: string | null }
  if (typeof bookingId === 'string') {
    if (!isTeam) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('id, guest_id, listing_id, listings(host_id)')
      .eq('id', bookingId)
      .maybeSingle()
    if (!booking) return NextResponse.json({ error: 'Buchung nicht gefunden.' }, { status: 404 })
    const l = (Array.isArray(booking.listings) ? booking.listings[0] : booking.listings) as { host_id: string } | null
    conv = { id: booking.id, host_id: l?.host_id ?? user.id, guest_id: booking.guest_id, listing_id: booking.listing_id }
  } else {
    const { data: found } = await supabaseAdmin
      .from('conversations')
      .select('id, host_id, guest_id, listing_id')
      .eq('id', conversationId)
      .maybeSingle()
    if (!found) return NextResponse.json({ error: 'Konversation nicht gefunden.' }, { status: 404 })
    if (found.host_id !== user.id && !isTeam) {
      return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
    }
    conv = found
  }

  const historyQuery = typeof bookingId === 'string'
    ? supabaseAdmin
        .from('messages')
        .select('sender_id, sender_type, content, created_at')
        .eq('booking_id', bookingId)
        .order('created_at', { ascending: false })
        .limit(12)
    : supabaseAdmin
        .from('messages')
        .select('sender_id, sender_type, content, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(12)

  const [{ data: messages }, { data: listing }, knowledgeDoc] = await Promise.all([
    historyQuery,
    conv.listing_id
      ? supabaseAdmin.from('listings').select('title, location, check_in_time, check_out_time').eq('id', conv.listing_id).maybeSingle()
      : Promise.resolve({ data: null }),
    getChatKnowledge(conv.listing_id ?? null).catch(() => ''),
  ])

  const history = (messages ?? [])
    .reverse()
    .map((m) => {
      const fromHost = m.sender_type
        ? m.sender_type !== 'guest'
        : m.sender_id === conv.host_id
      return `${fromHost ? 'GASTGEBER' : 'GAST'}: ${m.content.slice(0, 600)}`
    })
    .join('\n')
  if (!history) return NextResponse.json({ error: 'Noch keine Nachrichten.' }, { status: 400 })

  // "Learning" from past conversations: the host's own earlier replies are the
  // best source for tone AND facts (key-box codes policy, parking, Wi-Fi…).
  // Same-apartment replies first, then general ones from other conversations.
  const { data: past } = await supabaseAdmin
    .from('messages')
    .select('content, conversation_id, conversations!inner(listing_id)')
    .eq('sender_id', conv.host_id)
    .neq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(120)

  const seen = new Set<string>()
  const sameListing: string[] = []
  const general: string[] = []
  for (const m of past ?? []) {
    const text = (m.content ?? '').trim()
    if (text.length < 30) continue
    const norm = text.toLowerCase().replace(/\s+/g, ' ').slice(0, 80)
    if (seen.has(norm)) continue
    seen.add(norm)
    const rel = (Array.isArray(m.conversations) ? m.conversations[0] : m.conversations) as { listing_id: string | null } | null
    if (conv.listing_id && rel?.listing_id === conv.listing_id) {
      if (sameListing.length < 15) sameListing.push(text.slice(0, 400))
    } else if (general.length < 10) {
      general.push(text.slice(0, 400))
    }
  }
  const knowledge = [
    sameListing.length ? `— Zu DIESER Wohnung:\n${sameListing.map((t) => `• ${t}`).join('\n')}` : '',
    general.length ? `— Allgemein / andere Wohnungen:\n${general.map((t) => `• ${t}`).join('\n')}` : '',
  ].filter(Boolean).join('\n')

  const system = await getPrompt('chat_suggest')

  const facts = listing
    ? `Unterkunft: ${listing.title} (${listing.location ?? '—'}) · Check-in ab ${listing.check_in_time ?? '—'} · Check-out bis ${listing.check_out_time ?? '—'}`
    : 'Unterkunft: unbekannt'

  const prompt = `${facts}

${knowledgeDoc ? `WISSENSBASIS (destilliert aus den echten Gast-Konversationen der letzten Jahre —
verlässlichste Faktenquelle):
${knowledgeDoc}

` : ''}${knowledge ? `FRÜHERE ECHTE ANTWORTEN DES GASTGEBERS (beste Quelle für Ton UND Fakten —
Infos daraus darfst du übernehmen, wenn sie zur aktuellen Frage passen; Antworten zu
DIESER Wohnung haben Vorrang vor allgemeinen):
${knowledge}

` : ''}BISHERIGER VERLAUF (älteste zuerst):
${history}

${typeof currentDraft === 'string' && currentDraft.trim() && typeof instruction === 'string' && instruction.trim()
  ? `AKTUELLER ENTWURF DES GASTGEBERS:
${currentDraft.slice(0, 2000)}

ANWEISUNG DES GASTGEBERS: ${instruction.slice(0, 500)}

Überarbeite den Entwurf gemäß der Anweisung (Verlauf + Wissensbasis beachten).`
  : typeof instruction === 'string' && instruction.trim()
  ? `DER GASTGEBER SAGT DIR, WAS ER ANTWORTEN WILL (oft diktiert, stichwortartig):
${instruction.slice(0, 500)}

Formuliere daraus die fertige, freundliche Antwort an den Gast (Verlauf +
Wissensbasis beachten; die inhaltliche Aussage des Gastgebers ist verbindlich).`
  : 'Entwirf jetzt die nächste Antwort des GASTGEBERS auf die letzte Gast-Nachricht.'}`

  try {
    const suggestion = await askClaude(system, prompt, 500)
    return NextResponse.json({ suggestion })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'KI-Fehler.' }, { status: 502 })
  }
}
