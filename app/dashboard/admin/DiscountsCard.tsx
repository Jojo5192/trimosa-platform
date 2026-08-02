'use client'

/**
 * 🏷 Gutscheincode-Karte (§243af): aktive Rabattcodes für den Buchungsflow
 * der Website (BookingBox — „Gutscheincode einlösen"). Codes werden in
 * app_settings gespeichert und serverseitig in /api/bookings angewendet;
 * der rabattierte Preis läuft automatisch durch Stripe, Rechnung & Smoobu.
 */
import { useEffect, useState } from 'react'

interface DC { code: string; pct: number; aktiv: boolean }

export default function DiscountsCard() {
  const [codes, setCodes] = useState<DC[] | null>(null)
  const [neuCode, setNeuCode] = useState('')
  const [neuPct, setNeuPct] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/discounts', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setCodes(d.codes ?? []))
      .catch(() => setError('Gutscheincodes konnten nicht geladen werden.'))
  }, [])

  async function speichern(next: DC[]) {
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/admin/discounts', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes: next }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      setCodes(j.codes ?? next)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally { setBusy(false) }
  }

  function hinzufuegen() {
    if (!codes) return
    const code = neuCode.trim().toUpperCase().replace(/\s+/g, '')
    const pct = parseFloat(neuPct.replace(',', '.'))
    if (code.length < 3 || !Number.isFinite(pct)) { setError('Code (min. 3 Zeichen) und Rabatt-% angeben.'); return }
    speichern([...codes, { code, pct, aktiv: true }]).then(() => { setNeuCode(''); setNeuPct('') })
  }

  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: '20px 22px', marginTop: 18, boxShadow: '0 1px 8px rgba(0,0,0,0.05)' }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, color: '#12222E', margin: '0 0 4px' }}>🏷 Gutscheincodes (Website-Buchung)</h2>
      <p style={{ fontSize: 12.5, color: '#6B7280', margin: '0 0 14px', lineHeight: 1.55 }}>
        Gäste lösen die Codes in der Buchungsbox ein („Gutscheincode einlösen"). Der Rabatt
        wird serverseitig auf den Gesamtpreis angewendet und läuft automatisch durch
        Zahlung, Rechnung und Smoobu. Deaktivierte Codes bleiben gespeichert, sind aber
        nicht mehr einlösbar.
      </p>

      {error && <p style={{ fontSize: 13, color: '#DC2626', margin: '0 0 10px' }}>{error}</p>}
      {!codes && !error && <p style={{ fontSize: 13, color: '#9CA3AF' }}>Laden…</p>}

      {codes && (
        <>
          {codes.length === 0 && (
            <p style={{ fontSize: 13, color: '#9CA3AF', margin: '0 0 12px' }}>Noch keine Codes angelegt.</p>
          )}
          {codes.map((c, i) => (
            <div key={c.code} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
              borderBottom: '1px solid #F0EEE8', opacity: c.aktiv ? 1 : 0.55,
            }}>
              <span style={{
                fontFamily: 'ui-monospace, monospace', fontSize: 14, fontWeight: 700, color: '#12222E',
                background: '#F7F3E9', borderRadius: 8, padding: '4px 10px', letterSpacing: 0.5,
              }}>{c.code}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#B0912B' }}>−{c.pct} %</span>
              <span style={{ flex: 1 }} />
              <button onClick={() => speichern(codes.map((x, xi) => xi === i ? { ...x, aktiv: !x.aktiv } : x))}
                disabled={busy}
                style={{
                  fontSize: 12.5, fontWeight: 700, borderRadius: 999, border: 'none', cursor: 'pointer',
                  padding: '5px 12px',
                  background: c.aktiv ? 'rgba(36,138,61,0.12)' : 'rgba(118,118,128,0.12)',
                  color: c.aktiv ? '#248A3D' : '#6B7280',
                }}>{c.aktiv ? '✓ aktiv' : 'aus'}</button>
              <button onClick={() => { if (confirm(`Code „${c.code}" löschen?`)) speichern(codes.filter((_, xi) => xi !== i)) }}
                disabled={busy}
                style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: 15, padding: 4 }}>✕</button>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <input value={neuCode} onChange={(e) => setNeuCode(e.target.value.toUpperCase())}
              placeholder="CODE (z. B. MGZ5)" autoCapitalize="characters" spellCheck={false}
              style={{ flex: '2 1 160px', minWidth: 0, borderRadius: 10, border: '1.5px solid #E0DDD6', padding: '9px 12px', fontSize: 14, textTransform: 'uppercase' }} />
            <input value={neuPct} onChange={(e) => setNeuPct(e.target.value)} inputMode="decimal"
              placeholder="Rabatt %" style={{ flex: '1 1 90px', minWidth: 0, borderRadius: 10, border: '1.5px solid #E0DDD6', padding: '9px 12px', fontSize: 14 }} />
            <button onClick={hinzufuegen} disabled={busy}
              style={{
                borderRadius: 10, border: 'none', background: '#B0912B', color: '#fff',
                fontSize: 13.5, fontWeight: 700, padding: '9px 16px', cursor: 'pointer',
                opacity: busy ? 0.55 : 1, whiteSpace: 'nowrap',
              }}>+ Anlegen</button>
          </div>
        </>
      )}
    </div>
  )
}
