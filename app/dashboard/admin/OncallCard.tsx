'use client'

/**
 * ☎️ Bereitschafts-Karte (§175): Wer sieht akute Telefon-Meldungen der
 * KI-Assistentin und bekommt die Anruf-Pushes? Mehrfachauswahl; leere
 * Auswahl = das ganze Team (Fallback). Gleiche Steuerung existiert für
 * Admins auch in der Team-App unter ⚙️ Mehr.
 */
import { useEffect, useState } from 'react'

interface Person { id: string; name: string; role: string }

export default function OncallCard() {
  const [people, setPeople] = useState<Person[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/oncall', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { setPeople(d.people ?? []); setSelected(d.selected ?? []); setLoaded(true) })
      .catch(() => setError('Bereitschaft konnte nicht geladen werden.'))
  }, [])

  async function toggle(id: string) {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
    setSelected(next)
    const res = await fetch('/api/admin/oncall', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: next }),
    }).catch(() => null)
    if (!res || !res.ok) setError('Speichern fehlgeschlagen — Seite neu laden.')
  }

  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: '20px 22px', marginTop: 18, boxShadow: '0 1px 8px rgba(0,0,0,0.05)' }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, color: '#12222E', margin: '0 0 4px' }}>☎️ Bereitschaft (Telefon-Assistentin)</h2>
      <p style={{ fontSize: 12.5, color: '#6B7280', margin: '0 0 14px', lineHeight: 1.55 }}>
        Ausgewählte Personen sehen akute Anruf-Meldungen ganz oben im Aufgaben-Tab der
        Team-App und bekommen die Anruf-Pushes. <strong>Niemand ausgewählt = das ganze Team.</strong>
      </p>
      {error && <p style={{ fontSize: 12.5, color: '#B91C1C', margin: '0 0 10px' }}>{error}</p>}
      {!loaded && !error && <p style={{ fontSize: 12.5, color: '#9CA3AF', margin: 0 }}>Laden…</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {people.map((p) => {
          const on = selected.includes(p.id)
          return (
            <button key={p.id} onClick={() => toggle(p.id)} style={{
              padding: '8px 14px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 700,
              border: on ? '1px solid transparent' : '1px solid #E0DDD6',
              background: on ? 'linear-gradient(135deg, var(--gold), var(--gold-dark))' : '#fff',
              color: on ? '#fff' : '#3C3C43',
            }}>{on ? '✓ ' : ''}{p.name}<span style={{ fontWeight: 400, opacity: 0.75 }}> · {p.role}</span></button>
          )
        })}
      </div>
    </div>
  )
}
