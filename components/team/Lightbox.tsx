'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { haptic, useDialogFokus } from '@/components/team/ux'
import { useSheetMotion } from '@/components/team/motion'

/**
 * 🖼 Vollbild-Ansicht für Fotos (Pascal, Chefsache 10.10.2026): Antippen eines Bildes im Chat öffnete bisher
 * den Speicher-Link in einem Browser-Fenster (in der installierten App: leere Seite, Weiterleitung auf die
 * Website, kein Zurück). Jetzt öffnet sich das Bild direkt in der App:
 *  - scharf und groß (object-fit contain), dunkler Hintergrund, Zähler „2 / 5"
 *  - Wischen links/rechts = vorheriges/nächstes Bild, Wischen nach unten oder Antippen des Hintergrunds = zu
 *  - Doppeltipp = 2,5× zoomen (dann ziehen), zwei Finger = stufenlos zoomen, Esc/Pfeile am Rechner
 *  - Nachbarbilder werden vorgeladen; ↗ öffnet das Original (z. B. zum Teilen/Sichern)
 * Bedienung ohne Props: `openLightbox(bilder, index)` schickt ein Ereignis, `<LightboxHost/>` (einmal in der
 * TeamShell gemountet) zeigt es per createPortal an document.body — Portal-Wurzel trägt team-shell (§100).
 */

export interface LightboxBild { url: string; caption?: string | null }

const EVENT = 'trimosa-lightbox'

export function openLightbox(bilder: LightboxBild[], index = 0) {
  if (typeof window === 'undefined' || !bilder.length) return
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { bilder, index: Math.max(0, Math.min(index, bilder.length - 1)) } }))
}

const ZOOM = 2.5
const SWIPE_PX = 56

export default function LightboxHost() {
  const [state, setState] = useState<{ bilder: LightboxBild[]; index: number } | null>(null)

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ bilder: LightboxBild[]; index: number }>).detail
      if (d?.bilder?.length) setState({ bilder: d.bilder, index: d.index })
    }
    window.addEventListener(EVENT, onOpen)
    return () => window.removeEventListener(EVENT, onOpen)
  }, [])

  if (!state) return null
  return <LightboxView bilder={state.bilder} index={state.index} onIndex={(i) => setState((s) => (s ? { ...s, index: i } : s))} onClose={() => setState(null)} />
}

