/**
 * AI listing translations (EN/FR/NL). German stays the source of truth; the
 * translated title/description/room texts live in listings.translations:
 *   { en: { title, description, rooms: { [roomId]: { name, description } },
 *           src_hash, updated_at }, fr: {...}, nl: {...} }
 * src_hash fingerprints the German source, so the editor can show stale
 * translations and the nightly cron re-translates them automatically.
 */
import { supabaseAdmin } from '@/lib/supabase-admin'
import { askClaude } from '@/lib/ai'
import { getPrompt } from '@/lib/prompts'

export const TRANSLATION_LANGS = ['en', 'fr', 'nl'] as const
export type TranslationLang = (typeof TRANSLATION_LANGS)[number]

export const TRANSLATION_LANG_META: Record<TranslationLang, { flag: string; label: string; native: string; prompt: string }> = {
  en: { flag: '🇬🇧', label: 'Englisch', native: 'English', prompt: 'Englisch (British English)' },
  fr: { flag: '🇫🇷', label: 'Französisch', native: 'Français', prompt: 'Französisch' },
  nl: { flag: '🇳🇱', label: 'Niederländisch', native: 'Nederlands', prompt: 'Niederländisch' },
}

interface SourceRoom { id: string; name?: string; description?: string }

export interface TranslationEntry {
  title?: string
  description?: string
  rooms?: Record<string, { name?: string; description?: string }>
  src_hash?: string
  updated_at?: string
}

interface TranslatableListing {
  id: string
  title: string | null
  description: string | null
  rooms: SourceRoom[] | null
  translations: Record<string, TranslationEntry> | null
}

/** djb2 over the German source texts — cheap change detection. */
export function sourceHash(l: { title?: string | null; description?: string | null; rooms?: SourceRoom[] | null }): string {
  const parts = [
    l.title ?? '', l.description ?? '',
    ...(l.rooms ?? []).flatMap((r) => [r.name ?? '', r.description ?? '']),
  ]
  const s = parts.join('')
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

function extractJson(raw: string): Record<string, unknown> {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('Keine JSON-Antwort erhalten.')
  return JSON.parse(raw.slice(start, end + 1))
}

async function translateOne(lang: TranslationLang, source: TranslatableListing): Promise<TranslationEntry> {
  const payload = {
    title: source.title ?? '',
    description: source.description ?? '',
    rooms: (source.rooms ?? [])
      .filter((r) => r.id && (r.name || r.description))
      .map((r) => ({ id: r.id, name: r.name ?? '', description: r.description ?? '' })),
  }
  const system = (await getPrompt('listing_translate')).replaceAll('{{LANGUAGE}}', TRANSLATION_LANG_META[lang].prompt)
  const raw = await askClaude(system, JSON.stringify(payload), 8000)
  const parsed = extractJson(raw)

  const rooms: TranslationEntry['rooms'] = {}
  if (Array.isArray(parsed.rooms)) {
    for (const r of parsed.rooms as { id?: string; name?: string; description?: string }[]) {
      if (r?.id) rooms[r.id] = { name: r.name || undefined, description: r.description || undefined }
    }
  }
  return {
    title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : undefined,
    description: typeof parsed.description === 'string' && parsed.description.trim() ? parsed.description.trim() : undefined,
    rooms,
    src_hash: sourceHash(source),
    updated_at: new Date().toISOString(),
  }
}

/** Translate one listing into the given languages and persist the result. */
export async function translateListing(
  listingId: string,
  langs: readonly TranslationLang[] = TRANSLATION_LANGS,
): Promise<Record<string, string>> {
  const { data: listing } = await supabaseAdmin
    .from('listings')
    .select('id, title, description, rooms, translations')
    .eq('id', listingId)
    .single()
  if (!listing) return { error: 'Inserat nicht gefunden.' }

  const merged: Record<string, TranslationEntry> = { ...(listing.translations ?? {}) }
  const status: Record<string, string> = {}
  // Sequential: keeps token bursts small and error attribution per language clean.
  for (const lang of langs) {
    try {
      merged[lang] = await translateOne(lang, listing as TranslatableListing)
      status[lang] = 'ok'
    } catch (err) {
      status[lang] = err instanceof Error ? err.message : 'Fehler'
    }
  }
  const { error } = await supabaseAdmin.from('listings').update({ translations: merged }).eq('id', listingId)
  if (error) status.save = error.message
  return status
}

/** Status per language for the editor card. */
export function translationStatus(listing: { title?: string | null; description?: string | null; rooms?: SourceRoom[] | null; translations?: Record<string, TranslationEntry> | null }) {
  const hash = sourceHash(listing)
  return TRANSLATION_LANGS.map((lang) => {
    const t = listing.translations?.[lang]
    return {
      lang,
      ...TRANSLATION_LANG_META[lang],
      exists: !!t?.title,
      fresh: !!t?.title && t.src_hash === hash,
      updatedAt: t?.updated_at ?? null,
    }
  })
}

/**
 * Nightly cron: re-translate listings whose German source changed since the
 * last translation run. Only touches listings that were translated at least
 * once (the host opts in via the editor button). Budgeted per run.
 */
export async function refreshStaleTranslations(maxListings = 2): Promise<Record<string, unknown>[]> {
  const { data: listings } = await supabaseAdmin
    .from('listings')
    .select('id, title, description, rooms, translations')
    .eq('is_active', true)
    .not('translations', 'is', null)
  const results: Record<string, unknown>[] = []
  for (const l of listings ?? []) {
    if (results.length >= maxListings) break
    const hash = sourceHash(l as TranslatableListing)
    const stale = TRANSLATION_LANGS.filter((lang) => {
      const t = (l.translations as Record<string, TranslationEntry> | null)?.[lang]
      return t?.title && t.src_hash !== hash
    })
    if (!stale.length) continue
    results.push({ id: l.id, title: l.title, langs: stale, status: await translateListing(l.id, stale) })
  }
  return results
}
