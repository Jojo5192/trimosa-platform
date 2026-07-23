import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { askClaude, FAST_MODEL } from '@/lib/ai'
import { sanitizeRecipient } from '@/lib/lexoffice'

/**
 * ✨ §159-Nachtrag: Rechnungsempfänger AUS DEM CHAT extrahieren — die KI
 * liest die letzten Gast-Nachrichten und zieht explizit genannte
 * Rechnungsdaten (Name/Firma/Anschrift) heraus. Befüllt den Empfänger-
 * Dialog vor; das Team bestätigt mit einem Klick (bewusst KEIN
 * Voll-Automatismus — Rechnungen sind Finanzdokumente).
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(_req: NextRequest, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host, is_staff').eq('id', user.id).maybeSingle()
  if (!me?.is_admin && !me?.is_host && !me?.is_staff) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  }

  const { data: b } = await supabaseAdmin
    .from('bookings').select('id, guest_id, conversations(id, guest_id)').eq('id', bookingId).maybeSingle()
  if (!b) return NextResponse.json({ error: 'Buchung nicht gefunden.' }, { status: 404 })

  // Letzte Gast-Nachrichten aus beiden Welten (Original + deutsche Fassung)
  const texts: string[] = []
  const { data: bm } = await supabaseAdmin
    .from('messages').select('content, content_de').eq('booking_id', bookingId).eq('sender_type', 'guest')
    .order('created_at', { ascending: false }).limit(15)
  for (const m of bm ?? []) texts.push(String(m.content_de || m.content || ''))
  const conv = (Array.isArray(b.conversations) ? b.conversations[0] : b.conversations) as { id: string; guest_id: string | null } | null
  if (conv?.id) {
    const { data: dm } = await supabaseAdmin
      .from('messages').select('content, content_de, sender_id').eq('conversation_id', conv.id)
      .order('created_at', { ascending: false }).limit(15)
    for (const m of dm ?? []) {
      if (m.sender_id === (conv.guest_id ?? b.guest_id)) texts.push(String(m.content_de || m.content || ''))
    }
  }
  const material = texts.filter((t) => t.trim().length > 5).slice(0, 20)
  if (!material.length) return NextResponse.json({ recipient: null })

  const system = `Du extrahierst RECHNUNGSEMPFÄNGER-Daten aus Gäste-Nachrichten einer Ferienwohnung.
Suche NUR nach explizit als Rechnungsdaten gemeinten Angaben (Firma/Name, Adresse für die Rechnung).
Normale Absender-Namen oder Anschriften ohne Rechnungsbezug zählen NICHT.
Antworte AUSSCHLIESSLICH mit JSON:
{"found": true, "name": "...", "supplement": "...", "street": "...", "zip": "...", "city": "...", "country": "..."}
(nicht genannte Felder weglassen) — oder {"found": false}, wenn keine Rechnungsdaten vorkommen.`

  try {
    const raw = await askClaude(system, material.join('\n---\n').slice(0, 6000), 1000, FAST_MODEL)
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    const parsed = start >= 0 && end > start ? JSON.parse(raw.slice(start, end + 1)) : null
    if (!parsed?.found) return NextResponse.json({ recipient: null })
    const rec = sanitizeRecipient(parsed)
    return NextResponse.json({ recipient: rec })
  } catch (e) {
    console.error('[invoices/extract]', e)
    return NextResponse.json({ recipient: null })
  }
}
