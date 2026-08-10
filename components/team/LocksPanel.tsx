'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { haptic } from '@/components/team/ux'

/**
 * 🔑 Türschlösser (§253): Vollbild-Bereich der Team-App.
 *  - Fernöffnen (Aufschließen) je Schloss, mit Zwei-Schritt-Bestätigung
 *  - aktueller Gäste-Türcode je Wohnung (zum Ablesen/Weitergeben)
 *  - eigener Personen-Code
 *  - Öffnungs-Protokoll (wer/wann)
 * Öffnen ist Admins/Hosts/Staff vorbehalten (Server gated; Provider sehen
 * den Bereich gar nicht). Overlay via createPortal(document.body) — §83.
 */

type LockRef = { provider: 'nuki' | 'tedee' | 'ttlock'; id: string; label: string }
interface Wohnung {
  listingId: string
  title: string
  locks: LockRef[]
  guestCode: string | null
  guestName: string | null
  guestFrom: string | null
  guestTo: string | null
  guestStatus: 'current' | 'upcoming' | null
}
interface LogEntry { at: string; byName: string; title: string; lockLabel: string; ok: boolean }
interface Data {
  wohnungen: Wohnung[]
  meinCode: { code: string; listingIds: string[] } | null
  protokoll: LogEntry[]
}

function fmtWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).replace(',', ' ·')
}
function fmtRange(from: string | null, to: string | null): string {
  const f = (s: string | null) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : '?')
  return `${f(from)} – ${f(to)}`
}

