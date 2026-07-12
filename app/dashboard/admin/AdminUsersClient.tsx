'use client'

import { useState, useEffect, useCallback } from 'react'

type Person = { id: string; display_name: string | null; email: string }
type Msg = { type: 'ok' | 'error'; text: string }

export default function AdminUsersClient() {
  const [admins, setAdmins] = useState<Person[]>([])
  const [hosts, setHosts] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/users')
    const json = await res.json()
    if (res.ok) {
      setAdmins(json.admins ?? [])
      setHosts(json.hosts ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <RoleSection
        flag="is_admin"
        title="Admins"
        addLabel="Zu Admin machen"
        grantedMsg="ist jetzt Admin."
        revokedMsg="ist kein Admin mehr."
        people={admins}
        loading={loading}
        onChanged={load}
      />
      <RoleSection
        flag="is_host"
        title="Gastgeber"
        addLabel="Zu Gastgeber machen"
        grantedMsg="ist jetzt Gastgeber und hat Zugriff auf das Gastgeber-Dashboard."
        revokedMsg="ist kein Gastgeber mehr."
        people={hosts}
        loading={loading}
        onChanged={load}
      />
    </div>
  )
}

function RoleSection({
  flag, title, addLabel, grantedMsg, revokedMsg, people, loading, onChanged,
}: {
  flag: 'is_admin' | 'is_host'
  title: string
  addLabel: string
  grantedMsg: string
  revokedMsg: string
  people: Person[]
  loading: boolean
  onChanged: () => void
}) {
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<Msg | null>(null)

  async function setFlag(targetEmail: string, value: boolean) {
    setSaving(true)
    setMessage(null)
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: targetEmail, [flag]: value }),
    })
    const json = await res.json()
    if (res.ok) {
      setMessage({ type: 'ok', text: `${targetEmail} ${value ? grantedMsg : revokedMsg}` })
      if (value) setEmail('')
      onChanged()
    } else {
      setMessage({ type: 'error', text: json.error ?? 'Fehler beim Speichern.' })
    }
    setSaving(false)
  }

  return (
    <div>
      <div style={{ background: '#fff', borderRadius: '20px', border: '1px solid #E8E6E0', padding: '20px', marginBottom: '16px' }}>
        <p style={{ fontSize: '14px', fontWeight: 600, color: '#111', margin: '0 0 12px' }}>{title} hinzufügen</p>
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
            onClick={() => email.trim() && setFlag(email.trim(), true)}
            disabled={saving || !email.trim()}
            style={{
              padding: '12px 20px', borderRadius: '12px', border: 'none',
              background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))',
              color: '#fff', fontSize: '14px', fontWeight: 700,
              cursor: saving || !email.trim() ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {addLabel}
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
          Aktuelle {title}
        </p>
        {loading ? (
          <p style={{ fontSize: '13px', color: '#888', padding: '16px 20px' }}>Lädt…</p>
        ) : people.length === 0 ? (
          <p style={{ fontSize: '13px', color: '#888', padding: '16px 20px' }}>Keine {title} gefunden.</p>
        ) : (
          people.map((p, i) => (
            <div
              key={p.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 20px', borderTop: i > 0 ? '1px solid #F0EDE8' : 'none',
              }}
            >
              <div>
                <p style={{ fontSize: '14px', fontWeight: 600, color: '#111', margin: '0 0 2px' }}>
                  {p.display_name || p.email}
                </p>
                <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>{p.email}</p>
              </div>
              <button
                onClick={() => setFlag(p.email, false)}
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
