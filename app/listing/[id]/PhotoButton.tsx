'use client'

import { useState } from 'react'
import PhotoViewer, { type Room } from '@/components/PhotoViewer'

interface Props {
  rooms: Room[]
  allImages: string[]
  listingTitle: string
  label?: string
}

export default function PhotoButton({ rooms, allImages, listingTitle, label = 'Alle Fotos anzeigen' }: Props) {
  const [open, setOpen] = useState(false)
  const totalPhotos = rooms.length > 0
    ? rooms.reduce((sum, r) => sum + r.images.length, 0)
    : allImages.length

  if (totalPhotos === 0) return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          position: 'absolute', bottom: '16px', right: '16px',
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '8px 16px', borderRadius: '10px',
          border: '1.5px solid rgba(255,255,255,0.8)',
          background: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(8px)',
          cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: '#111',
          boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
          zIndex: 5,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
          <path d="M21 15l-5-5L5 21"/>
        </svg>
        {label} ({totalPhotos})
      </button>

      <PhotoViewer
        rooms={rooms}
        allImages={allImages}
        listingTitle={listingTitle}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
