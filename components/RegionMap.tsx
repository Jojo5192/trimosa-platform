'use client'

/**
 * Interactive experience map for the region landing pages: curated POIs
 * (sights / biking & outdoors / family) as filterable emoji markers, plus the
 * region's TRIMOSA apartments as gold pins linking to their detail pages.
 * Leaflet is loaded from CDN exactly like in ListingsMap.
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { POI_CATEGORIES, type Poi, type PoiCategory } from '@/lib/regions'
import type { EmpfehlungView } from '@/lib/empfehlungen'
import EmpfehlungBubble from '@/components/EmpfehlungBubble'
import { t, type UiLang } from '@/lib/i18n'

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
  /** POIs of the neighbouring regions — appear once the user zooms out */
  extraPois?: Poi[]
  /** Render the "Ausflugsziele im Detail" card grid below the map — it
      follows the same category filter as the markers */
  showPoiGrid?: boolean
  /** 'light' = clean overview (default) · 'voyager' = detailed street map
      with labels/POIs, for orientation around a single address */
  tiles?: 'light' | 'voyager'
  /** Hosts' personal recommendations keyed by Poi.slug (POI grid only) */
  empfehlungen?: Record<string, EmpfehlungView[]>
  lang?: UiLang
}

/** POI cards shown before "Alle anzeigen" expands the grid */
const POI_GRID_COLLAPSED = 6

/** Neighbouring-region POIs become visible at this zoom level or wider */
const FOREIGN_MAX_ZOOM = 11

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    L: any
  }
}

