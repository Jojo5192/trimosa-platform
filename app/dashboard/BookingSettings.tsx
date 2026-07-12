'use client'

import { useState } from 'react'

interface Props {
  allowInstant: boolean
  allowRequests: boolean
  minRequestNights: number
}

export default function BookingSettings({ allowInstant, allowRequests, minRequestNights }: Props) {
  const [instant, setInstant] = useState(allowInstant)
  const [requests, setRequests] = useState(allowRequests)
  const [minNights, setMinNights] = useState(minRequestNights)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function save() {
    setSaving(true)
    await fetch('/api/host/booking-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        allow_instant_booking: instant,
        allow_requests: requests,
        min_request_nights: minNights,
      }),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
    return (
      <div onClick={() => onChange(!value)} style={{
        width: '44px', height: '26px', borderRadius: '13px', flexShrink: 0,
        background: value ? 'var(--gold)' : '#D1D1D6',
        position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
      }}>
        <div style={{
          position: 'absolute', top: '3px',
          left: value ? '21px' : '3px',
          width: '20px', height: '20px', borderRadius: '50%',
          background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          transition: 'left 0.2s',
        }} />
      </div>
    )
  }

  return (
    <div style={{ background: '#fff', borderRadius: '20px', border: '1px solid #E8E6E0', padding: '20px 24px' }}>
      <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#111', margin: '0 0 16px' }}>Buchungseinstellungen</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
        {/* Instant booking */}
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #F0EDE8', cursor: 'pointer' }}>
          <div>
            <p style={{ fontSize: '13px', fontWeight: 600, color: '#111', margin: '0 0 2px' }}>⚡ Sofortbuchung erlauben</p>
            <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>Gäste können sofort buchen – der Kalender wird direkt gesperrt.</p>
          </div>
          <Toggle value={instant} onChange={setInstant} />
        </label>

        {/* Requests */}
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: requests ? '1px solid #F0EDE8' : 'none', cursor: 'pointer' }}>
          <div>
            <p style={{ fontSize: '13px', fontWeight: 600, color: '#111', margin: '0 0 2px' }}>✉ Anfragen erlauben</p>
            <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>Gäste können Anfragen stellen – du bestätigst manuell.</p>
          </div>
          <Toggle value={requests} onChange={setRequests} />
        </label>

        {/* Min nights for requests */}
        {requests && (
          <div style={{ padding: '12px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: '13px', fontWeight: 600, color: '#111', margin: '0 0 2px' }}>Mindestaufenthalt für Anfragen</p>
              <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>Anfragen erst ab dieser Anzahl Nächte möglich.</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button type="button" onClick={() => setMinNights(n => Math.max(1, n-1))}
                style={{ width: '28px', height: '28px', borderRadius: '50%', border: '1.5px solid #E0DDD6', background: '#fff', cursor: 'pointer', fontSize: '16px' }}>−</button>
              <span style={{ fontSize: '14px', fontWeight: 700, minWidth: '30px', textAlign: 'center' }}>{minNights}</span>
              <button type="button" onClick={() => setMinNights(n => Math.min(30, n+1))}
                style={{ width: '28px', height: '28px', borderRadius: '50%', border: '1.5px solid #E0DDD6', background: '#fff', cursor: 'pointer', fontSize: '16px' }}>+</button>
              <span style={{ fontSize: '12px', color: '#888' }}>Nacht{minNights !== 1 ? 'e' : ''}</span>
            </div>
          </div>
        )}
      </div>

      {!instant && !requests && (
        <div style={{ marginTop: '12px', padding: '10px 14px', background: '#FEF2F2', borderRadius: '10px', border: '1px solid #FECACA' }}>
          <p style={{ fontSize: '12px', color: '#DC2626', margin: 0 }}>
            ⚠️ Weder Sofortbuchung noch Anfragen sind aktiv. Gäste können diese Unterkunft nicht buchen.
          </p>
        </div>
      )}

      <button
        onClick={save}
        disabled={saving}
        style={{
          marginTop: '16px', width: '100%', padding: '12px', borderRadius: '12px', border: 'none',
          background: saved ? '#16A34A' : 'linear-gradient(135deg, var(--gold), var(--gold-dark))',
          color: '#fff', fontSize: '13px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
        }}
      >
        {saving ? 'Wird gespeichert…' : saved ? '✓ Gespeichert' : 'Einstellungen speichern'}
      </button>
    </div>
  )
}
