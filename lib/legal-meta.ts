import type { UiLang } from '@/lib/i18n'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trimosa-app.vercel.app'
const LANGS = ['en', 'fr', 'nl'] as const

/** Canonical + hreflang für Rechtsseiten (Audit 14.10.2026: Rechtsseiten hatten weder Canonical noch Sprach-URLs). */
export function legalAlternates(path: string, lang: UiLang = 'de') {
  const languages = {
    de: `${siteUrl}${path}`,
    ...Object.fromEntries(LANGS.map((x) => [x, `${siteUrl}/${x}${path}`])),
    'x-default': `${siteUrl}${path}`,
  }
  return { canonical: lang === 'de' ? `${siteUrl}${path}` : `${siteUrl}/${lang}${path}`, languages }
}
