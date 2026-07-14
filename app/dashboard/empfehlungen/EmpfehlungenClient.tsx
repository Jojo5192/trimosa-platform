'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'

export interface KatalogItem { key: string; label: string; sub?: string }
export interface KatalogGruppe {
  region: string
  pois: KatalogItem[]
  kulinarik: KatalogItem[]
  touren: KatalogItem[]
}

interface Empfehlung {
  item_type: string
  item_key: string
  comment: string
  author_id: string
  author_name: string
  author_avatar: string | null
}

const TYPE_META: Record<string, { label: string; emoji: string }> = {
  poi: { label: 'Ausflugsziele', emoji: '🗺️' },
  kulinarik: { label: 'Essen & Trinken', emoji: '🍽️' },
  tour: { label: 'Radtouren', emoji: '🚴' },
}

function Avatar({ name, url, size = 22 }: { name: string; url: string | null; size?: number }) {
  return (
    <span title={name} style={{
      position: 'relative', width: `${size}px`, height: `${size}px`, borderRadius: '50%',
      overflow: 'hidden', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))',
      boxShadow: '0 0 0 1.5px #E6C15A', color: '#fff', fontSize: `${size * 0.45}px`, fontWeight: 800,
    }}>
      {url ? <Image src={url} alt={name} fill sizes="48px" style={{ objectFit: 'cover' }} /> : name.charAt(0)}
    </span>
  )
}

