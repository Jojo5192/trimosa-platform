'use client'

import { useState, type CSSProperties } from 'react'

/** 🧹 §231: großer Fertig-Button der NFC-Seite — postet an /api/cleaning/done. */
export default function ConfirmClient({ token, title, slotDate, alreadyAt }: {
  token: string
  title: string
  slotDate: string | null
  alreadyAt: string | null
}) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ status: string; verify?: string } | null>(
    alreadyAt ? { status: 'schon_gemeldet' } : null,
  )

  const fmt = (iso: string) => {
    const [, m, d] = iso.split('-')
    return `${Number(d)}.${Number(m)}.`
  }

  const send = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/cleaning/done', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        cache: 'no-store',
      })
      const j = await r.json().catch(() => ({ status: 'fehler' }))
      setResult(j)
    } catch {
      setResult({ status: 'fehler' })
    } finally {
      setBusy(false)
    }
  }

  const card: CSSProperties = {
    background: '#fff', borderRadius: 20, padding: '26px 22px',
    width: '100%', maxWidth: 380, textAlign: 'center',
    boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
  }

  // ── Ergebnis-Zustände ─────────────────────────────────────────────
  if (result?.status === 'gemeldet') {
    return (
      <div style={card}>
        <p style={{ fontSize: 48, margin: '0 0 8px' }}>✅</p>
        <p style={{ fontSize: 19, fontWeight: 800, color: '#1A1814', margin: '0 0 6px' }}>Danke!</p>
        <p style={{ fontSize: 14.5, color: '#4A463E', lineHeight: 1.5, margin: 0 }}>
          {title} ist als gereinigt gemeldet. Das Team wurde informiert — du kannst diese Seite schließen.
        </p>
      </div>
    )
  }
  if (result?.status === 'schon_gemeldet') {
    return (
      <div style={card}>
        <p style={{ fontSize: 48, margin: '0 0 8px' }}>👍</p>
        <p style={{ fontSize: 19, fontWeight: 800, color: '#1A1814', margin: '0 0 6px' }}>Schon erledigt</p>
        <p style={{ fontSize: 14.5, color: '#4A463E', lineHeight: 1.5, margin: 0 }}>
          Diese Reinigung wurde bereits gemeldet. Alles gut!
        </p>
      </div>
    )
  }
  if (result?.status === 'zeitfenster') {
    return (
      <div style={card}>
        <p style={{ fontSize: 48, margin: '0 0 8px' }}>🌙</p>
        <p style={{ fontSize: 14.5, color: '#4A463E', lineHeight: 1.5, margin: 0 }}>
          Meldungen sind nur zwischen 6 und 20 Uhr möglich. Bitte melde dich beim Team, falls das ein Fehler ist.
        </p>
      </div>
    )
  }
  if (result?.status === 'fehler' || result?.status === 'unbekannt') {
    return (
      <div style={card}>
        <p style={{ fontSize: 48, margin: '0 0 8px' }}>⚠️</p>
        <p style={{ fontSize: 14.5, color: '#4A463E', lineHeight: 1.5, margin: '0 0 14px' }}>
          Das hat leider nicht geklappt. Bitte nochmal versuchen oder das Team anrufen.
        </p>
        <button onClick={send} disabled={busy} style={{
          border: 'none', borderRadius: 12, padding: '12px 22px', fontSize: 15,
          fontWeight: 700, background: '#12222E', color: '#fff', cursor: 'pointer',
        }}>Nochmal versuchen</button>
      </div>
    )
  }

  // ── Kein offener Slot ─────────────────────────────────────────────
  if (!slotDate) {
    return (
      <div style={card}>
        <p style={{ fontSize: 48, margin: '0 0 8px' }}>🛋️</p>
        <p style={{ fontSize: 19, fontWeight: 800, color: '#1A1814', margin: '0 0 6px' }}>{title}</p>
        <p style={{ fontSize: 14.5, color: '#4A463E', lineHeight: 1.5, margin: 0 }}>
          Aktuell ist hier keine Reinigung offen.
        </p>
      </div>
    )
  }

  // ── Bestätigen ────────────────────────────────────────────────────
  return (
    <div style={card}>
      <p style={{ fontSize: 44, margin: '0 0 8px' }}>🧹</p>
      <p style={{ fontSize: 20, fontWeight: 800, color: '#1A1814', margin: '0 0 4px' }}>{title}</p>
      <p style={{ fontSize: 13.5, color: '#8A8578', margin: '0 0 20px' }}>
        Reinigung nach Abreise vom {fmt(slotDate)}
      </p>
      <button onClick={send} disabled={busy} style={{
        width: '100%', border: 'none', borderRadius: 16, padding: '18px 20px',
        fontSize: 17, fontWeight: 800, cursor: 'pointer',
        background: busy ? '#C9B77A' : 'linear-gradient(180deg, var(--gold, #AE8D2D), var(--gold-dark, #8A7020))',
        color: '#fff', boxShadow: '0 6px 18px rgba(174,141,45,0.4)',
      }}>
        {busy ? 'Wird gemeldet…' : '✓ Wohnung ist gereinigt'}
      </button>
      <p style={{ fontSize: 12, color: '#B0AA9C', lineHeight: 1.5, margin: '14px 0 0' }}>
        Bitte erst antippen, wenn die Wohnung komplett fertig ist — das Team und ggf. der anreisende Gast werden sofort informiert.
      </p>
    </div>
  )
}
