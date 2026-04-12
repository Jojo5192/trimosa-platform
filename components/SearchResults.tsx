'use client'

import { useState, useMemo, useCallback } from 'react'
import Link from 'next/link'
import ListingsMap, { type MapListing } from './ListingsMap'

/* ── Card gradient palette (mirrors page.tsx) ── */
const CARD_GRADIENTS = [
  { from: '#D6EAE8', to: '#4A8F96', accent: '#2E7A82' },
  { from: '#DCEADC', to: '#567A5C', accent: '#3E6344' },
  { from: '#EDE5D0', to: '#A8882A', accent: '#8A6E1A' },
  { from: '#E4DFF0', to: '#7A6EA0', accent: '#5E537E' },
  { from: '#EDE1D8', to: '#A8705A', accent: '#8A5A44' },
  { from: '#D8E8F0', to: '#4A7EA8', accent: '#326080' },
  { from: '#DBE8DE', to: '#507860', accent: '#3A5E4A' },
  { from: '#EDE8D0', to: '#A89050', accent: '#8A7238' },
]

export interface CardData {
  id: string
  title: string
  location: string
  maxGuests: number
  bedrooms: number
  pricePerNight: number
  totalPrice: number
  nights: number
  distanceKm: number | null
  issues: string[]
  lat: number
  lon: number
  image?: string   // first photo if uploaded
  unavailable?: boolean  // true if not available for selected dates
}

interface FilterState {
  minBedrooms: number | null   // null = any
  minGuests: number | null     // null = any
  maxPrice: number | null      // null = any, per night
}

