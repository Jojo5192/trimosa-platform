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
                padding: '12px 14px',
                fontSize: '13px',
                fontWeight: active ? 700 : 500,
                color: active ? 'var(--gold)' : '#555',
                textDecoration: 'none',
                borderBottom: active ? '2px solid var(--gold)' : '2px solid transparent',
                whiteSpace: 'nowrap',
                transition: 'color 0.15s',
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
