'use client'

import { useState } from 'react'
import { supabaseBrowser as supabase } from '@/lib/supabase-browser'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    if (!email.trim() || !password) return
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    if (error) {
      setError('E-Mail oder Passwort falsch.')
      setLoading(false)
    } else {
      router.push('/')
    }
  }

  const inp: React.CSSProperties = {
    width: '100%', borderRadius: '12px', border: '1.5px solid #D2D2D7',
    padding: '13px 16px', fontSize: '15px', color: '#1D1D1F',
    backgroundColor: '#fff', outline: 'none', boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  }

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: '#F5F5F7' }}>

      {/* Left: Decorative */}
      <div className="hidden lg:flex lg:w-1/2 items-center justify-center p-16"
        style={{ background: 'linear-gradient(145deg, #B0912B 0%, #8A7020 60%, #6B5618 100%)' }}>
        <div className="text-center">
          <Image src="/logo.png" alt="TRIMOSA" width={260} height={58}
            className="h-14 w-auto object-contain brightness-0 invert opacity-90 mb-8" />
          <p className="text-white/80 text-lg leading-relaxed max-w-xs">
            Auszeiten, die bleiben.
          </p>
        </div>
      </div>

      {/* Right: Form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">

          {/* Mobile logo */}
          <div className="lg:hidden mb-8 text-center">
            <Link href="/"><Image src="/logo.png" alt="TRIMOSA" width={180} height={40} className="h-9 w-auto object-contain mx-auto" /></Link>
          </div>

          <h1 style={{ fontSize: '28px', fontWeight: 800, color: '#1D1D1F', marginBottom: '6px', letterSpacing: '-0.5px' }}>
            Willkommen zurück
          </h1>
          <p style={{ fontSize: '14px', color: '#6E6E73', marginBottom: '32px' }}>
            Melde dich an, um fortzufahren
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#1D1D1F', marginBottom: '7px' }}>
                E-Mail
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="deine@email.de"
                style={inp}
                autoFocus
                autoComplete="email"
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#1D1D1F', marginBottom: '7px' }}>
                Passwort
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="••••••••"
                style={inp}
                autoComplete="current-password"
              />
            </div>
          </div>

          {error && (
            <div style={{ borderRadius: '10px', padding: '11px 14px', marginBottom: '16px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}>
              <p style={{ fontSize: '13px', color: '#DC2626', margin: 0 }}>{error}</p>
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={loading || !email.trim() || !password}
            style={{
              width: '100%', padding: '14px', borderRadius: '12px', border: 'none',
              background: 'linear-gradient(135deg, #B0912B, #8A7020)',
              color: '#fff', fontSize: '15px', fontWeight: 700,
              cursor: loading || !email.trim() || !password ? 'not-allowed' : 'pointer',
              opacity: !email.trim() || !password ? 0.5 : 1,
              boxShadow: '0 4px 16px rgba(168,136,42,0.3)',
              transition: 'opacity 0.15s',
            }}
          >
            {loading ? 'Anmeldung läuft…' : 'Anmelden'}
          </button>

          <p style={{ textAlign: 'center', fontSize: '13px', color: '#6E6E73', marginTop: '24px' }}>
            Noch kein Konto?{' '}
            <Link href="/register" style={{ color: '#B0912B', fontWeight: 700, textDecoration: 'none' }}>
              Registrieren
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
