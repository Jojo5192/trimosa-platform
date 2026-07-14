'use client'

import { useState, useEffect } from 'react'
import { supabaseBrowser as supabase } from '@/lib/supabase-browser'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import OAuthButtons from '@/components/OAuthButtons'
import { t, isUiLang, UI_COOKIE, type UiLang } from '@/lib/i18n'

type AccountType = 'person' | 'business'

/* ── Kleine Hilfskomponenten ── */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 12px' }}>
      {children}
    </p>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#1D1D1F', marginBottom: '6px' }}>
        {label}
      </label>
      {children}
      {hint && <p style={{ fontSize: '11px', color: '#999', margin: '5px 0 0', lineHeight: 1.4 }}>{hint}</p>}
    </div>
  )
}

const inp: React.CSSProperties = {
  width: '100%', borderRadius: '10px', border: '1.5px solid #D2D2D7',
  padding: '11px 14px', fontSize: '14px', color: '#1D1D1F',
  backgroundColor: '#fff', outline: 'none', boxSizing: 'border-box',
}

/* ── Hauptkomponente ── */
export default function RegisterPage() {
  const [lang, setLang] = useState<UiLang>('de')
  useEffect(() => {
    const m = document.cookie.match(new RegExp('(?:^|; )' + UI_COOKIE + '=([a-z]{2})'))
    if (m && isUiLang(m[1])) setLang(m[1])
  }, [])
  const router = useRouter()

  const [accountType, setAccountType] = useState<AccountType>('person')
  const [firstName, setFirstName]     = useState('')
  const [lastName, setLastName]       = useState('')
  const [companyName, setCompanyName] = useState('')
  const [vatId, setVatId]             = useState('')
  const [displayName, setDisplayName] = useState('')
  const [street, setStreet]           = useState('')
  const [zip, setZip]                 = useState('')
  const [city, setCity]               = useState('')
  const [country, setCountry]         = useState('Deutschland')
  const [phone, setPhone]             = useState('')
  const [email, setEmail]             = useState('')
  const [password, setPassword]       = useState('')
  const [error, setError]             = useState('')
  const [loading, setLoading]         = useState(false)

  // Anzeigename automatisch vorschlagen wenn Name / Firma eingegeben wird
  useEffect(() => {
    const suggested = accountType === 'business'
      ? companyName.trim()
      : `${firstName.trim()} ${lastName.trim()}`.trim()
    setDisplayName(suggested)
  }, [accountType, firstName, lastName, companyName])

  async function handleRegister() {
    setError('')
    setLoading(true)

    // Client-seitige Validierung
    if (accountType === 'person' && (!firstName.trim() || !lastName.trim())) {
      setError(t(lang, 'Bitte Vor- und Nachname eingeben.')); setLoading(false); return
    }
    if (accountType === 'business' && !companyName.trim()) {
      setError(t(lang, 'Bitte Firmennamen eingeben.')); setLoading(false); return
    }
    if (!street.trim() || !zip.trim() || !city.trim()) {
      setError(t(lang, 'Bitte vollständige Adresse angeben.')); setLoading(false); return
    }
    if (!phone.trim()) {
      setError(t(lang, 'Bitte Telefonnummer angeben.')); setLoading(false); return
    }
    if (!email.trim() || !password) {
      setError(t(lang, 'Bitte E-Mail und Passwort eingeben.')); setLoading(false); return
    }
    if (password.length < 6) {
      setError(t(lang, 'Passwort muss mindestens 6 Zeichen lang sein.')); setLoading(false); return
    }

    // 1. User + Profil anlegen (Server-Route mit Admin-Rechten)
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        password,
        accountType,
        firstName:   accountType === 'person' ? firstName.trim() : undefined,
        lastName:    accountType === 'person' ? lastName.trim()  : undefined,
        companyName: accountType === 'business' ? companyName.trim() : undefined,
        vatId:       accountType === 'business' ? vatId.trim() || undefined : undefined,
        displayName: displayName.trim() || undefined,
        street: street.trim(),
        zip:    zip.trim(),
        city:   city.trim(),
        country: country.trim() || 'Deutschland',
        phone:  phone.trim(),
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      setError(data.error || t(lang, 'Registrierung fehlgeschlagen.'))
      setLoading(false)
      return
    }

    // 2. Direkt einloggen (E-Mail-Bestätigung ist übersprungen)
    const { error: loginErr } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })

    if (loginErr) {
      setError(t(lang, 'Konto erstellt — bitte jetzt anmelden.'))
      router.push('/login')
      return
    }

    router.push('/')
  }

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: '#F5F5F7' }}>

      {/* Left: Deko */}
      <div className="hidden lg:flex lg:w-2/5 items-center justify-center p-16 sticky top-0 h-screen"
        style={{ background: 'linear-gradient(145deg, var(--gold) 0%, var(--gold-dark) 60%, var(--gold-dark) 100%)' }}>
        <div className="text-center">
          <Image src="/logo.png" alt="TRIMOSA" width={240} height={54}
            className="h-12 w-auto object-contain brightness-0 invert opacity-90 mb-8" />
          <p className="text-white/80 text-lg leading-relaxed max-w-xs">{t(lang, 'Auszeiten, die bleiben.')}</p>
          <div style={{ marginTop: '48px', display: 'flex', flexDirection: 'column', gap: '16px', textAlign: 'left' }}>
            {[
              { icon: '🔒', text: 'Daten werden sicher übertragen' },
              { icon: '🏠', text: 'Direkt vom Gastgeber' },
              { icon: '💬', text: 'Persönlicher Kontakt' },
            ].map(i => (
              <div key={i.text} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '18px' }}>{i.icon}</span>
                <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.75)' }}>{i.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right: Form */}
      <div className="flex-1 overflow-y-auto px-6 py-12">
        <div style={{ maxWidth: '480px', margin: '0 auto' }}>

          {/* Mobile logo */}
          <div className="lg:hidden mb-8 text-center">
            <Link href="/"><Image src="/logo.png" alt="TRIMOSA" width={160} height={36} className="h-9 w-auto object-contain mx-auto" /></Link>
          </div>

          <h1 style={{ fontSize: '26px', fontWeight: 800, color: '#1D1D1F', marginBottom: '4px', letterSpacing: '-0.5px' }}>
            {t(lang, 'Konto erstellen')}
          </h1>
          <p style={{ fontSize: '14px', color: '#6E6E73', marginBottom: '32px' }}>
            {t(lang, 'Kostenlos · alle Angaben werden nur einmalig abgefragt')}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>

            {/* ── 1. Kontotyp ── */}
            <div>
              <SectionLabel>{t(lang, 'Kontotyp')}</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {([
                  { value: 'person'   as AccountType, emoji: '👤', title: 'Privatperson', sub: 'Privatkonto' },
                  { value: 'business' as AccountType, emoji: '🏢', title: 'Unternehmen',  sub: 'Firmenkonto' },
                ] as const).map(opt => (
                  <button key={opt.value} type="button" onClick={() => setAccountType(opt.value)}
                    style={{
                      padding: '14px', borderRadius: '12px', textAlign: 'left', cursor: 'pointer',
                      border: accountType === opt.value ? '2px solid var(--gold)' : '1.5px solid #D2D2D7',
                      backgroundColor: accountType === opt.value ? '#FAF5E4' : '#fff',
                      transition: 'all 0.15s',
                    }}>
                    <span style={{ fontSize: '22px' }}>{opt.emoji}</span>
                    <p style={{ fontSize: '13px', fontWeight: 700, color: '#1D1D1F', margin: '6px 0 2px' }}>{opt.title}</p>
                    <p style={{ fontSize: '11px', color: '#6E6E73', margin: 0 }}>{opt.sub}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* ── 2. Name / Firma ── */}
            <div>
              <SectionLabel>{accountType === 'business' ? 'Firmendaten' : 'Persönliche Daten'}</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {accountType === 'person' ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <Field label={`${t(lang, 'Vorname')} *`}>
                      <input style={inp} value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Max" autoComplete="given-name" />
                    </Field>
                    <Field label={`${t(lang, 'Nachname')} *`}>
                      <input style={inp} value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Mustermann" autoComplete="family-name" />
                    </Field>
                  </div>
                ) : (
                  <>
                    <Field label="Firmenname *">
                      <input style={inp} value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Musterfirma GmbH" autoComplete="organization" />
                    </Field>
                    <Field label="USt-ID" hint="Optional — z.B. DE123456789">
                      <input style={inp} value={vatId} onChange={e => setVatId(e.target.value)} placeholder="DE123456789" />
                    </Field>
                  </>
                )}
              </div>
            </div>

            {/* ── 3. Anzeigename ── */}
            <div>
              <SectionLabel>{t(lang, 'Öffentlicher Anzeigename')}</SectionLabel>
              <Field
                label={t(lang, 'Anzeigename')}
                hint="Wird im Chat und bei Bewertungen angezeigt. Dein richtiger Name / deine Firma bleibt intern und wird nur für Buchungen und Rechnungen verwendet."
              >
                <input
                  style={inp}
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder={accountType === 'business' ? 'z.B. Bergblick Apartments' : 'z.B. Max M.'}
                  autoComplete="nickname"
                />
              </Field>
            </div>

            {/* ── 4. Adresse ── */}
            <div>
              <SectionLabel>{t(lang, 'Adresse')}</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <Field label={`${t(lang, 'Straße & Hausnummer')} *`}>
                  <input style={inp} value={street} onChange={e => setStreet(e.target.value)} placeholder="Musterstraße 1" autoComplete="street-address" />
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '10px' }}>
                  <Field label={`${t(lang, 'PLZ')} *`}>
                    <input style={inp} value={zip} onChange={e => setZip(e.target.value)} placeholder="10115" autoComplete="postal-code" />
                  </Field>
                  <Field label={`${t(lang, 'Ort')} *`}>
                    <input style={inp} value={city} onChange={e => setCity(e.target.value)} placeholder="Berlin" autoComplete="address-level2" />
                  </Field>
                </div>
                <Field label={t(lang, 'Land')}>
                  <input style={inp} value={country} onChange={e => setCountry(e.target.value)} placeholder="Deutschland" autoComplete="country-name" />
                </Field>
              </div>
            </div>

            {/* ── 4b. Telefon ── */}
            <div>
              <SectionLabel>{t(lang, 'Kontakt')}</SectionLabel>
              <Field label={`${t(lang, 'Telefon')} *`} hint={t(lang, 'Wird für Buchungen benötigt und an den Gastgeber weitergegeben.')}>
                <input type="tel" style={inp} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+49 170 1234567" autoComplete="tel" />
              </Field>
            </div>

            {/* ── 6. Zugangsdaten ── */}
            <div>
              <SectionLabel>{t(lang, 'Zugangsdaten')}</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <Field label={`${t(lang, 'E-Mail')} *`}>
                  <input type="email" style={inp} value={email} onChange={e => setEmail(e.target.value)} placeholder="deine@email.de" autoComplete="email" />
                </Field>
                <Field label={`${t(lang, 'Passwort')} *`} hint={t(lang, 'Mindestens 6 Zeichen')}>
                  <input type="password" style={inp} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
                </Field>
              </div>
            </div>

            {/* Fehler */}
            {error && (
              <div style={{ borderRadius: '10px', padding: '12px 16px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}>
                <p style={{ fontSize: '13px', color: '#DC2626', margin: 0 }}>{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="button"
              onClick={handleRegister}
              disabled={loading}
              style={{
                width: '100%', padding: '15px', borderRadius: '12px', border: 'none',
                background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))',
                color: '#fff', fontSize: '15px', fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
                boxShadow: '0 4px 20px rgba(168,136,42,0.35)',
              }}
            >
              {loading ? t(lang, 'Konto wird erstellt…') : `${t(lang, 'Konto erstellen')} →`}
            </button>

            <OAuthButtons />

            <p style={{ textAlign: 'center', fontSize: '13px', color: '#6E6E73', marginTop: '-8px', paddingBottom: '16px' }}>
              {t(lang, 'Bereits ein Konto?')}{' '}
              <Link href="/login" style={{ color: 'var(--gold)', fontWeight: 700, textDecoration: 'none' }}>{t(lang, 'Anmelden')}</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