interface Props {
  cards: CardData[]
  centerLat?: number
  centerLon?: number
  searchQuery?: string
  searchGuests?: number
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/* ── Filter Modal ── */
function FilterModal({ filters, onApply, onClose }: {
  filters: FilterState
  onApply: (f: FilterState) => void
  onClose: () => void
}) {
  const [local, setLocal] = useState<FilterState>(filters)

  function PillGroup<T extends number | null>({ label, options, value, onChange }: {
    label: string
    options: { label: string; value: T }[]
    value: T
    onChange: (v: T) => void
  }) {
    return (
      <div style={{ marginBottom: '20px' }}>
        <p style={{ fontSize: '13px', fontWeight: 600, color: '#111', margin: '0 0 10px' }}>{label}</p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {options.map(opt => (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => onChange(opt.value)}
              style={{
                padding: '8px 16px',
                borderRadius: '999px',
                border: '1.5px solid',
                borderColor: value === opt.value ? '#111' : '#E0DDD6',
                background: value === opt.value ? '#111' : '#fff',
                color: value === opt.value ? '#fff' : '#333',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Backdrop */}
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 200, backdropFilter: 'blur(2px)' }}
        onClick={onClose}
      />

      {/* Sheet */}
      <div style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '480px',
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: '85vh',
        background: '#fff',
        borderRadius: '24px',
        zIndex: 201,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 24px 80px rgba(0,0,0,0.18)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 16px', borderBottom: '1px solid #F0EEE8' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#111', margin: 0 }}>Filter</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: '#666', lineHeight: 1, padding: '4px' }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          <PillGroup<number | null>
            label="Schlafzimmer"
            value={local.minBedrooms}
            onChange={(v) => setLocal(s => ({ ...s, minBedrooms: v }))}
            options={[
              { label: 'Beliebig', value: null },
              { label: '1+', value: 1 },
              { label: '2+', value: 2 },
              { label: '3+', value: 3 },
            ]}
          />
          <PillGroup<number | null>
            label="Mindestanzahl Gäste"
            value={local.minGuests}
            onChange={(v) => setLocal(s => ({ ...s, minGuests: v }))}
            options={[
              { label: 'Beliebig', value: null },
              { label: '2+', value: 2 },
              { label: '4+', value: 4 },
              { label: '6+', value: 6 },
              { label: '8+', value: 8 },
            ]}
          />
          <PillGroup<number | null>
            label="Max. Preis / Nacht"
            value={local.maxPrice}
            onChange={(v) => setLocal(s => ({ ...s, maxPrice: v }))}
            options={[
              { label: 'Beliebig', value: null },
              { label: 'bis 100 €', value: 100 },
              { label: 'bis 150 €', value: 150 },
              { label: 'bis 200 €', value: 200 },
              { label: 'bis 250 €', value: 250 },
            ]}
          />
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: '10px', padding: '16px 24px', borderTop: '1px solid #F0EEE8' }}>
          <button
            type="button"
            onClick={() => { setLocal({ minBedrooms: null, minGuests: null, maxPrice: null }); onApply({ minBedrooms: null, minGuests: null, maxPrice: null }) }}
            style={{ flex: 1, padding: '12px', borderRadius: '999px', border: '1.5px solid #E0DDD6', background: '#fff', color: '#333', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}
          >
            Alle löschen
          </button>
          <button
            type="button"
            onClick={() => { onApply(local); onClose() }}
            style={{ flex: 2, padding: '12px', borderRadius: '999px', border: 'none', background: 'linear-gradient(135deg, #C4A235, #9A7820)', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
          >
            Ergebnisse anzeigen
          </button>
        </div>
      </div>
    </>
  )
}

/* ── Listing Card ── */
function ListingCard({ card, index }: { card: CardData; index: number }) {
  const g = CARD_GRADIENTS[index % CARD_GRADIENTS.length]
  const showTotal = card.totalPrice > 0

  return (
    <Link
      href={`/listing/${card.id}`}
      className="listing-card"
      style={{ display: 'block', textDecoration: 'none', borderRadius: '14px', overflow: 'hidden', backgroundColor: '#fff', border: '1px solid #EAE7E0' }}
    >
      <div style={{ position: 'relative', aspectRatio: '4/3', background: `linear-gradient(160deg, ${g.from} 0%, ${g.to} 100%)`, overflow: 'hidden' }}>
        {card.image && (
          <img
            src={card.image}
            alt={card.title}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', ...(card.unavailable ? { filter: 'grayscale(60%) opacity(0.7)' } : {}) }}
          />
        )}
        {!card.image && (
          <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle at 25% 25%, rgba(255,255,255,0.22) 0%, transparent 55%), radial-gradient(circle at 80% 80%, rgba(0,0,0,0.08) 0%, transparent 50%)' }} />
        )}
        {card.unavailable && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '5px 12px', borderRadius: '999px', backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff', backdropFilter: 'blur(4px)' }}>
              Nicht verfügbar
            </span>
          </div>
        )}
        <div style={{ position: 'absolute', top: '10px', left: '10px' }}>
          <span style={{ fontSize: '10px', fontWeight: 600, padding: '3px 8px', borderRadius: '999px', backgroundColor: 'rgba(255,255,255,0.92)', color: '#333', backdropFilter: 'blur(8px)' }}>
            {card.location}
          </span>
        </div>
        {card.distanceKm !== null && card.distanceKm > 0 && (
          <div style={{ position: 'absolute', top: '10px', right: '10px' }}>
            <span style={{ fontSize: '10px', fontWeight: 500, padding: '3px 7px', borderRadius: '999px', backgroundColor: 'rgba(0,0,0,0.28)', color: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(6px)' }}>
              ~{card.distanceKm} km
            </span>
          </div>
        )}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '50%', background: `linear-gradient(to top, rgba(0,0,0,0.25) 0%, transparent 100%)` }} />
      </div>
      <div style={{ padding: '11px 13px 13px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#111', margin: 0, lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', flex: 1 }}>
            {card.title}
          </h3>
          {(card.pricePerNight > 0 || card.totalPrice > 0) && (
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#111' }}>
                €{showTotal ? card.totalPrice : card.pricePerNight}
              </span>
              <span style={{ fontSize: '10px', color: '#999', display: 'block', lineHeight: 1 }}>
                {showTotal ? `${card.nights} Nächte` : '/Nacht'}
              </span>
            </div>
          )}
        </div>
        <p style={{ fontSize: '11px', color: '#999', margin: '5px 0 0', lineHeight: 1 }}>
          {card.maxGuests} Gäste · {card.bedrooms} Schlafzimmer{(card.pricePerNight === 0 && card.totalPrice === 0) ? ' · Preis auf Anfrage' : ''}
        </p>
        {card.issues.length > 0 && (
          <div style={{ display: 'flex', gap: '4px', marginTop: '7px', flexWrap: 'wrap' }}>
            {card.issues.map((issue) => (
              <span key={issue} style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '999px', backgroundColor: '#FEF9EC', color: '#8A6A10', border: '1px solid #F0E0A0' }}>
                {issue}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  )
}

/* ── Main component ── */
export default function SearchResults({ cards, centerLat, centerLon, searchQuery, searchGuests }: Props) {
  const [mapCenter, setMapCenter] = useState<{ lat: number; lon: number } | null>(
    centerLat && centerLon ? { lat: centerLat, lon: centerLon } : null
  )
  const [filters, setFilters] = useState<FilterState>({ minBedrooms: null, minGuests: null, maxPrice: null })
  const [showFilter, setShowFilter] = useState(false)

  const handleCenterChange = useCallback((lat: number, lon: number) => {
    setMapCenter({ lat, lon })
  }, [])

  // 1. Apply filters
  const filtered = useMemo(() => {
    return cards.filter(c => {
      if (filters.minBedrooms !== null && c.bedrooms < filters.minBedrooms) return false
      if (filters.minGuests !== null && c.maxGuests < filters.minGuests) return false
      if (filters.maxPrice !== null && c.pricePerNight > 0 && c.pricePerNight > filters.maxPrice) return false
      return true
    })
  }, [cards, filters])

  // 2. Re-sort by distance to current map center
  const sorted = useMemo(() => {
    if (!mapCenter) return filtered
    return [...filtered].sort((a, b) => {
      const da = haversineKm(mapCenter.lat, mapCenter.lon, a.lat, a.lon)
      const db = haversineKm(mapCenter.lat, mapCenter.lon, b.lat, b.lon)
      return da - db
    })
  }, [filtered, mapCenter])

  // Map listings (all filtered, sorted by map center)
  const mapListings: MapListing[] = sorted.map(c => ({
    id: c.id,
    title: c.title,
    lat: c.lat,
    lon: c.lon,
    price: c.pricePerNight,
    totalPrice: c.totalPrice || undefined,
    nights: c.nights || undefined,
  }))

  const activeFilterCount = [filters.minBedrooms, filters.minGuests, filters.maxPrice].filter(v => v !== null).length

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',   /* required for position:sticky on right column */
      backgroundColor: '#ECEEF4',
    }}>
      {/* ── Left: Listings panel (scrolls with page) ── */}
      <div style={{
        flex: '0 0 55%',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Panel header — sticks below navbar */}
        <div style={{
          padding: '16px 20px 12px',
          backgroundColor: '#ECEEF4',
          position: 'sticky',
          top: 'var(--navbar-h, 88px)',
          zIndex: 10,
          borderBottom: '1px solid #EAE7E0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}>
          <h1 style={{ fontSize: '15px', fontWeight: 700, color: '#111', margin: 0, lineHeight: 1.2 }}>
            {sorted.length} Treffer{searchQuery ? <> · <span style={{ color: '#A8882A' }}>„{searchQuery}"</span></> : ''}
            {searchGuests ? ` · ${searchGuests}+ Gäste` : ''}
          </h1>
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setShowFilter(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '7px 14px', borderRadius: '999px',
                border: `1.5px solid ${activeFilterCount > 0 ? '#111' : '#E0DDD6'}`,
                background: activeFilterCount > 0 ? '#111' : '#fff',
                color: activeFilterCount > 0 ? '#fff' : '#333',
                fontSize: '12px', fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="8" y1="12" x2="16" y2="12" />
                <line x1="12" y1="18" x2="12" y2="18" />
              </svg>
              Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </button>
            <Link href="/" style={{ fontSize: '12px', padding: '7px 12px', borderRadius: '999px', border: '1.5px solid #E0DDD6', color: '#666', textDecoration: 'none', backgroundColor: '#fff', whiteSpace: 'nowrap' }}>
              ✕ Zurücksetzen
            </Link>
          </div>
        </div>

        {/* Cards grid */}
        <div style={{ padding: '16px 20px 32px', flex: 1 }}>
          {sorted.length > 0 ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(196px, 1fr))',
              gap: '14px',
            }}>
              {sorted.map((card, i) => (
                <ListingCard key={card.id} card={card} index={i} />
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '60px 20px', borderRadius: '16px', backgroundColor: '#fff', border: '1px solid #EAE7E0' }}>
              <p style={{ fontSize: '28px', marginBottom: '10px' }}>🔍</p>
              <p style={{ fontSize: '15px', fontWeight: 700, color: '#111', margin: '0 0 6px' }}>Keine Unterkünfte gefunden</p>
              <p style={{ fontSize: '13px', color: '#888', marginBottom: '16px' }}>Versuche andere Filter oder einen anderen Ort.</p>
              <button type="button" onClick={() => setFilters({ minBedrooms: null, minGuests: null, maxPrice: null })} style={{ fontSize: '13px', fontWeight: 600, padding: '10px 24px', borderRadius: '999px', backgroundColor: '#111', color: '#fff', border: 'none', cursor: 'pointer' }}>
                Filter zurücksetzen
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Right: Map panel — sticky, stays in viewport while left scrolls ── */}
      <div style={{
        flex: '0 0 45%',
        position: 'sticky',
        top: 'var(--navbar-h, 88px)',
        height: 'calc(100vh - var(--navbar-h, 88px))',
        display: 'flex',
        flexDirection: 'column',
        padding: '14px 20px 14px 10px',
        boxSizing: 'border-box',
      }}>
        <div style={{
          flex: 1,
          minHeight: 0,
          borderRadius: '24px',
          overflow: 'hidden',
          border: '2px solid #D8D5CE',
          boxShadow: '0 8px 32px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.06)',
          position: 'relative',
        }}>
          <ListingsMap
            listings={mapListings}
            centerLat={centerLat}
            centerLon={centerLon}
            onCenterChange={handleCenterChange}
          />
        </div>
      </div>

      {/* ── Filter Modal ── */}
      {showFilter && (
        <FilterModal
          filters={filters}
          onApply={setFilters}
          onClose={() => setShowFilter(false)}
        />
      )}
    </div>
  )
}
