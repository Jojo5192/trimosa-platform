'use client'

import { useEffect, useRef } from 'react'

export interface MapListing {
  id: string
  title: string
  lat: number
  lon: number
  price: number        // per night
  totalPrice?: number  // for the searched period
  nights?: number
  image?: string       // cover image for the popup
  location?: string    // shown as a subtle label in the popup
  maxGuests?: number   // capacity shown in the popup
  matched?: boolean    // matches the active filters → prominent; else muted
  flexNote?: string    // nearby free window (flexible dates)
  unavailable?: boolean // not free for the exact dates (flexNote = alternative)
}

interface Props {
  listings: MapListing[]
  centerLat?: number
  centerLon?: number
  onCenterChange?: (lat: number, lon: number) => void
  /** Currently hovered listing ids (highlights their markers). */
  hoveredIds?: string[]
  /** Called on marker hover with all listing ids at that address (or null). */
  onHoverListing?: (ids: string[] | null) => void
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    L: any
  }
}

export default function ListingsMap({ listings, centerLat, centerLon, onCenterChange, hoveredIds, onHoverListing }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  const leafletLoadedRef = useRef(false)
  // Marker instances keyed by listing id — lets a separate effect highlight the
  // hovered one without re-initialising the whole map.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<Record<string, any>>({})
  // Latest hover callback held in a ref so the marker handlers stay stable and
  // don't force a map re-init when the parent passes a fresh function.
  const onHoverRef = useRef(onHoverListing)
  useEffect(() => { onHoverRef.current = onHoverListing }, [onHoverListing])

  useEffect(() => {
    if (!containerRef.current) return

    const initMap = () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
      markersRef.current = {}
      const L = window.L
      if (!L || !containerRef.current) return

      const defaultLat = centerLat ?? (listings.length > 0
        ? listings.reduce((s, l) => s + l.lat, 0) / listings.length
        : 48.3)
      const defaultLon = centerLon ?? (listings.length > 0
        ? listings.reduce((s, l) => s + l.lon, 0) / listings.length
        : 11.5)

      const map = L.map(containerRef.current, {
        center: [defaultLat, defaultLon],
        zoom: listings.length === 1 ? 13 : 9,
        zoomControl: false,
        scrollWheelZoom: true,
        attributionControl: false,
      })
      mapRef.current = map

      // Zoom control – repositioned bottom right
      L.control.zoom({ position: 'bottomright' }).addTo(map)

      // Attribution – minimal, bottom left
      L.control.attribution({ position: 'bottomleft', prefix: false })
        .addAttribution('© <a href="https://carto.com" style="color:#999">CARTO</a> · © <a href="https://openstreetmap.org" style="color:#999">OSM</a>')
        .addTo(map)

      // CartoDB Positron — light, desaturated, minimal. Keeps the map calm so
      // the gold price markers and photo popups are what stands out.
      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map)

      // Listings at the exact same address stack invisibly on one point — fan
      // them out in a small circle (~15 m) so every apartment in the building
      // is visible and individually hoverable.
      const byCoord: Record<string, MapListing[]> = {}
      for (const l of listings) {
        const key = `${l.lat.toFixed(4)},${l.lon.toFixed(4)}`
        ;(byCoord[key] ??= []).push(l)
      }
      const positioned = listings.map((l) => {
        const group = byCoord[`${l.lat.toFixed(4)},${l.lon.toFixed(4)}`]
        if (group.length === 1) return l
        const i = group.indexOf(l)
        const angle = (2 * Math.PI * i) / group.length
        const r = 0.00015 // ≈ 15 m
        return {
          ...l,
          lat: l.lat + r * Math.sin(angle),
          lon: l.lon + (r * Math.cos(angle)) / Math.cos((l.lat * Math.PI) / 180),
        }
      })
      // All listing ids sharing an address — hovering one pin highlights them all
      const groupOf: Record<string, string[]> = {}
      for (const arr of Object.values(byCoord)) {
        const ids = arr.map((x) => x.id)
        for (const l of arr) groupOf[l.id] = ids
      }

      // Add markers
      positioned.forEach((listing) => {
        const displayPrice = listing.totalPrice && listing.totalPrice > 0
          ? listing.totalPrice
          : listing.price
        const hasTotal = !!(listing.totalPrice && listing.totalPrice > 0 && listing.nights && listing.nights > 1)
        const hasPrice = displayPrice > 0
        const isMatched = listing.matched !== false
        // Matched results are gold and prominent; non-matching ones are muted
        // grey so they read as "nearby / not an exact fit" at a glance.
        const ring = isMatched ? 'var(--gold)' : 'rgba(120,120,120,0.5)'
        const pinFill = isMatched ? 'var(--gold)' : '#B4B0A8'

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let icon: any
        if (hasPrice) {
          // Price pill
          icon = L.divIcon({
            className: '',
            html: `
              <div class="trimosa-marker" style="
                position: relative; display: inline-flex; flex-direction: column;
                align-items: center; cursor: pointer; transform-origin: bottom center;
                transition: transform 0.18s cubic-bezier(0.22,1,0.36,1);
                ${isMatched ? '' : 'opacity: 0.9;'}
              ">
                <div style="
                  display: inline-flex; align-items: center; background: #fff;
                  color: #111; font-size: 12.5px; font-weight: 700;
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                  padding: 6px 13px; border-radius: 12px; white-space: nowrap;
                  box-shadow: 0 3px 14px rgba(0,0,0,0.20), 0 0 0 1.5px ${ring};
                  letter-spacing: -0.01em;
                ">
                  <span style="color:${isMatched ? 'var(--gold)' : '#8A8680'};font-weight:800;margin-right:1px">€</span>${String(displayPrice)}
                </div>
                <div style="
                  width: 0; height: 0; border-left: 5px solid transparent;
                  border-right: 5px solid transparent; border-top: 6px solid #fff;
                  filter: drop-shadow(0 2px 2px rgba(0,0,0,0.12)); margin-top: -1px;
                "></div>
              </div>
            `,
            iconAnchor: [35, 42],
            popupAnchor: [0, -44],
            iconSize: [70, 42],
          })
        } else {
          // No price yet -> a clean teardrop pin instead of an "Anfrage" label.
          icon = L.divIcon({
            className: '',
            html: `
              <div class="trimosa-marker" style="
                position: relative; display: inline-flex; cursor: pointer;
                transform-origin: bottom center;
                transition: transform 0.18s cubic-bezier(0.22,1,0.36,1);
                ${isMatched ? '' : 'opacity: 0.92;'}
              ">
                <div style="
                  width: 26px; height: 26px; border-radius: 50% 50% 50% 0;
                  transform: rotate(-45deg); background: ${pinFill};
                  box-shadow: 0 3px 10px rgba(0,0,0,0.28), 0 0 0 2px #fff;
                  display: flex; align-items: center; justify-content: center;
                ">
                  <div style="width: 8px; height: 8px; border-radius: 50%; background: #fff; transform: rotate(45deg);"></div>
                </div>
              </div>
            `,
            iconAnchor: [13, 30],
            popupAnchor: [0, -30],
            iconSize: [26, 34],
          })
        }

        const priceBlock = displayPrice > 0
          ? hasTotal
            ? `<span style="font-size:15px;font-weight:800;color:var(--gold)">€\u202F${displayPrice}</span>
               <span style="font-size:11px;color:#888;margin-left:3px">gesamt · ${listing.nights} Nächte</span>`
            : `<span style="font-size:15px;font-weight:800;color:var(--gold)">€\u202F${displayPrice}</span>
               <span style="font-size:11px;color:#888;margin-left:3px">/Nacht</span>`
          : `<span style="font-size:12px;font-weight:500;color:#888">Preis auf Anfrage</span>`

        const imageHeader = listing.image
          ? `<div style="width:100%;height:132px;overflow:hidden;background:#EDEBE4">
               <img src="${listing.image}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block" />
             </div>`
          : ''

        const popup = L.popup({
          closeButton: false,
          className: 'trimosa-popup',
          maxWidth: 244,
          offset: [0, -6],
        }).setContent(`
          <a href="/listing/${listing.id}" style="display:block;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:inherit">
            ${imageHeader}
            <div style="padding:11px 13px 13px">
              ${listing.location ? `<p style="font-size:10px;font-weight:700;color:var(--gold-dark);text-transform:uppercase;letter-spacing:0.05em;margin:0 0 3px">${listing.location}</p>` : ''}
              <p style="font-size:13.5px;font-weight:600;color:#111;margin:0 0 4px;line-height:1.3">${listing.title}</p>
              ${listing.maxGuests ? `<p style="font-size:11.5px;color:#888;margin:0 0 6px;line-height:1">Bis zu ${listing.maxGuests} Gäste</p>` : '<div style="height:4px"></div>'}
              ${listing.flexNote ? `<p style="display:inline-block;font-size:10.5px;font-weight:600;border-radius:999px;padding:2px 8px;margin:0 0 8px;line-height:1.3;${listing.unavailable ? 'color:#8A6D1E;background:#FBF3E3;border:1px solid #F0E0A0' : 'color:#2D6A1E;background:#EAF3EC;border:1px solid #CDE6D2'}">📅 ${listing.unavailable ? 'Alternativ frei' : 'Frei'}: ${listing.flexNote}</p>` : ''}
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                <span style="line-height:1">${priceBlock}</span>
                <span style="flex-shrink:0;font-size:11.5px;font-weight:700;color:#1A1400;background:linear-gradient(135deg,var(--gold),var(--gold-dark));padding:6px 13px;border-radius:999px">Ansehen →</span>
              </div>
            </div>
          </a>
        `)

        const marker = L.marker([listing.lat, listing.lon], { icon })
          .addTo(map)
          .bindPopup(popup)

        marker.on('mouseover', () => { marker.openPopup(); onHoverRef.current?.(groupOf[listing.id] ?? [listing.id]) })
        marker.on('mouseout', () => { onHoverRef.current?.(null) })
        markersRef.current[listing.id] = marker
      })

      // Emit center on map move so parent can reorder listings
      if (onCenterChange) {
        map.on('moveend', () => {
          const c = map.getCenter()
          onCenterChange(c.lat, c.lng)
        })
      }

      // Fit bounds to the results that MATCH the search, so a "Bitburg" search
      // zooms to Bitburg instead of out to far-away "nearby" suggestions. Fall
      // back to all results when nothing fully matches (or on the unfiltered
      // map view, where everything is "matched").
      const matched = listings.filter((l: MapListing) => l.matched !== false)
      const focusListings = matched.length > 0 ? matched : listings
      const boundsPoints: [number, number][] = focusListings.map((l: MapListing) => [l.lat, l.lon])
      // Anchor to the typed location only when something actually matches it;
      // otherwise (e.g. a search far from any listing) its centroid would widen
      // the view back out.
      if (centerLat && centerLon && matched.length > 0) boundsPoints.push([centerLat, centerLon])

      if (boundsPoints.length > 1) {
        const bounds = L.latLngBounds(boundsPoints)
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 })
      } else if (boundsPoints.length === 1) {
        map.setView(boundsPoints[0], 12)
      }

      // Inject popup + zoom control styles once
      if (!document.getElementById('trimosa-map-styles')) {
        const style = document.createElement('style')
        style.id = 'trimosa-map-styles'
        style.textContent = `
          /* Warm up + deepen the light base map so it reads premium, not
             washed-out: a touch of sepia kills the cold grey, stronger contrast
             adds depth, slightly darker overall. */
          .trimosa-searchmap .leaflet-tile {
            filter: sepia(0.18) saturate(1.5) contrast(1.22) brightness(0.92);
          }
          /* Popup — crisp white card with full-bleed image header */
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
          /* Zoom controls — clean white pill style */
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
          /* Marker hover — direct pointer hover AND synced list hover */
          .trimosa-marker:hover,
          .trimosa-marker.trimosa-marker-active {
            transform: scale(1.18) translateY(-3px) !important;
          }
          .trimosa-marker:hover > div:first-child,
          .trimosa-marker.trimosa-marker-active > div:first-child {
            box-shadow: 0 8px 28px rgba(0,0,0,0.25), 0 0 0 3px var(--gold) !important;
          }
          /* Attribution */
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
    }

    // Load CSS
    if (!document.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      document.head.appendChild(link)
    }

    // Load JS
    if (!leafletLoadedRef.current && !window.L) {
      const script = document.createElement('script')
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
      script.async = true
      script.onload = () => { leafletLoadedRef.current = true; initMap() }
      document.head.appendChild(script)
    } else {
      if (window.L) initMap()
      else { const t = setTimeout(initMap, 200); return () => clearTimeout(t) }
    }

    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings.length, centerLat, centerLon, onCenterChange])

  // Highlight the hovered marker(s) (driven by list hover) without touching the map
  useEffect(() => {
    Object.entries(markersRef.current).forEach(([id, marker]) => {
      const active = hoveredIds?.includes(id) ?? false
      const el = marker.getElement?.()?.querySelector('.trimosa-marker') as HTMLElement | null
      if (el) el.classList.toggle('trimosa-marker-active', active)
      marker.setZIndexOffset?.(active ? 1000 : 0)
    })
  }, [hoveredIds])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} className="trimosa-searchmap" style={{ width: '100%', height: '100%' }} />
      {listings.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2F0EC', borderRadius: '16px' }}>
          <p style={{ fontSize: '13px', color: '#AAA' }}>Keine Ergebnisse auf der Karte</p>
        </div>
      )}
    </div>
  )
}
