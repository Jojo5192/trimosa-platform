'use client'

/**
 * Editor card: AI translations (EN/FR/NL) for the listing texts. Shows the
 * per-language freshness and runs /api/listings/[id]/translate on demand.
 * Stale translations (German source changed) are also refreshed by the
 * nightly cron — this button is for "jetzt sofort".
 */
import { useCallback, useEffect, useState } from 'react'

interface LangStatus {
  lang: string
  flag: string
  label: string
  exists: boolean
  fresh: boolean
  updatedAt: string | null
}

export default function TranslationsCard({ listingId }: { listingId: string }) {
  const [status, setStatus] = useState<LangStatus[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/listings/${listingId}/translate`)
    if (res.ok) setStatus((await res.json()).status ?? [])
  }, [listingId])
  useEffect(() => { load() }, [load])

  async function run() {
    setBusy(true); setMsg('')
    try {
      const res = await fetch(`/api/listings/${listingId}/translate`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setMsg('Fehler: ' + (data.error ?? res.status)); return }
      setStatus(data.status ?? [])
      const failed = Object.entries(data.result ?? {}).filter(([, v]) => v !== 'ok')
      setMsg(failed.length ? `⚠️ Teilweise fehlgeschlagen: ${failed.map(([k, v]) => `${k}: ${v}`).join(' · ')}` : '✓ Übersetzungen aktualisiert — Gäste sehen sie sofort auf der Detailseite.')
    } finally { setBusy(false) }
  }

  const hasAny = status.some((s) => s.exists)
  const allFresh = hasAny && status.every((s) => s.fresh)

  return (
    <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E8E6E0', padding: 20, marginTop: 24 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: '#111', margin: '0 0 6px' }}>🌍 Übersetzungen</h2>
      <p style={{ fontSize: '12.5px', color: '#888', margin: '0 0 12px', lineHeight: 1.6 }}>
        Titel, Beschreibung und Zimmertexte werden per KI in Englisch, Französisch und
        Niederländisch übersetzt — Gäste können auf der Detailseite umschalten. Ändert sich der
        deutsche Text, werden veraltete Übersetzungen nachts automatisch erneuert.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {status.map((s) => (
          <span key={s.lang} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999,
            fontSize: 12, fontWeight: 600, border: '1px solid',
            borderColor: s.fresh ? '#C9E5CB' : s.exists ? '#F3DFA8' : '#E5E5EA',
            background: s.fresh ? '#F0F9F0' : s.exists ? '#FDF6E3' : '#FAFAF8',
            color: s.fresh ? '#2E7D32' : s.exists ? '#9A7B18' : '#98938A',
          }}>
            {s.flag} {s.label} {s.fresh ? '✓ aktuell' : s.exists ? '⚠︎ veraltet' : '— fehlt'}
          </span>
        ))}
      </div>
      {msg && <p style={{ fontSize: 12, color: msg.startsWith('Fehler') || msg.startsWith('⚠️') ? '#B45309' : '#2E7D32', margin: '0 0 10px' }}>{msg}</p>}
      <button type="button" disabled={busy} onClick={run} style={{
        padding: '9px 18px', borderRadius: 999, border: 'none', cursor: busy ? 'wait' : 'pointer',
        background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))', color: '#fff',
        fontSize: 13, fontWeight: 700, opacity: busy ? 0.6 : 1,
      }}>
        {busy ? '⏳ Übersetzt… (bis zu 1 Min.)' : allFresh ? 'Neu übersetzen' : hasAny ? 'Übersetzungen aktualisieren' : 'Jetzt übersetzen (EN/FR/NL)'}
      </button>
    </div>
  )
}
