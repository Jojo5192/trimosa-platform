'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * ☎️ Telefonate (§227c): Vollbild-Bereich mit allen Anrufen der
 * KI-Assistentin — Transkript lesen + Audio abhören (team-only).
 * Mit `bookingId` zeigt dasselbe Panel nur die Anrufe EINER Buchung
 * (Einstieg über den ☎️-Chip im Gast-Thread). Overlay via
 * createPortal(document.body) — §83; Portal-Root trägt team-shell (§100).
 */

interface Call {
  id: string
  createdAt: string
  caller: string | null
  summary: string | null
  transcript: string | null
  guestInquiry: boolean
  bookingId: string | null
  guest: string | null
  apartment: string | null
  zeitraum: string | null
  hasAudio: boolean
}

function fmtWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).replace(',', ' ·')
}

/** Transkript „ANRUFER: …\nASSISTENTIN: …" → Sprecher-Blöcke */
function parseTranscript(t: string): { who: 'anrufer' | 'bot'; text: string }[] {
  const out: { who: 'anrufer' | 'bot'; text: string }[] = []
  for (const line of t.split('\n')) {
    const s = line.trim()
    if (!s) continue
    if (s.startsWith('ANRUFER:')) out.push({ who: 'anrufer', text: s.slice(8).trim() })
    else if (s.startsWith('ASSISTENTIN:')) out.push({ who: 'bot', text: s.slice(12).trim() })
    else if (out.length) out[out.length - 1].text += ' ' + s
    else out.push({ who: 'bot', text: s })
  }
  return out
}

export default function CallsPanel({ onClose, bookingId, title }: {
  onClose: () => void
  bookingId?: string
  title?: string
}) {
  const [calls, setCalls] = useState<Call[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [audioErr, setAudioErr] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const url = bookingId ? `/api/voice/calls?bookingId=${bookingId}` : '/api/voice/calls'
    fetch(url, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
        setCalls(j.calls ?? [])
        if (bookingId && (j.calls ?? []).length === 1) setOpenId(j.calls[0].id)
        setError(null)
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [bookingId])

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
        <div style={{ fontSize: 17, fontWeight: 800, color: '#1A1814', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          ☎️ {title ?? 'Telefonate'}
        </div>
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
          {!loading && !error && calls.length === 0 && (
            <div style={{ textAlign: 'center', color: '#8A8578', fontSize: 14, padding: '40px 0' }}>
              {bookingId ? 'Zu dieser Buchung gibt es keine Telefonate.' : 'Noch keine Telefonate aufgezeichnet.'}
            </div>
          )}

          {calls.map((c) => {
            const open = openId === c.id
            return (
              <div key={c.id} style={{
                background: '#fff', borderRadius: 14, marginBottom: 10, overflow: 'hidden',
                boxShadow: '0 0 0 0.5px rgba(60,60,67,0.1)',
              }}>
                <button onClick={() => setOpenId(open ? null : c.id)} style={{
                  width: '100%', textAlign: 'left', border: 'none', background: 'none',
                  padding: '12px 14px', cursor: 'pointer',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1A1814' }}>{fmtWhen(c.createdAt)}</span>
                    {c.caller && <span style={{ fontSize: 12, color: '#6B675E' }}>{c.caller}</span>}
                    <span style={{
                      fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                      background: c.guestInquiry ? '#DCFCE7' : '#F2F2F7',
                      color: c.guestInquiry ? '#16A34A' : '#8A8578',
                    }}>
                      {c.guestInquiry ? 'Gast-Anliegen' : 'Sonstiges'}
                    </span>
                    <span style={{ marginLeft: 'auto', color: '#C7C7CC', fontSize: 13 }}>{open ? '▾' : '▸'}</span>
                  </div>
                  {(c.guest || c.apartment) && (
                    <div style={{ fontSize: 12, color: 'var(--gold-dark)', fontWeight: 700, marginTop: 5 }}>
                      {[c.guest, c.apartment, c.zeitraum].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {c.summary && (
                    <div style={{ fontSize: 13, color: '#4A463E', lineHeight: 1.5, marginTop: 5 }}>{c.summary}</div>
                  )}
                </button>

                {open && (
                  <div style={{ padding: '0 14px 14px', borderTop: '0.5px solid rgba(60,60,67,0.12)' }}>
                    {/* 🎧 Audio */}
                    {c.hasAudio && !audioErr[c.id] && (
                      <audio
                        controls
                        preload="none"
                        src={`/api/voice/calls/${c.id}/audio`}
                        style={{ width: '100%', marginTop: 12 }}
                        onError={() => setAudioErr((p) => ({ ...p, [c.id]: true }))}
                      />
                    )}
                    {(!c.hasAudio || audioErr[c.id]) && (
                      <div style={{ fontSize: 12, color: '#8A8578', marginTop: 12 }}>🎧 Kein Audio verfügbar.</div>
                    )}

                    {/* 📝 Transkript */}
                    {c.transcript ? (
                      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
                        {parseTranscript(c.transcript).map((t, i) => (
                          <div key={i} style={{
                            alignSelf: t.who === 'bot' ? 'flex-end' : 'flex-start',
                            maxWidth: '88%',
                            background: t.who === 'bot' ? 'var(--gold)' : '#E9E9EB',
                            color: t.who === 'bot' ? '#fff' : '#1A1814',
                            borderRadius: 14, padding: '7px 11px', fontSize: 13, lineHeight: 1.45,
                          }}>
                            {t.text}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: '#8A8578', marginTop: 10 }}>Kein Transkript vorhanden.</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(body, document.body)
}
