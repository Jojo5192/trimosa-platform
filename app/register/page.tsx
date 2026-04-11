'use client'

import { useState } from 'react'
import { supabaseBrowser as supabase } from '@/lib/supabase-browser'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'

export default function RegisterPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<'guest' | 'host'>('guest')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleRegister() {
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { name, role } }
    })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/')
    }
  }

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: '#F5F5F7' }}>

      {/* Left Panel */}
      <div className="hidden lg:flex lg:w-1/2 items-center justify-center p-16" style={{ background: 'linear-gradient(145deg, #B0912B 0%, #8A7020 60%, #6B5618 100%)' }}>
        <div className="text-center">
          <Image src="/logo.png" alt="TRIMOSA" width={260} height={58} className="h-14 w-auto object-contain brightness-0 invert opacity-90 mb-8" />
          <p className="text-white/80 text-lg leading-relaxed max-w-xs">
            Tritt unserer wachsenden Community aus Gastgebern und Reisenden bei.
          </p>
        </div>
      </div>

      {/* Right: Form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">

          <div className="lg:hidden mb-8 text-center">
            <Link href="/">
              <Image src="/logo.png" alt="TRIMOSA" width={180} height={40} className="h-9 w-auto object-contain mx-auto" />
            </Link>
          </div>

          <h1 className="text-3xl font-bold tracking-tight mb-1" style={{ color: '#1D1D1F' }}>Konto erstellen</h1>
          <p className="text-sm mb-8" style={{ color: '#6E6E73' }}>Kostenlos und in 30 Sekunden</p>

          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#1D1D1F' }}>Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Max Mustermann"
                className="w-full rounded-xl px-4 py-3 text-sm"
                style={{ border: '1px solid #D2D2D7', color: '#1D1D1F', backgroundColor: '#fff' }} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#1D1D1F' }}>E-Mail</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="deine@email.de"
                className="w-full rounded-xl px-4 py-3 text-sm"
                style={{ border: '1px solid #D2D2D7', color: '#1D1D1F', backgroundColor: '#fff' }} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#1D1D1F' }}>Passwort</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 6 Zeichen"
                className="w-full rounded-xl px-4 py-3 text-sm"
                style={{ border: '1px solid #D2D2D7', color: '#1D1D1F', backgroundColor: '#fff' }} />
            </div>

            {/* Role */}
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: '#1D1D1F' }}>Ich bin…</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: 'guest', emoji: '🧳', title: 'Gast', sub: 'Unterkunft suchen' },
                  { value: 'host',  emoji: '🏠', title: 'Gastgeber', sub: 'Wohnung vermieten' },
                ] as const).map((opt) => (
                  <button key={opt.value} type="button" onClick={() => setRole(opt.value)}
                    className="p-3.5 rounded-xl text-left transition-all"
                    style={{
                      border: role === opt.value ? '2px solid #B0912B' : '1px solid #D2D2D7',
                      backgroundColor: role === opt.value ? '#FAF5E4' : '#fff',
                    }}>
                    <span className="text-xl">{opt.emoji}</span>
                    <p className="font-semibold text-sm mt-1" style={{ color: '#1D1D1F' }}>{opt.title}</p>
                    <p className="text-xs mt-0.5" style={{ color: '#6E6E73' }}>{opt.sub}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-xl px-4 py-3 mb-5 text-sm" style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA', color: '#DC2626' }}>
              {error}
            </div>
          )}

          <button onClick={handleRegister} disabled={loading}
            className="w-full py-3.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50 shadow-sm mb-4"
            style={{ background: 'linear-gradient(135deg, #B0912B, #8A7020)' }}>
            {loading ? 'Wird erstellt…' : 'Konto erstellen'}
          </button>

          <p className="text-center text-sm" style={{ color: '#6E6E73' }}>
            Bereits ein Konto?{' '}
            <Link href="/login" className="font-semibold hover:underline" style={{ color: '#B0912B' }}>Anmelden</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
