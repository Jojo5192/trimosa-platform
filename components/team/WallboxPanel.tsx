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
  charging: { label: '⚡ Lädt', bg: '#DCFCE7', color: '#16A34A' },
  starting: { label: '⚡ Startet', bg: '#DCFCE7', color: '#16A34A' },
  paused: { label: '⏸ Pausiert', bg: '#FEF9C3', color: '#A16207' },
  stopping: { label: 'Stoppt…', bg: '#FEF9C3', color: '#A16207' },
  completed: { label: '✓ Beendet', bg: '#F2F2F7', color: '#6B675E' },
  stopped: { label: '✓ Beendet', bg: '#F2F2F7', color: '#6B675E' },
  scheduled: { label: '🕐 Geplant', bg: '#E0EAFF', color: '#3B5BDB' },
  reserved: { label: 'Reserviert', bg: '#E0EAFF', color: '#3B5BDB' },
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
  const [kwhCost, setKwhCost] = useState<string>('')
  const [costSaved, setCostSaved] = useState(false)

  async function load(p: number, append: boolean) {
    if (p === 0) setLoading(true)
    try {
      const res = await fetch(`/api/wallbox?page=${p}`, { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      setCharges((prev) => (append ? [...prev, ...j.charges] : j.charges))
      setHasMore(!!j.hasMore)
      setPage(p)
      if (!append) setKwhCost(String(j.settings?.kwhCostCents ?? 35).replace('.', ','))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(0, false) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveKwhCost() {
    const n = Number(kwhCost.replace(',', '.'))
    if (!Number.isFinite(n) || n < 0) return
    const res = await fetch('/api/wallbox', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kwhCostCents: n }),
    }).catch(() => null)
    if (res?.ok) {
      setCostSaved(true)
      setTimeout(() => setCostSaved(false), 2500)
      load(0, false) // Gewinn-Spalte mit neuem Satz neu rechnen
    }
  }

  // Summen über die GELADENE Liste (Kopf-Kacheln)
  const done = charges.filter((c) => c.state === 'completed' || c.state === 'stopped')
  const sumKwh = done.reduce((s, c) => s + (c.kwh ?? 0), 0)
  const sumRev = done.reduce((s, c) => s + (c.revenueEur ?? 0), 0)
  const sumProfit = done.reduce((s, c) => s + (c.profitEur ?? 0), 0)

  const tile = (label: string, value: string, accent?: string) => (
    <div key={label} style={{
      flex: '1 1 105px', minWidth: 0, background: '#fff', borderRadius: 12, padding: '10px 12px',
      boxShadow: '0 0 0 0.5px rgba(60,60,67,0.1)',
    }}>
      <div style={{ fontSize: 11, color: '#8A8578', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: accent ?? '#1A1814', marginTop: 2, whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  )

  const body = (
    <div className="team-shell" style={{
      position: 'fixed', inset: 0, zIndex: 80, background: '#F2F2F7',
      display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top)',
    }}>
      {/* Kopf */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: '#fff',
        boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.15)', flexShrink: 0,
      }}>
        <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 22, color: 'var(--gold)', cursor: 'pointer', padding: '0 4px' }}>‹</button>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#1A1814' }}>⚡ Wallbox</div>
        <div style={{ flex: 1 }} />
        {loading && <span style={{ fontSize: 12, color: '#B0AA9C' }}>Laden…</span>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
        <div style={{ maxWidth: 620, margin: '0 auto', padding: '14px 14px 40px' }}>
          {error && (
            <div style={{
              padding: '11px 14px', borderRadius: 12, background: '#FEF2F2', color: '#B91C1C',
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
          <div style={{ fontSize: 11, color: '#8A8578', margin: '-6px 4px 14px' }}>
            Summen über die {charges.length} geladenen Vorgänge · Gewinn = Umsatz − Stromkosten (geschätzt)
          </div>

          {/* Strompreis */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, background: '#fff', borderRadius: 12,
            padding: '11px 14px', boxShadow: '0 0 0 0.5px rgba(60,60,67,0.1)', marginBottom: 16,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#1A1814' }}>Unser Strompreis</div>
              <div style={{ fontSize: 11.5, color: '#8A8578', marginTop: 1 }}>Cent/kWh — Basis der Gewinn-Schätzung</div>
            </div>
            <input
              value={kwhCost}
              onChange={(e) => setKwhCost(e.target.value)}
              onBlur={saveKwhCost}
              inputMode="decimal"
              style={{
                width: 76, fontSize: 16, padding: '7px 10px', borderRadius: 10,
                border: '1px solid #E3DCC8', textAlign: 'right', background: '#FDFCF8',
              }}
            />
            <span style={{ fontSize: 13, color: '#8A8578' }}>ct{costSaved ? ' ✓' : ''}</span>
          </div>

          {/* Ladehistorie */}
          <div style={{ fontSize: 12, fontWeight: 700, color: '#8A8578', letterSpacing: '0.05em', margin: '0 4px 7px' }}>LADEHISTORIE</div>
          {!loading && !error && charges.length === 0 && (
            <div style={{ padding: '26px 14px', textAlign: 'center', color: '#8A8578', fontSize: 13.5 }}>
              Noch keine Ladevorgänge gefunden.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {charges.map((c) => {
              const meta = STATE_META[c.state] ?? { label: c.state || '—', bg: '#F2F2F7', color: '#6B675E' }
              const dur = fmtDuration(c.startedAt, c.stoppedAt)
              return (
                <div key={c.id} style={{
                  background: '#fff', borderRadius: 12, padding: '11px 14px',
                  boxShadow: '0 0 0 0.5px rgba(60,60,67,0.1)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: '#1A1814', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                    <span style={{ color: (c.profitEur ?? 0) >= 0 ? '#16A34A' : '#DC2626' }}>
                      📈 Gewinn <strong>{c.profitEur != null ? `~${eur(c.profitEur)}` : '—'}</strong>
                    </span>
                    {dur && <span style={{ color: '#8A8578' }}>⏱ {dur}</span>}
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
                border: '1px solid #E3DCC8', background: '#fff', color: '#6B675E',
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
