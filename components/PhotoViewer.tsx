'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'

export interface Room {
  id: string
  name: string
  description?: string
  features?: string[]
  images: string[]
}

interface Props {
  rooms: Room[]
  allImages: string[]
  listingTitle: string
  open: boolean
  onClose: () => void
}

export default function PhotoViewer({ rooms, allImages, listingTitle, open, onClose }: Props) {
  const [lightboxImg, setLightboxImg] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Build display rooms
  const displayRooms: Room[] =
    rooms.length > 0
      ? rooms.filter(r => r.images.length > 0)
      : allImages.length > 0
        ? [{ id: 'all', name: 'Alle Fotos', images: allImages }]
        : []

  // Keyboard: Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightboxImg) setLightboxImg(null)
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, lightboxImg, onClose])

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  // Reset scroll on open
  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = 0
  }, [open])

  if (!open) return null

  return (
    <>
      {/* ── Full-screen overlay ── */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        backgroundColor: '#fff',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 40px',
          borderBottom: '1px solid #E5E5EA',
          flexShrink: 0,
          backgroundColor: '#fff',
          zIndex: 2,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#111' }}>Fotorundgang</span>
            <span style={{ fontSize: '12px', color: '#999' }}>{listingTitle}</span>
          </div>
          <button
            onClick={onClose}
            style={{
              width: '32px', height: '32px', borderRadius: '50%',
              border: '1.5px solid #E0DDD6', background: '#fff',
              cursor: 'pointer', fontSize: '16px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444',
            }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable content */}
        <div
          ref={scrollRef}
          style={{ flex: 1, overflowY: 'auto', padding: '0' }}
        >
          {displayRooms.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999', fontSize: '14px' }}>
              Noch keine Fotos hochgeladen.
            </div>
          ) : (
            displayRooms.map(room => (
              <div key={room.id}>
                {/* Sticky room title — each room header sticks and gets pushed out by the next */}
                <div style={{
                  position: 'sticky',
                  top: 0,
                  backgroundColor: '#fff',
                  zIndex: 1,
                  padding: '24px 40px 14px',
                  borderBottom: '1px solid #F0EDE8',
                }}>
                  <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#111', margin: 0 }}>
                    {room.name}
                  </h2>
                  {(room.description || (room.features && room.features.length > 0)) && (
                    <p style={{ fontSize: '13px', color: '#888', margin: '4px 0 0' }}>
                      {[room.description, room.features?.join(' · ')].filter(Boolean).join(' — ')}
                    </p>
                  )}
                </div>

                {/* 2-column photo grid */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '6px',
                  padding: '6px 40px 32px',
                }}>
                  {room.images.map((url, i) => (
                    <div
                      key={i}
                      onClick={() => setLightboxImg(url)}
                      style={{
                        position: 'relative',
                        aspectRatio: '3/2',
                        borderRadius: '10px',
                        overflow: 'hidden',
                        cursor: 'zoom-in',
                      }}
                    >
                      <Image
                        src={url}
                        alt={`${room.name} ${i + 1}`}
                        fill
                        sizes="45vw"
                        style={{ objectFit: 'cover', transition: 'transform 0.2s' }}
                        onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.02)')}
                        onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Single-image lightbox ── */}
      {lightboxImg && (
        <div
          onClick={() => setLightboxImg(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1100,
            background: 'rgba(0,0,0,0.9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'zoom-out',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ position: 'relative', width: '90vw', height: '90vh', cursor: 'default' }}
          >
            <Image
              src={lightboxImg}
              alt=""
              fill
              sizes="90vw"
              style={{ objectFit: 'contain', borderRadius: '8px' }}
            />
          </div>
          <button
            onClick={() => setLightboxImg(null)}
            style={{
              position: 'fixed', top: '20px', right: '20px',
              width: '40px', height: '40px', borderRadius: '50%',
              background: 'rgba(255,255,255,0.15)', border: 'none',
              cursor: 'pointer', color: '#fff', fontSize: '18px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>
      )}
    </>
  )
}
