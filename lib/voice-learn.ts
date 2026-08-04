import { supabaseAdmin } from '@/lib/supabase-admin'
import { askClaude, SMART_MODEL } from '@/lib/ai'

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

  // (b2) §247: Lösungen, die das Team DIREKT am Telefonat erfasst hat
  // (Gast-Thread → Anruf-Karte → „✅ So gelöst"). Seit §246g entsteht bei
  // bekanntem Gast keine Aufgabe mehr — ohne diesen Kanal versiegt genau
  // dort das Lernen. Auswahl über solution_at, damit nachgetragene
  // Lösungen auch bei längst gelerntem Transkript ankommen.
  const { data: solRows } = await supabaseAdmin
    .from('voice_calls')
    .select('summary, solution, solution_at')
    .not('solution', 'is', null)
    .gt('solution_at', cursor)
    .order('solution_at', { ascending: true })
    .limit(40)
  const callSolutions = (solRows ?? []).map((r) => ({
    titel: `Telefonat: ${String(r.summary ?? '').slice(0, 250)}`,
    loesung: `✅ Lösung (Telefonat): ${String(r.solution ?? '').slice(0, 500)}`,
  }))
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
  loesungen = [...loesungen, ...callSolutions]   // §247

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
  // §211: höchste Qualitätsstufe — dasselbe Muster wie die Chat-Destillate
  const md = (await askClaude(system, user, 12000, SMART_MODEL)).trim()
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

/**
 * 🔍 §228: Anruf-QA (Inhaber-Auftrag 31.7. nach dem Kerklingh-Vorfall) —
 * analysiert JEDEN neuen Anruf automatisch auf Fehler und Verbesserungen:
 * erfundene Fakten/Codes, behauptete-aber-nicht-ausgeführte Aktionen,
 * riskante Auskünfte, Gesprächsführungs-Probleme. Befunde mit Schwere
 * hoch/mittel gehen als Claude-Post in den Chefsache-Chat; der letzte
 * Bericht liegt in app_settings 'voice_qa_last'. Läuft im täglichen
 * 4:40-Cron (/api/voice/learn) mit — eigener Cursor, unabhängig vom Lernen.
 */
const QA_CURSOR_KEY = 'voice_qa_cursor'
// Inhaber-Wunsch 31.7.: QA-Befunde NUR an Johannes — private Gruppe
// „🔍 Anruf-QA" (nur er + Claude), NICHT die Chefsache.
const QA_CHAT_ID = '3ac62631-02af-49c8-b7ad-3fdcb6b38162'

export async function auditCalls(): Promise<{ calls: number; befunde: number; status: string }> {
  const cursor = String((await getSetting(QA_CURSOR_KEY) as { at?: string } | null)?.at
    ?? new Date(Date.now() - 2 * 86400_000).toISOString())
  const { data: rows } = await supabaseAdmin
    .from('voice_calls')
    .select('id, summary, transcript, caller_number, created_at')
    .gt('created_at', cursor)
    .order('created_at', { ascending: true })
    .limit(12)
  const calls = (rows ?? []).filter((c) => String(c.transcript ?? '').length > 400)
  if (!calls.length) {
    if (rows?.length) await setSetting(QA_CURSOR_KEY, { at: rows[rows.length - 1].created_at })
    return { calls: 0, befunde: 0, status: 'nichts Neues' }
  }

  const material = calls.map((c, i) =>
    `--- ANRUF ${i + 1} · ${String(c.created_at).slice(0, 16).replace('T', ' ')} ---\n${String(c.transcript).slice(0, 6000)}`
  ).join('\n\n')

  const system = [
    'Du bist der QUALITÄTS-AUDITOR der TRIMOSA-Telefon-Assistentin (KI-Bot für Ferienwohnungs-Gäste). Du prüfst Anruf-Transkripte auf Fehler.',
    'Prüfe JEDEN Anruf auf: (1) ERFUNDENES — Zahlen, Codes, Ausstattungs-Details, Zusagen oder „Buchung gefunden"-Behauptungen, die nicht aus einer Werkzeug-Antwort stammen können; (2) BEHAUPTETE, ABER NICHT AUSGEFÜHRTE AKTIONEN („Team ist informiert", „ich habe gesendet"); (3) RISKANTE AUSKÜNFTE (Preise ohne Personenzahl, Codes an unklare Anrufer, falsche Bedienungs-Anweisungen — Nuki-Keypads haben KEIN Häkchen); (4) GESPRÄCHSFÜHRUNG (Anrufer nicht verstanden, Schleifen, unnötige Datenabfragen, Missverständnisse ignoriert, falsche Sprache); (5) VERBESSERUNGS-CHANCEN.',
    'Antworte NUR mit JSON: {"befunde":[{"anruf":1,"schwere":"hoch"|"mittel"|"niedrig","problem":"1 Satz, konkret mit Zitat","empfehlung":"1 Satz, was der Bot hätte tun sollen"}],"fazit":"1-2 Sätze Gesamteindruck"}. Ist ein Anruf sauber, KEIN Befund dafür — melde nur echte Probleme, keine Geschmacksfragen.',
  ].join('\n')

  let befunde: { anruf?: number; schwere?: string; problem?: string; empfehlung?: string }[] = []
  let fazit = ''
  try {
    const raw = await askClaude(system, material.slice(0, 60000), 8000, SMART_MODEL)
    const m = raw.match(/\{[\s\S]*\}/)
    if (m) {
      const parsed = JSON.parse(m[0]) as { befunde?: typeof befunde; fazit?: string }
      befunde = Array.isArray(parsed.befunde) ? parsed.befunde : []
      fazit = String(parsed.fazit ?? '')
    }
  } catch (e) {
    console.error('[voice-qa] Analyse fehlgeschlagen:', e)
    return { calls: calls.length, befunde: 0, status: 'KI-Analyse fehlgeschlagen (Cursor bleibt — nächster Lauf versucht es erneut)' }
  }

  await setSetting('voice_qa_last', {
    at: new Date().toISOString(), gepruefte: calls.length, befunde, fazit,
  })
  await setSetting(QA_CURSOR_KEY, { at: calls[calls.length - 1].created_at })

  // Chefsache-Post nur bei relevanten Befunden (hoch/mittel) — kein Spam
  const relevant = befunde.filter((b) => b.schwere === 'hoch' || b.schwere === 'mittel')
  if (relevant.length) {
    try {
      const { postAsClaude } = await import('@/lib/claude-bot')
      const zeilen = relevant.slice(0, 6).map((b) => {
        const c = calls[(b.anruf ?? 1) - 1]
        const wann = c ? String(c.created_at).slice(5, 16).replace('T', ' ') : '?'
        return `${b.schwere === 'hoch' ? '🔴' : '🟡'} Anruf ${wann}: ${b.problem}\n   → ${b.empfehlung}`
      })
      await postAsClaude(QA_CHAT_ID,
        `🔍 Anruf-QA (automatische Analyse, ${calls.length} Anruf${calls.length > 1 ? 'e' : ''} geprüft):\n\n` +
        zeilen.join('\n\n') +
        (fazit ? `\n\nFazit: ${fazit}` : '') +
        '\n\nAnhören/Nachlesen: Team-App → Mehr → ☎️ Telefonate.')
    } catch (e) { console.error('[voice-qa] Chefsache-Post fehlgeschlagen:', e) }
  }

  return { calls: calls.length, befunde: befunde.length, status: relevant.length ? `${relevant.length} relevante Befunde → Chefsache` : 'geprüft, nichts Gravierendes' }
}
