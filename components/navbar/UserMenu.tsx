'use client'

import Image from 'next/image'
import type { User } from '@supabase/supabase-js'
import MenuItem from './MenuItem'
import { t, type UiLang } from '@/lib/i18n'

/**
 * Avatar button + dropdown menu (extracted from NavBar.tsx).
 * Open state stays in NavBar so the shared backdrop can close it.
 */
export default function UserMenu({ user, isHost, avatarUrl, initials, open, onToggle, onClose, onLogout, lang = 'de' }: {
  user: User
  isHost: boolean
  lang?: UiLang
  avatarUrl: string | null
  initials: string
  open: boolean
  onToggle: () => void
  onClose: () => void
  onLogout: () => void
}) {
  return (
    <div style={{ position: 'relative' }}>
      <button
        className="nav-menu-btn"
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          borderRadius: '999px', padding: '6px 6px 6px 14px',
          border: '1px solid #E0DDD6', backgroundColor: '#fff',
          boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
          cursor: 'pointer', transition: 'box-shadow 0.2s ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.1)' }}
        onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.05)' }}
      >
        <svg className="nav-menu-hamburger" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth={2} strokeLinecap="round">
          <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
        </svg>
        {avatarUrl ? (
          <Image src={avatarUrl} alt="" width={30} height={30} className="nav-avatar" style={{ width: '30px', height: '30px', borderRadius: '50%', objectFit: 'cover' }} />
        ) : (
          <div className="nav-avatar" style={{ width: '30px', height: '30px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '12px', fontWeight: 700 }}>
            {initials}
          </div>
        )}
      </button>

      {open && (
        <div style={{ position: 'absolute', right: 0, top: '52px', width: '240px', background: '#fff', borderRadius: '18px', padding: '6px 0', zIndex: 100, boxShadow: '0 12px 40px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.05)' }}>
          {/* User info */}
          <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid #F2F0EC' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: '#111', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.user_metadata?.name || 'Nutzer'}</p>
            <p style={{ fontSize: '11px', color: '#999', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</p>
          </div>

          {/* Host dashboard links */}
          {isHost && (
            <>
              <div style={{ padding: '8px 18px 4px' }}>
                <p style={{ fontSize: '10px', fontWeight: 700, color: '#BBB', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Gastgeber</p>
              </div>
              {[
                { href: '/dashboard',               icon: '⊞', label: 'Übersicht' },
                { href: '/dashboard/bookings',      icon: '📅', label: 'Buchungen' },
                { href: '/dashboard/chat',          icon: '💬', label: 'Chat' },
                { href: '/dashboard/notifications', icon: '🔔', label: 'Benachrichtigungen' },
              ].map(({ href, icon, label }) => (
                <MenuItem key={href} href={href} onClick={onClose}>
                  <span style={{ marginRight: '8px', fontSize: '13px' }}>{icon}</span>
                  {label}
                </MenuItem>
              ))}
              <div style={{ borderTop: '1px solid #F2F0EC', margin: '4px 0' }} />
            </>
          )}

          {/* Guest links */}
          {!isHost && (
            <>
              <div style={{ padding: '8px 18px 4px' }}>
                <p style={{ fontSize: '10px', fontWeight: 700, color: '#BBB', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>{t(lang, 'Mein Bereich')}</p>
              </div>
              {[
                { href: '/guest',               icon: '🏡', label: t(lang, 'Meine Reisen') },
                { href: '/guest/chat',          icon: '💬', label: t(lang, 'Nachrichten') },
                { href: '/guest/profile',       icon: '👤', label: t(lang, 'Profil bearbeiten') },
              ].map(({ href, icon, label }) => (
                <MenuItem key={href} href={href} onClick={onClose}>
                  <span style={{ marginRight: '8px', fontSize: '13px' }}>{icon}</span>
                  {label}
                </MenuItem>
              ))}
              <div style={{ borderTop: '1px solid #F2F0EC', margin: '4px 0' }} />
            </>
          )}
          {/* Host: profile link */}
          {isHost && (
            <MenuItem href="/dashboard/profile" onClick={onClose}>
              <span style={{ marginRight: '8px' }}>👤</span>
              Profil bearbeiten
            </MenuItem>
          )}

          <MenuItem href="/ueber-uns" onClick={onClose}>
            <span style={{ marginRight: '8px' }}>✨</span>
            {t(lang, 'Über TRIMOSA')}
          </MenuItem>

          <div style={{ borderTop: '1px solid #F2F0EC', marginTop: '4px', paddingTop: '4px' }}>
            <button
              onClick={onLogout}
              style={{ width: '100%', textAlign: 'left', padding: '10px 18px', fontSize: '13px', color: '#666', background: 'none', border: 'none', cursor: 'pointer', borderRadius: '12px' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#F7F5F2' }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
            >
              {t(lang, 'Abmelden')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
