'use client'

/**
 * 🔑 Admin-Karte Türcodes: je Wohnung die zugeordneten Nuki-Schlösser
 * (Checkboxen aus der live geladenen Schloss-Liste) + optionaler
 * Service-PIN (Reinigung/Handwerker, erscheint im Team-Kalender) +
 * globale Einstellung, wie viele Tage vor Anreise der Gast-Code in der
 * Gästemappe erscheint. Speist die Türcode-Automatik (§132).
 */
import { useEffect, useState } from 'react'

type LockRef = { provider: 'nuki' | 'tedee'; id: string; label: string }
type Row = { id: string; title: string; locks: LockRef[] | null }
type NukiLock = { id: string; name: string }

export default function LocksCard() {
  const [rows, setRows] = useState<Row[]>([])
  const [nuki, setNuki] = useState<NukiLock[] | null>(null)
  const [nukiError, setNukiError] = useState<string | null>(null)
  const [pins, setPins] = useState<Record<string, string>>({})
  const [revealDays, setRevealDays] = useState(3)
  const [validFromHour, setValidFromHour] = useState(0)
  const [validUntilHour, setValidUntilHour] = useState(24)
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!open || loaded) return
    fetch('/api/admin/locks', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setMsg(d.error); return }
        setRows(d.listings ?? [])
        setNuki(d.nuki)
        setNukiError(d.nukiError ?? null)
        setPins(d.servicePins ?? {})
        setRevealDays(d.revealDays ?? 3)
        setValidFromHour(d.validFromHour ?? 0)
        setValidUntilHour(d.validUntilHour ?? 24)
        setLoaded(true)
      })
      .catch(() => setMsg('Laden fehlgeschlagen.'))
  }, [open, loaded])

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setMsg(null)
    const r = await fetch('/api/admin/locks', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setMsg(d.error ?? 'Speichern fehlgeschlagen.'); return false }
    setMsg('✓ Gespeichert')
    return true
  }

  function toggleLock(row: Row, lock: NukiLock) {
    const cur = (row.locks ?? []).filter((l) => l.provider === 'nuki')
    const has = cur.some((l) => l.id === lock.id)
    const next: LockRef[] = has
      ? (row.locks ?? []).filter((l) => !(l.provider === 'nuki' && l.id === lock.id))
      : [...(row.locks ?? []), { provider: 'nuki', id: lock.id, label: lock.name }]
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, locks: next } : r)))
    patch({ listingId: row.id, locks: next })
  }

  const inputStyle = {
    border: '1.5px solid #E0DDD6', borderRadius: 10, padding: '8px 10px',
    fontSize: 13.5, background: '#fff', color: '#111', boxSizing: 'border-box' as const, minWidth: 0,
  }

  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: '22px 22px 20px', marginTop: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', border: 'none', background: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
      >
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111', margin: '0 0 4px' }}>🔑 Türcodes (Nuki)</h2>
          <p style={{ fontSize: 12.5, color: '#888', margin: 0, lineHeight: 1.55 }}>
            Schlösser je Wohnung zuordnen — Gäste-Codes entstehen dann automatisch je Buchung
            (Gästemappe), Service-PINs erscheinen im Team-Kalender.
          </p>
        </div>
        <span style={{ fontSize: 13, color: '#999', flexShrink: 0, marginLeft: 12 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ marginTop: 16 }}>
          {msg && (
            <div style={{ fontSize: 12.5, color: msg.startsWith('✓') ? '#2C8C46' : '#C0392B', marginBottom: 10 }}>{msg}</div>
          )}
          {nukiError && (
            <div style={{ padding: '10px 12px', borderRadius: 10, background: '#FDF3E7', border: '1px solid #EAD9B8', fontSize: 12.5, color: '#8A6216', lineHeight: 1.5, marginBottom: 14 }}>
              ⚠️ {nukiError}
            </div>
          )}

          {loaded && (
            <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <label style={{ fontSize: 12.5, color: '#555', fontWeight: 600 }}>
                  Gast-Code in der Mappe sichtbar ab
                </label>
                <input
                  type="number" min={0} max={30} defaultValue={revealDays}
                  onBlur={(e) => {
                    const v = Number(e.target.value)
                    if (Number.isFinite(v) && v !== revealDays) { setRevealDays(v); patch({ settings: { revealDays: v } }) }
                  }}
                  style={{ ...inputStyle, width: 64 }}
                />
                <span style={{ fontSize: 12.5, color: '#555' }}>Tagen vor Anreise</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <label style={{ fontSize: 12.5, color: '#555', fontWeight: 600 }}>
                  Code funktioniert am Anreisetag ab
                </label>
                <input
                  type="number" min={0} max={23} defaultValue={validFromHour}
                  onBlur={(e) => {
                    const v = Number(e.target.value)
                    if (Number.isFinite(v) && v !== validFromHour) { setValidFromHour(v); patch({ settings: { validFromHour: v } }) }
                  }}
                  style={{ ...inputStyle, width: 64 }}
                />
                <span style={{ fontSize: 12.5, color: '#555' }}>Uhr — bis am Abreisetag</span>
                <input
                  type="number" min={1} max={24} defaultValue={validUntilHour}
                  onBlur={(e) => {
                    const v = Number(e.target.value)
                    if (Number.isFinite(v) && v !== validUntilHour) { setValidUntilHour(v); patch({ settings: { validUntilHour: v } }) }
                  }}
                  style={{ ...inputStyle, width: 64 }}
                />
                <span style={{ fontSize: 12.5, color: '#555' }}>Uhr (0 = Mitternacht, 24 = Ende des Tages; gilt für NEUE Codes)</span>
              </div>
            </div>
          )}

          {loaded && rows.map((row) => {
            const assigned = (row.locks ?? []).filter((l) => l.provider === 'nuki')
            return (
              <div key={row.id} style={{ borderTop: '1px solid #F0EDE5', padding: '12px 0' }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: '#222', marginBottom: 8 }}>{row.title}</div>
                {nuki ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                    {nuki.map((l) => {
                      const on = assigned.some((a) => a.id === l.id)
                      return (
                        <button
                          key={l.id}
                          onClick={() => toggleLock(row, l)}
                          style={{
                            padding: '6px 12px', borderRadius: 999, cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
                            border: on ? '1.5px solid var(--gold, #AE8D2D)' : '1.5px solid #E0DDD6',
                            background: on ? 'rgba(174,141,45,0.1)' : '#fff',
                            color: on ? '#8A7020' : '#666',
                          }}
                        >
                          {on ? '✓ ' : ''}{l.name}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  assigned.length > 0 && (
                    <div style={{ fontSize: 12.5, color: '#888', marginBottom: 8 }}>
                      Zugeordnet: {assigned.map((a) => a.label).join(', ')}
                    </div>
                  )
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <label style={{ fontSize: 12, color: '#777' }}>🧹 Service-PIN (Team-Kalender):</label>
                  <input
                    type="text" inputMode="numeric" placeholder="z. B. 4711"
                    defaultValue={pins[row.id] ?? ''}
                    onBlur={(e) => {
                      const v = e.target.value.trim()
                      if (v !== (pins[row.id] ?? '')) {
                        setPins((p) => ({ ...p, [row.id]: v }))
                        patch({ listingId: row.id, servicePin: v })
                      }
                    }}
                    style={{ ...inputStyle, width: 110 }}
                  />
                </div>
              </div>
            )
          })}
          {loaded && (
            <p style={{ fontSize: 11.5, color: '#999', margin: '12px 0 0', lineHeight: 1.55 }}>
              Hinweis: Service-PINs werden hier nur ANGEZEIGT verwaltet — der Code selbst muss
              (einmalig) als dauerhafter Keypad-Code in der Nuki-App angelegt sein. Gäste-Codes
              legt die Automatik selbst an und räumt sie nach Abreise ab.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