function LightboxView({ bilder, index, onIndex, onClose: schliessenSofort }: {
  bilder: LightboxBild[]; index: number; onIndex: (i: number) => void; onClose: () => void
}) {
  // 🎬 Motion: alle Schließ-Wege (✕, Esc, Tipp auf den Hintergrund, Wisch nach unten) blenden kurz aus —
  // onClose ist hier die verzögerte Variante, die eigentliche Prop läuft nach der Ausblendung
  const { close: onClose, hostProps } = useSheetMotion(schliessenSofort)
  const bild = bilder[index]
  // ♿ Fokus ins Vollbild und beim Schließen zurück zum Bild im Chat; Esc/Pfeile regelt die Lightbox selbst (null)
  const dlgRef = useDialogFokus(null)
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [drag, setDrag] = useState({ x: 0, y: 0 })   // Verschiebung während eines Wischens (nicht gezoomt)
  const [laedt, setLaedt] = useState(true)
  const [aktiv, setAktiv] = useState(false)       // Finger/Zeiger unten → keine Übergangs-Animation
  const [fehler, setFehler] = useState(false)
  const zoomed = scale > 1.02

  // Zeiger-Zustand ohne Re-Render
  const ptr = useRef<Map<number, { x: number; y: number }>>(new Map())
  const start = useRef<{ x: number; y: number; t: number; pos: { x: number; y: number }; dist: number; scale: number } | null>(null)
  const lastTap = useRef(0)
  const moved = useRef(false)

  const reset = useCallback(() => { setScale(1); setPos({ x: 0, y: 0 }); setDrag({ x: 0, y: 0 }) }, [])
  const go = useCallback((delta: number) => {
    const n = index + delta
    if (n < 0 || n >= bilder.length) return
    haptic()
    reset(); setLaedt(true); setFehler(false)
    onIndex(n)
  }, [index, bilder.length, onIndex, reset])

  // Tastatur + Scroll-Sperre + Nachbarn vorladen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    for (const d of [1, -1]) {
      const n = bilder[index + d]
      if (n) { const im = new Image(); im.src = n.url }
    }
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [bilder, index, go, onClose])

  const onPointerDown = (e: React.PointerEvent) => {
    // setPointerCapture wirft „NotFoundError", wenn der Zeiger schon nicht mehr aktiv ist — dann ohne Capture weiter
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId) } catch { /* egal */ }
    ptr.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    moved.current = false
    setAktiv(true)
    const pts = [...ptr.current.values()]
    if (pts.length === 2) {
      start.current = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2, t: Date.now(), pos, dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), scale }
    } else {
      start.current = { x: e.clientX, y: e.clientY, t: Date.now(), pos, dist: 0, scale }
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!ptr.current.has(e.pointerId) || !start.current) return
    ptr.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...ptr.current.values()]
    if (pts.length === 2 && start.current.dist > 0) {
      // Zwei Finger: Abstand → Zoom (1 … 4)
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      const s = Math.min(4, Math.max(1, start.current.scale * (dist / start.current.dist)))
      setScale(s)
      if (s <= 1.02) setPos({ x: 0, y: 0 })
      moved.current = true
      return
    }
    const dx = e.clientX - start.current.x
    const dy = e.clientY - start.current.y
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved.current = true
    if (zoomed) setPos({ x: start.current.pos.x + dx, y: start.current.pos.y + dy })
    else setDrag({ x: dx, y: dy })
  }
  const onPointerUp = (e: React.PointerEvent) => {
    ptr.current.delete(e.pointerId)
    if (ptr.current.size > 0 || !start.current) return
    setAktiv(false)
    const dx = e.clientX - start.current.x
    const dy = e.clientY - start.current.y
    const dauer = Date.now() - start.current.t
    start.current = null
    if (!moved.current && dauer < 350) {
      // Tipp: Doppeltipp zoomt, Einzeltipp auf den Hintergrund schließt (auf dem Bild: UI unberührt)
      const now = Date.now()
      if (now - lastTap.current < 320) {
        lastTap.current = 0
        if (zoomed) reset()
        else { setScale(ZOOM); setPos({ x: (window.innerWidth / 2 - e.clientX) * (ZOOM - 1), y: (window.innerHeight / 2 - e.clientY) * (ZOOM - 1) }) }
        return
      }
      lastTap.current = now
      if ((e.target as HTMLElement).dataset.hintergrund === '1') setTimeout(() => { if (lastTap.current === now) onClose() }, 330)
      return
    }
    if (zoomed) return
    // 🎬 Wisch nach unten: das Bild bleibt beim Ausblenden dort, wohin der Finger es gezogen hat
    if (dy > SWIPE_PX && Math.abs(dy) > Math.abs(dx)) { haptic(); onClose(); return }
    setDrag({ x: 0, y: 0 })
    if (dx < -SWIPE_PX && Math.abs(dx) > Math.abs(dy)) go(1)
    else if (dx > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) go(-1)
  }

  const transform = zoomed
    ? `translate(${pos.x}px, ${pos.y}px) scale(${scale})`
    : `translate(${drag.x * 0.9}px, ${drag.y * 0.9}px) scale(${Math.max(0.85, 1 - Math.abs(drag.y) / 900)})`

  const body = (
    <div
      ref={dlgRef}
      className="team-shell tm-mo-fade"
      {...hostProps}
      role="dialog"
      aria-modal="true"
      aria-label={`Bild ${index + 1} von ${bilder.length}`}
      data-hintergrund="1"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        position: 'fixed', inset: 0, zIndex: 12000, background: `rgba(0,0,0,${zoomed ? 0.97 : Math.max(0.6, 0.94 - Math.abs(drag.y) / 500)})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none', userSelect: 'none',
        WebkitUserSelect: 'none', overflow: 'hidden',
      }}
    >
      {/* Kopfzeile: Zähler · Original · Schließen */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', gap: 8,
        padding: 'calc(env(safe-area-inset-top) + 10px) 12px 10px', color: '#fff', zIndex: 2,
        background: 'linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0))', opacity: zoomed ? 0 : 1, transition: 'opacity .2s',
        pointerEvents: zoomed ? 'none' : 'auto',
      }}>
        <span aria-hidden="true" style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', padding: '0 6px' }}>
          {bilder.length > 1 ? `${index + 1} / ${bilder.length}` : ''}
        </span>
        {/* ♿ Bildwechsel (Wischen/Pfeile) ansagen */}
        <span className="tm-sr-only" aria-live="polite">{bilder.length > 1 ? `Bild ${index + 1} von ${bilder.length}` : ''}</span>
        <span style={{ flex: 1 }} />
        <a href={bild.url} target="_blank" rel="noopener noreferrer" aria-label="Original öffnen" title="Original öffnen"
          onPointerDown={(e) => e.stopPropagation()}
          style={{ width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.16)', color: '#fff', textDecoration: 'none', fontSize: 16 }}>↗</a>
        <button type="button" aria-label="Schließen" onPointerDown={(e) => e.stopPropagation()} onClick={() => { haptic(); onClose() }}
          style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.16)', color: '#fff', fontSize: 17, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
      </div>

      {laedt && !fehler && (
        <div style={{ position: 'absolute', color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>Lädt…</div>
      )}
      {fehler && (
        <div style={{ position: 'absolute', color: 'rgba(255,255,255,0.85)', fontSize: 13, textAlign: 'center', padding: 24 }}>
          Das Bild konnte nicht geladen werden.<br />
          <a href={bild.url} target="_blank" rel="noopener noreferrer" style={{ color: '#fff' }}>Original öffnen ↗</a>
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={bild.url}
        src={bild.url}
        alt={bild.caption || 'Foto'}
        draggable={false}
        onLoad={() => setLaedt(false)}
        onError={() => { setLaedt(false); setFehler(true) }}
        style={{
          maxWidth: '100vw', maxHeight: '100dvh', objectFit: 'contain', display: 'block',
          transform, transition: aktiv ? 'none' : 'transform .22s var(--tm-ease, ease)',
          opacity: laedt ? 0 : 1, willChange: 'transform',
        }}
      />

      {bild.caption && !zoomed && (
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, padding: '14px 18px calc(env(safe-area-inset-bottom) + 16px)',
          color: '#fff', fontSize: 13.5, lineHeight: 1.45, textAlign: 'center',
          background: 'linear-gradient(rgba(0,0,0,0), rgba(0,0,0,0.6))',
        }}>{bild.caption}</div>
      )}

      {/* Pfeile am Rechner */}
      {bilder.length > 1 && !zoomed && (
        <>
          {index > 0 && (
            <button type="button" aria-label="Vorheriges Bild" onPointerDown={(e) => e.stopPropagation()} onClick={() => go(-1)}
              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: '50%', border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.14)', color: '#fff', fontSize: 20 }}>‹</button>
          )}
          {index < bilder.length - 1 && (
            <button type="button" aria-label="Nächstes Bild" onPointerDown={(e) => e.stopPropagation()} onClick={() => go(1)}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: '50%', border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.14)', color: '#fff', fontSize: 20 }}>›</button>
          )}
        </>
      )}
    </div>
  )
  return typeof document === 'undefined' ? null : createPortal(body, document.body)
}
