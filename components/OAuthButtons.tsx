'use client'

/**
 * "Weiter mit Google / Apple" buttons for the login and register pages.
 *
 * Only renders providers listed in NEXT_PUBLIC_OAUTH_PROVIDERS (comma-
 * separated, e.g. "google,apple") — the flag stays unset until the provider
 * is actually configured in Supabase (Dashboard → Auth → Providers), so no
 * broken buttons ever ship. Renders nothing (incl. the divider) when empty.
 */
import { useState, type ReactNode } from 'react'
import { supabaseBrowser as supabase } from '@/lib/supabase-browser'

const ENABLED = (process.env.NEXT_PUBLIC_OAUTH_PROVIDERS ?? '')
  .split(',')
  .map((p) => p.trim().toLowerCase())
  .filter(Boolean)

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
)

const AppleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 384 512" aria-hidden="true">
    <path fill="currentColor" d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
  </svg>
)

const PROVIDERS: Record<string, { label: string; icon: () => ReactNode; bg: string; color: string; border: string }> = {
  google: { label: 'Weiter mit Google', icon: GoogleIcon, bg: '#fff', color: '#1D1D1F', border: '1.5px solid #D2D2D7' },
  apple:  { label: 'Weiter mit Apple',  icon: AppleIcon,  bg: '#000', color: '#fff',    border: '1.5px solid #000' },
}

export default function OAuthButtons() {
  const [busy, setBusy] = useState<string | null>(null)
  const providers = ENABLED.filter((p) => p in PROVIDERS)
  if (providers.length === 0) return null

  async function signIn(provider: string) {
    setBusy(provider)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: provider as 'google' | 'apple',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/` },
    })
    // On success the browser navigates away; only reset on error
    if (error) setBusy(null)
  }

  return (
    <div style={{ marginTop: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '0 0 16px' }}>
        <span style={{ flex: 1, height: '1px', background: '#E5E5EA' }} />
        <span style={{ fontSize: '12px', color: '#8E8E93', fontWeight: 600 }}>oder</span>
        <span style={{ flex: 1, height: '1px', background: '#E5E5EA' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {providers.map((p) => {
          const meta = PROVIDERS[p]
          const Icon = meta.icon
          return (
            <button
              key={p}
              type="button"
              onClick={() => signIn(p)}
              disabled={busy !== null}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                width: '100%', padding: '13px', borderRadius: '12px',
                border: meta.border, background: meta.bg, color: meta.color,
                fontSize: '14.5px', fontWeight: 600,
                cursor: busy !== null ? 'not-allowed' : 'pointer',
                opacity: busy !== null && busy !== p ? 0.5 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              <Icon />
              {busy === p ? 'Weiterleitung…' : meta.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
