'use client'

/**
 * Landing page of the password-recovery email link. The link goes through
 * /auth/callback (code → session), so a valid visit arrives here already
 * signed in; without a session we show a friendly "request a new link" hint.
 */
import { useEffect, useState } from 'react'
import { supabaseBrowser as supabase } from '@/lib/supabase-browser'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session)
      setChecking(false)
    })
  }, [])

  async function handleSave() {
    if (password.length < 8) { setError('Das Passwort muss mindestens 8 Zeichen lang sein.'); return }
    if (password !== confirm) { setError('Die Passwörter stimmen nicht überein.'); return }
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) {
      setError(error.message.includes('different from the old')
        ? 'Das neue Passwort darf nicht dem alten entsprechen.'
        : 'Das Passwort konnte nicht gespeichert werden. Bitte fordere einen neuen Link an.')
      return
    }
    setDone(true)
    setTimeout(() => router.push('/'), 2500)
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

          {checking ? (
            <p style={{ fontSize: '14px', color: '#6E6E73' }}>Einen Moment…</p>
          ) : done ? (
            <>
              <div style={{ fontSize: '40px', marginBottom: '14px' }}>✅</div>
              <h1 style={{ fontSize: '26px', fontWeight: 800, color: '#1D1D1F', marginBottom: '10px', letterSpacing: '-0.5px' }}>
                Passwort gespeichert
              </h1>
              <p style={{ fontSize: '14.5px', color: '#6E6E73', lineHeight: 1.65 }}>
                Du bist angemeldet und wirst gleich zur Startseite weitergeleitet.
              </p>
            </>
          ) : !hasSession ? (
            <>
              <div style={{ fontSize: '40px', marginBottom: '14px' }}>⏳</div>
              <h1 style={{ fontSize: '26px', fontWeight: 800, color: '#1D1D1F', marginBottom: '10px', letterSpacing: '-0.5px' }}>
                Link abgelaufen oder ungültig
              </h1>
              <p style={{ fontSize: '14.5px', color: '#6E6E73', lineHeight: 1.65, marginBottom: '28px' }}>
                Der Zurücksetzen-Link ist nicht mehr gültig — er kann nur einmal und nur für
                begrenzte Zeit verwendet werden. Fordere einfach einen neuen an.
              </p>
              <Link href="/passwort-vergessen" style={{
                display: 'inline-block', padding: '13px 28px', borderRadius: '12px',
                background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))',
                color: '#fff', fontSize: '14.5px', fontWeight: 700, textDecoration: 'none',
              }}>Neuen Link anfordern</Link>
            </>
          ) : (
            <>
              <h1 style={{ fontSize: '28px', fontWeight: 800, color: '#1D1D1F', marginBottom: '6px', letterSpacing: '-0.5px' }}>
                Neues Passwort festlegen
              </h1>
              <p style={{ fontSize: '14px', color: '#6E6E73', marginBottom: '32px' }}>
                Mindestens 8 Zeichen — am besten eine Mischung aus Buchstaben, Zahlen und Sonderzeichen.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#1D1D1F', marginBottom: '7px' }}>
                    Neues Passwort
                  </label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••" style={inp} autoFocus autoComplete="new-password" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#1D1D1F', marginBottom: '7px' }}>
                    Passwort wiederholen
                  </label>
                  <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSave()}
                    placeholder="••••••••" style={inp} autoComplete="new-password" />
                </div>
              </div>

              {error && (
                <div style={{ borderRadius: '10px', padding: '11px 14px', marginTop: '14px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}>
                  <p style={{ fontSize: '13px', color: '#DC2626', margin: 0 }}>{error}</p>
                </div>
              )}

              <button
                onClick={handleSave}
                disabled={loading || !password || !confirm}
                style={{
                  width: '100%', padding: '14px', borderRadius: '12px', border: 'none', marginTop: '18px',
                  background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))',
                  color: '#fff', fontSize: '15px', fontWeight: 700,
                  cursor: loading || !password || !confirm ? 'not-allowed' : 'pointer',
                  opacity: !password || !confirm ? 0.5 : 1,
                  boxShadow: '0 4px 16px rgba(168,136,42,0.3)',
                }}
              >
                {loading ? 'Wird gespeichert…' : 'Passwort speichern'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
