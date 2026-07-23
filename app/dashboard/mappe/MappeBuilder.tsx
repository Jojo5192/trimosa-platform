'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  BLOCK_META, PHASE_META, defaultTemplate, emptyBlock, newBlockId, blockPhases, blockForListing,
  blockVisibleInPhase, DE_LABELS, type GuideBlock, type GuideCtx, type GuidePhase,
} from '@/lib/guide'
import GuideBlocks from '@/components/guide/GuideBlocks'
import AiPolishButton from '@/components/AiPolishButton'

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

export default function MappeBuilder({ listings, pool }: { listings: BuilderListing[]; pool: GuideBlock[] }) {
  // §150 Pool-Modell: EIN Baustein-Bestand für alle Wohnungen; `filter`
  // steuert, welche Wohnung in Liste + Vorschau gezeigt wird ('' = alle).
  const [blocks, setBlocks] = useState<GuideBlock[]>(pool)
  const [filter, setFilter] = useState(listings[0]?.id ?? '')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [links, setLinks] = useState<MappeLink[]>([])
  const [copiedLink, setCopiedLink] = useState<string | null>(null)

  // Vorschau-Wohnung: der Filter (bzw. die erste Wohnung bei „Alle")
  const previewListing = useMemo(
    () => listings.find((l) => l.id === filter) ?? listings[0],
    [listings, filter],
  )
  const linksListingId = previewListing?.id ?? ''

  // Sichtbare Bausteine in der Liste (Filter nach Wohnung)
  const visibleBlocks = useMemo(
    () => (filter ? blocks.filter((b) => blockForListing(b, filter)) : blocks),
    [blocks, filter],
  )
  // §160-Ergänzung: Vorschau-Phase — zeigt die Mappe so, wie sie zum
  // jeweiligen Zeitpunkt aussieht ('alle' = ohne Phasen-Filter).
  const [previewPhase, setPreviewPhase] = useState<'alle' | Exclude<GuidePhase, 'immer'>>('alle')
  // Vorschau: nur aktive Bausteine der Vorschau-Wohnung (+ Phasen-Filter;
  // nights=99, damit „ab X Nächten"-Bausteine die Phasen-Vorschau nicht stören)
  const previewBlocks = useMemo(
    () => blocks.filter((b) =>
      !b.disabled
      && (!previewListing || blockForListing(b, previewListing.id))
      && (previewPhase === 'alle' || blockVisibleInPhase(b, previewPhase, 99))),
    [blocks, previewListing, previewPhase],
  )

  useEffect(() => {
    if (!linksListingId) return
    fetch(`/api/mappe-links?listingId=${linksListingId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { bookings: [] }))
      .then((d) => setLinks(d.bookings ?? []))
      .catch(() => setLinks([]))
  }, [linksListingId])

  function update(id: string, patch: Partial<GuideBlock>) {
    setBlocks((bs) => bs.map((b) => (b.id === id ? ({ ...b, ...patch } as GuideBlock) : b)))
    setDirty(true)
  }
  /** Verschieben innerhalb der SICHTBAREN Liste (Filter!) — getauscht wird
   *  mit dem sichtbaren Nachbarn, Positionen im Gesamt-Pool. */
  function move(id: string, dir: -1 | 1) {
    setBlocks((bs) => {
      const vis = filter ? bs.filter((b) => blockForListing(b, filter)) : bs
      const vi = vis.findIndex((b) => b.id === id)
      const partner = vis[vi + dir]
      if (vi < 0 || !partner) return bs
      const i = bs.findIndex((b) => b.id === id)
      const j = bs.findIndex((b) => b.id === partner.id)
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
  /** §159: Baustein duplizieren — Kopie erscheint direkt DARUNTER (macht
   *  wohnungs-spezifische Varianten leicht: kopieren, Wohnung umstellen). */
  function duplicate(id: string) {
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.id === id)
      if (i < 0) return bs
      const copy = { ...bs[i], id: newBlockId() } as GuideBlock
      return [...bs.slice(0, i + 1), copy, ...bs.slice(i + 1)]
    })
    setDirty(true)
  }
  function add(type: GuideBlock['type']) {
    // Neuer Baustein übernimmt den aktiven Wohnungs-Filter als Vorbelegung
    const nb = emptyBlock(type)
    if (filter) nb.listingIds = [filter]
    setBlocks((bs) => [...bs, nb])
    setPaletteOpen(false)
    setDirty(true)
  }

  /** Einmal-Import: bestehende Wohnungs-Mappen in den Pool übernehmen
   *  (je Baustein der Wohnung zugeordnet — danach im Pool konsolidierbar). */
  function importLegacy() {
    const imported: GuideBlock[] = []
    for (const l of listings) {
      for (const b of l.blocks) {
        imported.push({ ...b, id: newBlockId(), listingIds: [l.id] } as GuideBlock)
      }
    }
    if (!imported.length) return
    setBlocks(imported)
    setDirty(true)
  }
  const hasLegacy = listings.some((l) => l.blocks.length > 0)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/guide-global', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `HTTP ${res.status}`)
      }
      setDirty(false)
      setSavedAt(Date.now())
      setTimeout(() => setSavedAt(null), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.')
    } finally {
      setSaving(false)
    }
  }

  if (!previewListing) return <p style={{ color: '#777', fontSize: 14 }}>Keine aktiven Inserate gefunden.</p>

  return (
    <div>
      {/* Kopfzeile: Wohnungs-Filter (Liste + Vorschau) + Speichern */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
        <span style={{ fontSize: 12, color: '#888' }}>Filter &amp; Vorschau:</span>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ ...INPUT, width: 'auto', minWidth: 220, fontWeight: 600 }}>
          <option value="">🌐 Alle Bausteine</option>
          {listings.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
        </select>
        {blocks.length === 0 && (
          <>
            {hasLegacy && (
              <button type="button" onClick={importLegacy} style={{
                padding: '9px 16px', borderRadius: 999, border: 'none', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                background: 'linear-gradient(135deg, var(--gold), var(--gold-dark, #8A7020))',
              }}>📥 Bestehende Wohnungs-Mappen übernehmen</button>
            )}
            <button type="button" onClick={() => { setBlocks(defaultTemplate()); setDirty(true) }} style={{
              padding: '9px 16px', borderRadius: 999, border: '1.5px solid var(--gold)', background: '#fff',
              color: '#8A7020', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
            }}>✨ Standard-Vorlage laden</button>
          </>
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
          {filter && visibleBlocks.length < blocks.length && (
            <p style={{ fontSize: 11.5, color: '#A8A292', margin: '0 0 8px' }}>
              Gefiltert: {visibleBlocks.length} von {blocks.length} Bausteinen gelten für {previewListing.title} —
              „🌐 Alle Bausteine" zeigt den kompletten Bestand.
            </p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {visibleBlocks.map((b, i) => (
              <BlockEditor
                key={b.id} block={b} index={i} total={visibleBlocks.length}
                listings={listings}
                onChange={(patch) => update(b.id, patch)}
                onMove={(dir) => move(b.id, dir)}
                onRemove={() => remove(b.id)}
                onDuplicate={() => duplicate(b.id)}
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
            LIVE-VORSCHAU · {previewListing.title.toUpperCase()}
          </div>
          {/* §160: Vorschau-Zeitpunkt — zeigt genau die Bausteine der Phase */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {([['alle', 'Alle'], ['vor', 'Vor Anreise'], ['waehrend', 'Während'], ['nach', 'Nach Abreise']] as const).map(([v, lbl]) => {
              const on = previewPhase === v
              return (
                <button key={v} type="button" onClick={() => setPreviewPhase(v)} style={{
                  padding: '4px 11px', borderRadius: 999, cursor: 'pointer', fontSize: 11.5, fontWeight: 700,
                  border: on ? '1px solid transparent' : '1px solid #E5E1D6',
                  background: on ? 'linear-gradient(135deg, var(--gold), var(--gold-dark))' : '#fff',
                  color: on ? '#fff' : '#8A857B',
                }}>{lbl}</button>
              )
            })}
          </div>
          <div style={{ borderRadius: 34, background: '#2B2F33', padding: 7, boxShadow: '0 14px 44px rgba(0,0,0,0.18)' }}>
            <div style={{ borderRadius: 28, overflow: 'hidden', background: '#F5F3EE', height: 620, overflowY: 'auto' }}>
              <div style={{ background: 'linear-gradient(160deg, #12222E 0%, #172A22 100%)', padding: '20px 16px 16px' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt="TRIMOSA" style={{ maxHeight: 32, maxWidth: '60%', width: 'auto', height: 'auto', display: 'block', marginBottom: 10 }} />
                <div style={{ fontSize: 18, fontWeight: 800, color: '#F5F0E8' }}>Hallo Anna! 👋</div>
                <div style={{ fontSize: 11.5, color: 'rgba(245,240,232,0.7)', marginTop: 3 }}>
                  Dein Aufenthalt im <strong style={{ color: '#E3C878' }}>{previewListing.ctx.listingTitle}</strong>
                </div>
              </div>
              <div style={{ padding: '16px 12px 30px' }}>
                <GuideBlocks blocks={previewBlocks} ctx={previewListing.ctx} labels={DE_LABELS} preview />
                {previewBlocks.length === 0 && (
                  <p style={{ fontSize: 12.5, color: '#A8A292', textAlign: 'center', marginTop: 30, lineHeight: 1.6 }}>
                    {previewPhase === 'alle'
                      ? <>Keine aktiven Bausteine für diese Wohnung.<br />Füge Bausteine hinzu oder ordne bestehende zu.</>
                      : <>Zu diesem Zeitpunkt ist kein Baustein sichtbar.</>}
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

/* ── Foto-Kompression (Task-Foto-Muster §89) ── */
async function compressToJpeg(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file)
    const max = 1600
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((res) => canvas.toBlob((b) => res(b ?? file), 'image/jpeg', 0.82))
  } catch {
    return file
  }
}

/* ── Einzelner Block im Editor ── */
function BlockEditor({ block, index, total, listings, onChange, onMove, onRemove, onDuplicate }: {
  block: GuideBlock
  index: number
  total: number
  listings: { id: string; title: string }[]
  onChange: (patch: Partial<GuideBlock>) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  onDuplicate: () => void
}) {
  const meta = BLOCK_META[block.type]
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadErr, setUploadErr] = useState('')

  async function uploadImage(file: File) {
    setUploadBusy(true)
    setUploadErr('')
    try {
      const blob = await compressToJpeg(file)
      const fd = new FormData()
      fd.append('file', new File([blob], 'foto.jpg', { type: blob.type || 'image/jpeg' }))
      const res = await fetch('/api/guide-image', { method: 'POST', body: fd })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`)
      onChange({ url: d.url } as Partial<GuideBlock>)
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : 'Upload fehlgeschlagen.')
    } finally {
      setUploadBusy(false)
    }
  }

  // §150: Mehrfach-Phasen (leer = immer) + Wohnungs-Zuordnung (leer = alle)
  const activePhases = blockPhases(block)
  function togglePhase(p: GuidePhase) {
    if (p === 'immer') { onChange({ phases: undefined, phase: undefined } as Partial<GuideBlock>); return }
    const set = new Set(activePhases)
    const key = p as Exclude<GuidePhase, 'immer'>
    if (set.has(key)) set.delete(key)
    else set.add(key)
    onChange({
      phases: set.size > 0 && set.size < 3 ? [...set] : undefined,
      phase: undefined,
    } as Partial<GuideBlock>)
  }
  function toggleListing(id: string) {
    const cur = block.listingIds ?? []
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    onChange({ listingIds: next.length > 0 && next.length < listings.length ? next : undefined } as Partial<GuideBlock>)
  }
  const btn: React.CSSProperties = {
    width: 26, height: 26, borderRadius: 8, border: '1px solid #E5E1D6', background: '#fff',
    cursor: 'pointer', fontSize: 12, color: '#777', display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
  // ✨ KI-Formulierhilfe (§149) für die Freitext-Bausteine — welches Feld
  // je Baustein-Typ poliert wird (steps behalten das Zeilen-Format)
  const aiText = block.type === 'steps' ? block.steps.join('\n')
    : block.type === 'contact' ? (block.note ?? '')
    : (block.type === 'text' || block.type === 'warning' || block.type === 'info' || block.type === 'door') ? (block.text ?? '')
    : null
  const aiAccept = (v: string) => {
    if (block.type === 'steps') onChange({ steps: v.split('\n') } as Partial<GuideBlock>)
    else if (block.type === 'contact') onChange({ note: v } as Partial<GuideBlock>)
    else onChange({ text: v } as Partial<GuideBlock>)
  }
  return (
    <div style={{
      border: block.disabled ? '1px dashed #D8D2C4' : '1px solid #E5E1D6', borderRadius: 14,
      background: '#fff', padding: '12px 14px', opacity: block.disabled ? 0.55 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: meta.smart ? 0 : 10 }}>
        <span style={{ fontSize: 15 }}>{meta.icon}</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#333', flex: 1 }}>
          {meta.label}
          {block.disabled && <span style={{ fontWeight: 700, color: '#B45309', marginLeft: 8, fontSize: 11 }}>⏸ pausiert</span>}
          {meta.smart && <span style={{ fontWeight: 400, color: '#A8A292', marginLeft: 8, fontSize: 11.5 }}>befüllt sich aus dem Inserat</span>}
        </span>
        {/* Aktiv/Inaktiv (§150) */}
        <button type="button" onClick={() => onChange({ disabled: block.disabled ? undefined : true } as Partial<GuideBlock>)}
          title={block.disabled ? 'Baustein aktivieren' : 'Baustein pausieren'} style={{
            width: 40, height: 22, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative',
            background: block.disabled ? '#D1D1D6' : '#34C759', transition: 'background .15s', flexShrink: 0,
          }}>
          <span style={{ position: 'absolute', top: 2, left: block.disabled ? 2 : 20, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
        </button>
        <button type="button" style={btn} onClick={onDuplicate} title="Duplizieren (Kopie erscheint darunter)">⧉</button>
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
      {block.type === 'image' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {block.url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={block.url} alt={block.caption || 'Foto'} style={{ width: '100%', maxWidth: 320, height: 'auto', borderRadius: 12, display: 'block' }} />
          )}
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, alignSelf: 'flex-start',
            padding: '8px 15px', borderRadius: 999, border: '1.5px solid var(--gold)', background: '#fff',
            color: '#8A7020', fontSize: 12, fontWeight: 700, cursor: uploadBusy ? 'wait' : 'pointer',
            opacity: uploadBusy ? 0.6 : 1,
          }}>
            {uploadBusy ? '⏳ Lädt hoch…' : block.url ? '🔄 Foto ersetzen' : '📷 Foto hochladen'}
            <input type="file" accept="image/*" style={{ display: 'none' }} disabled={uploadBusy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = '' }} />
          </label>
          {uploadErr && <span style={{ fontSize: 11.5, color: '#B91C1C' }}>⚠️ {uploadErr}</span>}
          <input style={INPUT} placeholder="Bildunterschrift (optional, z. B. Dein Parkplatz Nr. 3)" value={block.caption} onChange={(e) => onChange({ caption: e.target.value })} />
        </div>
      )}

      {/* §160-Kleinigkeit: Check-in-/Check-out-Zeit getrennt anzeigbar — als
          zwei duplizierte Bausteine mit je eigener Phasen-Sichtbarkeit */}
      {block.type === 'times' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: '#A8A292' }}>🕓 ZEIGT:</span>
          {([['beide', 'Beide Zeiten'], ['checkin', 'Nur Check-in'], ['checkout', 'Nur Check-out']] as const).map(([v, lbl]) => {
            const on = (block.show ?? 'beide') === v
            return (
              <button key={v} type="button" onClick={() => onChange({ show: v === 'beide' ? undefined : v } as Partial<GuideBlock>)} style={{
                padding: '3px 9px', borderRadius: 999, cursor: 'pointer', fontSize: 11, fontWeight: 700,
                border: on ? '1px solid transparent' : '1px solid #E5E1D6',
                background: on ? 'linear-gradient(135deg, var(--gold), var(--gold-dark))' : '#fff',
                color: on ? '#fff' : '#8A857B',
              }}>{lbl}</button>
            )
          })}
          <span style={{ fontSize: 11, color: '#A8A292', flexBasis: '100%' }}>
            Tipp: Baustein ⧉ duplizieren — einmal „Nur Check-in" (sichtbar: Vorher), einmal „Nur Check-out" (Während).
          </span>
        </div>
      )}

      {aiText !== null && (
        <AiPolishButton
          field="mappe_baustein"
          text={aiText}
          context={{
            baustein: meta.label,
            ...('title' in block && typeof block.title === 'string' && block.title ? { titel: block.title } : {}),
          }}
          onAccept={aiAccept}
        />
      )}

      {/* §136/§150: Sichtbarkeits-Phasen (MEHRFACH wählbar) + Mindest-Nächte */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: '#A8A292' }}>⏰ SICHTBAR:</span>
        {PHASE_META.map((p) => {
          const active = p.id === 'immer' ? activePhases.length === 0 : activePhases.includes(p.id as Exclude<GuidePhase, 'immer'>)
          return (
            <button key={p.id} type="button" title={p.id === 'immer' ? p.label : `${p.label} (kombinierbar)`}
              onClick={() => togglePhase(p.id)}
              style={{
                padding: '3px 9px', borderRadius: 999, cursor: 'pointer', fontSize: 11, fontWeight: 700,
                border: active ? '1px solid transparent' : '1px solid #E5E1D6',
                background: active ? 'linear-gradient(135deg, var(--gold), var(--gold-dark))' : '#fff',
                color: active ? '#fff' : '#8A857B',
              }}>{p.short}</button>
          )
        })}
        <span style={{ fontSize: 11, color: '#A8A292', marginLeft: 4 }}>ab</span>
        <input
          type="number" min={0} max={30} value={block.minNights ?? ''}
          placeholder="–"
          onChange={(e) => {
            const v = Number(e.target.value)
            onChange({ minNights: Number.isFinite(v) && v > 0 ? v : undefined } as Partial<GuideBlock>)
          }}
          style={{ width: 44, border: '1px solid #E5E1D6', borderRadius: 8, padding: '3px 6px', fontSize: 11.5, textAlign: 'center' }}
        />
        <span style={{ fontSize: 11, color: '#A8A292' }}>Nächten</span>
      </div>

      {/* §150: Wohnungs-Zuordnung je Baustein (leer = alle Wohnungen) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: '#A8A292' }}>🏠 GILT FÜR:</span>
        <button type="button" onClick={() => onChange({ listingIds: undefined } as Partial<GuideBlock>)} style={{
          padding: '3px 9px', borderRadius: 999, cursor: 'pointer', fontSize: 11, fontWeight: 700,
          border: !block.listingIds?.length ? '1px solid transparent' : '1px solid #E5E1D6',
          background: !block.listingIds?.length ? 'linear-gradient(135deg, var(--gold), var(--gold-dark))' : '#fff',
          color: !block.listingIds?.length ? '#fff' : '#8A857B',
        }}>Alle</button>
        {listings.map((l) => {
          const on = (block.listingIds ?? []).includes(l.id)
          return (
            <button key={l.id} type="button" onClick={() => toggleListing(l.id)} style={{
              padding: '3px 9px', borderRadius: 999, cursor: 'pointer', fontSize: 11, fontWeight: 700,
              border: on ? '1px solid transparent' : '1px solid #E5E1D6',
              background: on ? 'linear-gradient(135deg, var(--gold), var(--gold-dark))' : '#fff',
              color: on ? '#fff' : '#8A857B',
            }}>{l.title}</button>
          )
        })}
      </div>
    </div>
  )
}
