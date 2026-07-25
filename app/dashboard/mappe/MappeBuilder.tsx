'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  BLOCK_META, PHASE_META, defaultTemplate, emptyBlock, newBlockId, blockPhases, blockForListing,
  blockVisibleInPhase, mergeContactIntoChat, DE_LABELS, INVENTAR_KATALOG, inventarGroupLabel, inventarGroupOf,
  type GuideBlock, type GuideCtx, type GuidePhase, type InventarBlock, type InventarItem, type InventarCatalogItem, type StepsBlock,
  type InventarGroupKey,
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
  // §195-Ausbau: eigene Inventar-Einträge ALLER Listen als wohnungs-
  // übergreifende Vorschläge (dedupliziert nach Kategorie + Label)
  const inventarPool = useMemo(() => {
    const seen = new Map<string, { id: string; emoji: string; label: string }>()
    for (const b of blocks) {
      if (b.type !== 'inventar') continue
      for (const it of b.items ?? []) {
        if (!it.id.startsWith('x-')) continue
        const key = `${inventarGroupOf(it.id)}|${it.label.trim().toLowerCase()}`
        if (!seen.has(key)) seen.set(key, { id: it.id, emoji: it.emoji, label: it.label })
      }
    }
    return [...seen.values()]
  }, [blocks])

  // §160-Ergänzung: Vorschau-Phase — zeigt die Mappe so, wie sie zum
  // jeweiligen Zeitpunkt aussieht ('alle' = ohne Phasen-Filter).
  const [previewPhase, setPreviewPhase] = useState<'alle' | Exclude<GuidePhase, 'immer'>>('alle')
  // Vorschau: nur aktive Bausteine der Vorschau-Wohnung (+ Phasen-Filter;
  // nights=99, damit „ab X Nächten"-Bausteine die Phasen-Vorschau nicht stören)
  const previewBlocks = useMemo(
    () => mergeContactIntoChat(blocks.filter((b) =>
      !b.disabled
      && (!previewListing || blockForListing(b, previewListing.id))
      && (previewPhase === 'alle' || blockVisibleInPhase(b, previewPhase, 99)))),
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
                inventarPool={inventarPool}
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
          {/* §163: echtes iPhone-Seitenverhältnis (~390×800) statt Spaltenbreite */}
          <div style={{ borderRadius: 40, background: '#2B2F33', padding: 8, boxShadow: '0 14px 44px rgba(0,0,0,0.18)', width: '100%', maxWidth: 384, margin: '0 auto' }}>
            <div style={{ borderRadius: 32, overflow: 'hidden', background: '#F5F3EE', height: 770, overflowY: 'auto' }}>
              <div style={{ background: 'linear-gradient(160deg, #12222E 0%, #172A22 100%)', padding: '20px 16px 16px' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt="TRIMOSA" style={{ maxHeight: 32, maxWidth: '60%', width: 'auto', height: 'auto', display: 'block', marginBottom: 10 }} />
                <div style={{ fontSize: 18, fontWeight: 800, color: '#F5F0E8' }}>Hallo Anna! 👋</div>
                <div style={{ fontSize: 11.5, color: 'rgba(245,240,232,0.7)', marginTop: 3 }}>
                  Dein Zuhause auf Zeit: <strong style={{ color: '#E3C878' }}>{previewListing.ctx.listingTitle}</strong>
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
function BlockEditor({ block, index, total, listings, inventarPool, onChange, onMove, onRemove, onDuplicate }: {
  block: GuideBlock
  index: number
  total: number
  listings: { id: string; title: string }[]
  inventarPool: { id: string; emoji: string; label: string }[]
  onChange: (patch: Partial<GuideBlock>) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  onDuplicate: () => void
}) {
  const meta = BLOCK_META[block.type]
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadErr, setUploadErr] = useState('')

  async function uploadImage(file: File, field: 'url' | 'url2' = 'url') {
    setUploadBusy(true)
    setUploadErr('')
    try {
      const blob = await compressToJpeg(file)
      const fd = new FormData()
      fd.append('file', new File([blob], 'foto.jpg', { type: blob.type || 'image/jpeg' }))
      const res = await fetch('/api/guide-image', { method: 'POST', body: fd })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`)
      if (field === 'url2') onChange({ url2: d.url } as Partial<GuideBlock>)
      else onChange({ url: d.url } as Partial<GuideBlock>)
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : 'Upload fehlgeschlagen.')
    } finally {
      setUploadBusy(false)
    }
  }

  // 📷 je Schritt (§196): Fotos hängen index-parallel zu steps (stepImages)
  function stepImagesAligned(b: StepsBlock): string[] {
    const imgs = [...(b.stepImages ?? [])].map((x) => x || '')
    while (imgs.length < b.steps.length) imgs.push('')
    return imgs
  }
  async function uploadStepImage(b: StepsBlock, i: number, file: File) {
    setUploadBusy(true)
    setUploadErr('')
    try {
      const blob = await compressToJpeg(file)
      const fd = new FormData()
      fd.append('file', new File([blob], 'foto.jpg', { type: blob.type || 'image/jpeg' }))
      const res = await fetch('/api/guide-image', { method: 'POST', body: fd })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`)
      const imgs = stepImagesAligned(b)
      imgs[i] = d.url
      onChange({ stepImages: imgs } as Partial<GuideBlock>)
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : 'Upload fehlgeschlagen.')
    } finally {
      setUploadBusy(false)
    }
  }
  function moveStep(b: StepsBlock, i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= b.steps.length) return
    const st = [...b.steps]
    ;[st[i], st[j]] = [st[j], st[i]]
    const imgs = stepImagesAligned(b)
    ;[imgs[i], imgs[j]] = [imgs[j], imgs[i]]
    onChange({ steps: st, stepImages: imgs } as Partial<GuideBlock>)
  }
  function removeStep(b: StepsBlock, i: number) {
    const imgs = stepImagesAligned(b)
    imgs.splice(i, 1)
    onChange({ steps: b.steps.filter((_, j) => j !== i), stepImages: imgs } as Partial<GuideBlock>)
  }
  function clearStepImage(b: StepsBlock, i: number) {
    const imgs = stepImagesAligned(b)
    imgs[i] = ''
    onChange({ stepImages: imgs } as Partial<GuideBlock>)
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
    if (block.type === 'steps') {
      const lines = v.split('\n')
      onChange({ steps: lines, stepImages: (block.stepImages ?? []).slice(0, lines.length) } as Partial<GuideBlock>)
    }
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
          {block.steps.map((st, i) => {
            const img = block.stepImages?.[i] || ''
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    flexShrink: 0, width: 22, height: 22, borderRadius: '50%', background: '#FAF5E4',
                    color: '#8A7020', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{i + 1}</span>
                  <input style={{ ...INPUT, flex: 1, minWidth: 0 }} placeholder={`Schritt ${i + 1}…`} value={st}
                    onChange={(e) => onChange({ steps: block.steps.map((x, j) => (j === i ? e.target.value : x)) })} />
                  <label title={img ? 'Foto ersetzen' : 'Foto zu diesem Schritt hinzufügen'} style={{
                    ...btn, cursor: uploadBusy ? 'wait' : 'pointer', opacity: uploadBusy ? 0.5 : 1,
                    borderColor: img ? 'var(--gold)' : '#E5E1D6', background: img ? '#FAF5E4' : '#fff',
                  }}>
                    📷
                    <input type="file" accept="image/*" style={{ display: 'none' }} disabled={uploadBusy}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadStepImage(block, i, f); e.target.value = '' }} />
                  </label>
                  <button type="button" style={{ ...btn, opacity: i === 0 ? 0.35 : 1 }} disabled={i === 0} onClick={() => moveStep(block, i, -1)} title="Schritt nach oben">↑</button>
                  <button type="button" style={{ ...btn, opacity: i === block.steps.length - 1 ? 0.35 : 1 }} disabled={i === block.steps.length - 1} onClick={() => moveStep(block, i, 1)} title="Schritt nach unten">↓</button>
                  <button type="button" style={{ ...btn, color: '#DC2626' }} onClick={() => removeStep(block, i)} title="Schritt entfernen">✕</button>
                </div>
                {img && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 28 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img} alt={`Foto zu Schritt ${i + 1}`} style={{ width: 92, height: 60, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
                    <button type="button" style={{ ...btn, color: '#DC2626' }} onClick={() => clearStepImage(block, i)} title="Foto entfernen">✕</button>
                  </div>
                )}
              </div>
            )
          })}
          <button type="button" onClick={() => onChange({ steps: [...block.steps, ''] })} style={{
            alignSelf: 'flex-start', padding: '6px 14px', borderRadius: 999, border: '1.5px dashed #D8D2C4',
            background: '#FCFBF7', color: '#8A7020', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>+ Schritt</button>
          {uploadErr && <span style={{ fontSize: 11.5, color: '#B91C1C' }}>⚠️ {uploadErr}</span>}
          <span style={{ fontSize: 11, color: '#A8A292' }}>Wird automatisch nummeriert — 📷 hängt ein Foto an den Schritt (z. B. die richtige Tür oder der Schlüsselkasten).</span>
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
          {/* §196b: optionales zweites Foto — rendert NEBENEINANDER (Foto + Skizze) */}
          {block.url && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {block.url2 && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={block.url2} alt="Zweites Foto" style={{ width: 92, height: 92, objectFit: 'cover', borderRadius: 10, display: 'block' }} />
              )}
              <label style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '8px 15px', borderRadius: 999,
                border: block.url2 ? '1.5px solid var(--gold)' : '1.5px dashed #C9BE93',
                background: '#fff', color: '#8A7020', fontSize: 12, fontWeight: 700,
                cursor: uploadBusy ? 'wait' : 'pointer', opacity: uploadBusy ? 0.6 : 1,
              }}>
                {uploadBusy ? '⏳ Lädt hoch…' : block.url2 ? '🔄 2. Foto ersetzen' : '＋ 2. Foto daneben'}
                <input type="file" accept="image/*" style={{ display: 'none' }} disabled={uploadBusy}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f, 'url2'); e.target.value = '' }} />
              </label>
              {block.url2 && (
                <button type="button" style={{ ...btn, color: '#DC2626' }} onClick={() => onChange({ url2: undefined } as Partial<GuideBlock>)} title="2. Foto entfernen">✕</button>
              )}
            </div>
          )}
          {uploadErr && <span style={{ fontSize: 11.5, color: '#B91C1C' }}>⚠️ {uploadErr}</span>}
          <input style={INPUT} placeholder="Bildunterschrift (optional, z. B. Dein Parkplatz Nr. 3)" value={block.caption} onChange={(e) => onChange({ caption: e.target.value })} />
          {block.url && (
            <span style={{ fontSize: 11, color: '#A8A292' }}>
              Mit zweitem Foto erscheinen beide NEBENEINANDER (quadratisch zugeschnitten) — z. B. Straßenfoto + Parkplatz-Skizze.
            </span>
          )}
        </div>
      )}

      {block.type === 'inventar' && (
        <InventarEditor block={block} onChange={onChange} pool={inventarPool} />
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

/** 📦 Inventar-Editor (§195): Katalog anklicken, Stückzahlen eintragen,
 *  eigene Einträge ergänzen. Gespeichert werden nur die AKTIVEN Punkte. */
function InventarEditor({ block, onChange, pool }: {
  block: InventarBlock
  onChange: (patch: Partial<GuideBlock>) => void
  pool: { id: string; emoji: string; label: string }[]
}) {
  const [cEmoji, setCEmoji] = useState('')
  const [cLabel, setCLabel] = useState('')
  // Kategorie für den nächsten eigenen Eintrag (§195-Ausbau)
  const [cGroup, setCGroup] = useState<InventarGroupKey>('wohnen')
  // 📝-Notiz je Punkt (z. B. Kaffeemaschinen-Modell) — ein Feld zugleich offen
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const items = block.items ?? []
  const active = new Map(items.map((i) => [i.id, i]))
  const activeLabels = new Set(items.map((i) => i.label.trim().toLowerCase()))
  const set = (next: InventarItem[]) => onChange({ items: next } as Partial<GuideBlock>)

  function toggleCatalog(cat: InventarCatalogItem) {
    if (active.has(cat.id)) set(items.filter((i) => i.id !== cat.id))
    else set([...items, { id: cat.id, emoji: cat.emoji, label: cat.label }])
  }
  function setCount(id: string, raw: string) {
    const n = Number(raw)
    set(items.map((i) => (i.id === id ? { ...i, count: Number.isFinite(n) && n > 0 ? Math.round(n) : undefined } : i)))
  }
  function setNote(id: string, raw: string) {
    set(items.map((i) => (i.id === id ? { ...i, note: raw ? raw : undefined } : i)))
  }
  function noteButton(id: string) {
    const hasNote = !!active.get(id)?.note
    const open = noteFor === id
    return (
      <button type="button" onClick={() => setNoteFor(open ? null : id)}
        title={hasNote ? `Notiz: ${active.get(id)?.note}` : 'Notiz hinzufügen (z. B. Marke/Modell)'} style={{
          width: 24, height: 24, borderRadius: 8, cursor: 'pointer', fontSize: 11, padding: 0,
          border: hasNote || open ? '1.5px solid var(--gold)' : '1px solid #E5E1D6',
          background: hasNote ? '#FAF5E4' : '#fff',
        }}>📝</button>
    )
  }
  function noteInput(id: string, label: string) {
    if (noteFor !== id) return null
    return (
      <input
        autoFocus
        style={{ ...INPUT, flexBasis: '100%', marginTop: 2 }}
        placeholder={`Notiz zu „${label}" — z. B. Marke/Modell (Nespresso Vertuo), Standort, Besonderheit …`}
        value={active.get(id)?.note ?? ''}
        onChange={(e) => setNote(id, e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); setNoteFor(null) } }}
      />
    )
  }
  function addCustom() {
    const label = cLabel.trim()
    if (!label) return
    // Kategorie steckt im id-Präfix (x-<gruppe>-…) — so sortiert sich der
    // Eintrag in Builder + Mappe in die richtige Gruppe und erscheint bei den
    // anderen Wohnungen als Vorschlag derselben Kategorie.
    const id = `x-${cGroup}-${label.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-').slice(0, 30)}-${Math.random().toString(36).slice(2, 5)}`
    set([...items, { id, emoji: (cEmoji.trim() || '🔹').slice(0, 4), label }])
    setCEmoji('')
    setCLabel('')
  }
  // Eigene Einträge DIESER Liste je Kategorie + Vorschläge aus anderen Listen
  function customsOf(key: InventarGroupKey) {
    return items.filter((i) => i.id.startsWith('x-') && inventarGroupOf(i.id) === key)
  }
  function suggestionsOf(key: InventarGroupKey) {
    return pool.filter((s) => inventarGroupOf(s.id) === key && !active.has(s.id) && !activeLabels.has(s.label.trim().toLowerCase()))
  }
  const countInput: React.CSSProperties = {
    width: 46, border: '1px solid #E5E1D6', borderRadius: 8, padding: '3px 5px',
    fontSize: 11.5, textAlign: 'center', background: '#fff',
  }
  function customPill(it: InventarItem) {
    return (
      <span key={it.id} style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, ...(noteFor === it.id ? { flexBasis: '100%' } : {}) }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 6px 4px 10px', borderRadius: 999,
          background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))', color: '#fff', fontSize: 11.5, fontWeight: 600,
        }}>
          {it.emoji} {it.label}
          <button type="button" onClick={() => set(items.filter((x) => x.id !== it.id))} title="Entfernen" style={{
            border: 'none', background: 'rgba(255,255,255,0.25)', color: '#fff', cursor: 'pointer',
            width: 16, height: 16, borderRadius: '50%', fontSize: 10, lineHeight: 1, padding: 0,
          }}>✕</button>
        </span>
        <input
          type="number" min={1} max={99} placeholder="Stk."
          value={it.count ?? ''}
          onChange={(e) => setCount(it.id, e.target.value)}
          style={countInput} title="Stückzahl (optional)"
        />
        {noteButton(it.id)}
        {noteInput(it.id, it.label)}
      </span>
    )
  }
  function suggestionChips(key: InventarGroupKey) {
    return suggestionsOf(key).map((s) => (
      <button key={`sug-${s.id}`} type="button"
        onClick={() => set([...items, { id: s.id, emoji: s.emoji, label: s.label }])}
        title="Vorschlag — in einer anderen Wohnungs-Liste vorhanden. Antippen zum Übernehmen." style={{
          padding: '4px 10px', borderRadius: 999, cursor: 'pointer', fontSize: 11.5, fontWeight: 600,
          border: '1px dashed #C9BE93', background: '#FCFBF7', color: '#8A7020',
        }}>＋ {s.emoji} {s.label}</button>
    ))
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <input
        style={{ ...INPUT, fontWeight: 600 }} placeholder="Titel (z. B. Inventar & Ausstattung)"
        value={block.title} onChange={(e) => onChange({ title: e.target.value } as Partial<GuideBlock>)}
      />
      {INVENTAR_KATALOG.map((g) => (
        <div key={g.key}>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', color: '#A8A292', marginBottom: 6 }}>
            {g.emoji} {inventarGroupLabel(DE_LABELS, g.key).toUpperCase()}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {g.items.map((cat) => {
              const on = active.has(cat.id)
              return (
                <span key={cat.id} style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, ...(noteFor === cat.id ? { flexBasis: '100%' } : {}) }}>
                  <button type="button" onClick={() => toggleCatalog(cat)} title={on ? 'Entfernen' : 'Als vorhanden markieren'} style={{
                    padding: '4px 10px', borderRadius: 999, cursor: 'pointer', fontSize: 11.5, fontWeight: 600,
                    border: on ? '1px solid transparent' : '1px solid #E5E1D6',
                    background: on ? 'linear-gradient(135deg, var(--gold), var(--gold-dark))' : '#fff',
                    color: on ? '#fff' : '#8A857B',
                  }}>{cat.emoji} {cat.label}</button>
                  {on && cat.countable && (
                    <input
                      type="number" min={1} max={99} placeholder="Stk."
                      value={active.get(cat.id)?.count ?? ''}
                      onChange={(e) => setCount(cat.id, e.target.value)}
                      style={countInput} title="Stückzahl (optional)"
                    />
                  )}
                  {on && noteButton(cat.id)}
                  {noteInput(cat.id, cat.label)}
                </span>
              )
            })}
            {customsOf(g.key).map((it) => customPill(it))}
            {suggestionChips(g.key)}
          </div>
        </div>
      ))}
      {/* Eigene Einträge (mit Kategorie-Auswahl) */}
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', color: '#A8A292', marginBottom: 6 }}>
          🔹 EIGENE EINTRÄGE
        </div>
        {(customsOf('eigene').length > 0 || suggestionsOf('eigene').length > 0) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 8 }}>
            {customsOf('eigene').map((it) => customPill(it))}
            {suggestionChips('eigene')}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={cGroup} onChange={(e) => setCGroup(e.target.value as InventarGroupKey)}
            title="Kategorie des neuen Eintrags" style={{ ...INPUT, width: 'auto', minWidth: 0, flex: '0 1 auto' }}>
            {INVENTAR_KATALOG.map((g) => (
              <option key={g.key} value={g.key}>{g.emoji} {inventarGroupLabel(DE_LABELS, g.key)}</option>
            ))}
            <option value="eigene">🔹 {inventarGroupLabel(DE_LABELS, 'eigene')}</option>
          </select>
          <input style={{ ...INPUT, width: 52, textAlign: 'center', flex: '0 0 auto' }} maxLength={4} placeholder="🔹" value={cEmoji}
            onChange={(e) => setCEmoji(e.target.value)} title="Emoji (optional)" />
          <input style={{ ...INPUT, flex: '1 1 160px', minWidth: 0 }} placeholder="Eigener Eintrag (z. B. Fondue-Set, Weinkühler …)" value={cLabel}
            onChange={(e) => setCLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }} />
          <button type="button" onClick={addCustom} disabled={!cLabel.trim()} style={{
            padding: '8px 14px', borderRadius: 10, border: 'none', cursor: cLabel.trim() ? 'pointer' : 'default',
            background: cLabel.trim() ? 'linear-gradient(135deg, var(--gold), var(--gold-dark))' : '#E5E1D6',
            color: '#fff', fontSize: 12, fontWeight: 700,
          }}>+ Hinzufügen</button>
        </div>
        <span style={{ fontSize: 11, color: '#A8A292', display: 'block', marginTop: 5 }}>
          Der Eintrag landet in der gewählten Kategorie — und erscheint bei den Listen der anderen Wohnungen
          automatisch als ＋-Vorschlag. Marke/Modell gern per 📝-Notiz dazu — das nutzt auch die Telefon-KI.
        </span>
      </div>
    </div>
  )
}
