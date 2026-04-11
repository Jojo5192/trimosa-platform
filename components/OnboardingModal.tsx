'use client'

import { useState } from 'react'
import { supabaseBrowser as supabase } from '@/lib/supabase-browser'

interface Props {
  userId: string
  userName?: string
  onComplete: () => void
}

/**
 * Post-registration modal shown to guests who haven't filled in their personal data yet.
 * Collects: first name, last name, street, zip, city, country, optional display name.
 * Saves to the profiles table.
 */
export default function OnboardingModal({ userId, userName = '', onComplete }: Props) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [street, setStreet] = useState('')
  const [zip, setZip] = useState('')
  const [city, setCity] = useState('')
  const [country, setCountry] = useState('Deutschland')
  const [displayName, setDisplayName] = useState(userName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const canSave = firstName.trim() && lastName.trim() && street.trim() && zip.trim() && city.trim()

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    setError('')

    const { error: err } = await supabase.from('profiles').upsert({
      id: userId,
      display_name: displayName.trim() || `${firstName.trim()} ${lastName.trim()}`,
      guest_first_name: firstName.trim(),
      guest_last_name: lastName.trim(),
      guest_street: street.trim(),
      guest_zip: zip.trim(),
      guest_city: city.trim(),
      guest_country: country.trim() || 'Deutschland',
    })

    if (err) {
      setError('Speichern fehlgeschlagen: ' + err.message)
      setSaving(false)
    } else {
      onComplete()
    }
  }

  const inp: React.CSSProperties = {
    width: '100%', borderRadius: '12px', border: '1.5px solid #E0DDD6',
    padding: '10px 14px', fontSize: '14px', color: '#111',
    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
    backgroundColor: '#fff',
  }

  return (
    /* Backdrop */
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      backgroundColor: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px',
    }}>
      {/* Modal */}
      <div style={{
        backgroundColor: '#fff', borderRadius: '24px',
        width: '100%', maxWidth: '460px',
        padding: '32px', boxShadow: '0 24px 64px rgba(0,0,0,0.18)',
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: '28px', marginBottom: '8px' }}>👋</div>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#111', margin: '0 0 6px' }}>
            Fast geschafft!
          </h2>
          <p style={{ fontSize: '14px', color: '#666', margin: 0, lineHeight: 1.5 }}>
            Damit Buchungen reibungslos klappen, brauchen wir noch ein paar persönliche Angaben. Diese werden nur für Buchungen verwendet, nicht öffentlich angezeigt.
          </p>
        </div>

        {/* Name */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>
              Vorname <span style={{ color: '#C4A235' }}>*</span>
            </label>
            <input style={inp} value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Max" autoFocus />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>
              Nachname <span style={{ color: '#C4A235' }}>*</span>
            </label>
            <input style={inp} value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Mustermann" />
          </div>
        </div>

        {/* Street */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>
            Straße und Hausnummer <span style={{ color: '#C4A235' }}>*</span>
          </label>
          <input style={inp} value={street} onChange={e => setStreet(e.target.value)} placeholder="Musterstraße 1" />
        </div>

        {/* ZIP + City */}
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '12px', marginBottom: '12px' }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>
              PLZ <span style={{ color: '#C4A235' }}>*</span>
            </label>
            <input style={inp} value={zip} onChange={e => setZip(e.target.value)} placeholder="10115" />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>
              Stadt <span style={{ color: '#C4A235' }}>*</span>
            </label>
            <input style={inp} value={city} onChange={e => setCity(e.target.value)} placeholder="Berlin" />
          </div>
        </div>

        {/* Country */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>Land</label>
          <input style={inp} value={country} onChange={e => setCountry(e.target.value)} placeholder="Deutschland" />
        </div>

        {/* Display name */}
        <div style={{ marginBottom: '20px', padding: '14px', backgroundColor: '#FAF9F6', borderRadius: '12px', border: '1px solid #E8E6E0' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>
            Anzeigename (optional)
          </label>
          <input
            style={{ ...inp, backgroundColor: '#fff' }}
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder={`${firstName} ${lastName}`.trim() || 'Dein Spitzname auf Trimosa'}
          />
          <p style={{ fontSize: '11px', color: '#999', margin: '6px 0 0' }}>
            Dieser Name wird anderen Nutzern auf Trimosa angezeigt.
          </p>
        </div>

        {error && (
          <div style={{ borderRadius: '10px', padding: '10px 14px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', marginBottom: '14px' }}>
            <p style={{ fontSize: '13px', color: '#DC2626', margin: 0 }}>{error}</p>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving || !canSave}
          style={{
            width: '100%', padding: '14px', borderRadius: '14px', border: 'none',
            background: canSave ? 'linear-gradient(135deg, #C4A235, #8A6818)' : '#D2D2D7',
            color: '#fff', fontSize: '15px', fontWeight: 700,
            cursor: saving || !canSave ? 'not-allowed' : 'pointer',
            boxShadow: canSave ? '0 4px 20px rgba(168,136,42,0.35)' : 'none',
            transition: 'all 0.2s',
          }}
        >
          {saving ? 'Wird gespeichert…' : 'Weiter'}
        </button>

        <p style={{ fontSize: '11px', color: '#aaa', textAlign: 'center', marginTop: '12px', marginBottom: 0 }}>
          Diese Angaben kannst du jederzeit in deinem Profil ändern.
        </p>
      </div>
    </div>
  )
}
