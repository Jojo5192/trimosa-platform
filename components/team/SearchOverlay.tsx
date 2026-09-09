'use client'

/**
 * 🔍 §276 Globale Suche der Team-App (Pascal): eine Vollbild-Ebene mit
 * Suchfeld, „Abbrechen", Verlauf der letzten Suchbegriffe und Treffern in
 * Gruppen (Chats · Gruppen · Aufgaben). Nachrichten/Wissen folgen mit dem
 * Server-Endpunkt in Baustein 4 (Inbox). Am Rechner als Palette (⌘K).
 * Daten kommen client-seitig aus den vorhandenen APIs (Inbox, Team-Chat,
 * Aufgaben) — kein Server-Umbau nötig.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { haptic, IconSearch } from '@/components/team/ux'

type Hit = { id: string; group: 'chat' | 'intern' | 'task'; title: string; sub: string; badge?: string }

const RECENT_KEY = 'trimosa-search-recent'
function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') } catch { return [] }
}
function saveRecent(term: string) {
  try {
    const t = term.trim()
    if (!t) return
    const next = [t, ...loadRecent().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 8)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch { /* quota */ }
}

export default function SearchOverlay({ role, isDesktop, onClose, onOpen }: {
  role: 'team' | 'provider'
  isDesktop: boolean
  onClose: () => void
  onOpen: (hit: Hit) => void
}) {
  const [q, setQ] = useState('')
  const [recent] = useState<string[]>(() => (typeof window === 'undefined' ? [] : loadRecent()))
  const [threads, setThreads] = useState<Record<string, unknown>[]>([])
  const [groups, setGroups] = useState<Record<string, unknown>[]>([])
  const [tasks, setTasks] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 60)
    const get = (u: string) => fetch(u, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    Promise.all([
      role === 'team' ? get('/api/chat/inbox') : Promise.resolve(null),
      get('/api/team-chat'),
      get('/api/tasks'),
    ]).then(([inbox, tc, tk]) => {
      setThreads((inbox?.threads ?? []) as Record<string, unknown>[])
      setGroups((tc?.chats ?? []) as Record<string, unknown>[])
      setTasks((tk?.tasks ?? []) as Record<string, unknown>[])
      setLoading(false)
    })
  }, [role])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const hits = useMemo<Hit[]>(() => {
    const term = q.trim().toLowerCase()
    if (term.length < 2) return []
    const has = (...parts: unknown[]) => parts.some((p) => typeof p === 'string' && p.toLowerCase().includes(term))
    const out: Hit[] = []
    for (const t of threads) {
      if (has(t.guestName, t.listingTitle, t.lastPreview, t.platform)) {
        out.push({
          id: String(t.id), group: 'chat',
          title: String(t.guestName ?? 'Gast'),
          sub: [t.listingTitle, t.lastPreview].filter(Boolean).join(' · ').slice(0, 90),
          badge: typeof t.platform === 'string' ? t.platform : undefined,
        })
      }
      if (out.filter((h) => h.group === 'chat').length >= 12) break
    }
    for (const g of groups) {
      if (has(g.name, g.lastPreview)) {
        out.push({ id: String(g.id), group: 'intern', title: `${g.emoji ?? '💼'} ${g.name}`, sub: String(g.lastPreview ?? '').slice(0, 90) })
      }
    }
    for (const t of tasks) {
      if (has(t.title, t.description)) {
        out.push({
          id: String(t.id), group: 'task', title: String(t.title),
          sub: [t.status, t.prio].filter(Boolean).join(' · '),
        })
      }
      if (out.filter((h) => h.group === 'task').length >= 12) break
    }
    return out
  }, [q, threads, groups, tasks])

  const grouped: [string, Hit[]][] = [
    ['Chats', hits.filter((h) => h.group === 'chat')],
    ['Gruppen', hits.filter((h) => h.group === 'intern')],
    ['Aufgaben', hits.filter((h) => h.group === 'task')],
  ]

  const pick = (h: Hit) => { haptic(); saveRecent(q); onOpen(h); onClose() }

  const field: CSSProperties = {
    flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8,
    background: 'var(--tm-card)', border: '1px solid var(--tm-line)', borderRadius: 13,
    padding: '0 12px', boxShadow: 'var(--tm-shadow)',
  }

  const body = (
    <div className="team-shell" onClick={isDesktop ? onClose : undefined} style={{
      position: 'fixed', inset: 0, zIndex: 120,
      background: isDesktop ? 'rgba(23,26,31,0.35)' : 'var(--tm-bg)',
      backdropFilter: isDesktop ? 'blur(6px)' : undefined, WebkitBackdropFilter: isDesktop ? 'blur(6px)' : undefined,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      paddingTop: isDesktop ? '10vh' : 'env(safe-area-inset-top)',
    }}>
      <div className={isDesktop ? 'tm-pop-in' : 'tm-enter'} onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: isDesktop ? 640 : undefined, height: isDesktop ? undefined : '100%',
        maxHeight: isDesktop ? '70vh' : undefined,
        display: 'flex', flexDirection: 'column',
        background: isDesktop ? 'var(--tm-bg)' : undefined,
        borderRadius: isDesktop ? 22 : 0, boxShadow: isDesktop ? 'var(--tm-shadow-float)' : undefined,
        overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px' }}>
          <div style={field}>
            <span style={{ color: 'var(--tm-muted2)', display: 'inline-flex' }}><IconSearch size={17} /></span>
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) pick(hits[0]) }}
              placeholder="Gäste, Gruppen, Aufgaben …"
              style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: 16, padding: '11px 0', color: 'var(--tm-text)' }}
            />
            {q && (
              <button onClick={() => setQ('')} aria-label="Leeren" style={{ border: 'none', background: 'var(--tm-line)', color: 'var(--tm-muted)', width: 20, height: 20, borderRadius: '50%', fontSize: 11, cursor: 'pointer', padding: 0, lineHeight: '20px' }}>✕</button>
            )}
          </div>
          <button className="tm-press-btn" onClick={onClose} style={{ border: 'none', background: 'none', color: 'var(--tm-accent-dark)', fontSize: 15, fontWeight: 600, cursor: 'pointer', padding: '6px 2px', flexShrink: 0 }}>Abbrechen</button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 16px', paddingBottom: 'var(--tm-nav-pad)' }}>
          {q.trim().length < 2 ? (
            recent.length > 0 ? (
              <>
                <div className="tm-eyebrow" style={{ margin: '6px 2px 8px' }}>Zuletzt gesucht</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {recent.map((r) => (
                    <button key={r} className="tm-press-btn" onClick={() => setQ(r)} style={{
                      border: '1px solid var(--tm-line)', background: 'var(--tm-card)', color: 'var(--tm-text)',
                      borderRadius: 999, padding: '7px 13px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    }}>{r}</button>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--tm-muted2)', fontSize: 13.5, padding: '48px 20px', lineHeight: 1.6 }}>
                {loading ? 'Lade …' : 'Suche in Chats, Gruppen und Aufgaben.'}
              </div>
            )
          ) : hits.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--tm-muted2)', fontSize: 13.5, padding: '48px 20px' }}>
              {loading ? 'Lade …' : `Keine Treffer für „${q.trim()}“.`}
            </div>
          ) : (
            grouped.map(([label, list]) => list.length === 0 ? null : (
              <div key={label} style={{ marginBottom: 16 }}>
                <div className="tm-eyebrow" style={{ margin: '6px 2px 8px' }}>{label} · {list.length}</div>
                <div className="tm-card" style={{ overflow: 'hidden' }}>
                  {list.map((h, i) => (
                    <button key={h.id} className="tm-press" onClick={() => pick(h)} style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px',
                      background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
                      boxShadow: i < list.length - 1 ? 'inset 0 -1px 0 var(--tm-line)' : 'none',
                    }}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--tm-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.title}</span>
                        {h.sub && <span style={{ display: 'block', fontSize: 12.5, color: 'var(--tm-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.sub}</span>}
                      </span>
                      {h.badge && <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--tm-muted)', background: 'var(--tm-surface2)', borderRadius: 999, padding: '3px 8px', flexShrink: 0 }}>{h.badge}</span>}
                      <span style={{ color: 'var(--tm-muted2)', fontSize: 16 }}>›</span>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
  return typeof document === 'undefined' ? null : createPortal(body, document.body)
}
