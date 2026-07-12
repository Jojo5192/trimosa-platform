'use client'

import { useState, useRef } from 'react'

export interface Room {
  id: string
  name: string
  description: string
  features: string[]
  images: string[]
}

const ROOM_PRESETS = [
  'Wohnzimmer', 'Schlafzimmer', 'Badezimmer', 'Küche', 'Esszimmer',
  'Arbeitszimmer', 'Kinderzimmer', 'Terasse / Balkon', 'Garten', 'Eingangsbereich',
]

function genId() {
  return Math.random().toString(36).slice(2)
}

interface Props {
  listingId: string
  rooms: Room[]
  onChange: (rooms: Room[]) => void
}

export default function RoomEditor({ listingId, rooms, onChange }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(rooms[0]?.id ?? null)
  const [uploading, setUploading] = useState<string | null>(null) // room id being uploaded
  const [newRoomName, setNewRoomName] = useState('')
  const [showPresets, setShowPresets] = useState(false)
  const [featureInputs, setFeatureInputs] = useState<Record<string, string>>({})
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  function updateRoom(id: string, patch: Partial<Room>) {
    onChange(rooms.map(r => r.id === id ? { ...r, ...patch } : r))
  }

  function addRoom(name: string) {
    if (!name.trim()) return
    const newRoom: Room = { id: genId(), name: name.trim(), description: '', features: [], images: [] }
    onChange([...rooms, newRoom])
    setExpandedId(newRoom.id)
    setNewRoomName('')
    setShowPresets(false)
  }

  function deleteRoom(id: string) {
    onChange(rooms.filter(r => r.id !== id))
    if (expandedId === id) setExpandedId(rooms.find(r => r.id !== id)?.id ?? null)
  }

  function moveRoom(id: string, dir: -1 | 1) {
    const idx = rooms.findIndex(r => r.id === id)
    if (idx < 0) return
    const next = idx + dir
    if (next < 0 || next >= rooms.length) return
    const copy = [...rooms]
    ;[copy[idx], copy[next]] = [copy[next], copy[idx]]
    onChange(copy)
  }

  function addFeature(roomId: string) {
    const val = (featureInputs[roomId] ?? '').trim()
    if (!val) return
    const room = rooms.find(r => r.id === roomId)
    if (!room) return
    updateRoom(roomId, { features: [...room.features, val] })
    setFeatureInputs(prev => ({ ...prev, [roomId]: '' }))
  }

  function removeFeature(roomId: string, feat: string) {
    const room = rooms.find(r => r.id === roomId)
    if (!room) return
    updateRoom(roomId, { features: room.features.filter(f => f !== feat) })
  }

  async function handleImageUpload(roomId: string, files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(roomId)

    const newUrls: string[] = []
    for (const file of Array.from(files)) {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/listings/${listingId}/upload`, { method: 'POST', body: form })
      const data = await res.json()
      if (res.ok) newUrls.push(data.url)
    }

    const room = rooms.find(r => r.id === roomId)
    if (room) updateRoom(roomId, { images: [...room.images, ...newUrls] })
    setUploading(null)
    const ref = fileRefs.current[roomId]
    if (ref) ref.value = ''
  }

  function removeImage(roomId: string, url: string) {
    const room = rooms.find(r => r.id === roomId)
    if (!room) return
    updateRoom(roomId, { images: room.images.filter(u => u !== url) })
  }

  function moveImage(roomId: string, idx: number, dir: -1 | 1) {
    const room = rooms.find(r => r.id === roomId)
    if (!room) return
    const next = idx + dir
    if (next < 0 || next >= room.images.length) return
    const imgs = [...room.images]
    ;[imgs[idx], imgs[next]] = [imgs[next], imgs[idx]]
    updateRoom(roomId, { images: imgs })
  }

  const sInput: React.CSSProperties = {
    width: '100%', borderRadius: '10px', border: '1.5px solid #E0DDD6',
    padding: '8px 12px', fontSize: '13px', color: '#111',
    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
    backgroundColor: '#fff',
  }

  return (
    <div>
      {/* ── Existing rooms ── */}
      {rooms.map((room, roomIdx) => {
        const expanded = expandedId === room.id
        return (
          <div key={room.id} style={{ background: '#fff', borderRadius: '16px', border: '1.5px solid #E0DDD6', marginBottom: '10px', overflow: 'hidden' }}>
            {/* Room header */}
            <div
              onClick={() => setExpandedId(expanded ? null : room.id)}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px', cursor: 'pointer', userSelect: 'none' }}
            >
              {/* Drag handles / order */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}>
                <button type="button" onClick={e => { e.stopPropagation(); moveRoom(room.id, -1) }} disabled={roomIdx === 0}
                  style={{ background: 'none', border: 'none', cursor: roomIdx === 0 ? 'default' : 'pointer', color: roomIdx === 0 ? '#DDD' : '#888', fontSize: '10px', padding: '1px 4px', lineHeight: 1 }}>▲</button>
                <button type="button" onClick={e => { e.stopPropagation(); moveRoom(room.id, 1) }} disabled={roomIdx === rooms.length - 1}
                  style={{ background: 'none', border: 'none', cursor: roomIdx === rooms.length - 1 ? 'default' : 'pointer', color: roomIdx === rooms.length - 1 ? '#DDD' : '#888', fontSize: '10px', padding: '1px 4px', lineHeight: 1 }}>▼</button>
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#111' }}>{room.name}</span>
                {!expanded && (
                  <span style={{ fontSize: '12px', color: '#aaa', marginLeft: '10px' }}>
                    {room.images.length} Foto{room.images.length !== 1 ? 's' : ''}
                    {room.features.length > 0 ? ` · ${room.features.slice(0, 2).join(', ')}${room.features.length > 2 ? '…' : ''}` : ''}
                  </span>
                )}
              </div>

              {/* Thumbnail strip preview */}
              {!expanded && room.images.length > 0 && (
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                  {room.images.slice(0, 3).map((url, i) => (
                    <img key={i} src={url} alt="" style={{ width: '36px', height: '36px', borderRadius: '6px', objectFit: 'cover', border: '1px solid #E0DDD6' }} />
                  ))}
                  {room.images.length > 3 && (
                    <div style={{ width: '36px', height: '36px', borderRadius: '6px', background: '#F5F5F5', border: '1px solid #E0DDD6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: '#888', fontWeight: 600 }}>
                      +{room.images.length - 3}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                <button type="button" onClick={e => { e.stopPropagation(); deleteRoom(room.id) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#CCC', fontSize: '14px', padding: '4px', lineHeight: 1 }}
                  title="Raum löschen"
                >
                  🗑
                </button>
                <span style={{ color: '#CCC', fontSize: '14px', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'block' }}>▾</span>
              </div>
            </div>

            {/* Expanded content */}
            {expanded && (
              <div style={{ padding: '0 16px 16px', borderTop: '1px solid #F0EDE8' }}>
                {/* Name */}
                <div style={{ marginBottom: '12px', marginTop: '14px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: '#888', display: 'block', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Raumname</label>
                  <input
                    style={sInput}
                    value={room.name}
                    onChange={e => updateRoom(room.id, { name: e.target.value })}
                    placeholder="z.B. Wohnzimmer"
                  />
                </div>

                {/* Description */}
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: '#888', display: 'block', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Kurzbeschreibung (optional)</label>
                  <input
                    style={sInput}
                    value={room.description}
                    onChange={e => updateRoom(room.id, { description: e.target.value })}
                    placeholder="z.B. Großzügiger Wohnbereich mit Blick in den Garten"
                  />
                </div>

                {/* Features */}
                <div style={{ marginBottom: '14px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: '#888', display: 'block', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Ausstattungsmerkmale</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                    {room.features.map(f => (
                      <span key={f} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 10px', borderRadius: '999px', background: '#FDF6E3', border: '1px solid #E8D9A0', fontSize: '12px', color: 'var(--gold-dark)' }}>
                        {f}
                        <button type="button" onClick={() => removeFeature(room.id, f)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gold)', fontSize: '12px', padding: '0', lineHeight: 1 }}>✕</button>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      style={{ ...sInput, flex: 1 }}
                      value={featureInputs[room.id] ?? ''}
                      onChange={e => setFeatureInputs(prev => ({ ...prev, [room.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFeature(room.id) } }}
                      placeholder="z.B. Smart-TV, Doppelbett…"
                    />
                    <button type="button" onClick={() => addFeature(room.id)}
                      style={{ padding: '8px 14px', borderRadius: '10px', border: '1.5px solid var(--gold)', background: '#FDF6E3', color: 'var(--gold-dark)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      + Hinzufügen
                    </button>
                  </div>
                </div>

                {/* Photos */}
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: '#888', display: 'block', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Fotos dieses Raums</label>

                  {/* Upload button */}
                  <input
                    ref={el => { fileRefs.current[room.id] = el }}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    style={{ display: 'none' }}
                    onChange={e => handleImageUpload(room.id, e.target.files)}
                  />
                  <button
                    type="button"
                    onClick={() => fileRefs.current[room.id]?.click()}
                    disabled={uploading === room.id}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '6px',
                      padding: '8px 16px', borderRadius: '10px',
                      border: '1.5px dashed var(--gold)', background: uploading === room.id ? '#FAF5E4' : '#FFFBF0',
                      cursor: uploading === room.id ? 'not-allowed' : 'pointer',
                      fontSize: '12px', fontWeight: 600, color: 'var(--gold-dark)',
                      marginBottom: '10px',
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    {uploading === room.id ? 'Wird hochgeladen…' : 'Fotos hochladen'}
                  </button>

                  {/* Photo grid */}
                  {room.images.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '8px' }}>
                      {room.images.map((url, imgIdx) => (
                        <div key={url} style={{ position: 'relative', aspectRatio: '4/3', borderRadius: '10px', overflow: 'hidden', border: '2px solid #E8E6E0' }}>
                          {imgIdx === 0 && (
                            <div style={{ position: 'absolute', top: '4px', left: '4px', fontSize: '9px', fontWeight: 700, padding: '2px 6px', borderRadius: '999px', background: 'rgba(0,0,0,0.55)', color: '#fff', zIndex: 1 }}>
                              Titelbild
                            </div>
                          )}
                          <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          {/* Controls overlay */}
                          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0)', transition: 'background 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.4)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,0,0,0)')}
                          >
                            <button type="button" onClick={() => moveImage(room.id, imgIdx, -1)} disabled={imgIdx === 0}
                              style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'rgba(255,255,255,0.9)', border: 'none', cursor: imgIdx === 0 ? 'default' : 'pointer', color: imgIdx === 0 ? '#ccc' : '#333', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>←</button>
                            <button type="button" onClick={() => removeImage(room.id, url)}
                              style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'rgba(255,255,255,0.9)', border: 'none', cursor: 'pointer', color: '#c00', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                            <button type="button" onClick={() => moveImage(room.id, imgIdx, 1)} disabled={imgIdx === room.images.length - 1}
                              style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'rgba(255,255,255,0.9)', border: 'none', cursor: imgIdx === room.images.length - 1 ? 'default' : 'pointer', color: imgIdx === room.images.length - 1 ? '#ccc' : '#333', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>→</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* ── Add new room ── */}
      <div style={{ background: '#FAFAF8', borderRadius: '16px', border: '1.5px dashed #D0CCBE', padding: '16px' }}>
        <p style={{ fontSize: '12px', fontWeight: 600, color: '#888', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Raum hinzufügen</p>

        {/* Presets */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
          {ROOM_PRESETS.filter(p => !rooms.some(r => r.name === p)).map(preset => (
            <button
              key={preset}
              type="button"
              onClick={() => addRoom(preset)}
              style={{ padding: '5px 12px', borderRadius: '999px', border: '1.5px solid #E0DDD6', background: '#fff', color: '#555', fontSize: '12px', cursor: 'pointer', transition: 'all 0.1s' }}
            >
              + {preset}
            </button>
          ))}
        </div>

        {/* Custom name */}
        <div style={{ display: 'flex', gap: '6px' }}>
          <input
            style={{ flex: 1, borderRadius: '10px', border: '1.5px solid #E0DDD6', padding: '8px 12px', fontSize: '13px', color: '#111', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff', boxSizing: 'border-box' }}
            value={newRoomName}
            onChange={e => setNewRoomName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRoom(newRoomName) } }}
            placeholder="Eigener Raumname…"
          />
          <button
            type="button"
            onClick={() => addRoom(newRoomName)}
            disabled={!newRoomName.trim()}
            style={{ padding: '8px 16px', borderRadius: '10px', border: 'none', background: newRoomName.trim() ? 'linear-gradient(135deg, var(--gold), var(--gold-dark))' : '#E0DDD6', color: newRoomName.trim() ? '#fff' : '#aaa', fontSize: '13px', fontWeight: 600, cursor: newRoomName.trim() ? 'pointer' : 'default' }}
          >
            Anlegen
          </button>
        </div>
      </div>
    </div>
  )
}
