/**
 * Server-side translation layer for EDITORIAL German content (travel guide,
 * kulinarik, about page, guest summaries, reviews, room keywords). Texts are
 * AI-translated ONCE per language, cached forever in static_translations
 * (key: hash of the German text) plus an in-process cache — pages stay fast
 * after the first visit per language. Fail-soft: German on any error.
 */
import { supabaseAdmin } from '@/lib/supabase-admin'
import { askClaude, FAST_MODEL } from '@/lib/ai'
import type { UiLang } from '@/lib/i18n'

const LANG_NAME: Record<Exclude<UiLang, 'de'>, string> = {
  en: 'Englisch (British English)',
  fr: 'Französisch',
  nl: 'Niederländisch',
}

function deHash(s: string): string {
  let h1 = 5381, h2 = 52711
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = (((h1 << 5) + h1) ^ c) >>> 0
    h2 = (((h2 << 5) + h2) ^ c ^ 0x5a) >>> 0
  }
  return h1.toString(36) + h2.toString(36)
}

const g = globalThis as typeof globalThis & { __staticTrCache?: Map<string, string> }
const mem = (g.__staticTrCache ??= new Map<string, string>())

function extractArray(raw: string): string[] {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end <= start) throw new Error('Kein JSON-Array in der Antwort.')
  return JSON.parse(raw.slice(start, end + 1))
}

async function translateChunk(lang: Exclude<UiLang, 'de'>, texts: string[]): Promise<string[]> {
  const system = `Du übersetzt Texte einer deutschen Ferienwohnungs- und Reiseführer-Website
(TRIMOSA, Region Trier/Eifel/Mosel/Saar) in die Zielsprache: ${LANG_NAME[lang]}.
Muttersprachliches Niveau, natürlicher Reiseführer-/Gastfreundschafts-Ton.
Eigennamen unverändert lassen (TRIMOSA, Orte, Sehenswürdigkeiten wie "Porta Nigra",
Restaurant-/Weingutsnamen, Personennamen). Zahlen, Preise und Zeilenumbrüche beibehalten.
Nichts hinzufügen oder weglassen. Platzhalter in geschweiften
Klammern (z. B. {r}, {n}) und HTML-Tags (z. B. <strong>…</strong>) exakt unverändert an der
sinngemäßen Stelle beibehalten. Du erhältst ein JSON-Array aus Strings und antwortest
AUSSCHLIESSLICH mit einem JSON-Array derselben Länge und Reihenfolge mit den Übersetzungen.`
  const raw = await askClaude(system, JSON.stringify(texts), 8000, FAST_MODEL)
  const arr = extractArray(raw)
  if (!Array.isArray(arr) || arr.length !== texts.length) throw new Error('Array-Länge weicht ab.')
  return arr.map((x, i) => (typeof x === 'string' && x.trim() ? x : texts[i]))
}

/**
 * Batch-translate; returns a synchronous lookup fn. Unknown/failed → German.
 * Usage in a server page:
 *   const T = await makeTr(lang, [ ...alle deutschen Strings der Seite... ])
 *   ...  {T('Ausflugsziele im Detail')}
 */
export async function makeTr(lang: UiLang, texts: (string | null | undefined)[]): Promise<(de: string) => string> {
  if (lang === 'de') return (de: string) => de
  const uniq = [...new Set(texts.filter((t): t is string => !!t && t.trim().length > 1))]
  const result = new Map<string, string>()
  const missing: string[] = []
  for (const t of uniq) {
    const hit = mem.get(lang + ':' + deHash(t))
    if (hit !== undefined) result.set(t, hit)
    else missing.push(t)
  }
  try {
    if (missing.length) {
      // 1) DB-Cache
      const hashes = missing.map(deHash)
      const { data } = await supabaseAdmin
        .from('static_translations').select('de_hash, content')
        .eq('lang', lang).in('de_hash', hashes)
      const byHash = new Map((data ?? []).map((r) => [r.de_hash, r.content]))
      const untranslated: string[] = []
      for (const t of missing) {
        const c = byHash.get(deHash(t))
        if (c) { result.set(t, c); mem.set(lang + ':' + deHash(t), c) }
        else untranslated.push(t)
      }
      // 2) AI für den Rest, in Häppchen (Antwortlänge/Latenz begrenzen)
      const CHUNK = 12
      for (let i = 0; i < untranslated.length; i += CHUNK) {
        const chunk = untranslated.slice(i, i + CHUNK)
        try {
          const translated = await translateChunk(lang, chunk)
          const rows = chunk.map((t, j) => ({ de_hash: deHash(t), lang, content: translated[j] }))
          await supabaseAdmin.from('static_translations').upsert(rows, { onConflict: 'de_hash,lang' })
          chunk.forEach((t, j) => { result.set(t, translated[j]); mem.set(lang + ':' + deHash(t), translated[j]) })
        } catch (err) {
          console.error('[static-translate] chunk failed:', err)
        }
      }
    }
  } catch (err) {
    console.error('[static-translate]', err)
  }
  return (de: string) => result.get(de) ?? de
}
