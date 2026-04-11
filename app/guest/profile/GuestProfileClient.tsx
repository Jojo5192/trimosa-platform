'use client'

import { useState } from 'react'
import { supabaseBrowser as supabase } from '@/lib/supabase-browser'
import AvatarCropper from '@/components/AvatarCropper'

const LANGUAGE_OPTIONS = ['Deutsch', 'Englisch', 'Französisch', 'Spanisch', 'Italienisch', 'Niederländisch', 'Polnisch', 'Russisch']

interface Props {
  initialName: string
  initialBio: string
  initialLocation: string
  initialLanguages: string[]
  initialAvatarUrl: string | null
}

export default function GuestProfileClient({ initialName, initialBio, initialLocation, initialLanguages, initialAvatarUrl }: Props) {
  const [displayName, setDisplayName] = useState(initialName)
  const [bio, setBio] = useState(initialBio)
  const [location, setLocation] = useState(initialLocation)
  const [languages, setLanguages] = useState<string[]>(initialLanguages)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  function toggleLanguage(lang: string) {
    setLanguages(prev => prev.includes(lang) ? prev.filter(l => l !== lang) : [...prev, lang])
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { error: err } = await supabase.from('profiles').upsert({
      id: user.id,
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Avatar */}
      <div style={{ background: '#fff', borderRadius: '20px', padding: '24px', border: '1px solid #E8E6E0' }}>
        <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#111', margin: '0 0 16px' }}>Profilfoto</h2>
        <AvatarCropper
          currentUrl={avatarUrl}
          displayName={displayName}
          onUpload={(url) => setAvatarUrl(url)}
        />
      </div>

      {/* Personal info */}
      <div style={{ background: '#fff', borderRadius: '20px', padding: '24px', border: '1px solid #E8E6E0' }}>
        <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#111', margin: '0 0 16px' }}>Persönliche Infos</h2>

        <div style={{ marginBottom: '14px' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>Name</label>
          <input style={inputStyle} value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Dein Name" />
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>Über mich (optional)</label>
          <textarea
            style={{ ...inputStyle, resize: 'vertical', minHeight: '80px' }}
            value={bio}
            onChange={e => setBio(e.target.value)}
            placeholder="Kurze Vorstellung…"
            rows={3}
          />
        </div>

        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>Wohnort</label>
          <input style={inputStyle} value={location} onChange={e => setLocation(e.target.value)} placeholder="z.B. Berlin" />
        </div>
      </div>

      {/* Languages */}
      <div style={{ background: '#fff', borderRadius: '20px', padding: '24px', border: '1px solid #E8E6E0' }}>
        <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#111', margin: '0 0 14px' }}>Sprachen</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {LANGUAGE_OPTIONS.map(lang => {
            const active = languages.includes(lang)
            return (
              <button key={lang} type="button" onClick={() => toggleLanguage(lang)}
                style={{ padding: '7px 16px', borderRadius: '999px', fontSize: '13px', fontWeight: active ? 600 : 400, border: `1.5px solid ${active ? '#C4A235' : '#E0DDD6'}`, background: active ? '#FDF6E3' : '#fff', color: active ? '#8A6818' : '#555', cursor: 'pointer' }}>
                {lang}
              </button>
            )
          })}
        </div>
      </div>

      {error && (
        <div style={{ borderRadius: '12px', padding: '12px 16px', background: '#FEF2F2', border: '1px solid #FECACA' }}>
          <p style={{ fontSize: '13px', color: '#DC2626', margin: 0 }}>{error}</p>
        </div>
      )}

      <button type="button" onClick={handleSave} disabled={saving}
        style={{ width: '100%', padding: '14px', borderRadius: '14px', border: 'none', background: 'linear-gradient(135deg, #C4A235, #8A6818)', color: '#fff', fontSize: '14px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', boxShadow: '0 4px 20px rgba(168,136,42,0.35)' }}>
        {saving ? 'Wird gespeichert…' : saved ? '✓ Gespeichert' : 'Profil speichern'}
      </button>
    </div>
  )
}
