'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { supabaseBrowser as supabase } from '@/lib/supabase-browser'
import AvatarCropper from '@/components/AvatarCropper'

const LANGUAGE_OPTIONS = ['Deutsch', 'Englisch', 'Französisch', 'Spanisch', 'Italienisch', 'Niederländisch', 'Polnisch', 'Russisch']

export default function ProfilePage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [location, setLocation] = useState('')
  const [languages, setLanguages] = useState<string[]>([])
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { window.location.href = '/login'; return }
      setUserId(user.id)

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()

      if (profile) {
        setDisplayName(profile.display_name ?? '')
        setBio(profile.bio ?? '')
        setLocation(profile.location ?? '')
        setLanguages(profile.languages ?? [])
        setAvatarUrl(profile.avatar_url ?? null)
      } else {
        setDisplayName(user.user_metadata?.name ?? '')
      }
      setLoading(false)
    }
    load()
  }, [])

  function toggleLanguage(lang: string) {
    setLanguages(prev => prev.includes(lang) ? prev.filter(l => l !== lang) : [...prev, lang])
  }

  async function handleSave() {
    if (!userId) return
    setSaving(true)
    setError('')
    setSaved(false)

    const { error: err } = await supabase
      .from('profiles')
      .upsert({
        id: userId,
        display_name: displayName,
        bio,
        location,
        languages,
        avatar_url: avatarUrl,
      })

    if (err) {
      setError('Speichern fehlgeschlagen: ' + err.message)
    } else {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }
    setSaving(false)
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', borderRadius: '12px', border: '1.5px solid #E0DDD6',
    padding: '10px 14px', fontSize: '13px', color: '#111',
    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
    backgroundColor: '#fff',
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F5F7' }}>
      <div style={{ fontSize: '13px', color: '#888' }}>Wird geladen…</div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F5F5F7' }}>
      <nav style={{ backgroundColor: '#fff', borderBottom: '1px solid #E5E5EA', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href="/">
          <Image src="/logo.png" alt="TRIMOSA" width={2924} height={354} style={{ height: '28px', width: 'auto' }} />
        </Link>
        <Link href="/dashboard" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gold)', textDecoration: 'none' }}>
          ← Dashboard
        </Link>
      </nav>

      <div style={{ maxWidth: '640px', margin: '0 auto', padding: '32px 20px 80px' }}>
        <div style={{ marginBottom: '28px' }}>
          <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 6px' }}>Mein Profil</p>
          <h1 style={{ fontSize: '26px', fontWeight: 700, color: '#111', margin: 0 }}>Gastgeber-Profil</h1>
          <p style={{ fontSize: '13px', color: '#888', margin: '4px 0 0' }}>Dein Profil ist öffentlich sichtbar für Gäste auf deinen Inseraten.</p>
        </div>

        {/* Avatar */}
        <div style={{ background: '#fff', borderRadius: '20px', padding: '24px', border: '1px solid #E8E6E0', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#111', margin: '0 0 16px' }}>Profilfoto</h2>
          <AvatarCropper
            currentUrl={avatarUrl}
            displayName={displayName}
            onUpload={(url) => setAvatarUrl(url)}
          />
        </div>

        {/* Infos */}
        <div style={{ background: '#fff', borderRadius: '20px', padding: '24px', border: '1px solid #E8E6E0', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#111', margin: '0 0 18px' }}>Persönliche Infos</h2>

          <div style={{ marginBottom: '14px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>Anzeigename</label>
            <input style={inputStyle} value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Wie sollen Gäste dich nennen?" />
          </div>

          <div style={{ marginBottom: '14px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>Über mich</label>
            <textarea
              style={{ ...inputStyle, resize: 'vertical', minHeight: '100px' }}
              value={bio}
              onChange={e => setBio(e.target.value)}
              placeholder="Erzähl etwas über dich — warum vermietest du, was machst du gerne, was macht deine Region besonders?"
              rows={4}
            />
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>Wohnort</label>
            <input style={inputStyle} value={location} onChange={e => setLocation(e.target.value)} placeholder="z.B. Trier, Rheinland-Pfalz" />
          </div>
        </div>

        {/* Sprachen */}
        <div style={{ background: '#fff', borderRadius: '20px', padding: '24px', border: '1px solid #E8E6E0', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#111', margin: '0 0 14px' }}>Sprachen</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {LANGUAGE_OPTIONS.map(lang => {
              const active = languages.includes(lang)
              return (
                <button
                  key={lang}
                  type="button"
                  onClick={() => toggleLanguage(lang)}
                  style={{
                    padding: '7px 16px', borderRadius: '999px', fontSize: '13px', fontWeight: active ? 600 : 400,
                    border: `1.5px solid ${active ? 'var(--gold)' : '#E0DDD6'}`,
                    background: active ? '#FDF6E3' : '#fff',
                    color: active ? 'var(--gold-dark)' : '#555',
                    cursor: 'pointer', transition: 'all 0.12s',
                  }}
                >
                  {lang}
                </button>
              )
            })}
          </div>
        </div>

        {error && (
          <div style={{ borderRadius: '12px', padding: '12px 16px', background: '#FEF2F2', border: '1px solid #FECACA', marginBottom: '12px' }}>
            <p style={{ fontSize: '13px', color: '#DC2626', margin: 0 }}>{error}</p>
          </div>
        )}

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            width: '100%', padding: '14px', borderRadius: '14px', border: 'none',
            background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))',
            color: '#fff', fontSize: '14px', fontWeight: 700,
            cursor: saving ? 'not-allowed' : 'pointer',
            boxShadow: '0 4px 20px rgba(168,136,42,0.35)',
          }}
        >
          {saving ? 'Wird gespeichert…' : saved ? '✓ Profil gespeichert' : 'Profil speichern'}
        </button>
      </div>
    </div>
  )
}
