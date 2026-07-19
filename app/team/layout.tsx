import type { Viewport } from 'next'
import type { ReactNode } from 'react'

/**
 * Team-App-Layout: Zoom-Sperre NUR hier (App-Charakter) — die öffentliche
 * Website bleibt aus Barrierefreiheits-Gründen zoombar. Wirkt zusammen mit
 * .team-shell (touch-action + 16px-Inputs gegen den iOS-Auto-Zoom).
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function TeamLayout({ children }: { children: ReactNode }) {
  return children
}
