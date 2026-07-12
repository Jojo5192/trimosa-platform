'use client'

import { useState } from 'react'

interface Props {
  bookingConfirmed: boolean
  bookingCancelled: boolean
  newMessage: boolean
  payment: boolean
}

export default function GuestNotificationSettings({ bookingConfirmed, bookingCancelled, newMessage, payment }: Props) {
  const [settings, setSettings] = useState({
    guest_notif_booking_confirmed: bookingConfirmed,
    guest_notif_booking_cancelled: bookingCancelled,
    guest_notif_new_message: newMessage,
    guest_notif_payment: payment,
  })
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  async function toggle(key: keyof typeof settings) {
    const newVal = !settings[key]
    setSettings(s => ({ ...s, [key]: newVal }))
    setSaving(key)
    await fetch('/api/guest/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: newVal }),
    })
    setSaving(null)
    setSaved(key)
    setTimeout(() => setSaved(null), 1500)
  }

  const items = [
    { key: 'guest_notif_booking_confirmed' as const, icon: '✅', label: 'Buchung bestätigt', desc: 'Wenn deine Anfrage oder Buchung bestätigt wird.' },
    { key: 'guest_notif_booking_cancelled' as const, icon: '❌', label: 'Buchung storniert',  desc: 'Wenn eine Buchung storniert wird.' },
    { key: 'guest_notif_new_message' as const,       icon: '💬', label: 'Neue Nachricht',     desc: 'Wenn du eine Nachricht vom Gastgeber erhältst.' },
    { key: 'guest_notif_payment' as const,           icon: '💳', label: 'Zahlung',            desc: 'Bestätigungen zu Zahlungen und Rückerstattungen.' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {items.map(item => {
        const active = settings[item.key]
        return (
          <div key={item.key} style={{ background: '#fff', borderRadius: '16px', padding: '18px 20px', border: '1px solid #E5E5EA', display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ fontSize: '20px', flexShrink: 0 }}>{item.icon}</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '14px', fontWeight: 600, color: '#111', margin: 0 }}>{item.label}</p>
              <p style={{ fontSize: '12px', color: '#888', margin: '2px 0 0' }}>{item.desc}</p>
            </div>
            <button
              onClick={() => toggle(item.key)}
              disabled={saving === item.key}
              style={{
                width: '48px', height: '28px', borderRadius: '14px', border: 'none', cursor: 'pointer',
                background: active ? 'linear-gradient(135deg, var(--gold), var(--gold-dark))' : '#E5E5EA',
                position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                boxShadow: active ? '0 2px 8px rgba(196,162,53,0.3)' : 'none',
              }}
            >
              <div style={{
                position: 'absolute', top: '4px', left: active ? '24px' : '4px',
                width: '20px', height: '20px', borderRadius: '50%', backgroundColor: '#fff',
                boxShadow: '0 1px 4px rgba(0,0,0,0.2)', transition: 'left 0.2s',
              }} />
            </button>
            {saved === item.key && <span style={{ fontSize: '11px', color: '#16A34A', flexShrink: 0 }}>✓</span>}
          </div>
        )
      })}
    </div>
  )
}
