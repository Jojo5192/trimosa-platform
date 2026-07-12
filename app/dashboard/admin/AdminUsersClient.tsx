'use client'

import { useState, useEffect, useCallback } from 'react'

type Admin = { id: string; display_name: string | null; email: string }

export default function AdminUsersClient() {
  const [admins, setAdmins] = useState<Admin[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  const loadAdmins = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/users')
    const json = await res.json()
    if (res.ok) setAdmins(json.admins ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { loadAdmins() }, [loadAdmins])

  async function grantAdmin() {
    if (!email.trim()) return
    setSaving(true)
    setMessage(null)
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), is_admin: true }),
    })
    const json = await res.json()
    if (res.ok) {
      setMessage({ type: 'ok', text: `${email.trim()} ist jetzt Admin.` })
      setEmail('')
      loadAdmins()
    } else {
      setMessage({ type: 'error', text: json.error ?? 'Fehler beim Speichern.' })
    }
    setSaving(false)
  }

  async function revokeAdmin(targetEmail: string) {
    setSaving(true)
    setMessage(null)
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: targetEmail, is_admin: false }),
    })
    const json = await res.json()
    if (res.ok) {
      setMessage({ type: 'ok', text: `${targetEmail} ist kein Admin mehr.` })
      loadAdmins()
    } else {
      setMessage({ type: 'error', text: json.error ?? 'Fehler beim Speichern.' })
    }
    setSaving(false)
  }

  return (
    <div>
      <div style={{ background: '#fff', borderRadius: '20px', border: '1px solid #E8E6E0', padding: '20px', marginBottom: '16px' }}>
        <p style={{ fontSize: '14px', fontWeight: 600, color: '#111', margin: '0 0 12px' }}>Admin hinzufügen</p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="name@trimosa.de"
            style={{
              flex: 1, padding: '12px 14px', borderRadius: '12px', border: '1px solid #E0DDD5',
              fontSize: '14px', color: '#111',
            }}
          />
          <button
            onClick={grantAdmin}
            disabled={saving || !email.trim()}
            style={{
              padding: '12px 20px', borderRadius: '12px', border: 'none',
              background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))',
              color: '#fff', fontSize: '14px', fontWeight: 700,
              cursor: saving || !email.trim() ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
            }}
          >
            Zu Admin machen
          </button>
        </div>
        <p style={{ fontSize: '12px', color: '#999', margin: '10px 0 0' }}>
          Die Person muss sich vorher schon einmal auf TRIMOSA registriert haben.
        </p>
        {message && (
          <p style={{ fontSize: '13px', margin: '10px 0 0', color: message.type === 'ok' ? '#16A34A' : '#DC2626' }}>
            {message.text}
          </p>
        )}
      </div>

      <div style={{ background: '#fff', borderRadius: '20px', border: '1px solid #E8E6E0', overflow: 'hidden' }}>
        <p style={{ fontSize: '12px', fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0, padding: '14px 20px 0' }}>
          Aktuelle Admins
        </p>
        {loading ? (
          <p style={{ fontSize: '13px', color: '#888', padding: '16px 20px' }}>Lädt…</p>
        ) : admins.length === 0 ? (
          <p style={{ fontSize: '13px', color: '#888', padding: '16px 20px' }}>Keine Admins gefunden.</p>
        ) : (
          admins.map((a, i) => (
            <div
              key={a.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 20px', borderTop: i > 0 ? '1px solid #F0EDE8' : 'none',
              }}
            >
              <div>
                <p style={{ fontSize: '14px', fontWeight: 600, color: '#111', margin: '0 0 2px' }}>
                  {a.display_name || a.email}
                </p>
                <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>{a.email}</p>
              </div>
              <button
                onClick={() => revokeAdmin(a.email)}
                disabled={saving}
                style={{
                  padding: '8px 14px', borderRadius: '10px', border: '1px solid #E0DDD5',
                  background: '#fff', color: '#DC2626', fontSize: '12px', fontWeight: 600,
                  cursor: saving ? 'not-allowed' : 'pointer',
                }}
              >
                Entfernen
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
