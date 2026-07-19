'use client'

/**
 * 🧹 Admin-Karte Reinigung: je Wohnung die verantwortliche Person + die
 * durchschnittliche Reinigungsdauer, dazu globale Regeln (Sonn-/Feiertage
 * möglichst meiden). Speist den Reinigungsplaner im Team-Kalender.
 */
import { useEffect, useState } from 'react'

type Row = { id: string; title: string; cleaning_responsible: string | null; cleaning_minutes: number | null }
type Person = { id: string; name: string; role: string }
type RuleSet = {
  avoidSundays: boolean; avoidHolidays: boolean
  hourlyRate: number; travelFee: number; sundaySurchargePct: number; holidaySurchargePct: number
}
type Settings = RuleSet & { perPerson?: Record<string, RuleSet> }

export default function CleaningCard() {
  const [rows, setRows] = useState<Row[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
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

              {/* 💶 Kosten-Sätze (Basis der Monats-Prognose — nur Admins sehen die Prognose) */}
              <div style={{ marginTop: 8, paddingTop: 12, borderTop: '1px solid #F0EDE6' }}>
                <p style={{ fontSize: 11.5, fontWeight: 700, color: '#8A8578', letterSpacing: '0.05em', margin: '0 0 8px' }}>💶 STANDARD-SÄTZE (gelten, solange keine eigenen Sätze je Kraft hinterlegt sind)</p>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {([
                    ['hourlyRate', 'Stundensatz', '€/h'],
                    ['travelFee', 'Anfahrt', '€ je Einsatz'],
                    ['sundaySurchargePct', 'Sonntags-Zulage', '%'],
                    ['holidaySurchargePct', 'Feiertags-Zulage', '%'],
                  ] as const).map(([key, label, unit]) => (
                    <label key={key} style={{ flex: '1 1 130px', minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#8A8578', marginBottom: 4 }}>{label} ({unit})</span>
                      <input
                        type="number" min={0}
                        defaultValue={settings[key]}
                        onBlur={async (e) => {
                          const v = Number(e.target.value)
                          if (Number.isFinite(v) && v >= 0 && v !== settings[key]) {
                            const next = { ...settings, [key]: v }
                            setSettings(next)
                            await patch({ settings: { [key]: v } })
                          }
                        }}
                        style={{ ...inputStyle, width: '100%' }}
                      />
                    </label>
                  ))}
                </div>
              </div>

              {/* 👤 Abweichende Regeln & Sätze je Reinigungskraft (Vererbung wie
                  beim Checklisten-Editor: ohne eigenen Block gilt der Standard) */}
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #F0EDE6' }}>
                <p style={{ fontSize: 11.5, fontWeight: 700, color: '#8A8578', letterSpacing: '0.05em', margin: '0 0 4px' }}>👤 PRO REINIGUNGSKRAFT (abweichende Regeln & Sätze)</p>
                <p style={{ fontSize: 11.5, color: '#999', margin: '0 0 10px', lineHeight: 1.5 }}>
                  Z. B. Vanessa mit Sonntags-Zulage, ein Reinigungsunternehmen ohne — jede Wohnung
                  rechnet mit den Sätzen ihrer zugeordneten Kraft. Ohne eigenen Block gilt der Standard.
                </p>
                {[...new Set(rows.map((r) => r.cleaning_responsible).filter(Boolean))].map((pid) => {
                  const person = people.find((p) => p.id === pid)
                  const own = settings.perPerson?.[pid as string] ?? null
                  const eff = own ?? settings
                  return (
                    <div key={pid} style={{ marginBottom: 10, padding: '10px 12px', borderRadius: 12, background: own ? '#FDFBF4' : '#FAFAF8', boxShadow: `inset 0 0 0 1px ${own ? '#E8DCB8' : '#EEECE6'}` }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={!!own}
                          onChange={async () => {
                            if (own) {
                              if (!confirm(`Eigene Sätze für ${person?.name ?? 'diese Kraft'} entfernen? Es gilt dann wieder der Standard.`)) return
                              const ok = await patch({ personSettings: { personId: pid, values: null } })
                              if (ok) setSettings((s) => {
                                if (!s) return s
                                const pp = { ...(s.perPerson ?? {}) }; delete pp[pid as string]
                                return { ...s, perPerson: pp }
                              })
                            } else {
                              const copy: RuleSet = {
                                avoidSundays: settings.avoidSundays, avoidHolidays: settings.avoidHolidays,
                                hourlyRate: settings.hourlyRate, travelFee: settings.travelFee,
                                sundaySurchargePct: settings.sundaySurchargePct, holidaySurchargePct: settings.holidaySurchargePct,
                              }
                              const ok = await patch({ personSettings: { personId: pid, values: copy } })
                              if (ok) setSettings((s) => s ? { ...s, perPerson: { ...(s.perPerson ?? {}), [pid as string]: copy } } : s)
                            }
                          }}
                          style={{ width: 16, height: 16, accentColor: 'var(--gold, #AE8D2D)' }}
                        />
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{person?.name ?? '—'}</span>
                        <span style={{ fontSize: 11.5, color: '#999' }}>{own ? 'eigene Regeln & Sätze' : 'nutzt den Standard'}</span>
                      </label>
                      {own && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 8 }}>
                            {([['avoidSundays', 'Sonntage möglichst vermeiden'], ['avoidHolidays', 'Feiertage (RLP) möglichst vermeiden']] as const).map(([key, label]) => (
                              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                                <input
                                  type="checkbox" checked={eff[key]}
                                  onChange={async () => {
                                    const next = { ...own, [key]: !own[key] }
                                    const ok = await patch({ personSettings: { personId: pid, values: next } })
                                    if (ok) setSettings((s) => s ? { ...s, perPerson: { ...(s.perPerson ?? {}), [pid as string]: next } } : s)
                                  }}
                                  style={{ width: 15, height: 15, accentColor: 'var(--gold, #AE8D2D)' }}
                                />
                                <span style={{ fontSize: 12.5, color: '#333' }}>{label}</span>
                              </label>
                            ))}
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {([
                              ['hourlyRate', 'Stundensatz €/h'],
                              ['travelFee', 'Anfahrt €'],
                              ['sundaySurchargePct', 'So-Zulage %'],
                              ['holidaySurchargePct', 'Feiertag %'],
                            ] as const).map(([key, label]) => (
                              <label key={key} style={{ flex: '1 1 110px', minWidth: 0 }}>
                                <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, color: '#8A8578', marginBottom: 3 }}>{label}</span>
                                <input
                                  type="number" min={0} defaultValue={own[key]}
                                  onBlur={async (e) => {
                                    const v = Number(e.target.value)
                                    if (Number.isFinite(v) && v >= 0 && v !== own[key]) {
                                      const next = { ...own, [key]: v }
                                      const ok = await patch({ personSettings: { personId: pid, values: next } })
                                      if (ok) setSettings((s) => s ? { ...s, perPerson: { ...(s.perPerson ?? {}), [pid as string]: next } } : s)
                                    }
                                  }}
                                  style={{ ...inputStyle, width: '100%' }}
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
                {rows.every((r) => !r.cleaning_responsible) && (
                  <p style={{ fontSize: 12, color: '#999', margin: 0 }}>Erst oben Verantwortliche zuordnen — dann erscheinen sie hier.</p>
                )}
              </div>
            </div>
          )}
          {msg && <p style={{ fontSize: 12.5, margin: '10px 0 0', color: msg.startsWith('✓') ? '#15803D' : '#B45309' }}>{msg}</p>}
        </>
      )}
    </div>
  )
}
