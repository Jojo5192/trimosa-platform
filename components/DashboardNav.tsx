'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '/dashboard',               icon: '⊞',  label: 'Übersicht'    },
  { href: '/dashboard/bookings',      icon: '📅', label: 'Buchungen'    },
  { href: '/dashboard/chat',          icon: '💬', label: 'Chat'         },
  { href: '/dashboard/stats',         icon: '📊', label: 'Statistiken'  },
  { href: '/dashboard/invoices',      icon: '🧾', label: 'Rechnungen'   },
  { href: '/dashboard/notifications', icon: '🔔', label: 'Nachrichten'  },
  { href: '/dashboard/setup',         icon: '⚙️', label: 'Einrichtung'  },
]

export default function DashboardNav() {
  const path = usePathname()

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
        {NAV.map(({ href, icon, label }) => {
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
                color: active ? '#A8882A' : '#555',
                textDecoration: 'none',
                borderBottom: active ? '2px solid #A8882A' : '2px solid transparent',
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
