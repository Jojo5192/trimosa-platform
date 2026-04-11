'use client'

import { useState } from 'react'
import AvatarCropper from '@/components/AvatarCropper'

const LANGUAGE_OPTIONS = ['Deutsch', 'Englisch', 'Französisch', 'Spanisch', 'Italienisch', 'Niederländisch', 'Polnisch', 'Russisch']

interface Props {
  initialName: string
  initialBio: string
  initialLocation: string
  initialLanguages: string[]
  initialAvatarUrl: string | null
  accountType?: 'person' | 'business'
  initialFirstName?: string
  initialLastName?: string
  initialCompanyName?: string
  initialVatId?: string
  initialStreet?: string
  initialCity?: string
  initialZip?: string
  initialCountry?: string
}

export default function GuestProfileClient({ initialName, initialBio, initialLocation, initialLanguages, initialAvatarUrl, accountType = 'person', initialFirstName = '', initialLastName = '', initialCompanyName = '', initialVatId = '', initialStreet = '', initialCity = '', initialZip = '', initialCountry = 'Deutschland' }: Props) {
  const [displayName, setDisplayName] = useState(initialName)
  const [bio, setBio] = useState(initialBio)
  const [location, setLocation] = useState(initialLocation)
  const [languages, setLanguages] = useState<string[]>(initialLanguages)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl)
  const [firstName, setFirstName] = useState(initialFirstName)
  const [lastName, setLastName] = useState(initialLastName)
  const [companyName, setCompanyName] = useState(initialCompanyName)
  const [vatId, setVatId] = useState(initialVatId)
  const [street, setStreet] = useState(initialStreet)
  const [city, setCity] = useState(initialCity)
  const [zip, setZip] = useState(initialZip)
  const [country, setCountry] = useState(initialCountry)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  function toggleLanguage(lang: string) {
    setLanguages(prev => prev.includes(lang) ? prev.filter(l => l !== lang) : [...prev, lang])
  }

  async function handleSave() {
    setSaving(true)
    setError('')

    const resolvedDisplay = displayName ||
      (accountType === 'business' ? companyName : `${firstName} ${lastName}`.trim())

    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: resolvedDisplay,
          bio,
          location,
          languages,
          avatar_url: avatarUrl,
          account_type: accountType,
          // Person
          guest_first_name: accountType === 'person' ? firstName : null,
          guest_last_name:  accountType === 'person' ? lastName  : null,
          // Business
          company_name: accountType === 'business' ? companyName : null,
          vat_id:       accountType === 'business' ? (vatId || null) : null,
          // Address (shared)
          guest_street: street,
          guest_city:   city,
          guest_zip:    zip,
          guest_country: country,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError('Speichern fehlgeschlagen: ' + (json.error ?? res.statusText))
      } else {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } catch (err: unknown) {
      setError('Netzwerkfehler: ' + (err instanceof Error ? err.message : String(err)))
    }
    setSaving(false)
  }

  async function handleDeleteAccount() {
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await fetch('/api/account', { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Fehler beim Löschen')
      }
      // Account deleted — redirect to home
      window.location.href = '/'
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Unbekannter Fehler')
      setDeleting(false)
    }
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

      {/* Required fields: name + address */}
      <div style={{ background: '#fff', borderRadius: '20px', padding: '24px', border: '2px solid #C4A235' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#111', margin: 0 }}>Pflichtangaben für Buchungen</h2>
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#92400E', background: '#FFF7ED', padding: '2px 8px', borderRadius: '99px' }}>Erforderlich</span>
        </div>
        <p style={{ fontSize: '12px', color: '#888', margin: '0 0 16px' }}>Diese Angaben werden für Buchungen und Rechnungen benötigt.</p>

        {accountType === 'person' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>Vorname *</label>
              <input style={inputStyle} value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Max" />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>Nachname *</label>
              <input style={inputStyle} value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Mustermann" />
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: '14px' }}>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>Firmenname *</label>
              <input style={inputStyle} value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Musterfirma GmbH" />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>USt-ID <span style={{ fontWeight: 400, color: '#AAA' }}>(optional)</span></label>
              <input style={inputStyle} value={vatId} onChange={e => setVatId(e.target.value)} placeholder="DE123456789" />
            </div>
          </div>
        )}

        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>Straße und Hausnummer *</label>
          <input style={inputStyle} value={street} onChange={e => setStreet(e.target.value)} placeholder="Musterstraße 1" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '12px', marginBottom: '12px' }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>PLZ *</label>
            <input style={inputStyle} value={zip} onChange={e => setZip(e.target.value)} placeholder="10115" />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>Stadt *</label>
            <input style={inputStyle} value={city} onChange={e => setCity(e.target.value)} placeholder="Berlin" />
          </div>
        </div>

        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>Land</label>
          <input style={inputStyle} value={country} onChange={e => setCountry(e.target.value)} placeholder="Deutschland" />
        </div>
      </div>

      {/* Optional personal info */}
      <div style={{ background: '#fff', borderRadius: '20px', padding: '24px', border: '1px solid #E8E6E0' }}>
        <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#111', margin: '0 0 16px' }}>Weitere Infos (optional)</h2>

        <div style={{ marginBottom: '14px' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>Anzeigename</label>
          <input style={inputStyle} value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder={accountType === 'business' ? companyName || 'Firmenname' : `${firstName} ${lastName}`.trim() || 'Dein Name'} />
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>Über mich</label>
          <textarea
            style={{ ...inputStyle, resize: 'vertical', minHeight: '80px' }}
            value={bio}
            onChange={e => setBio(e.target.value)}
            placeholder="Kurze Vorstellung…"
            rows={3}
          />
        </div>

        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>Wohnort (öffentlich)</label>
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

      {/* Delete account section */}
      <div style={{ background: '#fff', borderRadius: '20px', padding: '24px', border: '1px solid #F5D0D0', marginTop: '8px' }}>
        <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#DC2626', margin: '0 0 8px' }}>Konto löschen</h2>
        <p style={{ fontSize: '13px', color: '#888', margin: '0 0 16px', lineHeight: 1.5 }}>
          Dein Konto und alle zugehörigen Daten werden unwiderruflich gelöscht. Aktive Buchungen können dadurch beeinträchtigt werden.
        </p>

        {!deleteConfirm ? (
          <button
            type="button"
            onClick={() => setDeleteConfirm(true)}
            style={{ padding: '10px 20px', borderRadius: '10px', border: '1.5px solid #DC2626', background: 'transparent', color: '#DC2626', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
          >
            Konto löschen
          </button>
        ) : (
          <div>
            <p style={{ fontSize: '13px', fontWeight: 600, color: '#DC2626', margin: '0 0 12px' }}>
              Bist du sicher? Diese Aktion kann nicht rückgängig gemacht werden.
            </p>
            {deleteError && (
              <div style={{ borderRadius: '10px', padding: '10px 14px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', marginBottom: '12px' }}>
                <p style={{ fontSize: '13px', color: '#DC2626', margin: 0 }}>{deleteError}</p>
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={() => { setDeleteConfirm(false); setDeleteError('') }}
                style={{ flex: 1, padding: '10px', borderRadius: '10px', border: '1.5px solid #D2D2D7', background: '#fff', color: '#555', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={deleting}
                style={{ flex: 1, padding: '10px', borderRadius: '10px', border: 'none', background: '#DC2626', color: '#fff', fontSize: '13px', fontWeight: 700, cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.7 : 1 }}
              >
                {deleting ? 'Wird gelöscht…' : 'Ja, löschen'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
