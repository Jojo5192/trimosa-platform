'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { haptic } from '@/components/team/ux'

/**
 * 🔔 Push-Historie (§265, Pascal): zeitlicher Verlauf der eigenen
 * Push-Mitteilungen — jeder Eintrag ist anklickbar und springt zu seinem
 * Ziel (Aufgabe, Buchung, Chat-Nachricht …). Deckt genau den Fall
 * „Push weggewischt / Tap ging ins Leere → von Hand suchen" ab.
 * Overlay via createPortal(document.body) — §83.
 */

interface Eintrag {
  id: string
  created_at: string
  title: string
  body: string | null
  url: string | null
  category: string | null
}

const KAT_EMOJI: Record<string, string> = {
  guestChats: '💬', teamChats: '💼', bookings: '🎉', tasks: '✅',
  reinigung: '🧹', calls: '☎️', buchhaltung: '💶', wallbox: '⚡', system: '🔧',
}

function tagVon(iso: string): string {
  const d = new Date(iso)
  const heute = new Date()
  const gestern = new Date(heute.getTime() - 86_400_000)
  const key = (x: Date) => x.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })
  if (key(d) === key(heute)) return 'Heute'
  if (key(d) === key(gestern)) return 'Gestern'
  return d.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long', day: 'numeric', month: 'long' })
}
function uhrzeit(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })
}

export default function PushLogPanel({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<Eintrag[] | null>(null)
  const [hinweis, setHinweis] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/push/log', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 403 ? 'Kein Zugriff.' : `Fehler ${r.status}`)
        const d = await r.json()
        setEntries(d.entries ?? [])
        if (d.hinweis) setHinweis(d.hinweis)
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)))
  }, [])

  const openEntry = (e: Eintrag) => {
    haptic()
    if (!e.url) return
    /* Volle Navigation statt Panel-interner Sprünge: die URL kann in jeden
     * Bereich zeigen (/team?conv=…, /team?tab=…, /buchhaltung) — der Reload
     * nimmt denselben Deep-Link-Weg wie ein frischer Push-Tap. */
    window.location.href = e.url
  }

  // Nach Tagen gruppieren (Einträge kommen absteigend sortiert)
  const gruppen: { tag: string; items: Eintrag[] }[] = []
  for (const e of entries ?? []) {
    const tag = tagVon(e.created_at)
    const g = gruppen[gruppen.length - 1]
    if (g && g.tag === tag) g.items.push(e)
    else gruppen.push({ tag, items: [e] })
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
        <div style={{ fontSize: 17, fontWeight: 800, color: '#1A1814' }}>🔔 Mitteilungen</div>
        <div style={{ flex: 1 }} />
        {entries === null && !error && <span style={{ fontSize: 12, color: '#B0AA9C' }}>Laden…</span>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '14px 14px 40px' }}>
          {error && (
            <div style={{ padding: '11px 14px', borderRadius: 12, background: '#FEF2F2', color: '#B91C1C', fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
              ⚠️ {error}
            </div>
          )}
          {hinweis && (
            <div style={{ padding: '11px 14px', borderRadius: 12, background: '#FBF6E9', color: '#7A6520', fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
              {hinweis}
            </div>
          )}
          {entries !== null && entries.length === 0 && !hinweis && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#8A8578', fontSize: 14 }}>
              Noch keine Mitteilungen — hier erscheint ab jetzt jede Push, die an dich rausgeht (30 Tage).
            </div>
          )}

          {gruppen.map((g) => (
            <div key={g.tag} style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#8A8578', letterSpacing: '0.04em', margin: '0 4px 7px', textTransform: 'uppercase' }}>{g.tag}</div>
              <div style={{ background: '#fff', borderRadius: 14, overflow: 'clip', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                {g.items.map((e, i) => (
                  <button
                    key={e.id}
                    onClick={() => openEntry(e)}
                    style={{
                      width: '100%', display: 'flex', gap: 11, alignItems: 'flex-start', textAlign: 'left',
                      padding: '11px 13px', border: 'none', background: 'none',
                      cursor: e.url ? 'pointer' : 'default', WebkitTapHighlightColor: 'transparent',
                      boxShadow: i < g.items.length - 1 ? 'inset 0 -0.5px 0 rgba(60,60,67,0.12)' : 'none',
                    }}
                  >
                    <span style={{
                      width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'inline-flex',
                      alignItems: 'center', justifyContent: 'center', fontSize: 16,
                      background: 'rgba(176,145,43,0.10)',
                    }}>{KAT_EMOJI[e.category ?? ''] ?? '🔔'}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 700, color: '#1A1814', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</span>
                        <span style={{ fontSize: 11.5, color: '#B0AA9C', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{uhrzeit(e.created_at)}</span>
                      </span>
                      {e.body && (
                        <span style={{
                          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                          fontSize: 13, color: '#6B6555', lineHeight: 1.4, marginTop: 2,
                        }}>{e.body}</span>
                      )}
                    </span>
                    {e.url && <span style={{ color: '#C7C7CC', fontSize: 15, flexShrink: 0, alignSelf: 'center' }}>›</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(body, document.body) : null
}