export default function RegionMap({ pois, listings, center, zoom, showFilter = true, highlightSlug, height, extraPois, showPoiGrid = false, tiles = 'light', empfehlungen = {}, lang = 'de' }: Props) {
  const [showAllPois, setShowAllPois] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const poiMarkersRef = useRef<{ category: PoiCategory; marker: any; foreign: boolean }[]>([])
  const [activeCategory, setActiveCategory] = useState<PoiCategory | 'alle'>('alle')
  const activeCategoryRef = useRef<PoiCategory | 'alle'>('alle')

  // Shared visibility rule: category filter + zoom gate for neighbour POIs
  const applyVisibility = () => {
    const map = mapRef.current
    if (!map) return
    const zoomNow = map.getZoom()
    const cat = activeCategoryRef.current
    for (const { category, marker, foreign } of poiMarkersRef.current) {
      const show = (cat === 'alle' || category === cat) && (!foreign || zoomNow <= FOREIGN_MAX_ZOOM)
      if (show && !map.hasLayer(marker)) marker.addTo(map)
      if (!show && map.hasLayer(marker)) map.removeLayer(marker)
    }
  }

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

      // Shared map styles (same block ListingsMap injects on the search page —
      // identical id, so whichever map loads first wins and the other skips)
      if (!document.getElementById('trimosa-map-styles')) {
        const style = document.createElement('style')
        style.id = 'trimosa-map-styles'
        style.textContent = `
          .trimosa-searchmap .leaflet-tile {
            filter: sepia(0.18) saturate(1.5) contrast(1.22) brightness(0.92);
          }
          /* Voyager (detail maps): own colours already, only gentle deepening */
          .trimosa-map-voyager .leaflet-tile {
            filter: saturate(1.12) contrast(1.06) brightness(0.98);
          }
          .leaflet-control-scale-line {
            border-color: rgba(0,0,0,0.35) !important;
            background: rgba(255,255,255,0.7) !important;
            color: #444 !important;
            font-size: 9px !important;
          }
          .trimosa-popup .leaflet-popup-content-wrapper {
            border-radius: 16px !important;
            padding: 0 !important;
            overflow: hidden !important;
            box-shadow: 0 12px 40px rgba(0,0,0,0.22) !important;
            border: none !important;
            background: #fff !important;
          }
          .trimosa-popup .leaflet-popup-content {
            margin: 0 !important;
            width: 220px !important;
          }
          .trimosa-popup a { transition: opacity 0.15s; }
          .trimosa-popup a:hover { opacity: 0.94; }
          .trimosa-popup .leaflet-popup-tip-container {
            display: none !important;
          }
          .leaflet-control-zoom {
            border: none !important;
            box-shadow: none !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 4px !important;
          }
          .leaflet-control-zoom a {
            width: 32px !important;
            height: 32px !important;
            line-height: 32px !important;
            border-radius: 8px !important;
            border: none !important;
            background: #fff !important;
            color: #333 !important;
            font-size: 18px !important;
            font-weight: 400 !important;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15) !important;
            text-align: center !important;
          }
          .leaflet-control-zoom a:hover {
            background: #f5f5f5 !important;
          }
          .trimosa-marker:hover,
          .trimosa-marker.trimosa-marker-active {
            transform: scale(1.18) translateY(-3px) !important;
          }
          .trimosa-marker:hover > div:first-child,
          .trimosa-marker.trimosa-marker-active > div:first-child {
            box-shadow: 0 8px 28px rgba(0,0,0,0.25), 0 0 0 3px var(--gold) !important;
          }
          .leaflet-attribution-flag { display: none !important; }
          .leaflet-control-attribution {
            font-size: 9px !important;
            background: rgba(255,255,255,0.8) !important;
            color: rgba(0,0,0,0.4) !important;
            border-radius: 4px !important;
            padding: 2px 6px !important;
          }
          .leaflet-control-attribution a { color: rgba(0,0,0,0.4) !important; }
        `
        document.head.appendChild(style)
      }

      L.control.attribution({ position: 'bottomleft', prefix: false })
        .addAttribution('© <a href="https://carto.com" style="color:#999">CARTO</a> · © <a href="https://openstreetmap.org" style="color:#999">OSM</a>')
        .addTo(map)

      L.tileLayer(
        tiles === 'voyager'
          ? 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
          : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        { subdomains: 'abcd', maxZoom: 19 }
      ).addTo(map)

      // Metric scale bar helps judging distances around the address
      L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map)

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

      // Curated POIs — emoji markers with category ring colour. Neighbouring
      // regions' POIs (foreign) only appear once the user zooms out.
      const addPoi = (poi: Poi, foreign: boolean) => {
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
            <a href="/erlebnis/${poi.slug}" style="display:inline-block;font-size:11.5px;font-weight:700;color:${color};margin-top:7px;text-decoration:none">${t(lang, 'Mehr erfahren →')}</a>`
        // Photo header served via our own /_next/image proxy (no third-party request)
        const imgHeader = poi.image
          ? `<img src="/_next/image?url=${encodeURIComponent(poi.image.src)}&w=640&q=75" alt="" style="display:block;width:100%;height:96px;object-fit:cover"/>`
          : ''
        const popup = L.popup({ closeButton: false, className: 'trimosa-popup', maxWidth: 240 }).setContent(`
          ${imgHeader}
          <div style="padding:10px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
            <span style="display:block;font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.05em;margin-bottom:3px">${t(lang, POI_CATEGORIES[poi.category].label)}</span>
            <span style="display:block;font-size:13px;font-weight:700;color:#111;margin-bottom:4px">${poi.emoji} ${poi.name}</span>
            <span style="display:block;font-size:12px;color:#555;line-height:1.45">${poi.text}</span>${detailLink}
          </div>`)
        const m = L.marker([poi.lat, poi.lon], { icon, zIndexOffset: isHighlight ? 500 : 0 }).bindPopup(popup)
        if (!foreign) m.addTo(map)
        m.on('mouseover', () => m.openPopup())
        poiMarkersRef.current.push({ category: poi.category, marker: m, foreign })
      }
      pois.forEach((p) => addPoi(p, false))
      ;(extraPois ?? []).forEach((p) => addPoi(p, true))

      // Reveal/hide neighbour POIs as the user zooms
      map.on('zoomend', applyVisibility)
      applyVisibility()
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
    activeCategoryRef.current = activeCategory
    applyVisibility()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory])

  return (
    <div>
      {/* Category chips */}
      {showFilter && (
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
        {([['alle', { label: t(lang, 'Alles anzeigen'), color: '#555' }], ...Object.entries(POI_CATEGORIES)] as [PoiCategory | 'alle', { label: string; color: string }][]).map(([key, meta]) => {
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
              {t(lang, meta.label)}
            </button>
          )
        })}
      </div>
      )}

      {/* position:relative + zIndex:0 traps Leaflet's internal z-indexes (up to
          ~1000) inside this box so the map never paints over the sticky NavBar */}
      <div style={{ position: 'relative', zIndex: 0, isolation: 'isolate', borderRadius: '20px', overflow: 'hidden', border: '2px solid #D8D5CE', boxShadow: '0 8px 32px rgba(0,0,0,0.1)' }}>
        <div ref={containerRef} className={`trimosa-searchmap${tiles === 'voyager' ? ' trimosa-map-voyager' : ''}`} style={{ width: '100%', height: height ?? 'clamp(340px, 55vh, 520px)' }} />
      </div>
      <p style={{ fontSize: '11.5px', color: '#999', margin: '8px 2px 0' }}>
        🏠 = TRIMOSA-Apartments · Marker antippen für Details
      </p>

      {/* ── Destination cards, driven by the same category filter ── */}
      {showPoiGrid && (
        <>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1A1400', margin: '28px 0 12px', letterSpacing: '-0.01em' }}>
            {t(lang, 'Ausflugsziele im Detail')}
            {activeCategory !== 'alle' && (
              <span style={{ fontSize: '12px', fontWeight: 600, color: POI_CATEGORIES[activeCategory].color, marginLeft: '10px' }}>
                {t(lang, POI_CATEGORIES[activeCategory].label)}
              </span>
            )}
          </h2>
          {(() => {
            // Hosts' recommendations float to the front of the grid
            const filtered = pois
              .filter((p) => activeCategory === 'alle' || p.category === activeCategory)
              .sort((a, b) => (empfehlungen[b.slug]?.length ? 1 : 0) - (empfehlungen[a.slug]?.length ? 1 : 0))
            const shownPois = showAllPois ? filtered : filtered.slice(0, POI_GRID_COLLAPSED)
            return (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                  {shownPois.map((p) => {
                    const c = POI_CATEGORIES[p.category].color
                    const emp = empfehlungen[p.slug]
                    return (
                      <Link key={p.slug} href={`/erlebnis/${p.slug}`} className="listing-card" style={{
                        display: 'block', textDecoration: 'none', borderRadius: '14px',
                        background: '#fff', overflow: 'hidden',
                        border: emp ? '1.5px solid var(--gold)' : '1px solid #EAE7E0',
                        boxShadow: emp ? '0 4px 20px rgba(174,141,45,0.18)' : 'none',
                      }}>
                        <div style={{ position: 'relative', aspectRatio: '16/10', background: `linear-gradient(135deg, ${c}1F, ${c}0A)` }}>
                          {p.image
                            ? <Image src={p.image.src} alt={p.name} fill sizes="(max-width: 768px) 50vw, 220px" style={{ objectFit: 'cover' }} />
                            : <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '38px' }}>{p.emoji}</span>}
                          <span style={{
                            position: 'absolute', top: '8px', left: '8px', fontSize: '9.5px', fontWeight: 800,
                            letterSpacing: '0.05em', textTransform: 'uppercase', color: '#fff',
                            background: c, padding: '3px 8px', borderRadius: '999px', boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
                          }}>{t(lang, POI_CATEGORIES[p.category].label)}</span>
                        </div>
                        <div style={{ padding: '10px 12px 11px' }}>
                          <span style={{ display: 'block', fontSize: '13.5px', fontWeight: 700, color: '#1A1400', lineHeight: 1.3 }}>{p.emoji} {p.name}</span>
                          {emp && <div style={{ margin: '9px 0 2px' }}><EmpfehlungBubble empfehlungen={emp} lang={lang} /></div>}
                          <span style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: c, marginTop: '3px' }}>{t(lang, 'Mehr erfahren →')}</span>
                        </div>
                      </Link>
                    )
                  })}
                </div>
                {filtered.length > POI_GRID_COLLAPSED && (
                  <div style={{ display: 'flex', justifyContent: 'center', marginTop: '14px' }}>
                    <button type="button" onClick={() => setShowAllPois(!showAllPois)} style={{
                      padding: '10px 24px', borderRadius: '999px', cursor: 'pointer',
                      border: '1.5px solid var(--gold)', background: '#fff',
                      color: 'var(--gold-dark)', fontSize: '13px', fontWeight: 700,
                    }}>
                      {showAllPois ? `− ${t(lang, 'Weniger anzeigen')}` : t(lang, 'Alle {n} Ausflugsziele anzeigen', { n: filtered.length })}
                    </button>
                  </div>
                )}
              </>
            )
          })()}
          <p style={{ fontSize: '11px', color: '#AAA6A0', margin: '10px 2px 0' }}>
            Fotos der Ausflugsziele: Wikimedia Commons — Urheber und Lizenz jeweils auf der Detailseite.
          </p>
        </>
      )}
    </div>
  )
}
