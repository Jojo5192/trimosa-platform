'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

const NAV = [
  { href: '/dashboard',               icon: '⊞',  label: 'Übersicht'    },
  { href: '/dashboard/bookings',      icon: '📅', label: 'Buchungen'    },
  { href: '/dashboard/chat',          icon: '💬', label: 'Chat'         },
  { href: '/dashboard/mappe',         icon: '📖', label: 'Gästemappe'   },
  { href: '/dashboard/auto-nachrichten', icon: '📨', label: 'Auto-Nachrichten' },
  { href: '/dashboard/notifications', icon: '🔔', label: 'Nachrichten'  },
]

export default function DashboardNav() {
  const path = usePathname()
  const [isAdmin, setIsAdmin] = useState(false)

  // /api/admin/users itself is admin-gated (403 for non-admins) — reused
  // here purely to decide whether to show the tab, not as an auth check.
  useEffect(() => {
    fetch('/api/admin/users').then(r => { if (r.ok) setIsAdmin(true) }).catch(() => {})
  }, [])

  const items = isAdmin
    ? [...NAV, { href: '/dashboard/empfehlungen', icon: '💬', label: 'Empfehlungen' }, { href: '/dashboard/admin', icon: '🛡️', label: 'Admin' }]
    : NAV

  return (
    <nav style={{
      backgroundColor: '#fff',
      borderBottom: '1px solid #E8E6E0',
      overflowX: 'auto',
      WebkitOverflowScrolling: 'touch',
    }}>
      <div style={{
        maxWidth: '1100px',
        margin: '0 auto',
        padding: '0 20px',
        display: 'flex',
        gap: '2px',
        minWidth: 'max-content',
      }}>
        {/* §243ag Apple-Redesign: aktive Seite als gefüllte iOS-Pill statt
            Unterstrich-Tab */}
        {items.map(({ href, icon, label }) => {
          const active = href === '/dashboard'
            ? path === '/dashboard'
            : path.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                margin: '8px 1px',
                padding: '7px 13px',
                borderRadius: 999,
                fontSize: '13px',
                fontWeight: 600,
                background: active ? 'rgba(174,141,45,0.14)' : 'transparent',
                color: active ? 'var(--gold-dark, #8A7020)' : '#555',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              <span style={{ fontSize: '15px' }}>{icon}</span>
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
