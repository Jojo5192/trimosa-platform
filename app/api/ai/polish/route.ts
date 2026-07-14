import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkRateLimit } from '@/lib/rate-limit'
import { askClaude } from '@/lib/ai'

/**
 * POST /api/ai/polish — writing help for hosts inside the listing editor.
 * Improves (or drafts, when empty) a listing text field. Strict rule in the
 * prompt: never invent amenities/facts — only rephrase what the host provided.
 */

const FIELD_BRIEFS: Record<string, string> = {
  title:
    'Formuliere einen prägnanten Inserats-Titel (max. 45 Zeichen, kein Punkt am Ende). ' +
    'Konkret statt werblich, keine Superlative wie "Traumhaft".',
  description:
    'Überarbeite die Inserats-Beschreibung: warm, klar, in Du-Form, kurze Absätze. ' +
    'Ähnliche Länge wie der Ausgangstext (bei leerem Ausgangstext: 3 kurze Absätze aus den Kontext-Fakten). ' +
    'Beginne mit dem stärksten Merkmal, keine Floskeln ("Herzlich willkommen"), keine Emojis.',
  house_rules:
    'Formuliere die Hausregeln freundlich, klar und respektvoll — kurze Sätze oder knappe Liste, Du-Form, ohne Drohton.',
  checkin_instructions:
    'Formuliere die Check-in-Hinweise als klare Schritt-für-Schritt-Anleitung in Du-Form, kurz und eindeutig.',
  important_notes:
    'Formuliere die wichtigen Hinweise klar und freundlich, das Wichtigste zuerst.',
}

const SYSTEM = `Du bist der Text-Assistent von TRIMOSA Apartments & Homes — Premium-Ferienwohnungen
in Trier, Bitburg, der Südeifel und an der Saar. Markenton: warm, klar, hochwertig,
bodenständig — nie marktschreierisch.

EISERNE REGEL: Erfinde NIEMALS Fakten. Keine Ausstattung, Entfernungen, Zahlen oder
Eigenschaften, die nicht im Ausgangstext oder den Kontext-Fakten stehen. Du darfst
nur umformulieren, strukturieren und kürzen.

Antworte AUSSCHLIESSLICH mit dem fertigen Text — keine Anführungszeichen drumherum,
keine Erklärungen, keine Varianten.`

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles').select('is_host, is_admin').eq('id', user.id).maybeSingle()
  if (!profile?.is_host && !profile?.is_admin) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  }

  const allowed = await checkRateLimit(`ai-polish:${user.id}`, 30, 3600)
  if (!allowed) {
    return NextResponse.json({ error: 'Zu viele KI-Anfragen — bitte kurz warten.' }, { status: 429 })
  }

  const { field, text, context } = await request.json()
  if (!(field in FIELD_BRIEFS)) {
    return NextResponse.json({ error: 'Unbekanntes Feld.' }, { status: 400 })
  }
  const input = typeof text === 'string' ? text.trim() : ''
  if (input.length > 6000) {
    return NextResponse.json({ error: 'Text zu lang.' }, { status: 400 })
  }

  // Context facts (title, location, capacity, amenities) ground the model so
  // drafts for empty fields stay factual.
  const ctx = context && typeof context === 'object'
    ? Object.entries(context)
        .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
        .slice(0, 12)
        .map(([k, v]) => `${k}: ${String(v).slice(0, 400)}`)
        .join('\n')
    : ''

  const prompt = `${FIELD_BRIEFS[field]}

KONTEXT-FAKTEN ZUR UNTERKUNFT (einzige erlaubte Faktenquelle):
${ctx || '—'}

AUSGANGSTEXT:
${input || '(leer — bitte einen Entwurf allein aus den Kontext-Fakten erstellen)'}`

  try {
    const suggestion = await askClaude(SYSTEM, prompt)
    return NextResponse.json({ suggestion })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'KI-Fehler.' }, { status: 502 })
  }
}
