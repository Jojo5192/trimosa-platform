'use client'

/**
 * Interactive "Essen & Trinken" block for the region pages: category filter
 * chips + Leaflet map + card grid, all wired together. Filtering updates map
 * AND grid (the map softly re-fits to the visible places); clicking a card
 * flies the map to its marker and opens the popup. Every place links out to
 * Google Maps (plain link on click — no embed, no third-party request).
 *
 * Lives inside the dark navy "Genuss" panel, so all styles are tuned for a
 * dark background. Leaflet is loaded exactly like RegionMap/ListingsMap
 * (unpkg CDN, shared window.L).
 */
import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { KULINARIK_KATEGORIEN, type KulinarikKategorie, type KulinarikTipp } from '@/lib/regions'
import type { KulinarikRating } from '@/lib/kulinarik-ratings'

interface Props {
  tipps: KulinarikTipp[]
  /** Live Google ratings keyed by tip name (fetched server-side) */
  ratings?: Record<string, KulinarikRating>
}

const fmtRating = (r: KulinarikRating) =>
  `★ ${r.rating.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} (${r.count.toLocaleString('de-DE')})`

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    L: any
  }
}

const mapsLink = (t: KulinarikTipp) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${t.name}, ${t.ort}`)}`

export default function KulinarikMap({ tipps, ratings = {} }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<{ tipp: KulinarikTipp; marker: any }[]>([])
  const [activeKat, setActiveKat] = useState<KulinarikKategorie | 'alle'>('alle')

  const visible = tipps.filter((t) => activeKat === 'alle' || t.kategorie === activeKat)

  // Categories actually present in this region (chips only for those)
  const present = (Object.keys(KULINARIK_KATEGORIEN) as KulinarikKategorie[])
    .filter((k) => tipps.some((t) => t.kategorie === k))

  const applyFilter = (kat: KulinarikKategorie | 'alle', fly: boolean) => {
    const map = mapRef.current
    if (!map) return
    const L = window.L
    const shown: [number, number][] = []
    for (const { tipp, marker } of markersRef.current) {
      const show = kat === 'alle' || tipp.kategorie === kat
      if (show) { if (!map.hasLayer(marker)) marker.addTo(map); shown.push([tipp.lat, tipp.lon]) }
      else if (map.hasLayer(marker)) map.removeLayer(marker)
    }
    if (shown.length > 0) {
      const bounds = L.latLngBounds(shown).pad(0.18)
      if (fly) map.flyToBounds(bounds, { maxZoom: 14, duration: 0.7 })
      else map.fitBounds(bounds, { maxZoom: 13 })
    }
  }

  useEffect(() => {
    const initMap = () => {
      const L = window.L
      if (!L || !containerRef.current || mapRef.current) return

      const map = L.map(containerRef.current, {
        zoomControl: true,
        scrollWheelZoom: false,
        attributionControl: false,
      })
      mapRef.current = map

      L.control.attribution({ position: 'bottomleft', prefix: false })
        .addAttribution('© <a href="https://carto.com" style="color:#999">CARTO</a> · © <a href="https://openstreetmap.org" style="color:#999">OSM</a>')
        .addTo(map)

      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd', maxZoom: 19,
      }).addTo(map)

      // Marker + popup styles for this block (own id — the shared
      // #trimosa-map-styles block stays untouched)
      if (!document.getElementById('trimosa-kulinarik-styles')) {
        const style = document.createElement('style')
        style.id = 'trimosa-kulinarik-styles'
        style.textContent = `
          .trimosa-kul-marker { transition: transform 0.15s ease; }
          .trimosa-kul-marker:hover { transform: scale(1.15) translateY(-2px); z-index: 1000 !important; }
          .trimosa-kul-popup .leaflet-popup-content-wrapper {
            border-radius: 14px !important; padding: 0 !important; overflow: hidden !important;
            box-shadow: 0 12px 40px rgba(0,0,0,0.3) !important; border: none !important;
            background: #16293A !important;
          }
          .trimosa-kul-popup .leaflet-popup-content { margin: 0 !important; width: 230px !important; }
          .trimosa-kul-popup .leaflet-popup-tip-container { display: none !important; }
          .trimosa-kul-popup a { transition: opacity 0.15s; }
          .trimosa-kul-popup a:hover { opacity: 0.9; }
        `
        document.head.appendChild(style)
      }

      for (const tipp of tipps) {
        const kat = KULINARIK_KATEGORIEN[tipp.kategorie]
        const size = tipp.top ? 40 : 33
        const ring = tipp.top ? 'box-shadow: 0 4px 14px rgba(0,0,0,0.35), 0 0 0 3px #E6C15A;' : 'box-shadow: 0 4px 12px rgba(0,0,0,0.3);'
        const icon = window.L.divIcon({
          className: 'trimosa-kul-marker',
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
          html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${kat.color};
            border:2.5px solid #fff;${ring}display:flex;align-items:center;justify-content:center;
            font-size:${tipp.top ? 19 : 15}px;">${tipp.emoji}</div>`,
        })
        const rating = ratings[tipp.name]
        // Photo header through our own /_next/image proxy (visitor's browser
        // never talks to upload.wikimedia.org — same pattern as RegionMap)
        const photoHtml = tipp.image
          ? `<div style="height:92px;overflow:hidden;"><img src="/_next/image?url=${encodeURIComponent(tipp.image.src)}&w=256&q=75" alt="" style="width:100%;height:100%;object-fit:cover;display:block;"/></div>`
          : ''
        const popupHtml = `${photoHtml}
          <div style="padding:14px 15px 13px;">
            ${tipp.top ? '<div style="font-size:9.5px;font-weight:700;color:#E6C15A;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px;">★ Unser Tipp</div>' : ''}
            <div style="font-size:14px;font-weight:700;color:#fff;line-height:1.25;margin-bottom:3px;">${tipp.name}</div>
            <div style="font-size:10.5px;font-weight:600;color:${kat.color};margin-bottom:${rating ? 4 : 7}px;">${tipp.art} · <span style="color:rgba(255,255,255,0.55);font-weight:500;">${tipp.ort}</span></div>
            ${rating ? `<div style="font-size:11px;font-weight:700;color:#E6C15A;margin-bottom:7px;">${fmtRating(rating)} <span style="color:rgba(255,255,255,0.45);font-weight:500;">bei Google</span></div>` : ''}
            <div style="font-size:11.5px;color:rgba(255,255,255,0.72);line-height:1.55;margin-bottom:10px;">${tipp.text}</div>
            <a href="${mapsLink(tipp)}" target="_blank" rel="noopener nofollow" style="display:inline-block;font-size:11px;font-weight:700;color:#12222E;background:#E6C15A;padding:6px 12px;border-radius:999px;text-decoration:none;">Route in Google Maps ↗</a>
          </div>`
        const m = window.L.marker([tipp.lat, tipp.lon], { icon })
          .bindPopup(popupHtml, { className: 'trimosa-kul-popup', closeButton: false, offset: [0, -6] })
        markersRef.current.push({ tipp, marker: m })
      }
      applyFilter('alle', false)
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
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; markersRef.current = [] }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectKat = (kat: KulinarikKategorie | 'alle') => {
    setActiveKat(kat)
    applyFilter(kat, true)
  }

  const flyTo = (tipp: KulinarikTipp) => {
    const map = mapRef.current
    if (!map) return
    map.flyTo([tipp.lat, tipp.lon], 15, { duration: 0.8 })
    const entry = markersRef.current.find((m) => m.tipp.name === tipp.name)
    if (entry) setTimeout(() => entry.marker.openPopup(), 850)
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  return (
    <div>
      {/* Category chips */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
        {(
          [
            ['alle', { label: 'Alles anzeigen', color: 'rgba(255,255,255,0.8)', emoji: '✦' }],
            ...present.map((k) => [k, KULINARIK_KATEGORIEN[k]]),
          ] as [KulinarikKategorie | 'alle', { label: string; color: string; emoji: string }][]
        ).map(([key, meta]) => {
          const isActive = activeKat === key
          return (
            <button key={key} type="button" onClick={() => selectKat(key)} style={{
              display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '8px 14px',
              borderRadius: '999px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer',
              border: isActive ? `1.5px solid ${meta.color}` : '1.5px solid rgba(255,255,255,0.18)',
              background: isActive ? `${key === 'alle' ? 'rgba(255,255,255,0.14)' : meta.color + '2E'}` : 'rgba(255,255,255,0.05)',
              color: isActive ? (key === 'alle' ? '#fff' : meta.color) : 'rgba(255,255,255,0.65)',
              transition: 'all 0.15s',
            }}>
              <span style={{ fontSize: '13px' }}>{meta.emoji}</span>{meta.label}
            </button>
          )
        })}
      </div>

      {/* Map */}
      <div style={{ position: 'relative', zIndex: 0, isolation: 'isolate', borderRadius: '16px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.15)' }}>
        <div ref={containerRef} style={{ height: 'clamp(280px, 38vh, 400px)', background: '#1A303F' }} />
      </div>
      <p style={{ fontSize: '10.5px', color: 'rgba(255,255,255,0.4)', margin: '8px 0 18px' }}>
        Marker antippen für Details · ★ goldener Ring = unser persönlicher Tipp
      </p>

      {/* Card grid (follows the filter; click flies the map to the place) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))', gap: '12px' }}>
        {visible.map((k) => {
          const kat = KULINARIK_KATEGORIEN[k.kategorie]
          return (
            <div key={k.name} onClick={() => flyTo(k)} style={{
              background: 'rgba(255,255,255,0.06)', border: k.top ? '1px solid rgba(230,193,90,0.5)' : '1px solid rgba(255,255,255,0.12)',
              borderRadius: '16px', padding: '16px 17px 15px', backdropFilter: 'blur(4px)',
              cursor: 'pointer', transition: 'background 0.15s', position: 'relative',
            }}>
              {k.top && (
                <span style={{
                  position: 'absolute', top: '-9px', right: '14px', zIndex: 2, fontSize: '9.5px', fontWeight: 800,
                  color: '#12222E', background: 'linear-gradient(135deg, #E6C15A, #C9A23B)',
                  padding: '3px 10px', borderRadius: '999px', letterSpacing: '0.06em', textTransform: 'uppercase',
                }}>★ Unser Tipp</span>
              )}
              {k.image && (
                <div style={{ position: 'relative', aspectRatio: '16/9', borderRadius: '11px', overflow: 'hidden', margin: '0 0 12px' }}>
                  <Image src={k.image.src} alt={k.name} fill sizes="(max-width: 768px) 90vw, 300px" style={{ objectFit: 'cover' }} />
                  <a href={k.image.fileUrl} target="_blank" rel="noopener nofollow" onClick={(e) => e.stopPropagation()} style={{
                    position: 'absolute', right: '6px', bottom: '6px', fontSize: '8.5px', color: 'rgba(255,255,255,0.85)',
                    background: 'rgba(10,16,22,0.6)', padding: '2px 8px', borderRadius: '999px', textDecoration: 'none',
                    maxWidth: '85%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>📷 {k.image.author} · {k.image.license}</a>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '9px' }}>
                <span style={{
                  width: '38px', height: '38px', borderRadius: '12px', flexShrink: 0,
                  background: `linear-gradient(135deg, ${kat.color}45, ${kat.color}1A)`,
                  border: `1px solid ${kat.color}66`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '19px',
                }}>{k.emoji}</span>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: '14px', fontWeight: 700, color: '#fff', margin: 0, lineHeight: 1.25 }}>{k.name}</p>
                  <p style={{ fontSize: '11px', fontWeight: 600, color: kat.color, margin: '3px 0 0', letterSpacing: '0.03em' }}>
                    {k.art} · <span style={{ color: 'rgba(255,255,255,0.55)', fontWeight: 500 }}>{k.ort}</span>
                  </p>
                </div>
              </div>
              <p style={{ fontSize: '12.5px', color: 'rgba(255,255,255,0.72)', margin: '0 0 10px', lineHeight: 1.6 }}>{k.text}</p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                {ratings[k.name] ? (
                  <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#E6C15A' }}>
                    {fmtRating(ratings[k.name])} <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>bei Google</span>
                  </span>
                ) : (
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.45)' }}>📍 Auf der Karte zeigen</span>
                )}
                <a href={mapsLink(k)} target="_blank" rel="noopener nofollow" onClick={(e) => e.stopPropagation()}
                  style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gold)', textDecoration: 'none' }}>
                  Route ↗
                </a>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
