'use client'

import { useSyncExternalStore } from 'react'

/**
 * 🌗 Dark Mode der Team-App (§284, Inhaber 9.9.: „mit Schalter, komplett").
 * Modus in localStorage `trimosa-theme` (system | light | dark); die Klasse
 * `tm-dark` auf <html> schaltet die Tokens (globals.css `.tm-dark .team-shell`),
 * den Vorhang, die Seite und die Portale um. Vor dem ersten Frame setzt ein
 * Inline-Script in app/team/layout.tsx dieselbe Klasse (kein Aufblitzen).
 */
import { THEME_KEY, DARK_BG, LIGHT_BG, THEME_COOKIE } from '@/lib/theme-boot'
export { THEME_KEY, DARK_BG, LIGHT_BG } from '@/lib/theme-boot'
export type ThemeMode = 'system' | 'light' | 'dark'
export const THEME_EVENT = 'trimosa-theme'

export function getThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch { return 'system' }
}
export function systemDark(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches } catch { return false }
}
export function isDarkActive(mode: ThemeMode = getThemeMode()): boolean {
  return mode === 'dark' || (mode === 'system' && systemDark())
}

/** Klasse + Hintergrund + theme-color-Meta nach dem gespeicherten Modus setzen. */
export function applyTheme(mode: ThemeMode = getThemeMode()) {
  if (typeof document === 'undefined') return
  const dark = isDarkActive(mode)
  const html = document.documentElement
  html.classList.toggle('tm-dark', dark)
  html.style.backgroundColor = dark ? DARK_BG : LIGHT_BG
  // Cookie für den Server (Statusbar-Stil der installierten App, theme-color beim nächsten Start)
  try { document.cookie = `${THEME_COOKIE}=${dark ? 'dark' : 'light'}; path=/; max-age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}` } catch { /* egal */ }
  try {
    let meta = document.querySelector('meta[name="theme-color"]:not([media])') as HTMLMetaElement | null
    if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta) }
    meta.content = dark ? DARK_BG : LIGHT_BG
    // Vom Layout gesetzte Media-Varianten würden sonst gewinnen
    document.querySelectorAll('meta[name="theme-color"][media]').forEach((m) => m.remove())
  } catch { /* egal */ }
}

export function setThemeMode(mode: ThemeMode) {
  try { localStorage.setItem(THEME_KEY, mode) } catch { /* egal */ }
  applyTheme(mode)
  try { window.dispatchEvent(new Event(THEME_EVENT)) } catch { /* SSR */ }
}

function subscribe(cb: () => void) {
  window.addEventListener(THEME_EVENT, cb)
  window.addEventListener('storage', cb)
  let mq: MediaQueryList | null = null
  try { mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', cb) } catch { mq = null }
  return () => {
    window.removeEventListener(THEME_EVENT, cb)
    window.removeEventListener('storage', cb)
    try { mq?.removeEventListener('change', cb) } catch { /* egal */ }
  }
}
/** Gespeicherter Modus (reaktiv). */
export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, getThemeMode, () => 'system' as ThemeMode)
}
/** Ist gerade dunkel aktiv? (reaktiv, folgt auch dem System-Wechsel) */
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, () => isDarkActive(), () => false)
}
