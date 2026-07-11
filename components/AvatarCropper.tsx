'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

interface Props {
  currentUrl: string | null
  displayName: string
  onUpload: (url: string) => void
  bucket?: string
  storagePath?: string
}

export default function AvatarCropper({ currentUrl, displayName, onUpload, bucket = 'listing-images', storagePath }: Props) {
  const [step, setStep] = useState<'idle' | 'crop' | 'uploading'>('idle')
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef<{ mx: number; my: number; ox: number; oy: number } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [userId, setUserId] = useState<string>('')
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    import('@/lib/supabase-browser').then(({ supabaseBrowser }) => {
      supabaseBrowser.auth.getUser().then(({ data: { user } }) => {
        if (user) setUserId(user.id)
      })
    })
  }, [])

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    setImgSrc(url)
    setZoom(1)
    setOffset({ x: 0, y: 0 })
    setNaturalSize(null)
    setStep('crop')
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setDragging(true)
    dragStart.current = { mx: e.clientX, my: e.clientY, ox: offset.x, oy: offset.y }
  }, [offset])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging || !dragStart.current) return
    setOffset({
      x: dragStart.current.ox + (e.clientX - dragStart.current.mx),
      y: dragStart.current.oy + (e.clientY - dragStart.current.my),
    })
  }, [dragging])

  const handleMouseUp = useCallback(() => setDragging(false), [])

  // Touch support
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0]
    setDragging(true)
    dragStart.current = { mx: t.clientX, my: t.clientY, ox: offset.x, oy: offset.y }
  }, [offset])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragging || !dragStart.current) return
    const t = e.touches[0]
    setOffset({
      x: dragStart.current.ox + (t.clientX - dragStart.current.mx),
      y: dragStart.current.oy + (t.clientY - dragStart.current.my),
    })
  }, [dragging])

  async function handleConfirm() {
    if (!imgSrc || !canvasRef.current) return
    setStep('uploading')
    setError('')

    const SIZE = 300
    const canvas = canvasRef.current
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = async () => {
      // Draw clipped circle
      ctx.clearRect(0, 0, SIZE, SIZE)
      ctx.save()
      ctx.beginPath()
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2)
      ctx.clip()

      const scale = zoom
      const displaySize = 160 // px of the preview circle
      const ratio = SIZE / displaySize
      // Mirror the preview's CSS `object-fit: cover`: scale so the
      // smaller source dimension fills displaySize, preserving aspect
      // ratio, before applying the user's zoom/pan.
      const coverScale = displaySize / Math.min(img.naturalWidth, img.naturalHeight)
      const baseW = img.naturalWidth * coverScale
      const baseH = img.naturalHeight * coverScale
      const drawW = baseW * scale * ratio
      const drawH = baseH * scale * ratio
      const dx = SIZE / 2 - drawW / 2 + offset.x * ratio
      const dy = SIZE / 2 - drawH / 2 + offset.y * ratio
      ctx.drawImage(img, dx, dy, drawW, drawH)
      ctx.restore()

      canvas.toBlob(async (blob) => {
        if (!blob) { setStep('crop'); return }
        const path = storagePath ?? `avatars/${userId}.jpg`
        const { supabaseBrowser } = await import('@/lib/supabase-browser')
        const { error: upErr } = await supabaseBrowser.storage
          .from(bucket)
          .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })

        if (upErr) {
          setError('Upload fehlgeschlagen: ' + upErr.message)
          setStep('crop')
          return
        }

        const { data } = supabaseBrowser.storage.from(bucket).getPublicUrl(path)
        const url = data.publicUrl + `?v=${Date.now()}`
        onUpload(url)
        URL.revokeObjectURL(imgSrc)
        setImgSrc(null)
        setStep('idle')
      }, 'image/jpeg', 0.9)
    }
    img.src = imgSrc
  }

  const PREVIEW = 160
  // Full cover-fit size of the source image at the preview scale — same
  // formula used in handleConfirm's canvas draw, just at PREVIEW instead
  // of SIZE. Rendering the <img> at this size (instead of clamping it to
  // PREVIEW×PREVIEW with CSS object-fit: cover) keeps the preview and the
  // final saved crop showing exactly the same content when panned/zoomed.
  const previewCoverScale = naturalSize ? PREVIEW / Math.min(naturalSize.w, naturalSize.h) : 1
  const previewW = naturalSize ? naturalSize.w * previewCoverScale : PREVIEW
  const previewH = naturalSize ? naturalSize.h * previewCoverScale : PREVIEW

  return (
    <div>
      {/* Hidden canvas for cropping */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {step === 'idle' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            {currentUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={currentUrl} alt="" style={{ width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover', border: '3px solid #F0EDE6' }} />
            ) : (
              <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'linear-gradient(135deg, #C4A235, #8A6818)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', fontWeight: 700, color: '#fff' }}>
                {displayName ? displayName[0].toUpperCase() : '?'}
              </div>
            )}
          </div>
          <div>
            <p style={{ fontSize: '14px', fontWeight: 600, color: '#111', margin: '0 0 4px' }}>{displayName || 'Kein Name'}</p>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={onFileChange} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              style={{ fontSize: '12px', fontWeight: 600, color: '#A8882A', background: 'none', border: '1px solid #E0DDD6', borderRadius: '999px', padding: '5px 14px', cursor: 'pointer' }}
            >
              Foto {currentUrl ? 'ändern' : 'hinzufügen'}
            </button>
          </div>
        </div>
      )}

      {(step === 'crop' || step === 'uploading') && imgSrc && (
        <div>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#111', margin: '0 0 12px' }}>Foto zuschneiden</p>

          {/* Preview circle with drag */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
            <div
              style={{ width: `${PREVIEW}px`, height: `${PREVIEW}px`, borderRadius: '50%', overflow: 'hidden', cursor: dragging ? 'grabbing' : 'grab', border: '3px solid #C4A235', userSelect: 'none', position: 'relative', backgroundColor: '#000' }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleMouseUp}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imgSrc}
                alt=""
                draggable={false}
                onLoad={e => setNaturalSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                  maxWidth: 'none',
                  width: `${previewW}px`,
                  height: `${previewH}px`,
                  transformOrigin: 'center',
                  pointerEvents: 'none',
                }}
              />
            </div>

            {/* Zoom slider */}
            <div style={{ width: '100%', maxWidth: `${PREVIEW}px` }}>
              <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '4px', textAlign: 'center' }}>Zoom</label>
              <input
                type="range" min="1" max="3" step="0.05"
                value={zoom}
                onChange={e => setZoom(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: '#C4A235' }}
              />
            </div>

            {error && <p style={{ fontSize: '12px', color: '#DC2626' }}>{error}</p>}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={() => { setStep('idle'); URL.revokeObjectURL(imgSrc); setImgSrc(null) }}
                style={{ padding: '9px 20px', borderRadius: '999px', border: '1px solid #E0DDD6', background: '#fff', fontSize: '13px', cursor: 'pointer', color: '#555' }}
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={step === 'uploading'}
                style={{ padding: '9px 24px', borderRadius: '999px', border: 'none', background: 'linear-gradient(135deg, #C4A235, #8A6818)', color: '#fff', fontSize: '13px', fontWeight: 700, cursor: step === 'uploading' ? 'not-allowed' : 'pointer' }}
              >
                {step === 'uploading' ? 'Wird hochgeladen…' : 'Übernehmen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
