'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * ⚡ Wallbox (§185): Vollbild-Bereich im Mehr-Tab (NUR Admins) —
 * Ladehistorie mit kWh, Umsatz und geschätztem Brutto-Gewinn
 * (Umsatz − Stromkosten; Strompreis unten einstellbar, sofern Monta
 * keine eigenen Kosten liefert). Overlay via createPortal(document.body)
 * — §83-Lektion; Portal-Root trägt team-shell (§100-Muster).
 */

interface Charge {
  id: string
  chargePointName: string | null
  state: string
  startedAt: string | null
  stoppedAt: string | null
  kwh: number | null
  revenueEur: number | null
  costEur: number | null
  profitEur: number | null
}

const eur = (n: number) => n.toFixed(2).replace('.', ',') + ' €'
const kwhF = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',')

const STATE_META: Record<string, { label: string; bg: string; color: string }> = {
  charging: { label: '⚡ Lädt', bg: 'var(--tm-green-soft)', color: 'var(--tm-green)' },
  starting: { label: '⚡ Startet', bg: 'var(--tm-green-soft)', color: 'var(--tm-green)' },
  paused: { label: '⏸ Pausiert', bg: 'var(--tm-yellow-soft)', color: 'var(--tm-yellow)' },
  stopping: { label: 'Stoppt…', bg: 'var(--tm-yellow-soft)', color: 'var(--tm-yellow)' },
  completed: { label: '✓ Beendet', bg: 'var(--tm-surface2)', color: 'var(--tm-muted)' },
  stopped: { label: '✓ Beendet', bg: 'var(--tm-surface2)', color: 'var(--tm-muted)' },
  scheduled: { label: '🕐 Geplant', bg: 'var(--tm-surface2)', color: 'var(--tm-blue)' },
  reserved: { label: 'Reserviert', bg: 'var(--tm-surface2)', color: 'var(--tm-blue)' },
}

function fmtWhen(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).replace(',', ' ·')
}

function fmtDuration(start: string | null, end: string | null): string | null {
  if (!start || !end) return null
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return null
  const min = Math.round(ms / 60000)
  return min < 60 ? `${min} Min.` : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} h`
}

export default function WallboxPanel({ onClose }: { onClose: () => void }) {
  const [charges, setCharges] = useState<Charge[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load(p: number, append: boolean) {
    if (p === 0) setLoading(true)
    try {
      const res = await fetch(`/api/wallbox?page=${p}`, { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      setCharges((prev) => (append ? [...prev, ...j.charges] : j.charges))
      setHasMore(!!j.hasMore)
      setPage(p)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(0, false) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Summen über die GELADENE Liste (Kopf-Kacheln)
  const done = charges.filter((c) => c.state === 'completed' || c.state === 'stopped')
  const sumKwh = done.reduce((s, c) => s + (c.kwh ?? 0), 0)
  const sumRev = done.reduce((s, c) => s + (c.revenueEur ?? 0), 0)
  const sumProfit = done.reduce((s, c) => s + (c.profitEur ?? 0), 0)

  const tile = (label: string, value: string, accent?: string) => (
    <div key={label} style={{
      flex: '1 1 105px', minWidth: 0, background: 'var(--tm-card)', borderRadius: 12, padding: '10px 12px',
      boxShadow: '0 0 0 0.5px var(--tm-line)',
    }}>
      <div style={{ fontSize: 11, color: 'var(--tm-muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: accent ?? 'var(--tm-text)', marginTop: 2, whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  )

  const body = (
    <div className="team-shell" style={{
      position: 'fixed', inset: 0, zIndex: 80, background: 'var(--tm-surface2)',
      display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top)',
    }}>
      {/* Kopf */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'var(--tm-card)',
        boxShadow: 'inset 0 -0.5px 0 var(--tm-line)', flexShrink: 0,
      }}>
        <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 22, color: 'var(--gold)', cursor: 'pointer', padding: '0 4px' }}>‹</button>
        <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--tm-text)' }}>⚡ Wallbox</div>
        <div style={{ flex: 1 }} />
        {loading && <span style={{ fontSize: 12, color: 'var(--tm-muted2)' }}>Laden…</span>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
        <div style={{ maxWidth: 620, margin: '0 auto', padding: '14px 14px 40px' }}>
          {error && (
            <div style={{
              padding: '11px 14px', borderRadius: 12, background: 'var(--tm-red-soft)', color: 'var(--tm-red)',
              fontSize: 13, lineHeight: 1.5, marginBottom: 14,
            }}>
              ⚠️ Wallbox-Daten nicht abrufbar: {error}
            </div>
          )}

          {/* Summen der geladenen Liste */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {tile('Ladungen', String(done.length))}
            {tile('Energie', `${kwhF(sumKwh)} kWh`)}
            {tile('Umsatz', eur(sumRev))}
            {tile('Gewinn ~', eur(sumProfit), sumProfit >= 0 ? '#16A34A' : '#DC2626')}
          </div>
          <div style={{ fontSize: 11, color: 'var(--tm-muted)', margin: '-6px 4px 16px' }}>
            Summen über die {charges.length} geladenen Vorgänge · Gewinn = Umsatz − Stromkosten (aus click2charge)
          </div>

          {/* Ladehistorie */}
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-muted)', letterSpacing: '0.05em', margin: '0 4px 7px' }}>LADEHISTORIE</div>
          {!loading && !error && charges.length === 0 && (
            <div style={{ padding: '26px 14px', textAlign: 'center', color: 'var(--tm-muted)', fontSize: 13.5 }}>
              Noch keine Ladevorgänge gefunden.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {charges.map((c) => {
              const meta = STATE_META[c.state] ?? { label: c.state || '—', bg: 'var(--tm-surface2)', color: 'var(--tm-muted)' }
              const dur = fmtDuration(c.startedAt, c.stoppedAt)
              return (
                <div key={c.id} style={{
                  background: 'var(--tm-card)', borderRadius: 12, padding: '11px 14px',
                  boxShadow: '0 0 0 0.5px var(--tm-line)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: 'var(--tm-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {fmtWhen(c.startedAt)}{c.chargePointName ? ` · ${c.chargePointName}` : ''}
                    </div>
                    <span style={{
                      fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
                      background: meta.bg, color: meta.color, flexShrink: 0, whiteSpace: 'nowrap',
                    }}>{meta.label}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 7, fontSize: 12.5, color: '#4A463C' }}>
                    <span>🔋 <strong>{c.kwh != null ? `${kwhF(c.kwh)} kWh` : '—'}</strong></span>
                    <span>💶 Umsatz <strong>{c.revenueEur != null ? eur(c.revenueEur) : '—'}</strong></span>
                    <span style={{ color: (c.profitEur ?? 0) >= 0 ? 'var(--tm-green)' : 'var(--tm-red)' }}>
                      📈 Gewinn <strong>{c.profitEur != null ? `~${eur(c.profitEur)}` : '—'}</strong>
                    </span>
                    {dur && <span style={{ color: 'var(--tm-muted)' }}>⏱ {dur}</span>}
                  </div>
                </div>
              )
            })}
          </div>

          {hasMore && (
            <button
              onClick={() => load(page + 1, true)}
              style={{
                width: '100%', marginTop: 12, padding: '11px', borderRadius: 12,
                border: '1px solid var(--tm-line)', background: 'var(--tm-card)', color: 'var(--tm-muted)',
                fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
              }}
            >Ältere Ladevorgänge laden</button>
          )}
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(body, document.body) : null
}
