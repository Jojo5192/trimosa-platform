import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// Client-Component-Seite — noindex via Layout, robots.txt blockiert bewusst nicht (§252).
export const metadata: Metadata = {
  title: 'Passwort vergessen',
  robots: { index: false, follow: true },
}

export default function ForgotPasswordLayout({ children }: { children: ReactNode }) {
  return children
}
