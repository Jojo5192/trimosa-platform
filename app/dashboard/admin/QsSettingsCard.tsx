'use client'

/**
 * 🧾 Admin-Karte Qualitätssicherung: zuständige Person + Intervall festlegen,
 * Planung sofort ausführen (sonst täglicher Cron). Die geplanten Termine
 * selbst erscheinen in der Team-App (Aufgaben-Tab + Kalender).
 */
import { useEffect, useState } from 'react'

type Person = { id: string; name: string }

export default function QsSettingsCard() {
  const [people, setPeople] = useState<Person[]>([])
  const [assigneeId, setAssigneeId] = useState('')
  const [intervalDays, setIntervalDays] = useState(182)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/qs-settings', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        setPeople(d.people ?? [])
        setAssigneeId(d.settings?.assigneeId ?? '')
        setIntervalDays(d.settings?.intervalDays ?? 182)
        setLoaded(true)
      })
      .catch(() => {})
  }, [])

  async function save(next: { assigneeId?: string; intervalDays?: number }) {
    setSaving(true)
    setMsg(null)
    try {
      const r = await fetch('/api/admin/qs-settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      if (!r.ok) { const d = await r.json().catch(() => ({})); setMsg(d.error ?? 'Speichern fehlgeschlagen.') }
      else setMsg('✓ Gespeichert')
    } finally { setSaving(false) }
  }

  async function runNow() {
    setRunning(true)
    setMsg(null)
    try {
      const r = await fetch('/api/admin/qs-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run' }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) setMsg(d.error ?? 'Planung fehlgeschlagen.')
      else if (d.note) setMsg(`⚠️ ${d.note}`)
      else setMsg(`✓ ${d.created} Termin${d.created === 1 ? '' : 'e'} geplant, ${d.skipped} Wohnungen aktuell (offener Termin oder noch nicht fällig).`)
    } finally { setRunning(false) }
  }

  const selectStyle = {
    width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' as const,
    border: '1.5px solid #E0DDD6', borderRadius: 12, padding: '10px 12px',
    fontSize: 14, background: '#fff', color: '#111',
  }

  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: '22px 22px 20px', marginTop: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111', margin: '0 0 4px' }}>🧾 Qualitätssicherung</h2>
      <p style={{ fontSize: 12.5, color: '#888', margin: '0 0 16px', lineHeight: 1.55 }}>
        Plant automatisch je Wohnung einen Halbjahres-Check auf einen freien Tag und
        benachrichtigt die zuständige Person per Push. Protokoll &amp; PDF entstehen in
        der Team-App (Aufgaben-Tab).
      </p>

      {!loaded ? (
        <p style={{ fontSize: 13, color: '#999' }}>Lädt…</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ flex: '1 1 220px', minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#8A8578', marginBottom: 5 }}>ZUSTÄNDIGE PERSON</span>
              <select
                value={assigneeId}
                onChange={(e) => { setAssigneeId(e.target.value); save({ assigneeId: e.target.value }) }}
                style={selectStyle}
              >
                <option value="">— nicht gesetzt (keine Auto-Planung) —</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label style={{ flex: '1 1 160px', minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#8A8578', marginBottom: 5 }}>INTERVALL</span>
              <select
                value={intervalDays}
                onChange={(e) => { const v = Number(e.target.value); setIntervalDays(v); save({ intervalDays: v }) }}
                style={selectStyle}
              >
                <option value={91}>Vierteljährlich</option>
                <option value={182}>Halbjährlich</option>
                <option value={365}>Jährlich</option>
              </select>
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
            <button onClick={runNow} disabled={running || saving} style={{
              padding: '9px 18px', borderRadius: 999, border: 'none', fontSize: 13, fontWeight: 700,
              background: running ? '#E5E1D6' : '#0F766E', color: running ? '#999' : '#fff', cursor: 'pointer',
            }}>{running ? 'Plant…' : '▶ Jetzt planen'}</button>
            {msg && <span style={{ fontSize: 12.5, color: msg.startsWith('✓') ? '#15803D' : '#B45309' }}>{msg}</span>}
          </div>
        </>
      )}
    </div>
  )
}
