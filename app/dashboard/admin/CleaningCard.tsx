'use client'

/**
 * 🧹 Admin-Karte Reinigung: je Wohnung die verantwortliche Person + die
 * durchschnittliche Reinigungsdauer, dazu globale Regeln (Sonn-/Feiertage
 * möglichst meiden). Speist den Reinigungsplaner im Team-Kalender.
 */
import { useEffect, useState } from 'react'

type Row = { id: string; title: string; cleaning_responsible: string | null; cleaning_minutes: number | null }
type Person = { id: string; name: string; role: string }

export default function CleaningCard() {
  const [rows, setRows] = useState<Row[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [settings, setSettings] = useState<{ avoidSundays: boolean; avoidHolidays: boolean } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/cleaning', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setMsg(d.error); return }
        setRows(d.listings ?? [])
        setPeople(d.people ?? [])
        setSettings(d.settings ?? null)
        setLoaded(true)
      })
      .catch(() => setMsg('Laden fehlgeschlagen.'))
  }, [])

  async function patch(body: Record<string, unknown>) {
    setMsg(null)
    const r = await fetch('/api/admin/cleaning', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setMsg(d.error ?? 'Speichern fehlgeschlagen.'); return false }
    setMsg('✓ Gespeichert')
    return true
  }

  const inputStyle = {
    border: '1.5px solid #E0DDD6', borderRadius: 10, padding: '8px 10px',
    fontSize: 13.5, background: '#fff', color: '#111', boxSizing: 'border-box' as const, minWidth: 0,
  }

  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: '22px 22px 20px', marginTop: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111', margin: '0 0 4px' }}>🧹 Reinigung</h2>
      <p style={{ fontSize: 12.5, color: '#888', margin: '0 0 16px', lineHeight: 1.55 }}>
        Verantwortliche Person und Ø-Dauer je Wohnung — die Basis für den Reinigungsplaner
        im Team-Kalender. Reine Reinigungskräfte (Dienstleister-Rolle) sehen im Kalender
        automatisch nur ihre Wohnungen; Team-Mitglieder behalten ihre volle Sicht.
      </p>

      {!loaded ? (
        <p style={{ fontSize: 13, color: msg ? '#B45309' : '#999' }}>{msg ?? 'Lädt…'}</p>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((row) => (
              <div key={row.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ flex: '1 1 130px', minWidth: 0, fontSize: 13.5, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.title}
                </span>
                <select
                  value={row.cleaning_responsible ?? ''}
                  onChange={async (e) => {
                    const v = e.target.value
                    if (await patch({ listingId: row.id, responsibleId: v })) {
                      setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, cleaning_responsible: v || null } : x)))
                    }
                  }}
                  style={{ ...inputStyle, flex: '1 1 170px' }}
                >
                  <option value="">— niemand zugeordnet —</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}
                </select>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                  <input
                    type="number" min={0} max={1440} placeholder="Ø"
                    defaultValue={row.cleaning_minutes ?? ''}
                    onBlur={(e) => {
                      const v = e.target.value === '' ? null : Number(e.target.value)
                      if (v !== row.cleaning_minutes) {
                        patch({ listingId: row.id, minutes: v }).then((ok) => {
                          if (ok) setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, cleaning_minutes: v } : x)))
                        })
                      }
                    }}
                    style={{ ...inputStyle, width: 68, textAlign: 'center' }}
                  />
                  <span style={{ fontSize: 12, color: '#8A8578' }}>Min.</span>
                </span>
              </div>
            ))}
          </div>

          {settings && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #F0EDE6', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {([
                ['avoidSundays', 'Reinigungen an Sonntagen möglichst vermeiden'],
                ['avoidHolidays', 'Reinigungen an Feiertagen (RLP) möglichst vermeiden'],
              ] as const).map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={settings[key]}
                    onChange={async () => {
                      const next = { ...settings, [key]: !settings[key] }
                      setSettings(next)
                      await patch({ settings: { [key]: next[key] } })
                    }}
                    style={{ width: 17, height: 17, accentColor: 'var(--gold, #AE8D2D)' }}
                  />
                  <span style={{ fontSize: 13, color: '#333' }}>{label}</span>
                </label>
              ))}
              <p style={{ fontSize: 11.5, color: '#999', margin: '2px 0 0', lineHeight: 1.5 }}>
                Wirkt als Empfehlung im Planer — bei Wechseltagen (Abreise + Anreise am selben Tag)
                muss natürlich trotzdem am selben Tag gereinigt werden.
              </p>
            </div>
          )}
          {msg && <p style={{ fontSize: 12.5, margin: '10px 0 0', color: msg.startsWith('✓') ? '#15803D' : '#B45309' }}>{msg}</p>}
        </>
      )}
    </div>
  )
}
