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
}

interface Props {
  listings: MapListing[]
  centerLat?: number
  centerLon?: number
  onCenterChange?: (lat: number, lon: number) => void
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    L: any
  }
}

export default function ListingsMap({ listings, centerLat, centerLon, onCenterChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  const leafletLoadedRef = useRef(false)

  useEffect(() => {
    if (!containerRef.current) return

    const initMap = () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
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

      // CartoDB Voyager — vibrant, colourful, modern
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map)

      // Add markers
      listings.forEach((listing) => {
        const displayPrice = listing.totalPrice && listing.totalPrice > 0
          ? listing.totalPrice
          : listing.price
        const hasTotal = !!(listing.totalPrice && listing.totalPrice > 0 && listing.nights && listing.nights > 1)
        const priceLabel = displayPrice > 0
          ? `€\u202F${displayPrice}${hasTotal ? '' : ''}`
          : 'Anfrage'

        const isRequest = priceLabel === 'Anfrage'
        const icon = L.divIcon({
          className: '',
          html: `
            <div class="trimosa-marker" style="
              position: relative;
              display: inline-flex;
              flex-direction: column;
              align-items: center;
              cursor: pointer;
              transform-origin: bottom center;
              transition: transform 0.18s cubic-bezier(0.22,1,0.36,1);
            ">
              <div style="
                display: inline-flex;
                align-items: center;
                background: #fff;
                color: ${isRequest ? '#999' : '#111'};
                font-size: 12.5px;
                font-weight: ${isRequest ? 500 : 700};
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                padding: 6px 13px;
                border-radius: 12px;
                white-space: nowrap;
                box-shadow: 0 2px 12px rgba(0,0,0,0.15), 0 0 0 1.5px ${isRequest ? 'rgba(0,0,0,0.07)' : 'rgba(196,162,53,0.35)'};
                letter-spacing: ${isRequest ? '0' : '-0.01em'};
              ">
                ${isRequest ? priceLabel : `<span style="color:var(--gold);font-weight:800;margin-right:1px">€</span>${priceLabel.replace('€\u202F','')}`}
              </div>
              <div style="
                width: 0; height: 0;
                border-left: 5px solid transparent;
                border-right: 5px solid transparent;
                border-top: 6px solid #fff;
                filter: drop-shadow(0 2px 2px rgba(0,0,0,0.12));
                margin-top: -1px;
              "></div>
            </div>
          `,
          iconAnchor: [35, 42],
          popupAnchor: [0, -44],
          iconSize: [70, 42],
        })

        const priceBlock = displayPrice > 0
          ? hasTotal
            ? `<span style="font-size:15px;font-weight:800;color:var(--gold)">€\u202F${displayPrice}</span>
               <span style="font-size:11px;color:#888;margin-left:3px">gesamt · ${listing.nights} Nächte</span>`
            : `<span style="font-size:15px;font-weight:800;color:var(--gold)">€\u202F${displayPrice}</span>
               <span style="font-size:11px;color:#888;margin-left:3px">/Nacht</span>`
          : `<span style="font-size:12px;font-weight:500;color:#888">Preis auf Anfrage</span>`

        const popup = L.popup({
          closeButton: false,
          className: 'trimosa-popup',
          maxWidth: 240,
          offset: [0, -4],
        }).setContent(`
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:2px 0">
            <p style="font-size:13px;font-weight:600;color:#111;margin:0 0 6px;line-height:1.3">${listing.title}</p>
            <p style="margin:0 0 10px;line-height:1">${priceBlock}</p>
            <a href="/listing/${listing.id}"
              style="display:inline-block;font-size:12px;font-weight:600;color:#1A1400;background:linear-gradient(135deg,var(--gold),var(--gold));padding:6px 14px;border-radius:999px;text-decoration:none">
              Ansehen →
            </a>
          </div>
        `)

        const marker = L.marker([listing.lat, listing.lon], { icon })
          .addTo(map)
          .bindPopup(popup)

        marker.on('mouseover', () => marker.openPopup())
      })

      // Emit center on map move so parent can reorder listings
      if (onCenterChange) {
        map.on('moveend', () => {
          const c = map.getCenter()
          onCenterChange(c.lat, c.lng)
        })
      }

      // Fit bounds — center point + closest ~5 listings
      const closestListings = listings.slice(0, Math.min(5, listings.length))
      const boundsPoints: [number, number][] = closestListings.map((l: MapListing) => [l.lat, l.lon])
      // Always include the search center so map is anchored to what the user typed
      if (centerLat && centerLon) boundsPoints.push([centerLat, centerLon])

      if (boundsPoints.length > 1) {
        const bounds = L.latLngBounds(boundsPoints)
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 11 })
      } else if (boundsPoints.length === 1) {
        map.setView(boundsPoints[0], 11)
      }

      // Inject popup + zoom control styles once
      if (!document.getElementById('trimosa-map-styles')) {
        const style = document.createElement('style')
        style.id = 'trimosa-map-styles'
        style.textContent = `
          /* Popup — crisp white card */
          .trimosa-popup .leaflet-popup-content-wrapper {
            border-radius: 16px !important;
            padding: 16px 18px !important;
            box-shadow: 0 8px 32px rgba(0,0,0,0.18) !important;
            border: none !important;
            background: #fff !important;
          }
          .trimosa-popup .leaflet-popup-content {
            margin: 0 !important;
          }
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
          /* Marker hover */
          .trimosa-marker:hover {
            transform: scale(1.08) translateY(-2px) !important;
          }
          .trimosa-marker:hover > div:first-child {
            box-shadow: 0 6px 24px rgba(0,0,0,0.18), 0 0 0 2px rgba(196,162,53,0.5) !important;
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

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Subtle warm tint overlay on map */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {listings.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2F0EC', borderRadius: '16px' }}>
          <p style={{ fontSize: '13px', color: '#AAA' }}>Keine Ergebnisse auf der Karte</p>
        </div>
      )}
    </div>
  )
}
