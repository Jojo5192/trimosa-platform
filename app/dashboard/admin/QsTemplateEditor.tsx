'use client'

/**
 * 🧾 Checklisten-Editor der Qualitätssicherung (Admin): Vorlagen mit
 * Vererbung — Standard (alle) → Standort → einzelne Wohnung; die
 * spezifischste Vorlage gewinnt. Standort/Wohnung starten als Kopie der
 * geerbten Liste und lassen sich jederzeit wieder auf die Erbschaft
 * zurücksetzen. Abgeschlossene Protokolle sind davon NIE betroffen
 * (Abschluss-Snapshot in report.template).
 */
import { useEffect, useState, type CSSProperties } from 'react'
import type { QsSection, QsItem } from '@/lib/qs'

type ListingRow = { id: string; title: string; group: string | null; override: QsSection[] | null }
type Data = {
  base: QsSection[]
  hasBaseOverride: boolean
  groups: Record<string, QsSection[] | null>
  listings: ListingRow[]
}

const clone = (t: QsSection[]): QsSection[] => JSON.parse(JSON.stringify(t))

export default function QsTemplateEditor() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<Data | null>(null)
  const [scope, setScope] = useState('base')
  const [draft, setDraft] = useState<QsSection[] | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function load(keepScope = 'base') {
    const r = await fetch('/api/admin/qs-templates', { cache: 'no-store' })
    if (!r.ok) return
    const d: Data = await r.json()
    setData(d)
    applyScope(keepScope, d)
  }
  useEffect(() => { if (open && !data) load() }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Geerbte Vorlage + Herkunfts-Label für einen Scope (ohne dessen eigenen Override). */
  function inherited(s: string, d: Data): { tpl: QsSection[]; from: string } {
    if (s.startsWith('listing:')) {
      const l = d.listings.find((x) => x.id === s.slice(8))
      if (l?.group && d.groups[l.group]) return { tpl: d.groups[l.group]!, from: `Standort „${l.group}"` }
      return { tpl: d.base, from: 'Standard' }
    }
    return { tpl: d.base, from: 'Standard' }
  }

  function ownOverride(s: string, d: Data): QsSection[] | null {
    if (s === 'base') return d.base // Standard ist immer direkt editierbar
    if (s.startsWith('group:')) return d.groups[s.slice(6)] ?? null
    if (s.startsWith('listing:')) return d.listings.find((x) => x.id === s.slice(8))?.override ?? null
    return null
  }

  function applyScope(s: string, d: Data) {
    setScope(s)
    setDirty(false)
    setMsg(null)
    const own = ownOverride(s, d)
    setDraft(own ? clone(own) : null)
  }

  async function save() {
    if (!draft || saving) return
    setSaving(true)
    setMsg(null)
    try {
      const r = await fetch('/api/admin/qs-templates', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, template: draft }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setMsg(j.error ?? 'Speichern fehlgeschlagen.'); return }
      setMsg('✓ Gespeichert — gilt für alle künftigen Protokolle.')
      setDirty(false)
      await load(scope)
    } finally { setSaving(false) }
  }

  async function removeOverride() {
    if (!data || scope === 'base' && !data.hasBaseOverride) return
    const label = scope === 'base' ? 'den Standard auf die Ausgangs-Checkliste zurücksetzen' : `die eigene Checkliste entfernen (gilt dann wieder: ${inherited(scope, data).from})`
    if (!confirm(`Wirklich ${label}?`)) return
    setSaving(true)
    try {
      const r = await fetch('/api/admin/qs-templates', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope }),
      })
      if (!r.ok) { const j = await r.json().catch(() => ({})); setMsg(j.error ?? 'Fehlgeschlagen.'); return }
      await load(scope)
    } finally { setSaving(false) }
  }

  /* ── Draft-Mutationen ── */
  const mut = (fn: (t: QsSection[]) => void) => {
    setDraft((prev) => { if (!prev) return prev; const next = clone(prev); fn(next); return next })
    setDirty(true)
    setMsg(null)
  }
  const moveIn = <T,>(arr: T[], i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= arr.length) return
    const [x] = arr.splice(i, 1)
    arr.splice(j, 0, x)
  }

  const btn = (active = true): CSSProperties => ({
    width: 26, height: 26, borderRadius: 8, border: 'none', cursor: active ? 'pointer' : 'default',
    background: 'rgba(120,120,128,0.1)', color: active ? '#555' : '#C7C7CC', fontSize: 12, flexShrink: 0,
  })
  const input: CSSProperties = {
    border: '1px solid #E0DDD6', borderRadius: 9, padding: '7px 10px', fontSize: 13.5,
    background: '#fff', color: '#111', minWidth: 0, boxSizing: 'border-box',
  }

  const inheritedInfo = data && scope !== 'base' && !draft ? inherited(scope, data) : null

  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: '22px 22px 20px', marginTop: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111', margin: '0 0 4px' }}>📋 Checklisten-Editor</h2>
          <p style={{ fontSize: 12.5, color: '#888', margin: 0, lineHeight: 1.55 }}>
            Prüfpunkte der QS-Protokolle anpassen — als Standard, je Standort oder je Wohnung
            (die spezifischste Liste gewinnt). Abgeschlossene Protokolle bleiben unverändert.
          </p>
        </div>
        <button onClick={() => setOpen(!open)} style={{
          padding: '7px 15px', borderRadius: 999, border: 'none', fontSize: 12.5, fontWeight: 700, flexShrink: 0,
          background: open ? 'rgba(120,120,128,0.12)' : '#0F766E', color: open ? '#3C3C43' : '#fff', cursor: 'pointer',
        }}>{open ? 'Schließen' : 'Öffnen'}</button>
      </div>

      {open && !data && <p style={{ fontSize: 13, color: '#999', margin: '16px 0 0' }}>Lädt…</p>}

      {open && data && (
        <div style={{ marginTop: 16 }}>
          <select
            value={scope}
            onChange={(e) => {
              if (dirty && !confirm('Ungespeicherte Änderungen verwerfen?')) return
              applyScope(e.target.value, data)
            }}
            style={{ ...input, width: '100%', maxWidth: 420, padding: '9px 10px' }}
          >
            <option value="base">🌐 Standard (alle Wohnungen){data.hasBaseOverride ? ' — angepasst' : ''}</option>
            <optgroup label="Standorte">
              {Object.entries(data.groups).map(([g, tpl]) => (
                <option key={g} value={'group:' + g}>📍 {g}{tpl ? ' — eigene Liste' : ''}</option>
              ))}
            </optgroup>
            <optgroup label="Wohnungen">
              {data.listings.map((l) => (
                <option key={l.id} value={'listing:' + l.id}>🏠 {l.title}{l.override ? ' — eigene Liste' : ''}</option>
              ))}
            </optgroup>
          </select>

          {inheritedInfo && (
            <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 12, background: '#F7F7F8', fontSize: 13, color: '#555', lineHeight: 1.5 }}>
              Nutzt aktuell die Checkliste: <strong>{inheritedInfo.from}</strong> ({inheritedInfo.tpl.reduce((s, x) => s + x.items.length, 0)} Punkte).
              <div style={{ marginTop: 10 }}>
                <button onClick={() => { setDraft(clone(inheritedInfo.tpl)); setDirty(true) }} style={{
                  padding: '8px 16px', borderRadius: 999, border: 'none', fontSize: 12.5, fontWeight: 700,
                  background: '#0F766E', color: '#fff', cursor: 'pointer',
                }}>Eigene Checkliste anlegen (als Kopie)</button>
              </div>
            </div>
          )}

          {draft && (
            <div style={{ marginTop: 14 }}>
              {draft.map((sec, si) => (
                <div key={si} style={{ border: '1px solid #EDEAE2', borderRadius: 14, padding: '12px 14px', marginBottom: 12, background: '#FCFBF9' }}>
                  <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 10 }}>
                    <input value={sec.emoji} onChange={(e) => mut((t) => { t[si].emoji = e.target.value })} maxLength={4}
                      style={{ ...input, width: 46, textAlign: 'center' }} />
                    <input value={sec.title} onChange={(e) => mut((t) => { t[si].title = e.target.value })}
                      placeholder="Bereichs-Name" style={{ ...input, flex: 1, fontWeight: 700 }} />
                    <button title="Nach oben" onClick={() => mut((t) => moveIn(t, si, -1))} style={btn(si > 0)}>↑</button>
                    <button title="Nach unten" onClick={() => mut((t) => moveIn(t, si, 1))} style={btn(si < draft.length - 1)}>↓</button>
                    <button title="Bereich löschen" onClick={() => { if (confirm(`Bereich „${sec.title}" mit ${sec.items.length} Punkten löschen?`)) mut((t) => { t.splice(si, 1) }) }}
                      style={{ ...btn(), color: '#B91C1C' }}>✕</button>
                  </div>
                  {sec.items.map((item: QsItem, ii: number) => (
                    <div key={ii} style={{ padding: '7px 0', borderTop: ii > 0 ? '1px solid #F0EDE6' : 'none' }}>
                      <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                        <input value={item.label} onChange={(e) => mut((t) => { t[si].items[ii].label = e.target.value })}
                          placeholder="Prüfpunkt" style={{ ...input, flex: 1 }} />
                        <select value={item.type} onChange={(e) => mut((t) => { t[si].items[ii].type = e.target.value as QsItem['type'] })}
                          style={{ ...input, width: 120, flexShrink: 0 }}>
                          <option value="zustand">Zustand</option>
                          <option value="anzahl">+ Anzahl</option>
                        </select>
                        <button title="Nach oben" onClick={() => mut((t) => moveIn(t[si].items, ii, -1))} style={btn(ii > 0)}>↑</button>
                        <button title="Nach unten" onClick={() => mut((t) => moveIn(t[si].items, ii, 1))} style={btn(ii < sec.items.length - 1)}>↓</button>
                        <button title="Punkt löschen" onClick={() => mut((t) => { t[si].items.splice(ii, 1) })} style={{ ...btn(), color: '#B91C1C' }}>✕</button>
                      </div>
                      <input value={item.hint ?? ''} onChange={(e) => mut((t) => { t[si].items[ii].hint = e.target.value })}
                        placeholder="Hinweis für die Prüferin (optional)"
                        style={{ ...input, width: '100%', marginTop: 5, fontSize: 12, color: '#777', padding: '5px 10px' }} />
                    </div>
                  ))}
                  <button onClick={() => mut((t) => { t[si].items.push({ id: '', label: '', type: 'zustand' }) })} style={{
                    marginTop: 8, padding: '6px 13px', borderRadius: 999, border: '1.5px dashed #D8D2C4',
                    background: 'none', color: '#8A7020', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}>+ Punkt</button>
                </div>
              ))}
              <button onClick={() => mut((t) => { t.push({ id: '', title: '', emoji: '📋', items: [{ id: '', label: '', type: 'zustand' }] }) })} style={{
                width: '100%', padding: '10px 0', borderRadius: 12, border: '2px dashed #D8D2C4',
                background: '#FCFBF7', color: '#8A7020', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>+ Bereich</button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
                <button onClick={save} disabled={saving || !dirty} style={{
                  padding: '10px 22px', borderRadius: 999, border: 'none', fontSize: 13.5, fontWeight: 800,
                  background: dirty && !saving ? '#0F766E' : '#E5E1D6', color: dirty && !saving ? '#fff' : '#999', cursor: 'pointer',
                }}>{saving ? 'Speichert…' : 'Speichern'}</button>
                {(scope !== 'base' || data.hasBaseOverride) && (
                  <button onClick={removeOverride} disabled={saving} style={{
                    padding: '10px 16px', borderRadius: 999, border: 'none', fontSize: 12.5, fontWeight: 700,
                    background: '#FEF2F2', color: '#B91C1C', cursor: 'pointer',
                  }}>{scope === 'base' ? 'Auf Ausgangsliste zurücksetzen' : 'Eigene Checkliste entfernen'}</button>
                )}
                {msg && <span style={{ fontSize: 12.5, color: msg.startsWith('✓') ? '#15803D' : '#B45309' }}>{msg}</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
