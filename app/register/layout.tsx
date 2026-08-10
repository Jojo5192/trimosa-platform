import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// Client-Component-Seite — noindex via Layout, robots.txt blockiert bewusst nicht (§252).
export const metadata: Metadata = {
  title: 'Registrieren',
  robots: { index: false, follow: true },
}

export default function RegisterLayout({ children }: { children: ReactNode }) {
  return children
}
