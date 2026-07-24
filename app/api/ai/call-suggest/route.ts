import { NextResponse } from 'next/server'
import { getTaskAuth } from '@/lib/tasks'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getChatKnowledge } from '@/lib/chat-knowledge'
import { askClaude } from '@/lib/ai'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * ☎️✨ Lösungsvorschlag für eine telefonische Meldung (§175 Phase 2):
 * POST { taskId, instruction? } — Claude analysiert das aufgenommene
 * Anliegen gegen die Wissensbasis (chat_knowledge, dieselbe Quelle wie
 * der ✨-Chat) und liefert Diagnose + konkrete Schritte + einen kurzen
 * Rückruf-Leitfaden. instruction = optionale Team-Anweisung (auch diktiert).
 */
export async function POST(request: Request) {
  const auth = await getTaskAuth()
  if (!auth || auth.role === 'provider') {
    return NextResponse.json({ error: 'Nicht berechtigt' }, { status: 403 })
  }

  const allowed = await checkRateLimit(`ai-call:${auth.userId}`, 30, 3600)
  if (!allowed) {
    return NextResponse.json({ error: 'Zu viele Anfragen — kurz warten.' }, { status: 429 })
  }

  let body: { taskId?: string; instruction?: string }
  try { body = await request.json() } catch { body = {} }
  if (!body.taskId) return NextResponse.json({ error: 'taskId fehlt' }, { status: 400 })

  const { data: task } = await supabaseAdmin
    .from('tasks')
    .select('id, title, description, source, created_at')
    .eq('id', body.taskId)
    .maybeSingle()
  if (!task || task.source !== 'anruf') {
    return NextResponse.json({ error: 'Anruf-Meldung nicht gefunden' }, { status: 404 })
  }

  // Wohnung aus dem Text erraten (der Anrufer nennt sie oft) → passendes Wissensdokument
  const { data: listings } = await supabaseAdmin
    .from('listings').select('id, title').eq('is_active', true)
  const text = `${task.title}\n${task.description}`.toLowerCase()
  const hit = (listings ?? []).find((l) => {
    const t = String(l.title ?? '').toLowerCase()
    return t && (text.includes(t) || t.split(/\s+/).every((w) => text.includes(w)))
  })
  const knowledge = await getChatKnowledge(hit?.id ?? null)

  const system = [
    'Du hilfst dem Team von TRIMOSA Apartments & Homes (Ferienwohnungen bei Trier),',
    'eine TELEFONISCH aufgenommene Gast-Meldung zu lösen. Antworte auf Deutsch, kompakt:',
    '1) Kurze Einschätzung, worum es geht.',
    '2) Konkrete Lösungsschritte — NUR aus der WISSENSBASIS und allgemeinem Hausverstand,',
    '   niemals erfundene Fakten, Codes oder Zusagen.',
    '3) „Für den Rückruf:" — 2–3 Sätze, die man dem Gast am Telefon sagen kann.',
    'Wenn die Wissensbasis nichts hergibt, sag ehrlich, was zu klären wäre.',
  ].join('\n')

  const user = [
    `TELEFONISCHE MELDUNG (${task.title}):`,
    task.description,
    hit ? `\nERKANNTE WOHNUNG: ${hit.title}` : '',
    '\nWISSENSBASIS (aus echten Gäste-Chats destilliert):',
    knowledge || '(keine Einträge)',
    body.instruction ? `\nANWEISUNG DES TEAMS (hat Vorrang): ${String(body.instruction).slice(0, 500)}` : '',
  ].filter(Boolean).join('\n')

  try {
    const suggestion = await askClaude(system, user, 1500)
    return NextResponse.json({ suggestion, listing: hit?.title ?? null })
  } catch (e) {
    console.error('[call-suggest]', e)
    return NextResponse.json({ error: 'KI-Vorschlag fehlgeschlagen — erneut versuchen.' }, { status: 502 })
  }
}
