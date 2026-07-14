'use client'

import { useState, useMemo } from 'react'
import Overlay from './Overlay'
import { AMENITY_CATEGORIES, AMENITY_MAP, PRIORITY_AMENITY_IDS } from './amenities-data'

/* ── 2. Amenities Section + Overlay ────────────────────────── */
export function AmenitiesSection({ amenities }: { amenities: string[] }) {
  const [showAll, setShowAll] = useState(false)
  const MAX_SHOW = 8

  const enriched = useMemo(() => {
    const all = amenities.map(a => {
      const info = AMENITY_MAP.get(a)
      return { id: a, emoji: info?.emoji ?? '✓', label: info?.label ?? a, category: info?.category ?? 'Sonstiges' }
    })
    const prioSet = new Set(PRIORITY_AMENITY_IDS)
    const prio = PRIORITY_AMENITY_IDS
      .filter(pid => all.some(a => a.id === pid))
      .map(pid => all.find(a => a.id === pid)!)
    const rest = all.filter(a => !prioSet.has(a.id))
    return [...prio, ...rest]
  }, [amenities])

  const visible = enriched.slice(0, MAX_SHOW)
  const remaining = enriched.length - MAX_SHOW

  const grouped = useMemo(() => {
    const amenitySet = new Set(amenities)
    return AMENITY_CATEGORIES
      .map(cat => ({ name: cat.name, icon: cat.icon, items: cat.items.filter(item => amenitySet.has(item.id)) }))
      .filter(cat => cat.items.length > 0)
  }, [amenities])

  if (amenities.length === 0) return null

  return (
    <div style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '16px' }}>Ausstattung</h2>
      <div className="detail-amenities-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px' }}>
        {visible.map(a => (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid #F0EEE8' }}>
            <span style={{ fontSize: '17px', lineHeight: 1, flexShrink: 0 }}>{a.emoji}</span>
            <span style={{ fontSize: '14px', color: '#1D1D1F' }}>{a.label}</span>
          </div>
        ))}
      </div>
      {remaining > 0 && (
        <button type="button" onClick={() => setShowAll(true)} style={{ marginTop: '16px', padding: '10px 20px', borderRadius: '12px', border: '1px solid #1D1D1F', background: 'transparent', fontSize: '13px', fontWeight: 600, color: '#1D1D1F', cursor: 'pointer', width: '100%' }}>
          Alle {enriched.length} Ausstattungsmerkmale anzeigen
        </button>
      )}

      {showAll && (
        <Overlay onClose={() => setShowAll(false)} title="Alle Ausstattungsmerkmale">
          {grouped.map(cat => (
            <div key={cat.name} style={{ marginBottom: '24px' }}>
              <h4 style={{ fontSize: '14px', fontWeight: 700, color: '#1D1D1F', marginBottom: '10px' }}>{cat.icon} {cat.name}</h4>
              <div className="detail-amenity-overlay-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {cat.items.map(a => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '10px', backgroundColor: '#F9F9FB', border: '1px solid #F0EEE8' }}>
                    <span style={{ fontSize: '16px', flexShrink: 0 }}>{a.emoji}</span>
                    <span style={{ fontSize: '13px', color: '#1D1D1F' }}>{a.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </Overlay>
      )}
    </div>
  )
}
