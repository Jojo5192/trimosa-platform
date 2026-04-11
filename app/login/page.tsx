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
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('E-Mail oder Passwort falsch.')
      setLoading(false)
    } else {
      router.push('/')
    }
  }

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: '#F5F5F7' }}>

      {/* Left: Decorative Panel */}
      <div className="hidden lg:flex lg:w-1/2 items-center justify-center p-16" style={{ background: 'linear-gradient(145deg, #B0912B 0%, #8A7020 60%, #6B5618 100%)' }}>
        <div className="text-center">
          <div className="mb-8">
            <Image src="/logo.png" alt="TRIMOSA" width={260} height={58} className="h-14 w-auto object-contain brightness-0 invert opacity-90" />
          </div>
          <p className="text-white/80 text-lg leading-relaxed max-w-xs">
            Exklusive Ferienwohnungen in Bayern — direkt vom Gastgeber.
          </p>
        </div>
      </div>

      {/* Right: Form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">

          {/* Mobile logo */}
          <div className="lg:hidden mb-8 text-center">
            <Link href="/">
              <Image src="/logo.png" alt="TRIMOSA" width={180} height={40} className="h-9 w-auto object-contain mx-auto" />
            </Link>
          </div>

          <h1 className="text-3xl font-bold tracking-tight mb-1" style={{ color: '#1D1D1F' }}>Willkommen zurück</h1>
          <p className="text-sm mb-8" style={{ color: '#6E6E73' }}>Melde dich an, um fortzufahren</p>

          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#1D1D1F' }}>E-Mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                placeholder="deine@email.de"
                className="w-full rounded-xl px-4 py-3 text-sm transition-all"
                style={{ border: '1px solid #D2D2D7', color: '#1D1D1F', backgroundColor: '#fff' }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#1D1D1F' }}>Passwort</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                placeholder="••••••••"
                className="w-full rounded-xl px-4 py-3 text-sm transition-all"
                style={{ border: '1px solid #D2D2D7', color: '#1D1D1F', backgroundColor: '#fff' }}
              />
            </div>
          </div>

          {error && (
            <div className="rounded-xl px-4 py-3 mb-5 text-sm" style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA', color: '#DC2626' }}>
              {error}
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full py-3.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50 shadow-sm mb-4"
            style={{ background: 'linear-gradient(135deg, #B0912B, #8A7020)' }}
          >
            {loading ? 'Anmeldung läuft…' : 'Anmelden'}
          </button>

          <p className="text-center text-sm" style={{ color: '#6E6E73' }}>
            Noch kein Konto?{' '}
            <Link href="/register" className="font-semibold hover:underline" style={{ color: '#B0912B' }}>
              Registrieren
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
