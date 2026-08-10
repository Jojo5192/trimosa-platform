import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// Die Login-Seite ist eine Client Component — noindex kommt darum aus diesem
// Layout. robots.txt darf sie NICHT blockieren, sonst sieht Google das
// noindex nie (GSC: „Indexiert, obwohl durch robots.txt blockiert").
export const metadata: Metadata = {
  title: 'Anmelden',
  robots: { index: false, follow: true },
}

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children
}
