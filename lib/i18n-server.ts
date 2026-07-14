/** Server-side language resolution (cookie 'uilang'); see lib/i18n.ts. */
import { cookies } from 'next/headers'
import { UI_COOKIE, isUiLang, type UiLang } from '@/lib/i18n'

export async function getUiLang(): Promise<UiLang> {
  try {
    const store = await cookies()
    const v = store.get(UI_COOKIE)?.value
    return isUiLang(v) ? v : 'de'
  } catch {
    return 'de'
  }
}
