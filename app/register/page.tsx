'use client'

import { useState } from 'react'
import { supabaseBrowser as supabase } from '@/lib/supabase-browser'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
    </svg>
  )
}

function AppleIcon() {
  return (
    <svg width="16" height="18" viewBox="0 0 814 1000" fill="currentColor">
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-43.4-150.3-109.1C27.5 724.4 0 621.5 0 522.1 0 374 79.1 254.4 195 195.7c43.3-21.6 92-32.6 142-32.6 28 0 77.5 6.5 133 28 55.6 21.5 97.5 42.6 121.9 42.6 18.5 0 61.7-21.5 131.4-58.6 38.2-21.2 78.5-31.3 121.9-31.3 139.5 0 252.4 91.2 305.4 233.7zm-222.1-232c-31.3 36.6-83.3 64.7-134.8 64.7-7.7 0-15.4-.9-23.1-2.4C406.3 163.3 382.6 89 382.6 38.5c0-12.8 1.3-26 3.2-38.5C449.6 2.3 522.9 38.7 565.5 82.3 596.8 118.3 622 180.7 622 247.8c0 12.3-1.3 24.8-3.8 37.1-4.5 2.6-9.6 4-14.4 4-45.9 0-108.2-42.9-108.2-181.2V108.9h-89v0z"/>
    </svg>
  )
}

type AccountType = 'person' | 'business'
type Role = 'guest' | 'host'

