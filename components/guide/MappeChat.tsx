'use client'

/**
 * 💬 Chat in der Gästemappe (§136): aufklappbare Karte am Mappe-Ende —
 * der Gast schreibt direkt mit dem Team (landet in der Team-Inbox mit
 * Push), Antworten erscheinen hier. Funktioniert für ALLE Gäste über den
 * Buchungs-Token, auch Portal-Gäste ohne Konto. Labels kommen übersetzt
 * vom Server (Mappe-Sprache).
 */
import { useEffect, useRef, useState } from 'react'

export interface MappeChatLabels {
  title: string; hint: string; placeholder: string; send: string; empty: string
  contactTitle: string; navLabel: string
}

type Msg = { id: string; content: string | null; created_at: string; mine: boolean }

// URLs im Nachrichtentext klickbar machen (z. B. Türcode-/Info-Links)
function linkify(text: string | null): React.ReactNode {
  if (!text) return text
  const re = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi
  const out: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    let url = m[0]
    const trail = url.match(/[.,;:!?]+$/)
    const tail = trail ? trail[0] : ''
    if (tail) url = url.slice(0, -tail.length)
    const href = url.startsWith('http') ? url : `https://${url}`
    out.push(<a key={m.index} href={href} target="_blank" rel="noreferrer" style={{ color: '#EAF2FF', textDecoration: 'underline', wordBreak: 'break-all' }}>{url}</a>)
    if (tail) out.push(tail)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out.length ? out : text
}

export default function MappeChat({ token, labels, lang = 'de', phone, note }: { token: string; labels: MappeChatLabels; lang?: string; phone?: string | null; note?: string | null }) {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[] | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const sigRef = useRef('')

  async function load() {
    try {
      const r = await fetch('/api/mappe/chat?token=' + encodeURIComponent(token) + '&lang=' + encodeURIComponent(lang), { cache: 'no-store' })
      if (!r.ok) return
      const { messages } = await r.json()
      const sig = (messages ?? []).map((m: Msg) => m.id).join(',')
      if (sig !== sigRef.current) {
        sigRef.current = sig
        setMsgs(messages ?? [])
        setTimeout(() => endRef.current?.scrollIntoView({ block: 'nearest' }), 80)
      } else if (msgs === null) {
        setMsgs(messages ?? [])
      }
    } catch { /* Netz */ }
  }

  useEffect(() => {
    if (!open) return
    load()
    const t = setInterval(load, 12000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function send() {
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await fetch('/api/mappe/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, text }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setError(d.error ?? 'Senden fehlgeschlagen.')
        return
      }
      setDraft('')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const fmt = (iso: string) => {
    const d = new Date(iso)
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  const telHref = phone ? 'tel:' + phone.replace(/[^\d+]/g, '') : null
  return (
    <div style={{ marginTop: 18, borderRadius: 16, overflow: 'hidden', background: '#12222E' }}>
      {/* §166: Kontakt + Chat = EIN Punkt — Telefon/Hinweis aus dem
          Kontakt-Baustein sitzen im Kopf der Chat-Karte */}
      {(phone || note) && (
        <div style={{ padding: '15px 18px 0' }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: '#E3C878', marginBottom: note ? 6 : 10 }}>📞 {labels.contactTitle}</div>
          {note && <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'rgba(245,240,232,0.7)', lineHeight: 1.6 }}>{note}</p>}
          {telHref && (
            <a href={telHref} style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 18px', borderRadius: 999,
              border: '1px solid rgba(227,200,120,0.4)', color: '#E3C878', fontSize: 13.5, fontWeight: 700,
              textDecoration: 'none', marginBottom: 4,
            }}>📞 {phone}</a>
          )}
          <div style={{ borderTop: '1px solid rgba(245,240,232,0.12)', marginTop: 12 }} />
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '15px 18px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 14.5, fontWeight: 700, color: '#E3C878' }}>💬 {labels.title}</span>
        <span style={{ fontSize: 12, color: 'rgba(245,240,232,0.6)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '0 14px 14px' }}>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: 'rgba(245,240,232,0.65)', lineHeight: 1.55 }}>{labels.hint}</p>

          <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 2px' }}>
            {msgs === null && <p style={{ fontSize: 12.5, color: 'rgba(245,240,232,0.5)', textAlign: 'center', margin: '14px 0' }}>…</p>}
            {msgs !== null && msgs.length === 0 && (
              <p style={{ fontSize: 12.5, color: 'rgba(245,240,232,0.5)', textAlign: 'center', margin: '14px 0' }}>{labels.empty}</p>
            )}
            {(msgs ?? []).map((m) => (
              <div key={m.id} style={{ display: 'flex', justifyContent: m.mine ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '82%', padding: '8px 12px', borderRadius: 14, fontSize: 13.5, lineHeight: 1.55,
                  whiteSpace: 'pre-line', wordBreak: 'break-word',
                  background: m.mine ? 'linear-gradient(135deg, var(--gold, #AE8D2D), #8A7020)' : 'rgba(245,240,232,0.1)',
                  color: m.mine ? '#fff' : 'rgba(245,240,232,0.92)',
                }}>
                  {linkify(m.content)}
                  <div style={{ fontSize: 9.5, opacity: 0.6, marginTop: 3, textAlign: 'right' }}>{fmt(m.created_at)}</div>
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          {error && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#F0A8A0' }}>{error}</p>}

          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'flex-end' }}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={labels.placeholder}
              rows={1}
              style={{
                flex: 1, minWidth: 0, resize: 'none', border: '1px solid rgba(227,200,120,0.35)',
                borderRadius: 14, padding: '10px 13px', fontSize: 16, lineHeight: '22px',
                background: 'rgba(245,240,232,0.06)', color: '#F5F0E8', outline: 'none',
                fontFamily: 'inherit', maxHeight: 120, overflowY: 'auto',
              }}
              onInput={(e) => {
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = Math.min(el.scrollHeight, 120) + 'px'
              }}
            />
            <button
              onClick={send}
              disabled={busy || !draft.trim()}
              style={{
                flexShrink: 0, padding: '10px 18px', borderRadius: 999, border: 'none',
                background: draft.trim() ? 'linear-gradient(135deg, var(--gold, #AE8D2D), #8A7020)' : 'rgba(245,240,232,0.15)',
                color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: draft.trim() ? 'pointer' : 'default',
              }}
            >{busy ? '…' : labels.send}</button>
          </div>
        </div>
      )}
    </div>
  )
}
