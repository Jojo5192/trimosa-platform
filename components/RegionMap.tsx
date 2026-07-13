'use client'

/**
 * Interactive experience map for the region landing pages: curated POIs
 * (sights / biking & outdoors / family) as filterable emoji markers, plus the
 * region's TRIMOSA apartments as gold pins linking to their detail pages.
 * Leaflet is loaded from CDN exactly like in ListingsMap.
 */
import { useEffect, useRef, useState } from 'react'
import { POI_CATEGORIES, type Poi, type PoiCategory } from '@/lib/regions'

export interface RegionMapListing {
  id: string
  slug?: string
  title: string
  lat: number
  lon: number
}

interface Props {
  pois: Poi[]
  listings: RegionMapListing[]
  center: [number, number]
  zoom: number
  /** Hide the category filter chips (e.g. on POI detail pages) */
  showFilter?: boolean
  /** POI slug rendered larger, e.g. the destination a detail page is about */
  highlightSlug?: string
  height?: string
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    L: any
  }
}

export default function RegionMap({ pois, listings, center, zoom, showFilter = true, highlightSlug, height }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const poiMarkersRef = useRef<{ category: PoiCategory; marker: any }[]>([])
  const [activeCategory, setActiveCategory] = useState<PoiCategory | 'alle'>('alle')

  useEffect(() => {
    const initMap = () => {
      const L = window.L
      if (!L || !containerRef.current || mapRef.current) return

      const map = L.map(containerRef.current, {
        center,
        zoom,
        zoomControl: true,
        scrollWheelZoom: false, // page scrolling stays smooth; zoom via buttons
        attributionControl: false,
      })
      mapRef.current = map

      L.control.attribution({ position: 'bottomleft', prefix: false })
        .addAttribution('© <a href="https://carto.com" style="color:#999">CARTO</a> · © <a href="https://openstreetmap.org" style="color:#999">OSM</a>')
        .addTo(map)

      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map)

      // TRIMOSA apartments — gold pins linking to the listing
      listings.forEach((l) => {
        const icon = L.divIcon({
          className: '',
          html: `
            <div style="position:relative;display:inline-flex;cursor:pointer;">
              <div style="width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
                background:var(--gold,#AE8D2D);box-shadow:0 3px 10px rgba(0,0,0,0.28),0 0 0 2px #fff;
                display:flex;align-items:center;justify-content:center;">
                <span style="transform:rotate(45deg);font-size:12px;line-height:1">🏠</span>
              </div>
            </div>`,
          iconAnchor: [14, 32],
          popupAnchor: [0, -32],
          iconSize: [28, 36],
        })
        const popup = L.popup({ closeButton: false, className: 'trimosa-popup', maxWidth: 220 }).setContent(`
          <a href="/listing/${l.slug ?? l.id}" style="display:block;padding:10px 12px;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
            <span style="display:block;font-size:13px;font-weight:700;color:#111;margin-bottom:6px">${l.title}</span>
            <span style="display:inline-block;font-size:11.5px;font-weight:700;color:#1A1400;background:linear-gradient(135deg,var(--gold),var(--gold-dark));padding:5px 12px;border-radius:999px">Ansehen →</span>
          </a>`)
        const m = L.marker([l.lat, l.lon], { icon }).addTo(map).bindPopup(popup)
        m.on('mouseover', () => m.openPopup())
      })

      // Curated POIs — emoji markers with category ring colour
      pois.forEach((poi) => {
        const color = POI_CATEGORIES[poi.category].color
        const isHighlight = poi.slug === highlightSlug
        const size = isHighlight ? 42 : 30
        const icon = L.divIcon({
          className: '',
          html: `
            <div style="width:${size}px;height:${size}px;border-radius:50%;background:#fff;cursor:pointer;
              box-shadow:0 2px 8px rgba(0,0,0,0.22),0 0 0 ${isHighlight ? 3.5 : 2.5}px ${color}${isHighlight ? `,0 0 0 7px ${color}33` : ''};
              display:flex;align-items:center;justify-content:center;font-size:${isHighlight ? 21 : 15}px;line-height:1">
              ${poi.emoji}
            </div>`,
          iconAnchor: [size / 2, size / 2],
          popupAnchor: [0, -(size / 2 + 1)],
          iconSize: [size, size],
        })
        const detailLink = isHighlight ? '' : `
            <a href="/erlebnis/${poi.slug}" style="display:inline-block;font-size:11.5px;font-weight:700;color:${color};margin-top:7px;text-decoration:none">Mehr erfahren →</a>`
        const popup = L.popup({ closeButton: false, className: 'trimosa-popup', maxWidth: 240 }).setContent(`
          <div style="padding:10px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
            <span style="display:block;font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.05em;margin-bottom:3px">${POI_CATEGORIES[poi.category].label}</span>
            <span style="display:block;font-size:13px;font-weight:700;color:#111;margin-bottom:4px">${poi.emoji} ${poi.name}</span>
            <span style="display:block;font-size:12px;color:#555;line-height:1.45">${poi.text}</span>${detailLink}
          </div>`)
        const m = L.marker([poi.lat, poi.lon], { icon, zIndexOffset: isHighlight ? 500 : 0 }).addTo(map).bindPopup(popup)
        m.on('mouseover', () => m.openPopup())
        poiMarkersRef.current.push({ category: poi.category, marker: m })
      })
    }

    if (!document.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      document.head.appendChild(link)
    }
    if (!window.L) {
      const existing = document.querySelector('script[src*="leaflet@1.9.4"]') as HTMLScriptElement | null
      if (existing) existing.addEventListener('load', initMap)
      else {
        const script = document.createElement('script')
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
        script.async = true
        script.onload = initMap
        document.head.appendChild(script)
      }
    } else {
      initMap()
    }

    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; poiMarkersRef.current = [] }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Category filter: add/remove POI markers without touching the map
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    for (const { category, marker } of poiMarkersRef.current) {
      const show = activeCategory === 'alle' || category === activeCategory
      if (show && !map.hasLayer(marker)) marker.addTo(map)
      if (!show && map.hasLayer(marker)) map.removeLayer(marker)
    }
  }, [activeCategory])

  return (
    <div>
      {/* Category chips */}
      {showFilter && (
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
        {([['alle', { label: 'Alles anzeigen', color: '#555' }], ...Object.entries(POI_CATEGORIES)] as [PoiCategory | 'alle', { label: string; color: string }][]).map(([key, meta]) => {
          const isActive = activeCategory === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveCategory(key)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '7px',
                padding: '7px 14px', borderRadius: '999px', fontSize: '12.5px', fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s',
                border: isActive ? `1.5px solid ${meta.color}` : '1.5px solid #E0DDD6',
                background: isActive ? '#fff' : '#FAFAF7',
                color: isActive ? meta.color : '#555',
                boxShadow: isActive ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              {key !== 'alle' && <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: meta.color }} />}
              {meta.label}
            </button>
          )
        })}
      </div>
      )}

      <div style={{ borderRadius: '20px', overflow: 'hidden', border: '2px solid #D8D5CE', boxShadow: '0 8px 32px rgba(0,0,0,0.1)' }}>
        <div ref={containerRef} className="trimosa-searchmap" style={{ width: '100%', height: height ?? 'clamp(340px, 55vh, 520px)' }} />
      </div>
      <p style={{ fontSize: '11.5px', color: '#999', margin: '8px 2px 0' }}>
        🏠 = TRIMOSA-Apartments · Marker antippen für Details
      </p>
    </div>
  )
}
