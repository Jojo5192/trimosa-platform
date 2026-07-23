'use client'

/**
 * 📥 Reiter „Offen" (§155): alle unbeantworteten Gäste-Threads als Karten-
 * Stapel, Karte für Karte abarbeitbar (Tinder-Prinzip) — je Karte:
 *  ✓ Keine Antwort erforderlich · 📞 Telefonat geführt · ✨ KI-Antwort
 *  (editierbar, übersetzt beim Senden) · 📋 Aufgabe erstellen · ⏭ Später.
 * Gleiche Daten wie der Chat-Reiter (Inbox-API + Mark-PATCH) — Antworten im
 * Chat räumen hier auf und umgekehrt (Reload bei Tab-Wechsel + Intervall).
 */
import { useCallback, useEffect, useRef, useState } from 'react'

// Lokale Flaggen-Map (wie ChatPanel) — lib/translate ist server-only (supabaseAdmin)
const LANG_FLAGS: Record<string, string> = {
  de: '🇩🇪', en: '🇬🇧', fr: '🇫🇷', nl: '🇳🇱', it: '🇮🇹', es: '🇪🇸', pl: '🇵🇱', da: '🇩🇰', sv: '🇸🇪', pt: '🇵🇹', cs: '🇨🇿', tr: '🇹🇷', ru: '🇷🇺',
}

interface Thread {
  kind: 'direct' | 'booking'
  id: string
  guestId?: string | null
  guestName: string
  listingTitle: string | null
  listingId: string | null
  platform: string
  checkIn: string | null
  checkOut: string | null
  guestStatus: string | null
  lastMessageAt: string | null
  lastSender: 'guest' | 'host' | null
  guestLang: string | null
  noReplyNeeded: boolean
  phoneResolved: boolean
}
interface Msg { id: string; ours: boolean; text: string; at: string }

