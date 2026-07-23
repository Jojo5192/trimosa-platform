import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkRateLimit } from '@/lib/rate-limit'
import { askClaude } from '@/lib/ai'
import { getPrompt } from '@/lib/prompts'

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
  empfehlung:
    'Poliere den persönlichen Tipp des Gastgebers für ein Ausflugsziel/Restaurant: 1–2 Sätze, ' +
    'direkt und authentisch (wie ein Freund, der einen Geheimtipp gibt), Du-Form erlaubt. ' +
    'Die persönliche Erfahrung MUSS aus dem Ausgangstext stammen — bei leerem Text darfst du ' +
    'KEINEN Entwurf erfinden, antworte dann exakt mit: "Bitte schreibe zuerst deinen eigenen Tipp — ich poliere ihn dann."',
  auto_nachricht:
    'Überarbeite die automatische Gäste-Nachricht einer Ferienwohnungs-Vermietung: warm, klar, ' +
    'in Du-Form, kurze Absätze, ähnliche Länge wie der Ausgangstext. ' +
    'EISERN: Platzhalter in geschweiften Klammern ({vorname}, {wohnung}, {anreise}, {checkin}, ' +
    '{tuercode}, {mappe_button} …) EXAKT unverändert an sinnvoller Stelle übernehmen — ' +
    'niemals übersetzen, umbenennen, erfinden oder weglassen. ' +
    'Bei leerem Ausgangstext: kurzen Entwurf aus den Kontext-Fakten (Zweck/Auslöser der Nachricht) ' +
    'erstellen und die im Kontext genannten Platzhalter sinnvoll einsetzen.',
  mappe_baustein:
    'Überarbeite den Text eines Gästemappen-Bausteins (digitale Mappe, die der Gast auf dem ' +
    'Handy liest): freundlich, klar, in Du-Form, kurz und praktisch — das Wichtigste zuerst. ' +
    'Ist der Ausgangstext eine Schritt-Liste (eine Zeile = ein Schritt), behalte GENAU dieses ' +
    'Zeilen-Format bei (keine Nummerierung ergänzen). Keine Fakten erfinden — nur umformulieren. ' +
    'Bei leerem Text: KEINEN Entwurf erfinden, antworte dann exakt mit: ' +
    '"Bitte schreibe zuerst ein paar Stichpunkte — ich formuliere sie dann aus."',
}


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

  const { field, text, context, instruction } = await request.json()
  if (!(field in FIELD_BRIEFS)) {
    return NextResponse.json({ error: 'Unbekanntes Feld.' }, { status: 400 })
  }
  const input = typeof text === 'string' ? text.trim() : ''
  if (input.length > 6000) {
    return NextResponse.json({ error: 'Text zu lang.' }, { status: 400 })
  }
  // §158: optionale Anweisung des Gastgebers („kürzer", „förmlicher", „erwähne
  // den Parkplatz") — hat Vorrang vor den Stil-Vorgaben des Feld-Briefings
  const instr = typeof instruction === 'string' ? instruction.trim().slice(0, 500) : ''

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
${instr ? `
ANWEISUNG DES GASTGEBERS (hat Vorrang vor den Stil-Vorgaben oben — aber die
EISERNEN Regeln wie „keine Fakten erfinden" und „Platzhalter unverändert"
gelten weiterhin):
${instr}
` : ''}
KONTEXT-FAKTEN ZUR UNTERKUNFT (einzige erlaubte Faktenquelle):
${ctx || '—'}

AUSGANGSTEXT:
${input || '(leer — bitte einen Entwurf allein aus den Kontext-Fakten erstellen)'}`

  try {
    const suggestion = await askClaude(await getPrompt('polish_system'), prompt)
    return NextResponse.json({ suggestion })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'KI-Fehler.' }, { status: 502 })
  }
}
