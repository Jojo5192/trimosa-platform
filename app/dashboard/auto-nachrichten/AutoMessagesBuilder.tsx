'use client'

import { useMemo, useRef, useState } from 'react'
import {
  TRIGGER_META, PLACEHOLDERS, resolvePlaceholders, demoContext, triggerSummary,
  defaultAutoMessages, type AutoMessage, type TriggerType,
} from '@/lib/auto-messages'

/**
 * 📨 Auto-Nachrichten-Builder (Client, §145): links die Nachrichten-Vorlagen
 * mit Auslöser/Geltung/Text, rechts die Live-Vorschau im Handy-Rahmen (wie
 * beim Gästemappen-Builder). Speichern je Vorlage via PUT /api/auto-messages.
 * KEIN Versand hier — der kommt als getrennter Schritt (Phase B).
 */

export interface BuilderListing { id: string; title: string; checkin: string; checkout: string }

const INPUT: React.CSSProperties = {
  width: '100%', borderRadius: 10, border: '1.5px solid #E0DDD6', padding: '8px 12px',
  fontSize: 13, color: '#111', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', background: '#fff',
}

type Draft = AutoMessage & { _dirty?: boolean; _new?: boolean }

let tmpCounter = 0
function blankMessage(): Draft {
  return {
    id: `tmp-${++tmpCounter}`, name: 'Neue Nachricht', enabled: true, trigger_type: 'vor_anreise',
    offset_days: 3, send_hour: 10, listing_id: null, channel_filter: null, min_nights: null, body: '', sort: 999,
    _dirty: true, _new: true,
  }
}

