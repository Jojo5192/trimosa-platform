import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

/**
 * Team-App-Layout: Zoom-Sperre NUR hier (App-Charakter) — die öffentliche
 * Website bleibt aus Barrierefreiheits-Gründen zoombar. Wirkt zusammen mit
 * .team-shell (touch-action + 16px-Inputs gegen den iOS-Auto-Zoom).
 */
export const metadata: Metadata = {
  // iOS-Statusbar in der installierten App: opak & hell (schwarze Uhrzeit auf Weiß)
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'TRIMOSA Team' },
}
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // cover: sonst liefert env(safe-area-inset-*) in der installierten App 0
  // und der Composer klebt in den runden Display-Ecken
  viewportFit: 'cover',
  // Statusbar-Fläche (Uhrzeit/Batterie) weiß — nahtlos zum App-Header
  themeColor: '#ffffff',
}

export default function TeamLayout({ children }: { children: ReactNode }) {
  return children
}
