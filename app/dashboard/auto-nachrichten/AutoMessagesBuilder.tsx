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
  const previewText = active ? resolvePlaceholders(active.body, ctx) : ''

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

        {/* ── Rechts: Live-Vorschau ── */}
        <div style={{ position: 'sticky', top: 100 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: '#A8A292', marginBottom: 8, textAlign: 'center' }}>
            LIVE-VORSCHAU · SO KOMMT SIE BEIM GAST AN
          </div>
          <div style={{ borderRadius: 34, background: '#2B2F33', padding: 7, boxShadow: '0 14px 44px rgba(0,0,0,0.18)' }}>
            <div style={{ borderRadius: 28, overflow: 'hidden', background: '#EBE7E0', minHeight: 560, display: 'flex', flexDirection: 'column' }}>
              <div style={{ background: 'linear-gradient(160deg, #12222E 0%, #172A22 100%)', padding: '18px 16px 14px' }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--gold)' }}>TRIMOSA</div>
                <div style={{ fontSize: 11.5, color: 'rgba(245,240,232,0.7)', marginTop: 2 }}>Nachricht an {ctx.vorname}</div>
              </div>
              <div style={{ flex: 1, padding: '18px 14px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                {active ? (
                  <>
                    <div style={{ alignSelf: 'flex-end', maxWidth: '86%', background: 'linear-gradient(135deg, var(--gold), var(--gold-dark, #8A7020))', color: '#fff', borderRadius: '16px 16px 4px 16px', padding: '11px 14px', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }}>
                      {previewText || <span style={{ opacity: 0.7 }}>Noch kein Text…</span>}
                    </div>
                    <div style={{ alignSelf: 'flex-end', fontSize: 10, color: '#9A948A', marginTop: 6 }}>
                      🌍 wird automatisch in die Sprache des Gasts übersetzt
                    </div>
                  </>
                ) : (
                  <p style={{ fontSize: 12.5, color: '#9A948A', textAlign: 'center', margin: 'auto' }}>Wähle links eine Nachricht aus.</p>
                )}
              </div>
              {active && (
                <div style={{ background: '#fff', borderTop: '1px solid #E5E1D6', padding: '12px 14px' }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: '#8A7020' }}>⏱ {triggerSummary(active)}</div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 3 }}>
                    {active.listing_id ? (activeListing?.title ?? 'Eine Wohnung') : 'Alle Wohnungen'}
                    {active.min_nights ? ` · ab ${active.min_nights} Nächten` : ''}
                    {active.enabled ? '' : ' · ⏸ pausiert'}
                  </div>
                </div>
              )}
            </div>
          </div>
          <p style={{ fontSize: 11, color: '#A8A292', margin: '12px 4px 0', lineHeight: 1.55, textAlign: 'center' }}>
            Demo-Daten für die Vorschau. Beim Versand werden die echten Buchungsdaten eingesetzt.
          </p>
        </div>
      </div>
    </div>
  )
}