export default function LocksPanel({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)  // "listingId:lockId" wartet auf Bestätigung
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/locks/control', { cache: 'no-store' })
      if (!r.ok) throw new Error(r.status === 403 ? 'Kein Zugriff auf die Türschlösser.' : `Fehler ${r.status}`)
      setData(await r.json())
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  async function open(listingId: string, lock: LockRef) {
    const key = `${listingId}:${lock.id}`
    setBusyKey(key); setConfirmKey(null)
    haptic()
    try {
      const r = await fetch('/api/locks/control', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, lockId: lock.id }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `Fehler ${r.status}`)
      setToast(`✅ ${lock.label} aufgeschlossen`)
      load()
    } catch (e) {
      setToast(`⚠️ ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusyKey(null)
      setTimeout(() => setToast(null), 3500)
    }
  }

  const body = (
    <div className="team-shell" style={{
      position: 'fixed', inset: 0, zIndex: 80, background: '#F2F2F7',
      display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: '#fff',
        boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.15)', flexShrink: 0,
      }}>
        <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 22, color: 'var(--gold)', cursor: 'pointer', padding: '0 4px' }}>‹</button>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#1A1814' }}>🔑 Türschlösser</div>
        <div style={{ flex: 1 }} />
        {loading && <span style={{ fontSize: 12, color: '#B0AA9C' }}>Laden…</span>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '14px 14px 40px' }}>
          {error && (
            <div style={{ padding: '11px 14px', borderRadius: 12, background: '#FEF2F2', color: '#B91C1C', fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
              ⚠️ {error}
            </div>
          )}

          {/* Eigener Personen-Code */}
          {data?.meinCode && (
            <div style={{ borderRadius: 14, background: '#12222E', color: '#fff', padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: '#C8B98A', fontWeight: 700, letterSpacing: '0.04em' }}>👤 DEIN ZUGANGS-CODE</div>
              <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '0.12em', fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>{data.meinCode.code}</div>
              <div style={{ fontSize: 12, color: '#9FB0BC', marginTop: 3 }}>gilt auf {data.meinCode.listingIds.length} Wohnung(en)</div>
            </div>
          )}

          {/* Wohnungen */}
          {(data?.wohnungen ?? []).map((w) => {
            return (
              <div key={w.listingId} style={{ borderRadius: 14, background: '#fff', boxShadow: '0 0 0 0.5px rgba(60,60,67,0.1)', marginBottom: 12, overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px 8px', display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: '#1A1814' }}>{w.title}</span>
                  {w.guestStatus === 'current' && <span style={{ fontSize: 11, fontWeight: 700, color: '#16A34A' }}>🟢 belegt</span>}
                  {w.guestStatus === 'upcoming' && <span style={{ fontSize: 11, fontWeight: 600, color: '#8A8578' }}>Anreise {fmtRange(w.guestFrom, null)}</span>}
                </div>

                {/* Gäste-Türcode */}
                {w.guestCode ? (
                  <div style={{ padding: '0 16px 10px', fontSize: 13, color: '#4A463E' }}>
                    🔑 Gäste-Code <b style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '0.06em', color: '#12222E' }}>{w.guestCode}</b>
                    {w.guestName && <span style={{ color: '#8A8578' }}> · {w.guestName} · {fmtRange(w.guestFrom, w.guestTo)}</span>}
                  </div>
                ) : (
                  <div style={{ padding: '0 16px 10px', fontSize: 12.5, color: '#B0AA9C' }}>Kein aktiver Gäste-Code</div>
                )}

                {/* Schlösser öffnen */}
                {w.locks.map((lock) => {
                  const key = `${w.listingId}:${lock.id}`
                  const armed = confirmKey === key
                  const busy = busyKey === key
                  return (
                    <div key={key} style={{ padding: '10px 16px', boxShadow: 'inset 0 0.5px 0 rgba(60,60,67,0.1)', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ flex: 1, fontSize: 14, color: '#1A1814' }}>🚪 {lock.label}</span>
                      {!armed ? (
                        <button
                          onClick={() => { setConfirmKey(key); haptic() }}
                          disabled={busy}
                          style={{
                            border: 'none', borderRadius: 999, padding: '8px 16px', fontSize: 13, fontWeight: 700,
                            background: busy ? '#E5E5EA' : 'var(--gold)', color: busy ? '#8A8578' : '#fff', cursor: busy ? 'default' : 'pointer',
                          }}>
                          {busy ? 'Öffne…' : 'Aufschließen'}
                        </button>
                      ) : (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => setConfirmKey(null)} style={{ border: '1px solid #E5E5EA', borderRadius: 999, padding: '8px 12px', fontSize: 13, background: '#fff', color: '#8A8578', cursor: 'pointer' }}>Abbrechen</button>
                          <button onClick={() => open(w.listingId, lock)} style={{ border: 'none', borderRadius: 999, padding: '8px 16px', fontSize: 13, fontWeight: 700, background: '#16A34A', color: '#fff', cursor: 'pointer' }}>Wirklich öffnen</button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}

          {!loading && !error && (data?.wohnungen ?? []).length === 0 && (
            <div style={{ textAlign: 'center', color: '#8A8578', fontSize: 14, padding: '30px 0' }}>
              Keine Wohnungen mit hinterlegten Schlössern.
            </div>
          )}

          {/* Protokoll */}
          {(data?.protokoll ?? []).length > 0 && (
            <div style={{ marginTop: 22 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#8A8578', letterSpacing: '0.05em', margin: '0 4px 8px' }}>PROTOKOLL</div>
              <div style={{ borderRadius: 14, background: '#fff', boxShadow: '0 0 0 0.5px rgba(60,60,67,0.1)', overflow: 'hidden' }}>
                {(data?.protokoll ?? []).map((e, i) => (
                  <div key={i} style={{ padding: '9px 14px', fontSize: 12.5, color: '#4A463E', boxShadow: i ? 'inset 0 0.5px 0 rgba(60,60,67,0.1)' : 'none' }}>
                    <span style={{ color: '#8A8578' }}>{fmtWhen(e.at)}</span>{' — '}
                    <b>{e.byName}</b>{e.ok ? ' öffnete ' : ' (Fehler) '}{e.lockLabel} · {e.title}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 18, fontSize: 11.5, color: '#B0AA9C', lineHeight: 1.5, padding: '0 4px' }}>
            „Aufschließen" entriegelt den Zylinder wie ein Keypad-Code — der Gast/Handwerker drückt dann die Klinke.
            Jede Öffnung wird protokolliert und die anderen Berechtigten bekommen einen Info-Push.
          </div>
        </div>
      </div>

      {toast && (
        <div style={{
          position: 'fixed', bottom: 'calc(20px + env(safe-area-inset-bottom))', left: '50%', transform: 'translateX(-50%)',
          background: '#12222E', color: '#fff', padding: '11px 18px', borderRadius: 999, fontSize: 14, fontWeight: 600,
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)', zIndex: 90, maxWidth: '90%',
        }}>{toast}</div>
      )}
    </div>
  )

  return createPortal(body, document.body)
}
