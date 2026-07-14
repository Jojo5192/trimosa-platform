'use client'

import { useEffect, useState } from 'react'
import { supabaseBrowser as supabase } from '@/lib/supabase-browser'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import OAuthButtons from '@/components/OAuthButtons'
import { t, isUiLang, UI_COOKIE, type UiLang } from '@/lib/i18n'

export default function LoginPage() {
  const router = useRouter()
  // Site-wide language (cookie from the NavBar flag switcher)
  const [lang, setLang] = useState<UiLang>('de')
  useEffect(() => {
    const m = document.cookie.match(new RegExp('(?:^|; )' + UI_COOKIE + '=([a-z]{2})'))
    if (m && isUiLang(m[1])) setLang(m[1])
  }, [])
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
      setError(t(lang, 'E-Mail oder Passwort falsch.'))
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
        style={{ background: 'linear-gradient(145deg, var(--gold) 0%, var(--gold-dark) 60%, var(--gold-dark) 100%)' }}>
        <div className="text-center">
          <Image src="/logo.png" alt="TRIMOSA" width={260} height={58}
            className="h-14 w-auto object-contain brightness-0 invert opacity-90 mb-8" />
          <p className="text-white/80 text-lg leading-relaxed max-w-xs">
            {t(lang, 'Auszeiten, die bleiben.')}
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
            {t(lang, 'Willkommen zurück')}
          </h1>
          <p style={{ fontSize: '14px', color: '#6E6E73', marginBottom: '32px' }}>
            {t(lang, 'Melde dich an, um fortzufahren')}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#1D1D1F', marginBottom: '7px' }}>
                {t(lang, 'E-Mail')}
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '7px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#1D1D1F' }}>
                  {t(lang, 'Passwort')}
                </label>
                <Link href="/passwort-vergessen" style={{ fontSize: '12.5px', color: 'var(--gold-dark)', fontWeight: 600, textDecoration: 'none' }}>
                  {t(lang, 'Passwort vergessen?')}
                </Link>
              </div>
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
              background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))',
              color: '#fff', fontSize: '15px', fontWeight: 700,
              cursor: loading || !email.trim() || !password ? 'not-allowed' : 'pointer',
              opacity: !email.trim() || !password ? 0.5 : 1,
              boxShadow: '0 4px 16px rgba(168,136,42,0.3)',
              transition: 'opacity 0.15s',
            }}
          >
            {loading ? t(lang, 'Anmeldung läuft…') : t(lang, 'Anmelden')}
          </button>

          <OAuthButtons />

          <p style={{ textAlign: 'center', fontSize: '13px', color: '#6E6E73', marginTop: '24px' }}>
            {t(lang, 'Noch kein Konto?')}{' '}
            <Link href="/register" style={{ color: 'var(--gold)', fontWeight: 700, textDecoration: 'none' }}>
              {t(lang, 'Registrieren')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