export default function EmpfehlungenClient({ gruppen }: { gruppen: KatalogGruppe[] }) {
  const [userId, setUserId] = useState<string | null>(null)
  const [empfehlungen, setEmpfehlungen] = useState<Empfehlung[]>([])
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [savedFlash, setSavedFlash] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/empfehlungen')
    if (res.ok) {
      const data = await res.json()
      setUserId(data.userId)
      setEmpfehlungen(data.empfehlungen)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const byItem = (type: string, key: string) =>
    empfehlungen.filter((e) => e.item_type === type && e.item_key === key)
  const own = (type: string, key: string) =>
    byItem(type, key).find((e) => e.author_id === userId)

  const toggle = (type: string, key: string) => {
    const id = `${type}::${key}`
    if (openKey === id) { setOpenKey(null); return }
    setOpenKey(id)
    setDraft(own(type, key)?.comment ?? '')
    setError('')
  }

  const save = async (type: string, key: string) => {
    setBusy(true); setError('')
    const res = await fetch('/api/empfehlungen', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_type: type, item_key: key, comment: draft }),
    })
    setBusy(false)
    if (!res.ok) { setError((await res.json()).error ?? 'Fehler beim Speichern.'); return }
    await load()
    setOpenKey(null)
    const id = `${type}::${key}`
    setSavedFlash(id)
    setTimeout(() => setSavedFlash((cur) => (cur === id ? null : cur)), 2200)
  }

  const remove = async (type: string, key: string) => {
    setBusy(true); setError('')
    const res = await fetch('/api/empfehlungen', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_type: type, item_key: key }),
    })
    setBusy(false)
    if (!res.ok) { setError((await res.json()).error ?? 'Fehler beim Löschen.'); return }
    await load()
    setOpenKey(null)
  }

  const renderItems = (type: string, items: readonly KatalogItem[]) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {items.map((item) => {
        const id = `${type}::${item.key}`
        const entries = byItem(type, item.key)
        const mine = own(type, item.key)
        const open = openKey === id
        return (
          <div key={id} style={{
            background: '#fff', borderRadius: '12px',
            border: mine ? '1.5px solid var(--gold)' : '1px solid #E8E6E0',
            boxShadow: savedFlash === id ? '0 0 0 3px rgba(174,141,45,0.25)' : 'none',
            transition: 'box-shadow 0.4s',
          }}>
            <button type="button" onClick={() => toggle(type, item.key)} style={{
              display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
              padding: '11px 14px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left',
            }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: '13.5px', fontWeight: 600, color: '#1D1D1F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.label}
                </span>
                {item.sub && <span style={{ fontSize: '11px', color: '#999' }}>{item.sub}</span>}
              </span>
              {entries.length > 0 && (
                <span style={{ display: 'inline-flex', marginRight: '2px' }}>
                  {entries.map((e, i) => (
                    <span key={e.author_id} style={{ marginLeft: i > 0 ? '-7px' : 0, zIndex: entries.length - i }}>
                      <Avatar name={e.author_name} url={e.author_avatar} />
                    </span>
                  ))}
                </span>
              )}
              <span style={{ fontSize: '12px', color: mine ? 'var(--gold-dark)' : '#B5B0A6', fontWeight: 700, flexShrink: 0 }}>
                {mine ? '✓ Empfohlen' : open ? '▲' : '+ Tipp'}
              </span>
            </button>

            {open && (
              <div style={{ padding: '0 14px 13px' }}>
                {byItem(type, item.key).filter((e) => e.author_id !== userId).map((e) => (
                  <div key={e.author_id} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', margin: '0 0 9px' }}>
                    <Avatar name={e.author_name} url={e.author_avatar} />
                    <p style={{ fontSize: '12px', color: '#777', fontStyle: 'italic', margin: 0, lineHeight: 1.5 }}>
                      <strong style={{ color: '#555', fontStyle: 'normal' }}>{e.author_name}:</strong> „{e.comment}“
                    </p>
                  </div>
                ))}
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Dein persönlicher Tipp — kurz und ehrlich, z. B. „Unbedingt die Flieten probieren!“"
                  maxLength={500}
                  rows={3}
                  style={{
                    width: '100%', boxSizing: 'border-box', borderRadius: '10px', border: '1.5px solid #D2D2D7',
                    padding: '10px 12px', fontSize: '13px', color: '#1D1D1F', resize: 'vertical',
                    fontFamily: 'inherit', outline: 'none', background: '#FAFAF8',
                  }}
                />
                {error && <p style={{ fontSize: '12px', color: '#DC2626', margin: '6px 0 0' }}>{error}</p>}
                <div style={{ display: 'flex', gap: '10px', marginTop: '9px', alignItems: 'center' }}>
                  <button type="button" onClick={() => save(type, item.key)} disabled={busy || draft.trim().length === 0} style={{
                    padding: '8px 18px', borderRadius: '999px', border: 'none',
                    background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))',
                    color: '#fff', fontSize: '12.5px', fontWeight: 700,
                    cursor: busy || draft.trim().length === 0 ? 'not-allowed' : 'pointer',
                    opacity: draft.trim().length === 0 ? 0.5 : 1,
                  }}>
                    {busy ? 'Speichert…' : mine ? 'Aktualisieren' : 'Empfehlen'}
                  </button>
                  {mine && (
                    <button type="button" onClick={() => remove(type, item.key)} disabled={busy} style={{
                      padding: '8px 14px', borderRadius: '999px', border: '1px solid #E5E5EA',
                      background: '#fff', color: '#DC2626', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer',
                    }}>
                      Empfehlung entfernen
                    </button>
                  )}
                  <span style={{ fontSize: '11px', color: '#B5B0A6', marginLeft: 'auto' }}>{draft.length}/500</span>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '26px' }}>
      {gruppen.map((g) => (
        <section key={g.region}>
          <h2 style={{ fontSize: '17px', fontWeight: 800, color: '#1A1400', margin: '0 0 12px', letterSpacing: '-0.01em' }}>
            {g.region}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {([['poi', g.pois], ['kulinarik', g.kulinarik], ['tour', g.touren]] as const).map(([type, items]) =>
              items.length > 0 ? (
                <div key={type}>
                  <p style={{ fontSize: '11px', fontWeight: 700, color: '#8A8065', letterSpacing: '0.07em', textTransform: 'uppercase', margin: '0 0 7px' }}>
                    {TYPE_META[type].emoji} {TYPE_META[type].label}
                  </p>
                  {renderItems(type, items)}
                </div>
              ) : null
            )}
          </div>
        </section>
      ))}
    </div>
  )
}
