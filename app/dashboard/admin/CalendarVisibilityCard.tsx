'use client'

/**
 * 📅 Kalender-Sichten (Pascal §99.4): je Mitarbeiter/Dienstleister festlegen,
 * welche Wohnungen ihr Team-Kalender zeigt (Belegung, Agenda, QS-Termine).
 * Keine Auswahl = alle Wohnungen (Default). Admins/Gastgeber sehen immer alles.
 */
import { useEffect, useState } from 'react'

type Person = { id: string; name: string; role: string }
type Listing = { id: string; title: string }

export default function CalendarVisibilityCard() {
  const [people, setPeople] = useState<Person[]>([])
  const [listings, setListings] = useState<Listing[]>([])
  const [visibility, setVisibility] = useState<Record<string, string[]>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/calendar-visibility', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        setPeople(d.people ?? [])
        setListings(d.listings ?? [])
        setVisibility(d.visibility ?? {})
        setLoaded(true)
      })
      .catch(() => {})
  }, [])

  async function save(userId: string, ids: string[]) {
    setSaving(true)
    setMsg(null)
    try {
      const r = await fetch('/api/admin/calendar-visibility', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, listingIds: ids }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setMsg(d.error ?? 'Speichern fehlgeschlagen.'); return }
      setVisibility(d.visibility ?? {})
      setMsg('✓ Gespeichert')
    } finally { setSaving(false) }
  }

  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: '22px 22px 20px', marginTop: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111', margin: '0 0 4px' }}>📅 Kalender-Sichten</h2>
      <p style={{ fontSize: 12.5, color: '#888', margin: '0 0 14px', lineHeight: 1.55 }}>
        Welche Wohnungen sieht die Person im Team-Kalender (Belegung, Agenda, QS)?
        Keine Auswahl = alle Wohnungen. Admins und Gastgeber sehen immer alles.
      </p>

      {!loaded ? (
        <p style={{ fontSize: 13, color: '#999' }}>Lädt…</p>
      ) : people.length === 0 ? (
        <p style={{ fontSize: 13, color: '#999' }}>Noch keine Mitarbeiter/Dienstleister registriert.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {people.map((p) => {
            const sel = visibility[p.id] ?? []
            const isOpen = open === p.id
            return (
              <div key={p.id} style={{ border: '1px solid #EDEAE2', borderRadius: 12, overflow: 'hidden' }}>
                <button onClick={() => setOpen(isOpen ? null : p.id)} style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px',
                  background: '#FCFBF9', border: 'none', cursor: 'pointer', textAlign: 'left',
                }}>
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: '#111' }}>
                    {p.name} <span style={{ fontWeight: 500, color: '#A8A292', fontSize: 11.5 }}>· {p.role}</span>
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: sel.length ? '#8A7020' : '#16A34A' }}>
                    {sel.length ? `${sel.length} Wohnung${sel.length === 1 ? '' : 'en'}` : 'Alle Wohnungen'}
                  </span>
                  <span style={{ color: '#C7C7CC' }}>{isOpen ? '▴' : '▾'}</span>
                </button>
                {isOpen && (
                  <div style={{ padding: '10px 14px', borderTop: '1px solid #F0EDE6' }}>
                    {listings.map((l) => (
                      <label key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 2px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={sel.length === 0 || sel.includes(l.id)}
                          disabled={saving}
                          onChange={() => {
                            // sel=[] heißt „alle" — der erste Abwahl-Klick startet
                            // eine explizite Auswahl (alle außer dieser Wohnung)
                            const current = sel.length === 0 ? listings.map((x) => x.id) : sel
                            const next = current.includes(l.id)
                              ? current.filter((x) => x !== l.id)
                              : [...current, l.id]
                            // Voll-Auswahl wieder als „alle" speichern (robust bei neuen Wohnungen)
                            save(p.id, next.length === listings.length ? [] : next)
                          }}
                          style={{ width: 16, height: 16, accentColor: 'var(--gold, #AE8D2D)' }}
                        />
                        <span style={{ fontSize: 13, color: '#333' }}>{l.title}</span>
                      </label>
                    ))}
                    <button onClick={() => save(p.id, [])} disabled={saving || sel.length === 0} style={{
                      marginTop: 8, padding: '6px 13px', borderRadius: 999, border: 'none', fontSize: 12, fontWeight: 700,
                      background: sel.length ? 'rgba(120,120,128,0.12)' : '#F5F5F4',
                      color: sel.length ? '#3C3C43' : '#C0BBB0', cursor: sel.length ? 'pointer' : 'default',
                    }}>Zurück auf „Alle Wohnungen"</button>
                  </div>
                )}
              </div>
            )
          })}
          {msg && <span style={{ fontSize: 12.5, color: msg.startsWith('✓') ? '#15803D' : '#B45309' }}>{msg}</span>}
        </div>
      )}
    </div>
  )
}