const PLATFORM_COLORS: Record<string, string> = {
  Airbnb: '#E0565B', 'Booking.com': '#1A4FA0', 'FeWo-direkt': '#2E7CF6', TRIMOSA: '#AE8D2D', Direktbuchung: '#AE8D2D',
}
function shortPlatform(p: string): string {
  const v = p.toLowerCase()
  if (/direct|direkt|website|trimosa/.test(v)) return v.includes('trimosa') ? 'TRIMOSA' : 'Direktbuchung'
  if (/fewo|homeaway|vrbo|abritel/.test(v)) return 'FeWo-direkt'
  if (/airbnb/.test(v)) return 'Airbnb'
  if (/booking/.test(v)) return 'Booking.com'
  if (/hometogo/.test(v)) return 'HomeToGo'
  return p
}
function fmtD(iso: string | null): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y.slice(2)}`
}
function fmtT(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function OffenPanel({ visible, onCount }: {
  visible: boolean
  onCount: (n: number) => void
}) {
  const [queue, setQueue] = useState<Thread[]>([])
  const [loaded, setLoaded] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [msgsLoading, setMsgsLoading] = useState(false)
  const [leaving, setLeaving] = useState<null | 'left' | 'right'>(null)
  const [draft, setDraft] = useState('')
  const [composer, setComposer] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [taskOpen, setTaskOpen] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDesc, setTaskDesc] = useState('')
  const [taskPrio, setTaskPrio] = useState('mittel')
  const [taskBusy, setTaskBusy] = useState(false)
  const busyRef = useRef(false)

  const current = queue[0] ?? null

  /* ── Laden: Inbox → nur Unbeantwortete, älteste zuerst (FIFO) ── */
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/chat/inbox', { cache: 'no-store' })
      if (!r.ok) return
      const d = await r.json()
      const open: Thread[] = (d.threads ?? [])
        .filter((t: Thread) => t.lastSender === 'guest' && !t.noReplyNeeded && !t.phoneResolved)
        .sort((a: Thread, b: Thread) => String(a.lastMessageAt ?? '').localeCompare(String(b.lastMessageAt ?? '')))
      setQueue((q) => {
        // Aktuelle Karte nicht unter den Fingern austauschen — nur wenn sie
        // inzwischen beantwortet wurde, fliegt sie raus (Chat-Reiter-Sync)
        const cur = q[0]
        if (cur && open.some((t) => t.id === cur.id)) {
          return [cur, ...open.filter((t) => t.id !== cur.id)]
        }
        return open
      })
      setLoaded(true)
    } catch { /* Netz */ }
  }, [])

  // Einmal beim Start laden (Tab-Badge zeigt die Zahl schon vor dem ersten
  // Besuch), danach bei jedem Tab-Wechsel hierher + 45s-Intervall
  useEffect(() => { load() }, [load])
  useEffect(() => { if (visible) load() }, [visible, load])
  useEffect(() => {
    if (!visible) return
    const t = setInterval(load, 45000)
    return () => clearInterval(t)
  }, [visible, load])
  useEffect(() => { onCount(queue.length) }, [queue.length, onCount])

  /* ── Verlauf der aktuellen Karte (letzte Nachrichten) ── */
  useEffect(() => {
    if (!current) { setMsgs([]); return }
    let stale = false
    setMsgsLoading(true)
    const run = async () => {
      try {
        if (current.kind === 'booking') {
          const r = await fetch(`/api/messages/${current.id}`, { cache: 'no-store' })
          const d = await r.json().catch(() => null)
          if (stale) return
          const list = (d?.messages ?? []) as { id: string; sender_type: string; content: string; content_de?: string | null; created_at: string }[]
          setMsgs(list.slice(-5).map((m) => ({
            id: m.id, ours: m.sender_type !== 'guest',
            text: m.content_de || m.content, at: m.created_at,
          })))
        } else {
          const r = await fetch(`/api/chat?conversationId=${current.id}`, { cache: 'no-store' })
          const d = await r.json().catch(() => null)
          if (stale) return
          const list = (Array.isArray(d) ? d : []) as { id: string; sender_id: string | null; content: string; content_de?: string | null; created_at: string }[]
          setMsgs(list.slice(-5).map((m) => ({
            id: m.id, ours: m.sender_id !== (current.guestId ?? '—'),
            text: m.content_de || m.content, at: m.created_at,
          })))
        }
      } finally { if (!stale) setMsgsLoading(false) }
    }
    run()
    return () => { stale = true }
  }, [current?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Karte abräumen (Animation → Queue-Update) ── */
  function dismiss(dir: 'left' | 'right', remove: boolean) {
    setLeaving(dir)
    setTimeout(() => {
      setLeaving(null)
      setDraft(''); setComposer(false); setError(null); setTaskOpen(false)
      setQueue((q) => {
        const [c, ...rest] = q
        if (!c) return q
        return remove ? rest : [...rest, c]
      })
    }, 260)
  }

  function showToast(t: string) {
    setToast(t)
    setTimeout(() => setToast((x) => (x === t ? null : x)), 2200)
  }

  /* ── Aktionen ── */
  async function mark(field: 'no_reply' | 'phone') {
    if (!current || busyRef.current) return
    busyRef.current = true
    try {
      const r = await fetch('/api/chat/inbox', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: current.kind, id: current.id, field, value: true }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      showToast(field === 'phone' ? '📞 Als telefonisch geklärt markiert' : '✓ Keine Antwort erforderlich')
      dismiss('right', true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Aktion fehlgeschlagen.')
    } finally { busyRef.current = false }
  }

  async function suggest() {
    if (!current || aiBusy) return
    setAiBusy(true); setError(null); setComposer(true)
    try {
      const body = current.kind === 'booking' ? { bookingId: current.id } : { conversationId: current.id }
      const r = await fetch('/api/ai/chat-suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error(d?.error ?? `KI-Fehler (${r.status})`)
      setDraft(d.suggestion ?? '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'KI-Vorschlag fehlgeschlagen.')
    } finally { setAiBusy(false) }
  }

  async function send() {
    if (!current || !draft.trim() || sending) return
    setSending(true); setError(null)
    try {
      let content = draft.trim()
      let contentDe: string | undefined
      let lang: string | undefined
      if (current.guestLang && current.guestLang !== 'de') {
        const tr = await fetch('/api/ai/translate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: content, targetLang: current.guestLang }),
        }).then((r) => r.json()).catch(() => null)
        if (tr?.translation) { contentDe = content; lang = current.guestLang; content = tr.translation }
      }
      const url = current.kind === 'booking' ? `/api/messages/${current.id}` : '/api/chat'
      const payload = current.kind === 'booking'
        ? { content, ...(contentDe ? { contentDe, lang } : {}) }
        : { conversationId: current.id, content, ...(contentDe ? { contentDe, lang } : {}) }
      const r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => null)
        throw new Error(d?.error ?? `Senden fehlgeschlagen (${r.status})`)
      }
      showToast('✨ Antwort gesendet')
      dismiss('right', true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Senden fehlgeschlagen — Entwurf bleibt erhalten.')
    } finally { setSending(false) }
  }

  function openTask() {
    if (!current) return
    const lastGuest = [...msgs].reverse().find((m) => !m.ours)
    setTaskTitle(`Anliegen ${current.guestName}${current.listingTitle ? ` · ${current.listingTitle}` : ''}`.slice(0, 120))
    setTaskDesc(lastGuest ? `Gast-Nachricht (${fmtD(current.lastMessageAt?.slice(0, 10) ?? null)}): „${lastGuest.text.slice(0, 400)}"` : '')
    setTaskPrio('mittel')
    setTaskOpen(true)
  }

  async function createTask() {
    if (!current || taskBusy || !taskTitle.trim()) return
    setTaskBusy(true); setError(null)
    try {
      const r = await fetch('/api/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: taskTitle.trim(), description: taskDesc.trim(), prio: taskPrio,
          visibility: 'admin', ...(current.listingId ? { listing_id: current.listingId } : {}),
        }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => null)
        throw new Error(d?.error ?? `HTTP ${r.status}`)
      }
      setTaskOpen(false)
      showToast('📋 Aufgabe erstellt — Thread bleibt offen')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Aufgabe fehlgeschlagen.')
    } finally { setTaskBusy(false) }
  }

  /* ── Styles ── */
  const actionBtn = (bg: string, color = '#fff'): React.CSSProperties => ({
    flex: 1, minWidth: 0, border: 'none', borderRadius: 14, cursor: 'pointer',
    padding: '11px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
    background: bg, color, fontSize: 10.5, fontWeight: 700,
  })

  const next = queue[1] ?? null
  const platform = current ? shortPlatform(current.platform) : ''

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#F2F2F7', overflow: 'hidden' }}>
      {/* Kopf */}
      <div style={{
        padding: '14px 16px 10px', background: 'rgba(249,249,249,0.92)',
        backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
        boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.2)', flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ fontSize: 17, fontWeight: 800, color: '#111' }}>📥 Offen</span>
        {loaded && queue.length > 0 && (
          <span style={{
            fontSize: 12, fontWeight: 800, color: '#fff', background: 'linear-gradient(135deg, var(--gold, #AE8D2D), #8A7020)',
            borderRadius: 999, padding: '3px 10px',
          }}>{queue.length}</span>
        )}
        <button type="button" onClick={load} title="Aktualisieren" style={{
          marginLeft: 'auto', border: 'none', background: 'rgba(118,118,128,0.12)', borderRadius: 999,
          width: 30, height: 30, cursor: 'pointer', fontSize: 14, color: '#666',
        }}>↻</button>
      </div>

      {toast && (
        <div style={{
          position: 'absolute', top: 64, left: '50%', transform: 'translateX(-50%)', zIndex: 60,
          background: '#16293A', color: '#fff', fontSize: 12.5, fontWeight: 700,
          borderRadius: 999, padding: '9px 18px', boxShadow: '0 6px 20px rgba(0,0,0,0.25)', whiteSpace: 'nowrap',
        }}>{toast}</div>
      )}

      {/* Karten-Bühne */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', padding: '16px 14px', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {!loaded && <p style={{ textAlign: 'center', color: '#999', fontSize: 13, marginTop: 60 }}>Lädt…</p>}

        {loaded && !current && (
          <div style={{ textAlign: 'center', marginTop: 70 }}>
            <div style={{ fontSize: 52 }}>🎉</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#111', marginTop: 10 }}>Alles abgearbeitet!</div>
            <p style={{ fontSize: 13, color: '#8E8E93', marginTop: 6, lineHeight: 1.6 }}>
              Keine offenen Gäste-Nachrichten.<br />Neue tauchen hier automatisch auf.
            </p>
          </div>
        )}

        {current && (
          <div style={{ position: 'relative', maxWidth: 560, margin: '0 auto' }}>
            {/* nächste Karte blitzt dahinter hervor (Stapel-Gefühl) */}
            {next && (
              <div style={{
                position: 'absolute', inset: 0, transform: 'scale(0.955) translateY(10px)',
                background: '#fff', borderRadius: 22, boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
              }} />
            )}
            {/* aktuelle Karte */}
            <div style={{
              position: 'relative', background: '#fff', borderRadius: 22,
              boxShadow: '0 10px 34px rgba(0,0,0,0.10)', overflow: 'hidden',
              transition: 'transform .26s ease, opacity .26s ease',
              transform: leaving ? `translateX(${leaving === 'right' ? '120%' : '-120%'}) rotate(${leaving === 'right' ? 7 : -7}deg)` : 'none',
              opacity: leaving ? 0 : 1,
            }}>
              {/* Karten-Kopf */}
              <div style={{ padding: '15px 17px 11px', boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.12)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 16.5, fontWeight: 800, color: '#111' }}>
                    {current.guestLang && current.guestLang !== 'de' ? `${LANG_FLAGS[current.guestLang] ?? '🌐'} ` : ''}{current.guestName}
                  </span>
                  <span style={{
                    fontSize: 10.5, fontWeight: 800, color: '#fff', borderRadius: 999, padding: '3px 9px',
                    background: PLATFORM_COLORS[platform] ?? '#8E8E93',
                  }}>{platform}</span>
                  {current.guestStatus === 'current' && <span style={{ fontSize: 11, color: '#1B7A34', fontWeight: 700 }}>🟢 Vor Ort</span>}
                </div>
                <div style={{ fontSize: 12, color: '#8E8E93', marginTop: 4 }}>
                  {current.listingTitle ?? '—'} · {fmtD(current.checkIn)}–{fmtD(current.checkOut)}
                  {current.lastMessageAt ? ` · wartet seit ${fmtT(current.lastMessageAt)}` : ''}
                </div>
              </div>

              {/* Mini-Verlauf */}
              <div style={{ padding: '13px 15px', background: '#FAFAF8', minHeight: 120, maxHeight: 300, overflowY: 'auto' }}>
                {msgsLoading && <p style={{ fontSize: 12, color: '#999', textAlign: 'center' }}>Verlauf lädt…</p>}
                {!msgsLoading && msgs.map((m) => (
                  <div key={m.id} style={{ display: 'flex', justifyContent: m.ours ? 'flex-end' : 'flex-start', marginBottom: 7 }}>
                    <div style={{
                      maxWidth: '85%', padding: '8px 12px', borderRadius: 15, fontSize: 13, lineHeight: 1.5,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      background: m.ours ? 'linear-gradient(135deg, var(--gold, #AE8D2D), #8A7020)' : '#E9E9EB',
                      color: m.ours ? '#fff' : '#111',
                    }}>
                      {m.text}
                      <div style={{ fontSize: 9.5, opacity: 0.6, marginTop: 2, textAlign: 'right' }}>{fmtT(m.at)}</div>
                    </div>
                  </div>
                ))}
              </div>

              {error && (
                <p style={{ margin: 0, padding: '8px 15px', fontSize: 12, color: '#B91C1C', background: '#FEF2F2' }}>⚠️ {error}</p>
              )}

              {/* ✨-Composer */}
              {composer && (
                <div style={{ padding: '11px 15px', boxShadow: 'inset 0 0.5px 0 rgba(60,60,67,0.12)' }}>
                  <textarea
                    value={aiBusy ? '' : draft}
                    placeholder={aiBusy ? '✨ Claude schreibt einen Vorschlag…' : 'Antwort (wird beim Senden automatisch übersetzt)…'}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={4}
                    style={{
                      width: '100%', boxSizing: 'border-box', borderRadius: 12, border: '1.5px solid #E0DDD6',
                      padding: '9px 12px', fontSize: 16, lineHeight: 1.5, fontFamily: 'inherit', resize: 'vertical', outline: 'none',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button type="button" onClick={send} disabled={sending || !draft.trim()} style={{
                      flex: 1, border: 'none', borderRadius: 999, padding: '10px 0', cursor: 'pointer',
                      background: draft.trim() ? 'linear-gradient(135deg, var(--gold, #AE8D2D), #8A7020)' : '#E5E1D6',
                      color: '#fff', fontSize: 13, fontWeight: 800,
                    }}>{sending ? 'Sendet…' : current.guestLang && current.guestLang !== 'de' ? `Senden (übersetzt ${LANG_FLAGS[current.guestLang] ?? ''})` : 'Senden'}</button>
                    <button type="button" onClick={suggest} disabled={aiBusy} title="Neuen Vorschlag" style={{
                      border: '1.5px solid #E0DDD6', borderRadius: 999, padding: '10px 14px', cursor: 'pointer',
                      background: '#fff', color: '#8A7020', fontSize: 13, fontWeight: 800,
                    }}>✨ Neu</button>
                    <button type="button" onClick={() => { setComposer(false); setDraft('') }} style={{
                      border: '1.5px solid #E0DDD6', borderRadius: 999, padding: '10px 14px', cursor: 'pointer',
                      background: '#fff', color: '#999', fontSize: 13, fontWeight: 700,
                    }}>✕</button>
                  </div>
                </div>
              )}

              {/* Aufgaben-Dialog */}
              {taskOpen && (
                <div style={{ padding: '11px 15px', boxShadow: 'inset 0 0.5px 0 rgba(60,60,67,0.12)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Aufgaben-Titel" style={{
                    borderRadius: 10, border: '1.5px solid #E0DDD6', padding: '9px 12px', fontSize: 16, fontFamily: 'inherit', outline: 'none',
                  }} />
                  <textarea value={taskDesc} onChange={(e) => setTaskDesc(e.target.value)} rows={3} placeholder="Beschreibung" style={{
                    borderRadius: 10, border: '1.5px solid #E0DDD6', padding: '9px 12px', fontSize: 16, fontFamily: 'inherit', resize: 'vertical', outline: 'none',
                  }} />
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select value={taskPrio} onChange={(e) => setTaskPrio(e.target.value)} style={{
                      borderRadius: 10, border: '1.5px solid #E0DDD6', padding: '9px 10px', fontSize: 16, fontFamily: 'inherit', minWidth: 0,
                    }}>
                      <option value="hoch">🔴 Hoch</option>
                      <option value="mittel">🟡 Mittel</option>
                      <option value="niedrig">⚪️ Niedrig</option>
                    </select>
                    <button type="button" onClick={createTask} disabled={taskBusy || !taskTitle.trim()} style={{
                      flex: 1, border: 'none', borderRadius: 999, padding: '10px 0', cursor: 'pointer',
                      background: 'linear-gradient(135deg, var(--gold, #AE8D2D), #8A7020)', color: '#fff', fontSize: 13, fontWeight: 800,
                    }}>{taskBusy ? 'Erstellt…' : '📋 Aufgabe anlegen'}</button>
                    <button type="button" onClick={() => setTaskOpen(false)} style={{
                      border: '1.5px solid #E0DDD6', borderRadius: 999, padding: '10px 13px', cursor: 'pointer',
                      background: '#fff', color: '#999', fontSize: 13, fontWeight: 700,
                    }}>✕</button>
                  </div>
                </div>
              )}

              {/* Aktions-Leiste */}
              <div style={{ display: 'flex', gap: 7, padding: '11px 13px 13px' }}>
                <button type="button" onClick={() => mark('no_reply')} style={actionBtn('#E8F6EC', '#1B7A34')}>
                  <span style={{ fontSize: 18 }}>✓</span>Keine Antwort nötig
                </button>
                <button type="button" onClick={() => mark('phone')} style={actionBtn('#EAF1FE', '#1D5FD1')}>
                  <span style={{ fontSize: 18 }}>📞</span>Telefonisch geklärt
                </button>
                <button type="button" onClick={() => (composer ? send() : suggest())} style={actionBtn('linear-gradient(135deg, var(--gold, #AE8D2D), #8A7020)')}>
                  <span style={{ fontSize: 18 }}>✨</span>{composer ? 'Senden' : 'KI-Antwort'}
                </button>
                <button type="button" onClick={openTask} style={actionBtn('#F3EFFC', '#6D28D9')}>
                  <span style={{ fontSize: 18 }}>📋</span>Aufgabe
                </button>
                <button type="button" onClick={() => dismiss('left', false)} style={actionBtn('rgba(118,118,128,0.10)', '#666')}>
                  <span style={{ fontSize: 18 }}>⏭</span>Später
                </button>
              </div>

              <div style={{ textAlign: 'center', paddingBottom: 11 }}>
                <a href={`/team?conv=${current.id}`} style={{ fontSize: 11.5, color: '#8A7020', fontWeight: 700, textDecoration: 'none' }}>
                  Im Chat öffnen ›
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
