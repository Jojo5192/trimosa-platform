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
  solution?: string | null   // §247: im Gast-Thread erfasste Lösung
}

function fmtWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).replace(',', ' ·')
}

/** Transkript „ANRUFER: …\nASSISTENTIN: …" → Sprecher-Blöcke */
export function parseTranscript(t: string): { who: 'anrufer' | 'bot'; text: string }[] {
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

/** Rufnummern-Schlüssel wie in lib/voice.ts: nur Ziffern, letzte 9 (übersteht +49/0049/Leerzeichen) */
function phoneKey(raw: string | null | undefined): string {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  return d.slice(-9)
}

export default function CallsPanel({ onClose, bookingId, title, focus }: {
  onClose: () => void
  bookingId?: string
  title?: string
  /** 🎧 Anruf gezielt aufklappen: per id (Deep-Link) oder Rufnummer + Zeitpunkt (Anruf-Aufgabe; nächster Anruf binnen 3 h) */
  focus?: { id?: string; phone?: string | null; at?: string; name?: string } | null
}) {
  const [calls, setCalls] = useState<Call[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [audioErr, setAudioErr] = useState<Record<string, boolean>>({})
  const [fokusFehlt, setFokusFehlt] = useState(false)

  useEffect(() => {
    const url = bookingId ? `/api/voice/calls?bookingId=${bookingId}` : '/api/voice/calls'
    fetch(url, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
        const liste: Call[] = j.calls ?? []
        setCalls(liste)
        if (bookingId && liste.length === 1) setOpenId(liste[0].id)
        if (focus) {
          let treffer: Call | undefined = focus.id ? liste.find((c) => c.id === focus.id) : undefined
          if (!treffer && focus.phone && phoneKey(focus.phone)) {
            const at = focus.at ? Date.parse(focus.at) : Date.now()
            treffer = liste
              .filter((c) => phoneKey(c.caller) === phoneKey(focus.phone) && Math.abs(Date.parse(c.createdAt) - at) < 3 * 3_600_000)
              .sort((x, y) => Math.abs(Date.parse(x.createdAt) - at) - Math.abs(Date.parse(y.createdAt) - at))[0]
          }
          if (!treffer && focus.name) {
            const n = focus.name.trim().toLowerCase().split(/\s+/).pop() ?? ''
            if (n.length >= 4) treffer = liste.find((c) => `${c.summary ?? ''} ${c.transcript ?? ''}`.toLowerCase().includes(n))
          }
          if (treffer) {
            setOpenId(treffer.id)
            setTimeout(() => document.getElementById(`tm-call-${treffer!.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80)
          } else {
            setFokusFehlt(true)
          }
        }
        setError(null)
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus nur beim Öffnen auswerten
  }, [bookingId])

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
        <button onClick={onClose} aria-label="Zurück" style={{ border: 'none', background: 'none', fontSize: 22, color: 'var(--tm-accent, #AE8D2D)', cursor: 'pointer', padding: '0 4px', minWidth: 40, minHeight: 40 }}>‹</button>
        <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--tm-text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          ☎️ {title ?? 'Telefonate'}
        </div>
        <div style={{ flex: 1 }} />
        {loading && <span style={{ fontSize: 12, color: 'var(--tm-muted2)' }}>Laden…</span>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '14px 14px 40px' }}>
          {error && (
            <div style={{ padding: '11px 14px', borderRadius: 12, background: 'var(--tm-red-soft)', color: 'var(--tm-red)', fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
              ⚠️ {error}
            </div>
          )}
          {fokusFehlt && !loading && (
            <div style={{ padding: '11px 14px', borderRadius: 12, background: 'var(--tm-accent-soft)', color: 'var(--tm-text)', fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
              🎧 Zu dieser Aufgabe wurde kein passender Anruf gefunden (gleiche Rufnummer, ±3 Stunden). Unten stehen alle Anrufe.
            </div>
          )}
          {!loading && !error && calls.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--tm-muted)', fontSize: 14, padding: '40px 0' }}>
              {bookingId ? 'Zu dieser Buchung gibt es keine Telefonate.' : 'Noch keine Telefonate aufgezeichnet.'}
            </div>
          )}

          {calls.map((c) => {
            const open = openId === c.id
            return (
              <div key={c.id} id={`tm-call-${c.id}`} style={{
                background: 'var(--tm-card)', borderRadius: 14, marginBottom: 10, overflow: 'hidden',
                boxShadow: focus && openId === c.id ? '0 0 0 2px var(--tm-accent)' : '0 0 0 0.5px var(--tm-line)',
                scrollMarginTop: 12,
              }}>
                <button onClick={() => setOpenId(open ? null : c.id)} style={{
                  width: '100%', textAlign: 'left', border: 'none', background: 'none',
                  padding: '12px 14px', cursor: 'pointer',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--tm-text)' }}>{fmtWhen(c.createdAt)}</span>
                    {c.caller && <span style={{ fontSize: 12, color: 'var(--tm-muted)' }}>{c.caller}</span>}
                    <span style={{
                      fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                      background: c.guestInquiry ? 'var(--tm-green-soft)' : 'var(--tm-surface2)',
                      color: c.guestInquiry ? 'var(--tm-green)' : 'var(--tm-muted)',
                    }}>
                      {c.guestInquiry ? 'Gast-Anliegen' : 'Sonstiges'}
                    </span>
                    <span style={{ marginLeft: 'auto', color: 'var(--tm-muted2)', fontSize: 13 }}>{open ? '▾' : '▸'}</span>
                  </div>
                  {(c.guest || c.apartment) && (
                    <div style={{ fontSize: 12, color: 'var(--tm-accent-dark, #715C1D)', fontWeight: 700, marginTop: 5 }}>
                      {[c.guest, c.apartment, c.zeitraum].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {c.summary && (
                    <div style={{ fontSize: 13, color: 'var(--tm-text)', lineHeight: 1.5, marginTop: 5 }}>{c.summary}</div>
                  )}
                  {/* §247: erfasste Lösung — erfassen/ändern läuft im Gast-Thread */}
                  {c.solution && (
                    <div style={{
                      marginTop: 7, background: 'var(--tm-green-soft)', border: '1px solid var(--tm-line)',
                      borderRadius: 9, padding: '7px 10px', fontSize: 12.5, lineHeight: 1.5, color: 'var(--tm-green)',
                    }}>
                      <span style={{ fontWeight: 800 }}>✅ Gelöst: </span>{c.solution}
                    </div>
                  )}
                </button>

                {open && (
                  <div style={{ padding: '0 14px 14px', borderTop: '0.5px solid var(--tm-line)' }}>
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
                      <div style={{ fontSize: 12, color: 'var(--tm-muted)', marginTop: 12 }}>🎧 Kein Audio verfügbar.</div>
                    )}

                    {/* 📝 Transkript */}
                    {c.transcript ? (
                      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
                        {parseTranscript(c.transcript).map((t, i) => (
                          <div key={i} style={{
                            alignSelf: t.who === 'bot' ? 'flex-end' : 'flex-start',
                            maxWidth: '88%',
                            background: t.who === 'bot' ? 'var(--tm-navy)' : 'var(--tm-surface2)',
                            color: t.who === 'bot' ? '#fff' : 'var(--tm-text)',
                            borderRadius: 14, padding: '7px 11px', fontSize: 13, lineHeight: 1.45,
                          }}>
                            {t.text}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--tm-muted)', marginTop: 10 }}>Kein Transkript vorhanden.</div>
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
