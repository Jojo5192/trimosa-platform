'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  BLOCK_META, defaultTemplate, emptyBlock, type GuideBlock, type GuideCtx,
} from '@/lib/guide'
import GuideBlocks, { DE_LABELS } from '@/components/guide/GuideBlocks'

/**
 * 📖 Gästemappen-Builder (Client): links Bausteine anordnen und ausfüllen,
 * rechts die Live-Vorschau im Handy-Rahmen (identischer Renderer wie die
 * echte Mappe). Speichern schreibt listings.guide via PATCH.
 */

export interface BuilderListing { id: string; title: string; blocks: GuideBlock[]; ctx: GuideCtx }

interface MappeLink { id: string; guestName: string; checkIn: string; checkOut: string; channel: string | null; url: string | null }

const INPUT: React.CSSProperties = {
  width: '100%', borderRadius: 10, border: '1.5px solid #E0DDD6', padding: '8px 12px',
  fontSize: 13, color: '#111', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', background: '#fff',
}

function fmtD(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y.slice(2)}`
}

export default function MappeBuilder({ listings }: { listings: BuilderListing[] }) {
  const [listingId, setListingId] = useState(listings[0]?.id ?? '')
  const current = useMemo(() => listings.find((l) => l.id === listingId), [listings, listingId])
  const [blocks, setBlocks] = useState<GuideBlock[]>(current?.blocks ?? [])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [links, setLinks] = useState<MappeLink[]>([])
  const [copiedLink, setCopiedLink] = useState<string | null>(null)

  // Wohnungswechsel: Blöcke der neuen Wohnung laden (ungespeicherte Änderungen verwerfen nach Rückfrage)
  function switchListing(id: string) {
    if (dirty && !confirm('Ungespeicherte Änderungen verwerfen?')) return
    setListingId(id)
    const next = listings.find((l) => l.id === id)
    setBlocks(next?.blocks ?? [])
    setDirty(false)
    setError(null)
  }

  useEffect(() => {
    if (!listingId) return
    fetch(`/api/mappe-links?listingId=${listingId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { bookings: [] }))
      .then((d) => setLinks(d.bookings ?? []))
      .catch(() => setLinks([]))
  }, [listingId])

  function update(id: string, patch: Partial<GuideBlock>) {
    setBlocks((bs) => bs.map((b) => (b.id === id ? ({ ...b, ...patch } as GuideBlock) : b)))
    setDirty(true)
  }
  function move(id: string, dir: -1 | 1) {
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= bs.length) return bs
      const copy = [...bs]
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
      return copy
    })
    setDirty(true)
  }
  function remove(id: string) {
    setBlocks((bs) => bs.filter((b) => b.id !== id))
    setDirty(true)
  }
  function add(type: GuideBlock['type']) {
    setBlocks((bs) => [...bs, emptyBlock(type)])
    setPaletteOpen(false)
    setDirty(true)
  }

  async function save() {
    if (!current) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/listings/${current.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guide: { blocks } }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `HTTP ${res.status}`)
      }
      current.blocks = blocks
      setDirty(false)
      setSavedAt(Date.now())
      setTimeout(() => setSavedAt(null), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.')
    } finally {
      setSaving(false)
    }
  }

  if (!current) return <p style={{ color: '#777', fontSize: 14 }}>Keine aktiven Inserate gefunden.</p>

  return (
    <div>
      {/* Kopfzeile: Wohnungswahl + Speichern */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
        <select value={listingId} onChange={(e) => switchListing(e.target.value)} style={{ ...INPUT, width: 'auto', minWidth: 220, fontWeight: 600 }}>
          {listings.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
        </select>
        {blocks.length === 0 && (
          <button type="button" onClick={() => { setBlocks(defaultTemplate()); setDirty(true) }} style={{
            padding: '9px 16px', borderRadius: 999, border: '1.5px solid var(--gold)', background: '#fff',
            color: '#8A7020', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
          }}>✨ Standard-Vorlage laden</button>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {savedAt && <span style={{ fontSize: 12.5, fontWeight: 700, color: '#16A34A' }}>✓ Gespeichert</span>}
          {dirty && !savedAt && <span style={{ fontSize: 12, color: '#B45309' }}>Ungespeicherte Änderungen</span>}
          <button type="button" onClick={save} disabled={saving || !dirty} style={{
            padding: '10px 22px', borderRadius: 999, border: 'none', cursor: saving || !dirty ? 'default' : 'pointer',
            background: dirty ? 'linear-gradient(135deg, var(--gold), var(--gold-dark, #8A7020))' : '#E5E1D6',
            color: dirty ? '#fff' : '#999', fontSize: 13.5, fontWeight: 700,
          }}>{saving ? 'Speichert…' : 'Speichern'}</button>
        </div>
      </div>
      {error && (
        <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 13, color: '#B91C1C' }}>
          ⚠️ {error}
        </div>
      )}

      <div className="mappe-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 24, alignItems: 'start' }}>
        {/* ── Linke Spalte: Blöcke ── */}
        <div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {blocks.map((b, i) => (
              <BlockEditor
                key={b.id} block={b} index={i} total={blocks.length}
                onChange={(patch) => update(b.id, patch)}
                onMove={(dir) => move(b.id, dir)}
                onRemove={() => remove(b.id)}
              />
            ))}
          </div>

          {/* Palette */}
          <div style={{ marginTop: 14 }}>
            {!paletteOpen ? (
              <button type="button" onClick={() => setPaletteOpen(true)} style={{
                width: '100%', padding: '13px 0', borderRadius: 14, border: '2px dashed #D8D2C4',
                background: '#FCFBF7', color: '#8A7020', fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
              }}>+ Baustein hinzufügen</button>
            ) : (
              <div style={{ border: '1px solid #E5E1D6', borderRadius: 14, background: '#fff', padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>Baustein wählen</span>
                  <button type="button" onClick={() => setPaletteOpen(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#999', fontSize: 14, fontWeight: 700 }}>✕</button>
                </div>
                {([false, true] as const).map((smart) => (
                  <div key={String(smart)} style={{ marginBottom: smart ? 0 : 10 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: '#A8A292', margin: '4px 0 7px' }}>
                      {smart ? 'AUS DEM INSERAT (BEFÜLLT SICH SELBST)' : 'INHALT'}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                      {(Object.entries(BLOCK_META) as [GuideBlock['type'], typeof BLOCK_META[keyof typeof BLOCK_META]][])
                        .filter(([, m]) => !!m.smart === smart)
                        .map(([type, m]) => (
                          <button key={type} type="button" onClick={() => add(type)} title={m.hint} style={{
                            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10,
                            border: '1px solid #E5E1D6', background: '#FCFBF7', cursor: 'pointer', textAlign: 'left',
                          }}>
                            <span style={{ fontSize: 16, flexShrink: 0 }}>{m.icon}</span>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#333' }}>{m.label}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Mappe-Links */}
          {links.length > 0 && (
            <div style={{ marginTop: 26, border: '1px solid #E5E1D6', borderRadius: 14, background: '#fff', padding: '16px 18px' }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: '#111', marginBottom: 4 }}>🔗 Mappe-Links aktueller Buchungen</div>
              <p style={{ fontSize: 12, color: '#999', margin: '0 0 10px', lineHeight: 1.5 }}>
                Jeder Gast hat seinen persönlichen Link — kopieren und per Chat schicken. (Automatischer Versand kommt mit den Auto-Nachrichten.)
              </p>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {links.map((b) => (
                  <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid #F0EDE5' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>{b.guestName}</span>
                      <span style={{ fontSize: 11.5, color: '#999', marginLeft: 8 }}>{fmtD(b.checkIn)}–{fmtD(b.checkOut)}{b.channel ? ` · ${b.channel}` : ''}</span>
                    </div>
                    {b.url && (
                      <button type="button" onClick={() => {
                        navigator.clipboard?.writeText(`${location.origin}${b.url}`)
                        setCopiedLink(b.id)
                        setTimeout(() => setCopiedLink((c) => (c === b.id ? null : c)), 1800)
                      }} style={{
                        flexShrink: 0, padding: '6px 12px', borderRadius: 999, border: '1px solid #E5E1D6',
                        background: copiedLink === b.id ? '#16A34A' : '#fff', color: copiedLink === b.id ? '#fff' : '#555',
                        fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                      }}>{copiedLink === b.id ? '✓ Kopiert' : 'Link kopieren'}</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Rechte Spalte: Live-Vorschau ── */}
        <div style={{ position: 'sticky', top: 100 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: '#A8A292', marginBottom: 8, textAlign: 'center' }}>
            LIVE-VORSCHAU · SO SIEHT ES DEIN GAST
          </div>
          <div style={{ borderRadius: 34, background: '#2B2F33', padding: 7, boxShadow: '0 14px 44px rgba(0,0,0,0.18)' }}>
            <div style={{ borderRadius: 28, overflow: 'hidden', background: '#F5F3EE', height: 620, overflowY: 'auto' }}>
              <div style={{ background: 'linear-gradient(160deg, #12222E 0%, #172A22 100%)', padding: '22px 16px 18px' }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--gold)', marginBottom: 9 }}>TRIMOSA</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#F5F0E8' }}>Hallo Anna! 👋</div>
                <div style={{ fontSize: 11.5, color: 'rgba(245,240,232,0.7)', marginTop: 3 }}>
                  Dein Aufenthalt im <strong style={{ color: '#E3C878' }}>{current.ctx.listingTitle}</strong>
                </div>
              </div>
              <div style={{ padding: '16px 12px 30px' }}>
                <GuideBlocks blocks={blocks} ctx={current.ctx} labels={DE_LABELS} preview />
                {blocks.length === 0 && (
                  <p style={{ fontSize: 12.5, color: '#A8A292', textAlign: 'center', marginTop: 30, lineHeight: 1.6 }}>
                    Noch keine Bausteine.<br />Lade links die Standard-Vorlage oder füge Bausteine hinzu.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}

/* ── Einzelner Block im Editor ── */
function BlockEditor({ block, index, total, onChange, onMove, onRemove }: {
  block: GuideBlock
  index: number
  total: number
  onChange: (patch: Partial<GuideBlock>) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}) {
  const meta = BLOCK_META[block.type]
  const btn: React.CSSProperties = {
    width: 26, height: 26, borderRadius: 8, border: '1px solid #E5E1D6', background: '#fff',
    cursor: 'pointer', fontSize: 12, color: '#777', display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
  return (
    <div style={{ border: '1px solid #E5E1D6', borderRadius: 14, background: '#fff', padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: meta.smart ? 0 : 10 }}>
        <span style={{ fontSize: 15 }}>{meta.icon}</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#333', flex: 1 }}>
          {meta.label}
          {meta.smart && <span style={{ fontWeight: 400, color: '#A8A292', marginLeft: 8, fontSize: 11.5 }}>befüllt sich aus dem Inserat</span>}
        </span>
        <button type="button" style={{ ...btn, opacity: index === 0 ? 0.35 : 1 }} disabled={index === 0} onClick={() => onMove(-1)} title="Nach oben">↑</button>
        <button type="button" style={{ ...btn, opacity: index === total - 1 ? 0.35 : 1 }} disabled={index === total - 1} onClick={() => onMove(1)} title="Nach unten">↓</button>
        <button type="button" style={{ ...btn, color: '#DC2626' }} onClick={onRemove} title="Entfernen">✕</button>
      </div>

      {block.type === 'heading' && (
        <input style={{ ...INPUT, fontWeight: 700 }} placeholder="Überschrift…" value={block.text} onChange={(e) => onChange({ text: e.target.value })} />
      )}
      {block.type === 'text' && (
        <textarea style={{ ...INPUT, resize: 'vertical' }} rows={3} placeholder="Text…" value={block.text} onChange={(e) => onChange({ text: e.target.value })} />
      )}
      {block.type === 'warning' && (
        <textarea style={{ ...INPUT, resize: 'vertical' }} rows={2} placeholder="Wichtiger Hinweis…" value={block.text} onChange={(e) => onChange({ text: e.target.value })} />
      )}
      {block.type === 'info' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...INPUT, width: 58, textAlign: 'center' }} maxLength={4} value={block.emoji} onChange={(e) => onChange({ emoji: e.target.value })} title="Emoji" />
            <input style={INPUT} placeholder="Titel (z. B. Parken)" value={block.title} onChange={(e) => onChange({ title: e.target.value })} />
          </div>
          <textarea style={{ ...INPUT, resize: 'vertical' }} rows={2} placeholder="Text…" value={block.text} onChange={(e) => onChange({ text: e.target.value })} />
        </div>
      )}
      {block.type === 'steps' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input style={INPUT} placeholder="Titel (z. B. So kommst du rein)" value={block.title} onChange={(e) => onChange({ title: e.target.value })} />
          <textarea
            style={{ ...INPUT, resize: 'vertical' }} rows={Math.max(3, block.steps.length + 1)}
            placeholder={'Ein Schritt pro Zeile…'}
            value={block.steps.join('\n')}
            onChange={(e) => onChange({ steps: e.target.value.split('\n') })}
          />
          <span style={{ fontSize: 11, color: '#A8A292' }}>Eine Zeile = ein Schritt (wird automatisch nummeriert)</span>
        </div>
      )}
      {block.type === 'wifi' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input style={{ ...INPUT, flex: '1 1 160px' }} placeholder="Netzwerkname (SSID)" value={block.ssid} onChange={(e) => onChange({ ssid: e.target.value })} />
          <input style={{ ...INPUT, flex: '1 1 160px' }} placeholder="Passwort" value={block.password} onChange={(e) => onChange({ password: e.target.value })} />
        </div>
      )}
      {block.type === 'door' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input style={INPUT} placeholder="Titel" value={block.title} onChange={(e) => onChange({ title: e.target.value })} />
          <textarea style={{ ...INPUT, resize: 'vertical' }} rows={3} placeholder="Wie kommt der Gast an den Schlüssel? (Später ersetzt der automatische Türcode diesen Text.)" value={block.text} onChange={(e) => onChange({ text: e.target.value })} />
        </div>
      )}
      {block.type === 'contact' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input style={INPUT} placeholder="Telefonnummer (z. B. +49 170 1234567)" value={block.phone} onChange={(e) => onChange({ phone: e.target.value })} />
          <textarea style={{ ...INPUT, resize: 'vertical' }} rows={2} placeholder="Hinweis (z. B. wann ihr erreichbar seid)" value={block.note} onChange={(e) => onChange({ note: e.target.value })} />
        </div>
      )}
    </div>
  )
}
