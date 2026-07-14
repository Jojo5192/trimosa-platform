'use client'

import { useState } from 'react'
import { supabaseBrowser as supabase } from '@/lib/supabase-browser'
import Link from 'next/link'
import Image from 'next/image'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (!email.trim()) return
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/passwort-zuruecksetzen`,
    })
    setLoading(false)
    if (error) {
      // Rate limit is the only error worth surfacing — anything else stays a
      // generic success so the form can't be used to probe registered emails.
      if (error.status === 429) {
        setError('Zu viele Anfragen — bitte warte ein paar Minuten und versuche es erneut.')
        return
      }
    }
    setSent(true)
  }

  const inp: React.CSSProperties = {
    width: '100%', borderRadius: '12px', border: '1.5px solid #D2D2D7',
    padding: '13px 16px', fontSize: '15px', color: '#1D1D1F',
    backgroundColor: '#fff', outline: 'none', boxSizing: 'border-box',
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
            Auszeiten, die bleiben.
          </p>
        </div>
      </div>

      {/* Right: Form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">

          <div className="lg:hidden mb-8 text-center">
            <Link href="/"><Image src="/logo.png" alt="TRIMOSA" width={180} height={40} className="h-9 w-auto object-contain mx-auto" /></Link>
          </div>

          {sent ? (
            <>
              <div style={{ fontSize: '40px', marginBottom: '14px' }}>📬</div>
              <h1 style={{ fontSize: '26px', fontWeight: 800, color: '#1D1D1F', marginBottom: '10px', letterSpacing: '-0.5px' }}>
                Schau in dein Postfach
              </h1>
              <p style={{ fontSize: '14.5px', color: '#6E6E73', lineHeight: 1.65, marginBottom: '8px' }}>
                Falls ein Konto für <strong style={{ color: '#1D1D1F' }}>{email.trim()}</strong> existiert,
                haben wir dir einen Link zum Zurücksetzen deines Passworts geschickt.
              </p>
              <p style={{ fontSize: '13px', color: '#8E8E93', lineHeight: 1.6, marginBottom: '28px' }}>
                Keine E-Mail erhalten? Prüfe den Spam-Ordner — oder versuche es in ein paar Minuten erneut.
              </p>
              <Link href="/login" style={{
                display: 'inline-block', padding: '13px 28px', borderRadius: '12px',
                background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))',
                color: '#fff', fontSize: '14.5px', fontWeight: 700, textDecoration: 'none',
              }}>Zurück zur Anmeldung</Link>
            </>
          ) : (
            <>
              <h1 style={{ fontSize: '28px', fontWeight: 800, color: '#1D1D1F', marginBottom: '6px', letterSpacing: '-0.5px' }}>
                Passwort vergessen?
              </h1>
              <p style={{ fontSize: '14px', color: '#6E6E73', marginBottom: '32px', lineHeight: 1.6 }}>
                Kein Problem. Gib deine E-Mail-Adresse ein und wir schicken dir einen Link,
                mit dem du ein neues Passwort festlegen kannst.
              </p>

              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#1D1D1F', marginBottom: '7px' }}>
                E-Mail
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                placeholder="deine@email.de"
                style={inp}
                autoFocus
                autoComplete="email"
              />

              {error && (
                <div style={{ borderRadius: '10px', padding: '11px 14px', marginTop: '14px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}>
                  <p style={{ fontSize: '13px', color: '#DC2626', margin: 0 }}>{error}</p>
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={loading || !email.trim()}
                style={{
                  width: '100%', padding: '14px', borderRadius: '12px', border: 'none', marginTop: '18px',
                  background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))',
                  color: '#fff', fontSize: '15px', fontWeight: 700,
                  cursor: loading || !email.trim() ? 'not-allowed' : 'pointer',
                  opacity: !email.trim() ? 0.5 : 1,
                  boxShadow: '0 4px 16px rgba(168,136,42,0.3)',
                }}
              >
                {loading ? 'Wird gesendet…' : 'Link anfordern'}
              </button>

              <p style={{ textAlign: 'center', fontSize: '13px', color: '#6E6E73', marginTop: '24px' }}>
                Doch wieder eingefallen?{' '}
                <Link href="/login" style={{ color: 'var(--gold)', fontWeight: 700, textDecoration: 'none' }}>
                  Anmelden
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
