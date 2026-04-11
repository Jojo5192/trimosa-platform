'use client'

import { useState } from 'react'

const ITEMS = [
  { key: 'notif_new_booking',       label: 'Neue Buchungsanfrage',   desc: 'Wenn ein Gast deine Unterkunft bucht oder eine Anfrage sendet.' },
  { key: 'notif_booking_cancelled', label: 'Stornierung',             desc: 'Wenn ein Gast eine Buchung storniert.' },
  { key: 'notif_new_message',       label: 'Neue Nachricht',          desc: 'Wenn ein Gast dir eine Nachricht schickt.' },
  { key: 'notif_payment_received',  label: 'Zahlung eingegangen',     desc: 'Wenn TRIMOSA eine Zahlung für deine Unterkunft erhalten hat.' },
  { key: 'notif_monthly_invoice',   label: 'Monatliche Provisionsrechnung', desc: 'Wenn die monatliche Provisionsabrechnung verfügbar ist.' },
] as const

type Settings = { [K in typeof ITEMS[number]['key']]: boolean }

export default function NotificationSettings({
  email,
  initial,
}: {
  email: string
  initial: Settings
}) {
  const [settings, setSettings] = useState<Settings>(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  function toggle(key: keyof Settings) {
    setSettings(s => ({ ...s, [key]: !s[key] }))
    setSaved(false)
  }

  async function save() {
    setSaving(true)
    await fetch('/api/host/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <div>
      <div style={{ background: '#fff', borderRadius: '20px', border: '1px solid #E8E6E0', overflow: 'hidden', marginBottom: '16px' }}>
        {ITEMS.map(({ key, label, desc }, i) => (
          <label
            key={key}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 20px', cursor: 'pointer',
              borderBottom: i < ITEMS.length - 1 ? '1px solid #F0EDE8' : 'none',
            }}
          >
            <div style={{ flex: 1, paddingRight: '16px' }}>
              <p style={{ fontSize: '14px', fontWeight: 600, color: '#111', margin: '0 0 2px' }}>{label}</p>
              <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>{desc}</p>
            </div>
            {/* Toggle switch */}
            <div
              onClick={() => toggle(key)}
              style={{
                width: '44px', height: '26px', borderRadius: '13px', flexShrink: 0,
                background: settings[key] ? '#A8882A' : '#D1D1D6',
                position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
              }}
            >
              <div style={{
                position: 'absolute', top: '3px',
                left: settings[key] ? '21px' : '3px',
                width: '20px', height: '20px', borderRadius: '50%',
                background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                transition: 'left 0.2s',
              }} />
            </div>
          </label>
        ))}
      </div>

      <button
        onClick={save}
        disabled={saving}
        style={{
          width: '100%', padding: '14px', borderRadius: '14px', border: 'none',
          background: saved ? '#16A34A' : 'linear-gradient(135deg, #C4A235, #8A6818)',
          color: '#fff', fontSize: '14px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
        }}
      >
        {saving ? 'Wird gespeichert…' : saved ? '✓ Gespeichert' : 'Einstellungen speichern'}
      </button>
    </div>
  )
}
