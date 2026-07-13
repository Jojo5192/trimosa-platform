'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

export default function MenuItem({ href, onClick, children }: { href: string; onClick: () => void; children: ReactNode }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      style={{ display: 'block', padding: '10px 18px', fontSize: '13px', color: '#111', textDecoration: 'none', borderRadius: '12px' }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#F7F5F2' }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
    >
      {children}
    </Link>
  )
}
