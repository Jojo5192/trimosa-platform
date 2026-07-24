import { NextResponse } from 'next/server'
import { getTaskAuth } from '@/lib/tasks'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getChatKnowledge } from '@/lib/chat-knowledge'
import { askClaude } from '@/lib/ai'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * ☎️✨ Lösungs-Optionen für eine telefonische Meldung (§175):
 *  POST { taskId, instruction? }            → 2–3 anklickbare Optionen,
 *    je { text (was man dem Gast sagt/tut), reasoning (worauf sich das
 *    stützt — fürs ⓘ) }. instruction = Team-Anweisung (auch diktiert),
 *    die Optionen richten sich dann danach.
 *  POST { taskId, action:'solution', rawText } → formuliert aus einer
 *    kurzen (diktierten) Erklärung den sauberen Lösungs-Eintrag fürs
 *    Lern-Archiv (1–2 Sätze).
 */

interface SolutionOption { text: string; reasoning: string }

function parseOptions(raw: string): SolutionOption[] {
  let s = raw.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('[')
  const end = s.lastIndexOf(']')
  if (start >= 0 && end > start) s = s.slice(start, end + 1)
  try {
    const arr = JSON.parse(s)
    if (Array.isArray(arr)) {
      const opts = arr
        .map((o) => ({ text: String(o?.text ?? '').trim(), reasoning: String(o?.reasoning ?? '').trim() }))
        .filter((o) => o.text)
        .slice(0, 3)
      if (opts.length) return opts
    }
  } catch { /* Fallback unten */ }
  return [{ text: raw.trim().slice(0, 1200), reasoning: 'Freitext-Antwort der KI (JSON-Parsing fehlgeschlagen).' }]
}

export async function POST(request: Request) {
  const auth = await getTaskAuth()
  if (!auth || auth.role === 'provider') {
    return NextResponse.json({ error: 'Nicht berechtigt' }, { status: 403 })
  }

  const allowed = await checkRateLimit(`ai-call:${auth.userId}`, 40, 3600)
  if (!allowed) {
    return NextResponse.json({ error: 'Zu viele Anfragen — kurz warten.' }, { status: 429 })
  }

  let body: { taskId?: string; instruction?: string; action?: string; rawText?: string }
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

  // ── Modus „Lösung formulieren" (Erledigt-Flow, meist diktiert) ──
  if (body.action === 'solution') {
    const raw = String(body.rawText ?? '').trim()
    if (!raw) return NextResponse.json({ error: 'rawText fehlt' }, { status: 400 })
    try {
      const solution = await askClaude(
        [
          'Du formulierst für das TRIMOSA-Team (Ferienwohnungen) aus einer kurzen, oft',
          'diktierten Erklärung einen sauberen Lösungs-Eintrag fürs Wissens-Archiv.',
          '1–2 vollständige deutsche Sätze: WAS war die Lösung (ggf. Regel dahinter).',
          'Nichts erfinden, nur glätten. Antworte NUR mit dem Eintrag.',
        ].join('\n'),
        `ANLIEGEN: ${task.title}\n${task.description.slice(0, 600)}\n\nERKLÄRUNG DES TEAMS: ${raw.slice(0, 800)}`,
        400,
      )
      return NextResponse.json({ solution: solution.trim() })
    } catch (e) {
      console.error('[call-suggest solution]', e)
      return NextResponse.json({ error: 'Formulieren fehlgeschlagen.' }, { status: 502 })
    }
  }

  // ── Standard: 2–3 Lösungs-Optionen ──
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
    'eine TELEFONISCH aufgenommene Gast-Meldung zu lösen.',
    'Antworte AUSSCHLIESSLICH mit einem JSON-Array aus 2–3 unterschiedlichen',
    'Lösungs-Optionen (z. B. kulant / Standard / Alternative), Format:',
    '[{"text": "...", "reasoning": "..."}]',
    '- text: 1–3 Sätze — was man dem Gast beim Rückruf sagt bzw. was getan wird.',
    '- reasoning: 1–2 Sätze — WORAUF sich die Option stützt (Wissensbasis-Fakt,',
    '  frühere Entscheidung, Hausregel oder Hausverstand). Ehrlich kennzeichnen,',
    '  wenn etwas NICHT aus der Wissensbasis stammt.',
    'NIEMALS Fakten, Codes oder Zusagen erfinden. Beste Option zuerst.',
  ].join('\n')

  const user = [
    `TELEFONISCHE MELDUNG (${task.title}):`,
    task.description,
    hit ? `\nERKANNTE WOHNUNG: ${hit.title}` : '',
    '\nWISSENSBASIS (aus echten Gäste-Chats destilliert):',
    knowledge || '(keine Einträge)',
    body.instruction ? `\nANWEISUNG DES TEAMS (hat Vorrang — richte die Optionen danach aus): ${String(body.instruction).slice(0, 500)}` : '',
  ].filter(Boolean).join('\n')

  try {
    const raw = await askClaude(system, user, 2000)
    return NextResponse.json({ options: parseOptions(raw), listing: hit?.title ?? null })
  } catch (e) {
    console.error('[call-suggest]', e)
    return NextResponse.json({ error: 'KI-Vorschlag fehlgeschlagen — erneut versuchen.' }, { status: 502 })
  }
}
