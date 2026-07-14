/**
 * Chat message translation (fast model). Two directions:
 *  - translateIncoming: batch-detect + translate guest messages to German,
 *    cached in messages.lang / messages.content_de (one call per new batch).
 *  - translateOutgoing: German team reply → guest language (send preview).
 * All failures degrade gracefully — the chat always works untranslated.
 */
import { askClaude, FAST_MODEL } from '@/lib/ai'
import { supabaseAdmin } from '@/lib/supabase-admin'

export interface DetectedTranslation {
  id: string
  lang: string
  german: string | null
}

/** Language code → flag emoji (fallback 🌐 handled by the UI). */
export const LANG_FLAGS: Record<string, string> = {
  de: '🇩🇪', en: '🇬🇧', nl: '🇳🇱', fr: '🇫🇷', es: '🇪🇸', it: '🇮🇹', pl: '🇵🇱',
  da: '🇩🇰', pt: '🇵🇹', ru: '🇷🇺', cs: '🇨🇿', sv: '🇸🇪', tr: '🇹🇷', lb: '🇱🇺',
}
export const LANG_NAMES: Record<string, string> = {
  de: 'Deutsch', en: 'Englisch', nl: 'Niederländisch', fr: 'Französisch',
  es: 'Spanisch', it: 'Italienisch', pl: 'Polnisch', da: 'Dänisch',
  pt: 'Portugiesisch', ru: 'Russisch', cs: 'Tschechisch', sv: 'Schwedisch',
  tr: 'Türkisch', lb: 'Luxemburgisch',
}

/**
 * Detects language + translates to German for a batch of messages in ONE
 * fast-model call. Persists lang/content_de on the messages rows and returns
 * the map for immediate use.
 */
export async function translateIncoming(items: { id: string; text: string }[]): Promise<Map<string, { lang: string; german: string | null }>> {
  const result = new Map<string, { lang: string; german: string | null }>()
  if (items.length === 0 || !process.env.ANTHROPIC_API_KEY) return result

  const system = `Du bist ein Übersetzungsdienst für Gäste-Nachrichten einer Ferienwohnungs-Plattform.
Für jede nummerierte Nachricht: erkenne die Sprache (ISO-639-1, z. B. "de", "nl", "en")
und übersetze sie natürlich und vollständig ins Deutsche.
Antworte AUSSCHLIESSLICH mit einem JSON-Array: [{"i": <Nummer>, "lang": "<code>", "de": "<deutsche Übersetzung>"}].
Ist eine Nachricht bereits Deutsch, setze "de": null. Keine Erklärungen, kein Markdown.`

  const user = items.map((m, i) => `${i}. ${m.text.slice(0, 1500)}`).join('\n\n')
  try {
    const raw = await askClaude(system, user, 4000, FAST_MODEL)
    const jsonStart = raw.indexOf('[')
    const parsed = JSON.parse(raw.slice(jsonStart)) as { i: number; lang: string; de: string | null }[]
    for (const row of parsed) {
      const item = items[row.i]
      if (!item || typeof row.lang !== 'string') continue
      const lang = row.lang.toLowerCase().slice(0, 2)
      const german = lang === 'de' ? null : (typeof row.de === 'string' ? row.de : null)
      result.set(item.id, { lang, german })
      await supabaseAdmin.from('messages').update({ lang, content_de: german }).eq('id', item.id)
    }
  } catch (err) {
    console.error('[translate] incoming batch failed:', err)
  }
  return result
}

/** German team reply → guest language. Returns null on failure (send untranslated or abort). */
export async function translateOutgoing(text: string, targetLang: string): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  const langName = LANG_NAMES[targetLang] ?? targetLang
  const system = `Übersetze die Nachricht eines Ferienwohnungs-Gastgebers natürlich und freundlich
ins ${langName} (Sprachcode: ${targetLang}). Erhalte Ton und Duzen/Siezen sinngemäß.
Antworte AUSSCHLIESSLICH mit der Übersetzung — keine Erklärungen, keine Anführungszeichen.`
  try {
    return await askClaude(system, text.slice(0, 3000), 1500, FAST_MODEL)
  } catch (err) {
    console.error('[translate] outgoing failed:', err)
    return null
  }
}
