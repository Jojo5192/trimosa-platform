'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * 🧾 BELEG-INBOX (§238): Vollbild-Bereich im Mehr-Tab (NUR Admins/
 * Gastgeber) — Belege aus dem Mail-Scan, die nicht eindeutig der
 * Apartments & Homes zuzuordnen waren. Je Beleg: PDF ansehen, dann
 * entscheiden — → sevdesk (A&H, mit Kostenstelle) · andere Gesellschaft ·
 * verwerfen. Overlay via createPortal (§83); Portal-Root trägt team-shell.
 */

interface Beleg {
  id: string
  mailbox: string | null
  from: string | null
  subject: string | null
  lieferant: string | null
  betrag: number | null
  datum: string | null
  belegnummer: string | null
  kiHinweis: string | null
  links: { name: string; url: string }[]
  erhalten: string
}

const eur = (n: number) => n.toFixed(2).replace('.', ',') + ' €'
const fmtD = (iso: string | null) => {
  if (!iso) return null
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}

export default function BelegePanel({ onClose }: { onClose: () => void }) {
  const [belege, setBelege] = useState<Beleg[]>([])
  const [kostenstellen, setKostenstellen] = useState<string[]>(['Allgemein'])
  const [kst, setKst] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/belege', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      setBelege(j.belege ?? [])
      setKostenstellen(j.kostenstellen ?? ['Allgemein'])
      setErr('')
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const decide = async (id: string, ziel: 'sevdesk' | 'andere' | 'verworfen') => {
    setBusy(id)
    setErr('')
    try {
      const r = await fetch('/api/belege', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ziel, ...(ziel === 'sevdesk' ? { kostenstelle: kst[id] ?? 'Allgemein' } : {}) }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      setBelege((prev) => prev.filter((b) => b.id !== id))
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(null)
    }
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="team-shell" style={{
      position: 'fixed', inset: 0, zIndex: 90, background: '#F2F2F7',
      display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
        background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(14px)',
        boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.15)',
      }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 17, color: '#B0912B', cursor: 'pointer', padding: '4px 6px 4px 0', fontWeight: 600 }}>‹ Zurück</button>
        <div style={{ flex: 1, fontSize: 17, fontWeight: 700, color: '#1A1814' }}>🧾 Beleg-Inbox</div>
        <div style={{ fontSize: 13, color: '#8A8578' }}>{belege.length} offen</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '14px 14px calc(20px + env(safe-area-inset-bottom))' }}>
        <div style={{ fontSize: 12.5, color: '#8A8578', margin: '0 2px 12px', lineHeight: 1.45 }}>
          Belege aus den Postfächern, die nicht eindeutig zuzuordnen waren. „→ sevdesk" lädt sie als
          Beleg-Entwurf zu Apartments & Homes hoch; „Andere Gesellschaft" (UG/GbR) bleibt hier archiviert.
        </div>
        {err && (
          <div style={{ background: '#FEE2E2', color: '#B91C1C', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, marginBottom: 12 }}>
            {err} <button onClick={load} style={{ background: 'none', border: 'none', color: '#B91C1C', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>Erneut laden</button>
          </div>
        )}
        {loading && <div style={{ textAlign: 'center', color: '#8A8578', padding: 30 }}>Laden…</div>}
        {!loading && !belege.length && !err && (
          <div style={{ textAlign: 'center', color: '#8A8578', padding: '48px 20px', fontSize: 15 }}>
            🎉 Keine offenen Belege — alles zugeordnet.
          </div>
        )}
        {belege.map((b) => (
          <div key={b.id} style={{ background: '#fff', borderRadius: 14, padding: '14px 14px 12px', marginBottom: 12, boxShadow: '0 0 0 0.5px rgba(60,60,67,0.1)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 15.5, fontWeight: 700, color: '#1A1814', flex: 1, minWidth: 140 }}>{b.lieferant ?? 'Unbekannt'}</div>
              {b.betrag != null && <div style={{ fontSize: 15.5, fontWeight: 700, color: '#1A1814' }}>{eur(b.betrag)}</div>}
            </div>
            <div style={{ fontSize: 12.5, color: '#8A8578', marginTop: 3 }}>
              {[fmtD(b.datum), b.belegnummer ? `Nr. ${b.belegnummer}` : null, b.mailbox].filter(Boolean).join(' · ')}
            </div>
            {b.subject && <div style={{ fontSize: 13, color: '#6B675E', marginTop: 6 }}>{b.subject}</div>}
            {b.kiHinweis && <div style={{ fontSize: 12.5, color: '#8A8578', fontStyle: 'italic', marginTop: 5 }}>{b.kiHinweis}</div>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 9 }}>
              {b.links.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noreferrer" style={{
                  fontSize: 13, fontWeight: 600, color: '#B0912B', textDecoration: 'none',
                  background: '#FBF7EC', borderRadius: 8, padding: '6px 10px',
                }}>📄 {l.name.slice(0, 40)} ↗</a>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
              <select
                value={kst[b.id] ?? 'Allgemein'}
                onChange={(e) => setKst((p) => ({ ...p, [b.id]: e.target.value }))}
                style={{ flex: '1 1 150px', minWidth: 0, fontSize: 16, padding: '8px 10px', borderRadius: 9, border: '0.5px solid rgba(60,60,67,0.25)', background: '#fff', color: '#1A1814' }}
              >
                {kostenstellen.map((k) => <option key={k} value={k}>{k === 'Allgemein' ? 'Kostenstelle: Allgemein' : k}</option>)}
              </select>
              <button
                onClick={() => decide(b.id, 'sevdesk')}
                disabled={busy === b.id}
                style={{ flex: '1 1 130px', fontSize: 14, fontWeight: 700, color: '#fff', background: busy === b.id ? '#C9BC93' : '#B0912B', border: 'none', borderRadius: 9, padding: '10px 12px', cursor: 'pointer' }}
              >{busy === b.id ? '⏳ …' : '→ sevdesk (A&H)'}</button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={() => decide(b.id, 'andere')} disabled={busy === b.id} style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: '#3B5BDB', background: '#EEF2FF', border: 'none', borderRadius: 9, padding: '9px 10px', cursor: 'pointer' }}>Andere Gesellschaft</button>
              <button onClick={() => decide(b.id, 'verworfen')} disabled={busy === b.id} style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: '#B91C1C', background: '#FEF2F2', border: 'none', borderRadius: 9, padding: '9px 10px', cursor: 'pointer' }}>Kein Beleg</button>
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  )
}
