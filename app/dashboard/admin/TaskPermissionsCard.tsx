'use client'

/**
 * Admin-Karte „✅ Aufgaben-Rechte": legt je Rolle fest, welche Aufgaben
 * Mitarbeiter/Dienstleister SEHEN (alle vs. nur eigene + selbst angelegte)
 * und ob sie ANLEGEN & ZUTEILEN dürfen. Admins/Gastgeber haben immer alles.
 */
import { useState, useEffect } from 'react'

type RolePerm = { view: 'all' | 'own'; manage: boolean }
type Perms = { staff: RolePerm; provider: RolePerm }

const ROLE_LABELS: Record<keyof Perms, { title: string; hint: string }> = {
  staff: { title: 'Mitarbeiter', hint: 'Team-Mitglieder mit Chat-Zugriff' },
  provider: { title: 'Dienstleister', hint: 'Handwerker, Reinigung, Verwaltung — ohne Chat' },
}

export default function TaskPermissionsCard() {
  const [perms, setPerms] = useState<Perms | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/task-permissions')
      .then((r) => r.json())
      .then((j) => { if (j.permissions) setPerms(j.permissions) })
      .catch(() => {})
  }, [])

  async function save(next: Perms) {
    setPerms(next)
    setSaving(true)
    setMsg(null)
    const res = await fetch('/api/admin/task-permissions', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next),
    })
    const j = await res.json().catch(() => ({}))
    setMsg(res.ok ? 'Gespeichert — wirkt sofort.' : (j.error ?? 'Fehler beim Speichern.'))
    setSaving(false)
  }

  function Toggle({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: string) => void }) {
    return (
      <div style={{ display: 'flex', gap: 4, background: '#F0EEE8', borderRadius: 10, padding: 3 }}>
        {options.map(([v, label]) => (
          <button key={v} type="button" onClick={() => onChange(v)} disabled={saving} style={{
            flex: 1, padding: '7px 10px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 600,
            background: value === v ? '#fff' : 'transparent', color: '#111',
            boxShadow: value === v ? '0 1px 4px rgba(0,0,0,0.12)' : 'none', cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{label}</button>
        ))}
      </div>
    )
  }

  return (
    <div style={{ background: '#fff', borderRadius: 20, border: '1px solid #E8E6E0', padding: 20, marginTop: 32 }}>
      <p style={{ fontSize: 15, fontWeight: 700, color: '#111', margin: '0 0 4px' }}>✅ Aufgaben-Rechte</p>
      <p style={{ fontSize: 12.5, color: '#888', margin: '0 0 16px' }}>
        Admins und Gastgeber sehen und verwalten immer alle Aufgaben. Hier legst du fest, was
        Mitarbeiter und Dienstleister in der Team-App dürfen.
      </p>

      {!perms ? (
        <p style={{ fontSize: 13, color: '#999', margin: 0 }}>Laden…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {(Object.keys(ROLE_LABELS) as (keyof Perms)[]).map((role) => (
            <div key={role} style={{ borderTop: '1px solid #F0EEE8', paddingTop: 14 }}>
              <p style={{ fontSize: 13.5, fontWeight: 700, color: '#111', margin: '0 0 2px' }}>{ROLE_LABELS[role].title}</p>
              <p style={{ fontSize: 11.5, color: '#999', margin: '0 0 10px' }}>{ROLE_LABELS[role].hint}</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', margin: '0 0 5px' }}>Aufgaben sehen</p>
                  <Toggle
                    options={[['own', 'Nur eigene'], ['all', 'Alle']]}
                    value={perms[role].view}
                    onChange={(v) => save({ ...perms, [role]: { ...perms[role], view: v as 'all' | 'own' } })}
                  />
                </div>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', margin: '0 0 5px' }}>Anlegen & Zuteilen</p>
                  <Toggle
                    options={[['nein', 'Nein'], ['ja', 'Ja']]}
                    value={perms[role].manage ? 'ja' : 'nein'}
                    onChange={(v) => save({ ...perms, [role]: { ...perms[role], manage: v === 'ja' } })}
                  />
                </div>
              </div>
            </div>
          ))}
          {msg && <p style={{ fontSize: 12, color: msg.startsWith('Gespeichert') ? '#16A34A' : '#B91C1C', fontWeight: 600, margin: 0 }}>{msg}</p>}
        </div>
      )}
    </div>
  )
}
