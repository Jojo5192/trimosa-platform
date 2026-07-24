import { supabaseAdmin } from '@/lib/supabase-admin'
import { askClaude } from '@/lib/ai'

/**
 * ☎️🧠 Transkript-Lernen (§183, Phase 2b): destilliert aus (a) den
 * Anruf-Transkripten des KI-Assistenten (voice_calls, via Post-Call-
 * Webhook) und (b) den „✅ Lösung (Telefonat)"-Kommentaren erledigter
 * Anruf-Aufgaben ein wachsendes Telefon-Wissensdokument
 * (app_settings 'voice_phone_knowledge'). Der tägliche KB-Sync lädt es
 * als „[Auto] Telefon-Erkenntnisse" zu ElevenLabs — der Bot beantwortet
 * wiederkehrende Fragen damit beim nächsten Mal selbst.
 */

const CURSOR_KEY = 'voice_learn_cursor'
const KNOWLEDGE_KEY = 'voice_phone_knowledge'

async function getSetting(key: string): Promise<unknown> {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', key).maybeSingle()
  return data?.value ?? null
}

async function setSetting(key: string, value: unknown): Promise<void> {
  await supabaseAdmin.from('app_settings').upsert({ key, value }, { onConflict: 'key' })
}

export async function learnFromCalls(): Promise<{ calls: number; loesungen: number; status: string }> {
  // (a) Noch nicht gelernte Anrufe mit echtem Gespräch
  const { data: callRows } = await supabaseAdmin
    .from('voice_calls')
    .select('id, summary, transcript, created_at')
    .is('learned_at', null)
    .order('created_at', { ascending: true })
    .limit(40)
  const calls = (callRows ?? []).filter((c) => String(c.transcript ?? '').length > 300)

  // (b) Lösungs-Kommentare erledigter Anruf-Aufgaben seit dem Cursor
  const cursor = String((await getSetting(CURSOR_KEY) as { at?: string } | null)?.at
    ?? new Date(Date.now() - 7 * 86400_000).toISOString())
  const { data: comments } = await supabaseAdmin
    .from('task_comments')
    .select('task_id, content, created_at')
    .ilike('content', '✅ Lösung%')
    .gt('created_at', cursor)
    .order('created_at', { ascending: true })
    .limit(40)
  let loesungen: { titel: string; loesung: string }[] = []
  const taskIds = [...new Set((comments ?? []).map((c) => String(c.task_id)))]
  if (taskIds.length) {
    const { data: tasks } = await supabaseAdmin
      .from('tasks').select('id, title, description, source').in('id', taskIds)
    const bySrc = new Map((tasks ?? []).map((t) => [String(t.id), t]))
    loesungen = (comments ?? [])
      .map((c) => {
        const t = bySrc.get(String(c.task_id))
        if (!t || t.source !== 'anruf') return null
        return {
          titel: `${t.title}\n${String(t.description ?? '').split('\n')[0]}`.slice(0, 300),
          loesung: String(c.content).slice(0, 500),
        }
      })
      .filter((x): x is { titel: string; loesung: string } => !!x)
  }

  if (!calls.length && !loesungen.length) {
    await setSetting(CURSOR_KEY, { at: new Date().toISOString() })
    return { calls: 0, loesungen: 0, status: 'nichts Neues' }
  }

  const existing = String((await getSetting(KNOWLEDGE_KEY) as { md?: string } | null)?.md ?? '')

  const material = [
    ...calls.map((c) => `--- ANRUF ${String(c.created_at).slice(0, 10)} ---\n${String(c.transcript).slice(0, 4000)}`),
    ...loesungen.map((s) => `--- VOM TEAM GELÖSTES TELEFON-ANLIEGEN ---\n${s.titel}\nLÖSUNG: ${s.loesung}`),
  ].join('\n\n')

  const system = [
    'Du pflegst das Telefon-Wissensdokument der TRIMOSA-Ferienwohnungs-Assistentin (Markdown, max. ~700 Wörter).',
    'Du bekommst das BESTEHENDE Dokument und NEUES Material (Anruf-Transkripte + vom Team dokumentierte Lösungen).',
    'Erstelle die AKTUALISIERTE Fassung: bestehendes Wissen behalten und mit dem neuen Material verschmelzen; bei Widerspruch gewinnt die NEUESTE Team-Lösung.',
    'Struktur: „## Häufige Anliegen & bewährte Antworten" (je Anliegen 1–3 Sätze, WIE richtig geantwortet/gelöst wird) und „## Stolperfallen für die Assistentin" (was im Gespräch schieflief und wie es besser geht).',
    'EISERNE REGELN: NIEMALS Türcodes, Passwörter, Telefonnummern oder Gastnamen ins Dokument — nur Prozedere und Formulierungen. Nichts erfinden, nur aus dem Material. Antworte NUR mit dem Markdown-Dokument.',
  ].join('\n')

  const user = [
    existing ? `BESTEHENDES DOKUMENT:\n${existing.slice(0, 12000)}` : 'BESTEHENDES DOKUMENT: (noch leer)',
    '',
    `NEUES MATERIAL:\n${material.slice(0, 40000)}`,
  ].join('\n')

  // Sonnet mit ausreichend Denkbudget (§45-Lektion)
  const md = (await askClaude(system, user, 8000)).trim()
  if (md.length < 50) return { calls: calls.length, loesungen: loesungen.length, status: 'KI-Antwort zu kurz — nichts gespeichert' }

  await setSetting(KNOWLEDGE_KEY, { md, updated: new Date().toISOString() })
  await setSetting(CURSOR_KEY, { at: new Date().toISOString() })
  if (calls.length) {
    await supabaseAdmin
      .from('voice_calls')
      .update({ learned_at: new Date().toISOString() })
      .in('id', calls.map((c) => c.id))
  }
  return { calls: calls.length, loesungen: loesungen.length, status: 'aktualisiert' }
}