export default function RegisterPage() {
  const router = useRouter()

  // Step 1: Person/Business
  const [accountType, setAccountType] = useState<AccountType>('person')
  const [companyName, setCompanyName] = useState('')
  const [vatId, setVatId] = useState('')

  // Step 2: Role
  const [role, setRole] = useState<Role>('guest')

  // Email form
  const [showEmail, setShowEmail] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const [error, setError] = useState('')
  const [loading, setLoading] = useState<string | null>(null)

  function getRedirectTo() {
    return `${window.location.origin}/auth/callback?role=${role}&accountType=${accountType}`
  }

  async function handleGoogle() {
    setLoading('google'); setError('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: getRedirectTo(), queryParams: { access_type: 'offline', prompt: 'consent' } },
    })
    if (error) { setError(error.message); setLoading(null) }
  }

  async function handleApple() {
    setLoading('apple'); setError('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: getRedirectTo() },
    })
    if (error) { setError(error.message); setLoading(null) }
  }

  async function handleEmail() {
    setLoading('email'); setError('')
    const { error } = await supabase.auth.signUp({
      email, password,
      options: {
        data: {
          name, role,
          account_type: accountType,
          company_name: accountType === 'business' ? companyName.trim() || null : null,
          vat_id: accountType === 'business' ? vatId.trim() || null : null,
        },
      },
    })
    if (error) { setError(error.message); setLoading(null) }
    else router.push('/')
  }

  const inp: React.CSSProperties = {
    width: '100%', borderRadius: '12px', border: '1px solid #D2D2D7',
    padding: '12px 14px', fontSize: '14px', color: '#1D1D1F',
    backgroundColor: '#fff', boxSizing: 'border-box',
  }

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: '#F5F5F7' }}>

      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 items-center justify-center p-16"
        style={{ background: 'linear-gradient(145deg, #B0912B 0%, #8A7020 60%, #6B5618 100%)' }}>
        <div className="text-center">
          <Image src="/logo.png" alt="TRIMOSA" width={260} height={58}
            className="h-14 w-auto object-contain brightness-0 invert opacity-90 mb-8" />
          <p className="text-white/80 text-lg leading-relaxed max-w-xs">Auszeiten, die bleiben.</p>
        </div>
      </div>

      {/* Right: Form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 overflow-y-auto">
        <div className="w-full max-w-sm">

          <div className="lg:hidden mb-8 text-center">
            <Link href="/"><Image src="/logo.png" alt="TRIMOSA" width={180} height={40} className="h-9 w-auto object-contain mx-auto" /></Link>
          </div>

          <h1 className="text-3xl font-bold tracking-tight mb-1" style={{ color: '#1D1D1F' }}>Konto erstellen</h1>
          <p className="text-sm mb-7" style={{ color: '#6E6E73' }}>Kostenlos · 30 Sekunden</p>

          {/* ── 1. Person oder Unternehmen ── */}
          <div className="mb-5">
            <p className="text-sm font-semibold mb-2" style={{ color: '#1D1D1F' }}>Ich registriere mich als…</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: 'person' as AccountType, emoji: '👤', title: 'Privatperson', sub: 'Privatkonto' },
                { value: 'business' as AccountType, emoji: '🏢', title: 'Unternehmen', sub: 'Firmenkonto' },
              ]).map(opt => (
                <button key={opt.value} type="button" onClick={() => setAccountType(opt.value)}
                  className="p-3.5 rounded-xl text-left transition-all"
                  style={{
                    border: accountType === opt.value ? '2px solid #B0912B' : '1px solid #D2D2D7',
                    backgroundColor: accountType === opt.value ? '#FAF5E4' : '#fff',
                  }}>
                  <span className="text-xl">{opt.emoji}</span>
                  <p className="font-semibold text-sm mt-1" style={{ color: '#1D1D1F' }}>{opt.title}</p>
                  <p className="text-xs mt-0.5" style={{ color: '#6E6E73' }}>{opt.sub}</p>
                </button>
              ))}
            </div>

            {/* Business-specific fields */}
            {accountType === 'business' && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: '#555' }}>Firmenname *</label>
                  <input style={inp} value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Musterfirma GmbH" />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: '#555' }}>
                    USt-ID <span style={{ color: '#999', fontWeight: 400 }}>(optional)</span>
                  </label>
                  <input style={inp} value={vatId} onChange={e => setVatId(e.target.value)} placeholder="DE123456789" />
                </div>
              </div>
            )}
          </div>

          {/* ── 2. Gast oder Gastgeber ── */}
          <div className="mb-6">
            <p className="text-sm font-semibold mb-2" style={{ color: '#1D1D1F' }}>Ich möchte…</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: 'guest' as Role, emoji: '🧳', title: 'Gast', sub: 'Unterkunft suchen' },
                { value: 'host' as Role, emoji: '🏠', title: 'Gastgeber', sub: 'Wohnung vermieten' },
              ]).map(opt => (
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

          {/* ── OAuth ── */}
          <div className="space-y-3 mb-4">
            <button onClick={handleGoogle} disabled={!!loading}
              className="w-full flex items-center justify-center gap-3 py-3.5 rounded-xl text-sm font-medium transition-all hover:bg-gray-50 disabled:opacity-60"
              style={{ border: '1.5px solid #D2D2D7', backgroundColor: '#fff', color: '#1D1D1F' }}>
              <GoogleIcon />
              {loading === 'google' ? 'Weiterleitung…' : 'Mit Google registrieren'}
            </button>
            <button onClick={handleApple} disabled={!!loading}
              className="w-full flex items-center justify-center gap-3 py-3.5 rounded-xl text-sm font-medium transition-all hover:opacity-90 disabled:opacity-60"
              style={{ backgroundColor: '#000', color: '#fff' }}>
              <AppleIcon />
              {loading === 'apple' ? 'Weiterleitung…' : 'Mit Apple registrieren'}
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px" style={{ backgroundColor: '#D2D2D7' }} />
            <span className="text-xs font-medium" style={{ color: '#6E6E73' }}>oder</span>
            <div className="flex-1 h-px" style={{ backgroundColor: '#D2D2D7' }} />
          </div>

          {/* Email */}
          {!showEmail ? (
            <button onClick={() => setShowEmail(true)}
              className="w-full py-3.5 rounded-xl text-sm font-medium transition-all hover:bg-gray-50"
              style={{ border: '1.5px solid #D2D2D7', backgroundColor: '#fff', color: '#1D1D1F' }}>
              Mit E-Mail registrieren
            </button>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: '#1D1D1F' }}>Name</label>
                <input type="text" style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="Max Mustermann" autoFocus />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: '#1D1D1F' }}>E-Mail</label>
                <input type="email" style={inp} value={email} onChange={e => setEmail(e.target.value)} placeholder="deine@email.de" />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: '#1D1D1F' }}>Passwort</label>
                <input type="password" style={inp} value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 6 Zeichen" />
              </div>

              {error && (
                <div className="rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA', color: '#DC2626' }}>{error}</div>
              )}

              <button onClick={handleEmail} disabled={!!loading}
                className="w-full py-3.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50 shadow-sm"
                style={{ background: 'linear-gradient(135deg, #B0912B, #8A7020)' }}>
                {loading === 'email' ? 'Wird erstellt…' : 'Konto erstellen'}
              </button>
            </div>
          )}

          {error && !showEmail && (
            <div className="rounded-xl px-4 py-3 mt-3 text-sm" style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA', color: '#DC2626' }}>{error}</div>
          )}

          <p className="text-center text-sm mt-6" style={{ color: '#6E6E73' }}>
            Bereits ein Konto?{' '}
            <Link href="/login" className="font-semibold hover:underline" style={{ color: '#B0912B' }}>Anmelden</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
