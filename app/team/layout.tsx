import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { THEME_BOOT_SCRIPT, THEME_COOKIE, DARK_BG, LIGHT_BG } from '@/lib/theme-boot'

/**
 * Team-App-Layout: Zoom-Sperre NUR hier (App-Charakter) — die öffentliche
 * Website bleibt aus Barrierefreiheits-Gründen zoombar. Wirkt zusammen mit
 * .team-shell (touch-action + 16px-Inputs gegen den iOS-Auto-Zoom).
 */
/** §292 (Dominik 9.9.: helle Balken im Dark Mode): Statusbar-Stil und theme-color folgen dem
 *  Modus-Cookie, das der Client beim Umschalten und das Boot-Script setzen. iOS liest den
 *  Statusbar-Stil beim Start der installierten App — nach einem Wechsel greift er beim nächsten
 *  Kaltstart. 'black' = dunkle Leiste mit weißer Uhrzeit, 'default' = hell mit schwarzer. */
async function isDarkCookie(): Promise<boolean> {
  try { return (await cookies()).get(THEME_COOKIE)?.value === 'dark' } catch { return false }
}
export async function generateMetadata(): Promise<Metadata> {
  const dark = await isDarkCookie()
  return {
    appleWebApp: { capable: true, statusBarStyle: dark ? 'black' : 'default', title: 'TRIMOSA Team' },
  }
}
export async function generateViewport(): Promise<Viewport> {
  const dark = await isDarkCookie()
  return {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    // cover: sonst liefert env(safe-area-inset-*) in der installierten App 0
    // und der Composer klebt in den runden Display-Ecken
    viewportFit: 'cover',
    // Statusbar-Fläche (Uhrzeit/Batterie) — nahtlos zum App-Header, je Modus
    themeColor: dark ? DARK_BG : LIGHT_BG,
    // <meta name="color-scheme">: iOS richtet Tastatur + Zubehörleiste danach aus (§292)
    colorScheme: dark ? 'dark' : 'light',
  }
}

export default function TeamLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* §284 Dark Mode: Klasse tm-dark vor dem ersten Frame (gespeicherter
          Modus oder System) — sonst blitzt die helle Seite auf */}
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      {children}
    </>
  )
}