export default function AutoMessagesBuilder({ listings, initial, migrationMissing }: {
  listings: BuilderListing[]
  initial: AutoMessage[]
  migrationMissing: boolean
}) {
  const [messages, setMessages] = useState<Draft[]>(initial)
  const [activeId, setActiveId] = useState<string | null>(initial[0]?.id ?? null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewMode, setPreviewMode] = useState<'chat' | 'iphone' | 'desktop'>('chat')
  const bodyRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})

  const active = useMemo(() => messages.find((m) => m.id === activeId) ?? messages[0] ?? null, [messages, activeId])
  const activeListing = active?.listing_id ? listings.find((l) => l.id === active.listing_id) : listings[0]

  function patch(id: string, p: Partial<Draft>) {
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...p, _dirty: true } : m)))
  }

  async function saveRow(id: string) {
    const m = messages.find((x) => x.id === id)
    if (!m) return
    setSavingId(id); setError(null)
    try {
      const res = await fetch('/api/auto-messages', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: m._new ? undefined : m.id,
          name: m.name, enabled: m.enabled, trigger_type: m.trigger_type,
          offset_days: m.offset_days, send_hour: m.send_hour, listing_id: m.listing_id,
          channel_filter: m.channel_filter, min_nights: m.min_nights, body: m.body, sort: m.sort,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`)
      const realId = d.id as string
      setMessages((ms) => ms.map((x) => (x.id === id ? { ...x, id: realId, _dirty: false, _new: false } : x)))
      setActiveId((a) => (a === id ? realId : a))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.')
    } finally {
      setSavingId(null)
    }
  }

  async function deleteRow(id: string) {
    const m = messages.find((x) => x.id === id)
    if (!m) return
    if (!m._new && !confirm(`Nachricht „${m.name}" wirklich löschen?`)) return
    if (!m._new) {
      const res = await fetch('/api/auto-messages', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) { setError('Löschen fehlgeschlagen.'); return }
    }
    setMessages((ms) => ms.filter((x) => x.id !== id))
    setActiveId((a) => (a === id ? null : a))
  }

  function addRow(m?: Draft) {
    const row = m ?? blankMessage()
    setMessages((ms) => [...ms, row])
    setActiveId(row.id)
  }

  function loadDefaults() {
    const rows: Draft[] = defaultAutoMessages().map((d, i) => ({ ...d, id: `tmp-${++tmpCounter}`, _dirty: true, _new: true, sort: i }))
    setMessages(rows)
    setActiveId(rows[0]?.id ?? null)
  }

  function insertPlaceholder(id: string, key: string) {
    const ta = bodyRefs.current[id]
    const m = messages.find((x) => x.id === id)
    if (!m) return
    if (ta && typeof ta.selectionStart === 'number') {
      const s = ta.selectionStart, e = ta.selectionEnd
      const next = m.body.slice(0, s) + key + m.body.slice(e)
      patch(id, { body: next })
      requestAnimationFrame(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = s + key.length })
    } else {
      patch(id, { body: m.body + key })
    }
  }

  const ctx = demoContext(activeListing?.title ?? '', activeListing?.checkin ?? '16:00', activeListing?.checkout ?? '10:00')
  // {mappe} + {mappe_button} bleiben als Token stehen (leerer Wert), damit sie
  // beim Rendern als klickbarer Link bzw. Button dargestellt werden können
  const previewText = active ? resolvePlaceholders(active.body, { ...ctx, mappe: '' }) : ''

  return (
    <div>
      {migrationMissing && (
        <div style={{ marginBottom: 16, padding: '11px 14px', borderRadius: 10, background: '#FDF3E7', border: '1px solid #EAD9B8', fontSize: 12.5, color: '#8A6216', lineHeight: 1.5 }}>
          ⚠️ Migration <code>20260722_auto_messages.sql</code> noch nicht ausgeführt — du kannst schon anlegen, gespeichert wird aber erst nach der Migration.
        </div>
      )}
      {error && (
        <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 13, color: '#B91C1C' }}>⚠️ {error}</div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => addRow()} style={{
          padding: '9px 16px', borderRadius: 999, border: '1.5px solid var(--gold)', background: '#fff',
          color: '#8A7020', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
        }}>+ Nachricht hinzufügen</button>
        {messages.length === 0 && (
          <button type="button" onClick={loadDefaults} style={{
            padding: '9px 16px', borderRadius: 999, border: 'none', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
            background: 'linear-gradient(135deg, var(--gold), var(--gold-dark, #8A7020))',
          }}>✨ Standard-Vorlagen laden</button>
        )}
      </div>

      <div className="mappe-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 24, alignItems: 'start' }}>
        {/* ── Links: Nachrichten-Vorlagen ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.length === 0 && (
            <p style={{ fontSize: 13, color: '#999', padding: '30px 0', textAlign: 'center' }}>
              Noch keine Auto-Nachrichten. Lade die Standard-Vorlagen oder lege eine neue an.
            </p>
          )}
          {messages.map((m) => {
            const isActive = m.id === active?.id
            return (
              <div key={m.id} onClick={() => setActiveId(m.id)} style={{
                border: isActive ? '1.5px solid var(--gold)' : '1px solid #E5E1D6', borderRadius: 14,
                background: '#fff', padding: '14px 16px', cursor: 'pointer',
                boxShadow: isActive ? '0 2px 10px rgba(174,141,45,0.12)' : 'none',
              }}>
                {/* Kopf: Name + An/Aus + Löschen */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <input
                    style={{ ...INPUT, fontWeight: 700, flex: 1 }} value={m.name}
                    placeholder="Name (intern, z. B. Willkommen)"
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => patch(m.id, { name: e.target.value })}
                  />
                  <button type="button" onClick={(e) => { e.stopPropagation(); patch(m.id, { enabled: !m.enabled }) }} title={m.enabled ? 'Aktiv' : 'Pausiert'} style={{
                    width: 46, height: 26, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative',
                    background: m.enabled ? '#34C759' : '#D1D1D6', transition: 'background .15s', flexShrink: 0,
                  }}>
                    <span style={{ position: 'absolute', top: 3, left: m.enabled ? 23 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
                  </button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); deleteRow(m.id) }} title="Löschen" style={{
                    width: 28, height: 28, borderRadius: 8, border: '1px solid #E5E1D6', background: '#fff', color: '#DC2626', cursor: 'pointer', flexShrink: 0,
                  }}>✕</button>
                </div>

                {/* Auslöser */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }} onClick={(e) => e.stopPropagation()}>
                  <select value={m.trigger_type} onChange={(e) => patch(m.id, { trigger_type: e.target.value as TriggerType })} style={{ ...INPUT, width: 'auto', flex: '1 1 180px' }}>
                    {TRIGGER_META.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                  {m.trigger_type !== 'nach_buchung' && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#666' }}>
                      <input type="number" min={0} max={60} value={m.offset_days} onChange={(e) => patch(m.id, { offset_days: Number(e.target.value) })} style={{ ...INPUT, width: 58, textAlign: 'center' }} />
                      Tage · um
                      <input type="number" min={0} max={23} value={m.send_hour} onChange={(e) => patch(m.id, { send_hour: Number(e.target.value) })} style={{ ...INPUT, width: 54, textAlign: 'center' }} />
                      Uhr
                    </span>
                  )}
                </div>

                {/* Geltung */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }} onClick={(e) => e.stopPropagation()}>
                  <span style={{ fontSize: 12, color: '#888', flexShrink: 0 }}>Gilt für:</span>
                  <select value={m.listing_id ?? ''} onChange={(e) => patch(m.id, { listing_id: e.target.value || null })} style={{ ...INPUT, width: 'auto', flex: 1 }}>
                    <option value="">Alle Wohnungen</option>
                    {listings.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                  </select>
                </div>

                {/* Text + Platzhalter */}
                <textarea
                  ref={(el) => { bodyRefs.current[m.id] = el }}
                  style={{ ...INPUT, resize: 'vertical', lineHeight: 1.5 }} rows={6}
                  placeholder="Nachrichtentext… (Platzhalter unten anklicken)"
                  value={m.body} onClick={(e) => e.stopPropagation()}
                  onChange={(e) => patch(m.id, { body: e.target.value })}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                  {PLACEHOLDERS.map((p) => (
                    <button key={p.key} type="button" title={p.label} onClick={() => insertPlaceholder(m.id, p.key)} style={{
                      fontSize: 11, fontWeight: 600, color: '#8A7020', background: 'rgba(174,141,45,0.1)',
                      border: '1px solid rgba(174,141,45,0.25)', borderRadius: 7, padding: '3px 7px', cursor: 'pointer',
                    }}>{p.key}</button>
                  ))}
                </div>

                {/* Speichern-Zeile */}
                {m._dirty && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }} onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => saveRow(m.id)} disabled={savingId === m.id} style={{
                      padding: '8px 18px', borderRadius: 999, border: 'none', cursor: 'pointer', color: '#fff', fontSize: 12.5, fontWeight: 700,
                      background: 'linear-gradient(135deg, var(--gold), var(--gold-dark, #8A7020))',
                    }}>{savingId === m.id ? 'Speichert…' : 'Speichern'}</button>
                    <span style={{ fontSize: 12, color: '#B45309' }}>Ungespeicherte Änderungen</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── Rechts: Vorschau (Chat / iPhone Mail / Desktop) ── */}
        <div style={{ position: 'sticky', top: 100 }}>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
            {([['chat', '💬 Chat'], ['iphone', '📱 iPhone Mail'], ['desktop', '💻 Desktop']] as const).map(([mode, label]) => (
              <button key={mode} type="button" onClick={() => setPreviewMode(mode)} style={{
                padding: '6px 13px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                border: previewMode === mode ? '1.5px solid var(--gold)' : '1.5px solid #E0DDD6',
                background: previewMode === mode ? 'rgba(174,141,45,0.1)' : '#fff',
                color: previewMode === mode ? '#8A7020' : '#888',
              }}>{label}</button>
            ))}
          </div>

          {!active ? (
            <p style={{ fontSize: 12.5, color: '#9A948A', textAlign: 'center', padding: 30 }}>Wähle links eine Nachricht aus.</p>
          ) : previewMode === 'chat' ? (
            /* Chat-Optik (so kommt sie bei Airbnb/Booking & Website-Chat an) */
            <div style={{ borderRadius: 34, background: '#2B2F33', padding: 7, boxShadow: '0 14px 44px rgba(0,0,0,0.18)' }}>
              <div style={{ borderRadius: 28, overflow: 'hidden', background: '#EBE7E0', minHeight: 520, display: 'flex', flexDirection: 'column' }}>
                <div style={{ background: 'linear-gradient(160deg, #12222E 0%, #172A22 100%)', padding: '18px 16px 14px' }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--gold)' }}>TRIMOSA</div>
                  <div style={{ fontSize: 11.5, color: 'rgba(245,240,232,0.7)', marginTop: 2 }}>Nachricht an {ctx.vorname}</div>
                </div>
                <div style={{ flex: 1, padding: '18px 14px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                  <div style={{ alignSelf: 'flex-end', maxWidth: '88%', background: 'linear-gradient(135deg, var(--gold), var(--gold-dark, #8A7020))', color: '#fff', borderRadius: '16px 16px 4px 16px', padding: '11px 14px', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }}>
                    {renderBody(previewText, 'chat')}
                  </div>
                  <div style={{ alignSelf: 'flex-end', fontSize: 10, color: '#9A948A', marginTop: 6 }}>🌍 automatisch übersetzt</div>
                </div>
              </div>
            </div>
          ) : previewMode === 'iphone' ? (
            /* iPhone-Mail-App-Rahmen */
            <div style={{ borderRadius: 34, background: '#2B2F33', padding: 7, boxShadow: '0 14px 44px rgba(0,0,0,0.18)' }}>
              <div style={{ borderRadius: 28, overflow: 'hidden', background: '#fff', maxHeight: 600, overflowY: 'auto' }}>
                <div style={{ background: '#F7F7F7', borderBottom: '1px solid #E3E3E6', padding: '10px 14px 12px' }}>
                  <div style={{ fontSize: 11, color: '#8A8A8E', marginBottom: 6 }}>‹ Postfach</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#111', lineHeight: 1.3 }}>Nachricht von TRIMOSA</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#12222E', color: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>T</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, color: '#111' }}><strong>TRIMOSA</strong> <span style={{ color: '#8A8A8E' }}>16:32</span></div>
                      <div style={{ fontSize: 11, color: '#8A8A8E' }}>an {ctx.name}</div>
                    </div>
                  </div>
                </div>
                <EmailBody>{renderBody(previewText, 'email')}</EmailBody>
              </div>
            </div>
          ) : (
            /* Desktop-Mail-Fenster */
            <div style={{ borderRadius: 12, overflow: 'hidden', background: '#fff', border: '1px solid #E3E3E6', boxShadow: '0 10px 34px rgba(0,0,0,0.12)' }}>
              <div style={{ background: '#F4F4F6', borderBottom: '1px solid #E3E3E6', padding: '12px 16px' }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#FF5F57' }} />
                  <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#FEBC2E' }} />
                  <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#28C840' }} />
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>Nachricht von TRIMOSA</div>
                <div style={{ fontSize: 12, color: '#8A8A8E', marginTop: 4 }}>
                  <strong style={{ color: '#333' }}>TRIMOSA</strong> &lt;buchung@trimosa.de&gt; · an {ctx.name}
                </div>
              </div>
              <div style={{ maxHeight: 560, overflowY: 'auto' }}>
                <EmailBody>{renderBody(previewText, 'email')}</EmailBody>
              </div>
            </div>
          )}

          {active && (
            <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid #E5E1D6' }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#8A7020' }}>⏱ {triggerSummary(active)}</div>
              <div style={{ fontSize: 11, color: '#999', marginTop: 3 }}>
                {active.listing_id ? (activeListing?.title ?? 'Eine Wohnung') : 'Alle Wohnungen'}
                {active.min_nights ? ` · ab ${active.min_nights} Nächten` : ''}
                {active.enabled ? '' : ' · ⏸ pausiert'} · 🌍 automatisch übersetzt
              </div>
            </div>
          )}
          <p style={{ fontSize: 11, color: '#A8A292', margin: '10px 4px 0', lineHeight: 1.55, textAlign: 'center' }}>
            Demo-Daten für die Vorschau. Beim Versand kommen die echten Buchungsdaten rein.
            Bei Airbnb/Booking-Gästen erscheint der Text ohne Logo direkt im Portal.
          </p>
        </div>
      </div>
    </div>
  )
}

const DEMO_MAPPE_URL = 'https://trimosa.de/mappe/a1b2c3'

/**
 * Rendert den Nachrichtentext und macht {mappe} zum klickbaren Link bzw.
 * {mappe_button} zum Button. In der Mail (mode 'email') echte Buttons/Links,
 * im Chat (mode 'chat') klickbarer Link + „📖 …: URL"-Zeile (Chat-Clients
 * verlinken URLs automatisch — ein echter Button geht dort nicht).
 */
function renderBody(text: string, mode: 'email' | 'chat'): React.ReactNode {
  if (!text) return <span style={{ opacity: 0.7 }}>Noch kein Text…</span>
  const parts = text.split(/(\{mappe_button\}|\{mappe\})/g)
  const linkColor = mode === 'chat' ? '#EAF2FF' : '#8A7020'
  return parts.map((p, i) => {
    if (p === '{mappe}') {
      return <a key={i} href={DEMO_MAPPE_URL} target="_blank" rel="noreferrer" style={{ color: linkColor, fontWeight: 600, textDecoration: 'underline', wordBreak: 'break-all' }}>{DEMO_MAPPE_URL.replace('https://', '')}</a>
    }
    if (p === '{mappe_button}') {
      if (mode === 'email') {
        return (
          <span key={i} style={{ display: 'block', margin: '16px 0 6px' }}>
            <a href={DEMO_MAPPE_URL} target="_blank" rel="noreferrer" style={{
              display: 'inline-block', background: 'linear-gradient(135deg, var(--gold), var(--gold-dark, #8A7020))',
              color: '#fff', fontWeight: 700, fontSize: 14, textDecoration: 'none', padding: '12px 26px', borderRadius: 999,
            }}>📖 Zur Gästemappe</a>
          </span>
        )
      }
      return (
        <span key={i} style={{ display: 'block', marginTop: 8 }}>
          📖 Deine Gästemappe: <a href={DEMO_MAPPE_URL} target="_blank" rel="noreferrer" style={{ color: linkColor, fontWeight: 600, textDecoration: 'underline', wordBreak: 'break-all' }}>{DEMO_MAPPE_URL.replace('https://', '')}</a>
        </span>
      )
    }
    return <span key={i}>{p}</span>
  })
}

/* Gebrandeter Mail-Inhalt (Navy-Kopf + Logo + Text + Footer) — matcht lib/email.ts */
function EmailBody({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: '#F2F0EA', padding: '16px 12px' }}>
      <div style={{ maxWidth: 520, margin: '0 auto', borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        {/* Navy-Kopf mit Logo */}
        <div style={{ background: '#12222E', padding: '20px 24px', textAlign: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="TRIMOSA Apartments & Homes" style={{ height: 40, width: 'auto', maxWidth: '70%' }} />
        </div>
        {/* Text */}
        <div style={{ background: '#fff', padding: '22px 24px 20px' }}>
          <div style={{ fontSize: 14, lineHeight: 1.7, color: '#3A362E', whiteSpace: 'pre-wrap' }}>
            {children}
          </div>
        </div>
        {/* Footer */}
        <div style={{ background: '#fff', borderTop: '1px solid #F0EDE5', padding: '14px 24px 18px', textAlign: 'center' }}>
          <div style={{ fontSize: 10.5, color: '#A8A292', lineHeight: 1.5 }}>
            TRIMOSA Apartments &amp; Homes · Ferienwohnungen in Trier, Bitburg &amp; der Südeifel
          </div>
          <div style={{ fontSize: 10.5, color: '#8A7020', marginTop: 3 }}>trimosa.de · Impressum · Datenschutz</div>
        </div>
      </div>
    </div>
  )
}
