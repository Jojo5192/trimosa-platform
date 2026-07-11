'use client'

import { useState } from 'react'
import Image from 'next/image'
import PhotoViewer, { type Room } from '@/components/PhotoViewer'

interface Props {
  rooms: Room[]
  allImages: string[]
  listingTitle: string
  pricePerNight: number
  mainGradient: React.CSSProperties
  fallbackColors: string[]
}

export default function PhotoGrid({
  rooms,
  allImages,
  listingTitle,
  pricePerNight,
  mainGradient,
  fallbackColors,
}: Props) {
  const [viewerOpen, setViewerOpen] = useState(false)

  // Collect photos for grid display
  const allForGrid = rooms.length > 0 ? rooms.flatMap(r => r.images) : allImages
  const firstImage = allForGrid[0] ?? null

  const totalPhotos = allForGrid.length

  return (
    <>
      {/* Clickable grid */}
      <div
        className="detail-photo-grid"
        onClick={() => totalPhotos > 0 && setViewerOpen(true)}
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr 1fr',
          gridTemplateRows: '210px 210px',
          gap: '6px',
          borderRadius: '20px',
          overflow: 'hidden',
          marginBottom: '40px',
          position: 'relative',
          cursor: totalPhotos > 0 ? 'pointer' : 'default',
        }}
      >
        {/* Main photo */}
        <div style={{ gridColumn: '1', gridRow: '1 / 3', position: 'relative', overflow: 'hidden' }}>
          {firstImage ? (
            <Image
              src={firstImage}
              alt={listingTitle}
              fill
              priority
              sizes="(max-width: 900px) 100vw, 55vw"
              style={{ objectFit: 'cover', transition: 'transform 0.3s' }}
              onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.02)')}
              onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
            />
          ) : (
            <div style={{ ...mainGradient, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={0.8}>
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M9 22V12h6v10"/>
              </svg>
            </div>
          )}
          {pricePerNight > 0 && (
            <div style={{ position: 'absolute', bottom: '16px', left: '16px', background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)', borderRadius: '12px', padding: '6px 14px', color: '#fff', fontSize: '14px', fontWeight: 700, pointerEvents: 'none' }}>
              ab € {pricePerNight} / Nacht
            </div>
          )}
        </div>

        {/* 4 smaller photos */}
        {[1, 2, 3, 4].map((idx) => {
          const src = allForGrid[idx] ?? null
          return (
            <div
              key={idx}
              style={{
                gridColumn: idx <= 2 ? String(idx + 1) : String(idx - 1),
                gridRow: idx <= 2 ? '1' : '2',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              {src ? (
                <Image
                  src={src}
                  alt={`Foto ${idx + 1}`}
                  fill
                  sizes="(max-width: 900px) 50vw, 22vw"
                  style={{ objectFit: 'cover', transition: 'transform 0.3s' }}
                  onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.02)')}
                  onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                />
              ) : (
                <div style={{ background: fallbackColors[(idx - 1) % fallbackColors.length], width: '100%', height: '100%' }} />
              )}
            </div>
          )
        })}

        {/* "Alle Fotos" badge — bottom right */}
        {totalPhotos > 0 && (
          <div className="detail-photo-badge" style={{
            position: 'absolute', bottom: '16px', right: '16px',
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '7px 14px', borderRadius: '10px',
            border: '1.5px solid rgba(255,255,255,0.7)',
            background: 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(8px)',
            fontSize: '12px', fontWeight: 600, color: '#111',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            pointerEvents: 'none',
            zIndex: 2,
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <path d="M21 15l-5-5L5 21"/>
            </svg>
            Alle Fotos ({totalPhotos})
          </div>
        )}
      </div>

      <PhotoViewer
        rooms={rooms}
        allImages={allImages}
        listingTitle={listingTitle}
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
      />
    </>
  )
}
