'use client'

import { useEffect } from 'react'
import { UI_COOKIE, type UiLang } from '@/lib/i18n'

/**
 * Besuch einer Sprachseite (/en|fr|nl/…) setzt das uilang-Cookie (Audit 14.10.2026, Hoch-Punkt 3):
 * Vorher verlor ein Gast von Google aus /en beim ersten Klick die Sprache und bekam deutsche
 * Rechtsseiten, deutsche Buchungsmail und deutschen Gastbereich — alles hängt am Cookie.
 */
export default function LangCookieSync({ lang }: { lang: UiLang }) {
  useEffect(() => {
    const m = document.cookie.match(/(?:^|; )uilang=([a-z]{2})/)
    if (m?.[1] === lang) return
    document.cookie = `${UI_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`
  }, [lang])
  return null
}
