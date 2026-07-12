'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  lat: number | null
  lon: number | null
  onChange: (lat: number, lon: number) => void
  /** Free-text address used for the "locate from address" button. */
  address?: string
  /** Map center when no coordinates are set yet. Defaults to the Trier region. */
  fallback?: [number, number]
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    L: any
  }
}

/**
 * Draggable map pin for the listing editor. The host geocodes the address as a
 * starting point and then fine-tunes the exact spot by dragging (or clicking)
 * the pin. The chosen coordinates are what the public search map renders, so
 * markers sit on the real address instead of the town centroid.
 */
export default function LocationPicker({ lat, lon, onChange, address, fallback = [49.75, 6.64] }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null)
  // Latest onChange in a ref so the map init effect stays stable.
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  const [geocoding, setGeocoding] = useState(false)
  const [geoError, setGeoError] = useState('')
  const hasCoords = lat != null && lon != null && (lat !== 0 || lon !== 0)

  // Init map once Leaflet is available.
  useEffect(() => {
    const initMap = () => {
      const L = window.L
      if (!L || !containerRef.current || mapRef.current) return

      const start: [number, number] = hasCoords ? [lat as number, lon as number] : fallback
      const map = L.map(containerRef.current, {
        center: start,
        zoom: hasCoords ? 15 : 10,
        zoomControl: true,
        scrollWheelZoom: true,
        attributionControl: false,
      })
      mapRef.current = map

      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map)

      const pin = L.divIcon({
        className: '',
        html: `
          <div style="transform:translate(-50%,-100%);width:30px;height:40px;">
            <svg viewBox="0 0 30 40" width="30" height="40" xmlns="http://www.w3.org/2000/svg">
              <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 25 15 25s15-14.5 15-25C30 6.7 23.3 0 15 0z" fill="var(--gold, #AE8D2D)"/>
              <circle cx="15" cy="15" r="6" fill="#fff"/>
            </svg>
          </div>`,
        iconSize: [30, 40],
        iconAnchor: [0, 0],
      })

      const marker = L.marker(start, { icon: pin, draggable: true }).addTo(map)
      markerRef.current = marker

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      marker.on('dragend', (e: any) => {
        const p = e.target.getLatLng()
        onChangeRef.current(Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6)))
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.on('click', (e: any) => {
        marker.setLatLng(e.latlng)
        onChangeRef.current(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)))
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
      if (existing) {
        existing.addEventListener('load', initMap)
      } else {
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
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; markerRef.current = null }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reflect coordinate changes on the marker. Only moves the marker (no
  // recenter) so dragging the pin doesn't make the map snap back; the geocode
  // handler flies the map to the found location itself.
  useEffect(() => {
    if (!markerRef.current || !hasCoords) return
    markerRef.current.setLatLng([lat as number, lon as number])
  }, [lat, lon, hasCoords])

  async function locateFromAddress() {
    const q = (address || '').trim()
    if (q.length < 3) { setGeoError('Bitte zuerst eine Adresse eingeben.'); return }
    setGeocoding(true)
    setGeoError('')
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      if (data.found) {
        const gLat = Number(data.lat.toFixed(6))
        const gLon = Number(data.lon.toFixed(6))
        onChange(gLat, gLon)
        mapRef.current?.setView([gLat, gLon], 15)
      } else {
        setGeoError('Adresse nicht gefunden – bitte Pin manuell setzen.')
      }
    } catch {
      setGeoError('Standortsuche fehlgeschlagen – bitte Pin manuell setzen.')
    } finally {
      setGeocoding(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={locateFromAddress}
          disabled={geocoding}
          style={{
            padding: '7px 14px', borderRadius: '8px', border: '1px solid var(--gold)',
            background: '#fff', color: 'var(--gold-dark)', fontSize: '12px', fontWeight: 700,
            cursor: geocoding ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px',
          }}
        >
          📍 {geocoding ? 'Suche…' : 'Standort aus Adresse ermitteln'}
        </button>
        <span style={{ fontSize: '12px', color: '#888' }}>
          {hasCoords ? `${(lat as number).toFixed(5)}, ${(lon as number).toFixed(5)}` : 'Noch kein Pin gesetzt'}
        </span>
      </div>
      {geoError && <p style={{ fontSize: '12px', color: '#DC2626', margin: '0 0 8px' }}>{geoError}</p>}
      <div
        ref={containerRef}
        style={{ width: '100%', height: '280px', borderRadius: '12px', overflow: 'hidden', border: '1px solid #E0DDD6' }}
      />
      <p style={{ fontSize: '11px', color: '#999', margin: '6px 2px 0' }}>
        Pin ziehen oder auf die Karte klicken, um den genauen Standort festzulegen. Er bestimmt die Position auf der Suchkarte.
      </p>
    </div>
  )
}
