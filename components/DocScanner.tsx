'use client'

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'

/**
 * 📐 §256 DOKUMENTENSCANNER mit Kantenerkennung — rein client-seitig, ohne
 * neue Dependencies (kein OpenCV): Sobel-Kanten + gradient-geführte
 * Hough-Transformation finden den Belegrand automatisch; die vier Ecken sind
 * per Finger nachjustierbar (mit Lupe), dann perspektivische Entzerrung
 * (Homographie, bilineares Sampling) und wahlweise Scan-Aufhellung
 * (Beleuchtungs-Ausgleich + Schwarz/Weiß-Levels), Farb-Modus oder Original.
 * Ausgabe: JPEG ≤2000px, Dateiname beleg-scan-… — die Eltern (Buchhaltung
 * 📸-Upload + Team-Einreichung) betten diese direkt ein, ohne Re-Encoding.
 * Vollbild via createPortal(document.body) — §83-Lektion (fixed im Scroller).
 */

type Pt = { x: number; y: number }
type Mode = 'scan' | 'farbe' | 'original'
type Phase = 'lade' | 'anpassen' | 'verarbeite' | 'ergebnis'

const NAVY = '#12222E'
const GOLD = '#B0912B'
const GOLD_HELL = '#E3C878'

/* ── Geometrie-Helfer ─────────────────────────────────────────────── */

function clampN(v: number, a: number, b: number): number { return v < a ? a : v > b ? b : v }
function dist(a: Pt, b: Pt): number { return Math.hypot(a.x - b.x, a.y - b.y) }

function insetCorners(w: number, h: number, f: number): Pt[] {
  const dx = w * f, dy = h * f
  return [{ x: dx, y: dy }, { x: w - dx, y: dy }, { x: w - dx, y: h - dy }, { x: dx, y: h - dy }]
}

/** Sortiert 4 Punkte in die feste Reihenfolge TL, TR, BR, BL (Uhrzeigersinn). */
function orderCorners(pts: Pt[]): Pt[] {
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4
  const s = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
  let start = 0, best = Infinity
  for (let k = 0; k < 4; k++) { const v = s[k].x + s[k].y; if (v < best) { best = v; start = k } }
  return [s[start], s[(start + 1) % 4], s[(start + 2) % 4], s[(start + 3) % 4]]
}

function isConvex(p: Pt[]): boolean {
  let sign = 0
  for (let k = 0; k < 4; k++) {
    const a = p[k], b = p[(k + 1) % 4], c = p[(k + 2) % 4]
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cr) < 1e-6) return false
    const s2 = cr > 0 ? 1 : -1
    if (sign === 0) sign = s2
    else if (s2 !== sign) return false
  }
  return true
}

function polyArea(p: Pt[]): number {
  let a = 0
  for (let k = 0; k < 4; k++) { const q = p[k], r = p[(k + 1) % 4]; a += q.x * r.y - r.x * q.y }
  return Math.abs(a) / 2
}

/* ── Bildverarbeitung ─────────────────────────────────────────────── */

/** Separierter Box-Blur (laufende Summe, O(n)) auf einem Graustufen-Array. */
function boxBlurF(src: Float32Array, w: number, h: number, r0: number): Float32Array {
  const r = Math.max(1, Math.min(r0, Math.floor(Math.min(w, h) / 2) - 1))
  if (r < 1) return src.slice()
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  const win = 2 * r + 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let acc = 0
    for (let x = -r; x <= r; x++) acc += src[row + clampN(x, 0, w - 1)]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / win
      acc += src[row + clampN(x + r + 1, 0, w - 1)] - src[row + clampN(x - r, 0, w - 1)]
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -r; y <= r; y++) acc += tmp[clampN(y, 0, h - 1) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win
      acc += tmp[clampN(y + r + 1, 0, h - 1) * w + x] - tmp[clampN(y - r, 0, h - 1) * w + x]
    }
  }
  return out
}

/**
 * Automatische Belegrand-Erkennung: Graustufen → Sobel-Gradienten →
 * Hough-Transformation (jedes Kantenpixel stimmt nur für Winkel nahe seiner
 * Gradientenrichtung — schnell + sauberer Akkumulator) → je Bildseite die
 * stärkste Linie in ihrem Winkel-/Positions-Fenster → Schnittpunkte = Ecken.
 * Liefert null, wenn kein plausibles Viereck gefunden wird (Fallback: Inset).
 */
function detectDocumentCorners(src: HTMLCanvasElement): Pt[] | null {
  const W = src.width, H = src.height
  const scale = 440 / Math.max(W, H)
  const dw = Math.max(60, Math.round(W * scale))
  const dh = Math.max(60, Math.round(H * scale))
  const c = document.createElement('canvas')
  c.width = dw; c.height = dh
  const cctx = c.getContext('2d', { willReadFrequently: true })
  if (!cctx) return null
  cctx.drawImage(src, 0, 0, dw, dh)
  const px = cctx.getImageData(0, 0, dw, dh).data
  const n = dw * dh
  const gray = new Float32Array(n)
  for (let i = 0, j = 0; i < n; i++, j += 4) gray[i] = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2]
  const soft = boxBlurF(gray, dw, dh, 1)

  // Sobel-Gradienten + adaptive Kanten-Schwelle
  const mag = new Float32Array(n)
  const ang = new Float32Array(n)
  let sum = 0, sum2 = 0, cnt = 0
  for (let y = 1; y < dh - 1; y++) {
    for (let x = 1; x < dw - 1; x++) {
      const i = y * dw + x
      const gx = -soft[i - dw - 1] - 2 * soft[i - 1] - soft[i + dw - 1] + soft[i - dw + 1] + 2 * soft[i + 1] + soft[i + dw + 1]
      const gy = -soft[i - dw - 1] - 2 * soft[i - dw] - soft[i - dw + 1] + soft[i + dw - 1] + 2 * soft[i + dw] + soft[i + dw + 1]
      const m = Math.hypot(gx, gy)
      mag[i] = m
      ang[i] = Math.atan2(gy, gx)
      sum += m; sum2 += m * m; cnt++
    }
  }
  const mean = sum / cnt
  const std = Math.sqrt(Math.max(0, sum2 / cnt - mean * mean))
  let thr = mean + std * 1.1
  // Sehr texturierte Hintergründe: Schwelle anheben, bis die Kantenmenge handhabbar ist
  for (let tries = 0; tries < 4; tries++) {
    let edges = 0
    for (let i = 0; i < n; i++) if (mag[i] >= thr) edges++
    if (edges <= 30000) break
    thr *= 1.35
  }

  // Hough: rho-Auflösung 2px, Winkel 1 Grad; Stimmen nur nahe der Gradientenrichtung
  const diag = Math.ceil(Math.hypot(dw, dh))
  const RHO = 2
  const nRho = Math.ceil((2 * diag) / RHO) + 1
  const NT = 180
  const cosT = new Float32Array(NT), sinT = new Float32Array(NT)
  for (let t = 0; t < NT; t++) { const rr = (t * Math.PI) / 180; cosT[t] = Math.cos(rr); sinT[t] = Math.sin(rr) }
  const acc = new Float32Array(NT * nRho)
  const margin = 3
  for (let y = margin; y < dh - margin; y++) {
    for (let x = margin; x < dw - margin; x++) {
      const i = y * dw + x
      if (mag[i] < thr) continue
      let g = (ang[i] * 180) / Math.PI
      if (g < 0) g += 180
      if (g >= 180) g -= 180
      const g0 = Math.round(g)
      const wv = mag[i] > thr * 2 ? 2 : 1
      for (let dt = -14; dt <= 14; dt++) {
        let t = g0 + dt
        if (t < 0) t += 180
        else if (t >= 180) t -= 180
        const rho = x * cosT[t] + y * sinT[t]
        const ri = Math.round((rho + diag) / RHO)
        if (ri >= 0 && ri < nRho) acc[t * nRho + ri] += wv
      }
    }
  }

  type Line = { t: number; rho: number }
  const yAtMid = (t: number, rho: number) => (rho - (dw / 2) * cosT[t]) / (sinT[t] || 1e-9)
  const xAtMid = (t: number, rho: number) => (rho - (dh / 2) * sinT[t]) / (cosT[t] || 1e-9)
  const horiz = (t: number) => t >= 60 && t <= 120
  const vert = (t: number) => t <= 30 || t >= 150
  const MIN_VOTES = 40
  // 2-Pass-Auswahl: erst die stärkste Linie im Fenster finden, dann unter
  // allen Linien mit >= 60 Prozent dieser Stimmen die ÄUSSERSTE nehmen —
  // die Belegkante liegt außen, Textzeilen/Tabellenlinien im Beleg innen.
  // (Numerisch verifiziert: Text im Beleg, gedreht, Tischkante, bildfüllend.)
  const lineAt = (
    pred: (t: number, rho: number) => boolean,
    outward: (t: number, rho: number) => number,
  ): Line | null => {
    let best = 0
    for (let t = 0; t < NT; t++) {
      const base = t * nRho
      for (let ri = 0; ri < nRho; ri++) {
        const v = acc[base + ri]
        if (v <= best) continue
        if (pred(t, ri * RHO - diag)) best = v
      }
    }
    if (best < MIN_VOTES) return null
    const need = best * 0.6
    let bt = -1, br = 0, bo = -Infinity
    for (let t = 0; t < NT; t++) {
      const base = t * nRho
      for (let ri = 0; ri < nRho; ri++) {
        if (acc[base + ri] < need) continue
        const rho = ri * RHO - diag
        if (!pred(t, rho)) continue
        const o = outward(t, rho)
        if (o > bo) { bo = o; bt = t; br = rho }
      }
    }
    return bt >= 0 ? { t: bt, rho: br } : null
  }
  const top = lineAt((t, r) => horiz(t) && yAtMid(t, r) >= dh * 0.02 && yAtMid(t, r) <= dh * 0.5, (t, r) => -yAtMid(t, r))
  const bottom = lineAt((t, r) => horiz(t) && yAtMid(t, r) > dh * 0.5 && yAtMid(t, r) <= dh * 0.98, (t, r) => yAtMid(t, r))
  const left = lineAt((t, r) => vert(t) && xAtMid(t, r) >= dw * 0.02 && xAtMid(t, r) <= dw * 0.5, (t, r) => -xAtMid(t, r))
  const right = lineAt((t, r) => vert(t) && xAtMid(t, r) > dw * 0.5 && xAtMid(t, r) <= dw * 0.98, (t, r) => xAtMid(t, r))
  if (!top || !bottom || !left || !right) return null

  const inter = (a: Line, b: Line): Pt | null => {
    const d = cosT[a.t] * sinT[b.t] - sinT[a.t] * cosT[b.t]
    if (Math.abs(d) < 1e-6) return null
    return {
      x: (a.rho * sinT[b.t] - b.rho * sinT[a.t]) / d,
      y: (cosT[a.t] * b.rho - cosT[b.t] * a.rho) / d,
    }
  }
  const tl = inter(top, left), tr = inter(top, right), br2 = inter(bottom, right), bl = inter(bottom, left)
  if (!tl || !tr || !br2 || !bl) return null
  const pts = [tl, tr, br2, bl]
  for (const p of pts) {
    if (!isFinite(p.x) || !isFinite(p.y)) return null
    if (p.x < -dw * 0.06 || p.x > dw * 1.06 || p.y < -dh * 0.06 || p.y > dh * 1.06) return null
  }
  if (!isConvex(pts)) return null
  if (polyArea(pts) < dw * dh * 0.15) return null
  const minSide = Math.min(dw, dh) * 0.18
  for (let k = 0; k < 4; k++) if (dist(pts[k], pts[(k + 1) % 4]) < minSide) return null

  const sx = W / dw, sy = H / dh
  return pts.map((p) => ({ x: clampN(p.x * sx, 0, W), y: clampN(p.y * sy, 0, H) }))
}

/**
 * Homographie H (3x3, h8=1), die die 4 Punkte `from` exakt auf `to` abbildet
 * — gelöst als 8x8-Gleichungssystem (Gauß mit Spaltenpivot).
 */
function solveH(from: Pt[], to: Pt[]): number[] | null {
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const u = from[i].x, v = from[i].y
    const x = to[i].x, y = to[i].y
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x)
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y)
  }
  for (let col = 0; col < 8; col++) {
    let piv = col
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r
    if (Math.abs(A[piv][col]) < 1e-9) return null
    if (piv !== col) {
      const t = A[piv]; A[piv] = A[col]; A[col] = t
      const tb = b[piv]; b[piv] = b[col]; b[col] = tb
    }
    for (let r = col + 1; r < 8; r++) {
      const f = A[r][col] / A[col][col]
      if (!f) continue
      for (let c2 = col; c2 < 8; c2++) A[r][c2] -= f * A[col][c2]
      b[r] -= f * b[col]
    }
  }
  const hv = new Array<number>(8).fill(0)
  for (let r = 7; r >= 0; r--) {
    let s = b[r]
    for (let c2 = r + 1; c2 < 8; c2++) s -= A[r][c2] * hv[c2]
    hv[r] = s / A[r][r]
  }
  return [...hv, 1]
}

/** Perspektivische Entzerrung: Ausgabe-Rechteck → Quell-Viereck, bilinear. */
function warpPerspective(img: ImageData, corners: Pt[], ow: number, oh: number): ImageData | null {
  const Hm = solveH(
    [{ x: 0, y: 0 }, { x: ow, y: 0 }, { x: ow, y: oh }, { x: 0, y: oh }],
    corners,
  )
  if (!Hm) return null
  const sw = img.width, sh = img.height, s = img.data
  const out = new ImageData(ow, oh)
  const d = out.data
  let di = 0
  for (let v = 0; v < oh; v++) {
    const vc = v + 0.5
    let nx = Hm[0] * 0.5 + Hm[1] * vc + Hm[2]
    let ny = Hm[3] * 0.5 + Hm[4] * vc + Hm[5]
    let nw = Hm[6] * 0.5 + Hm[7] * vc + 1
    for (let u = 0; u < ow; u++) {
      const x = clampN(nx / nw - 0.5, 0, sw - 1.001)
      const y = clampN(ny / nw - 0.5, 0, sh - 1.001)
      const x0 = Math.floor(x), y0 = Math.floor(y)
      const ax = x - x0, ay = y - y0
      const x1 = x0 + 1 < sw ? x0 + 1 : x0
      const y1 = y0 + 1 < sh ? y0 + 1 : y0
      const i00 = (y0 * sw + x0) * 4, i01 = (y0 * sw + x1) * 4
      const i10 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4
      const w00 = (1 - ax) * (1 - ay), w01 = ax * (1 - ay), w10 = (1 - ax) * ay, w11 = ax * ay
      d[di] = s[i00] * w00 + s[i01] * w01 + s[i10] * w10 + s[i11] * w11
      d[di + 1] = s[i00 + 1] * w00 + s[i01 + 1] * w01 + s[i10 + 1] * w10 + s[i11 + 1] * w11
      d[di + 2] = s[i00 + 2] * w00 + s[i01 + 2] * w01 + s[i10 + 2] * w10 + s[i11 + 2] * w11
      d[di + 3] = 255
      di += 4
      nx += Hm[0]; ny += Hm[3]; nw += Hm[6]
    }
  }
  return out
}

/**
 * Scan-Aufhellung IN PLACE: Beleuchtungs-Ausgleich (Division durch stark
 * geblurte Kopie = Papier wird gleichmäßig weiß, Schatten verschwinden),
 * bei 'scan' zusätzlich Schwarz/Weiß-Levels für den klassischen Scan-Look.
 */
function enhanceImage(img: ImageData, mode: Mode): void {
  if (mode === 'original') return
  const w = img.width, h = img.height, d = img.data
  const n = w * h
  const gray = new Float32Array(n)
  for (let i = 0, j = 0; i < n; i++, j += 4) gray[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]
  const r = Math.max(8, Math.round(Math.max(w, h) / 28))
  const bg = boxBlurF(gray, w, h, r)
  if (mode === 'scan') {
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      let v = (gray[i] * 236) / Math.max(bg[i], 60)
      v = (v - 70) * (255 / 155)
      const out = v < 0 ? 0 : v > 255 ? 255 : v
      d[j] = out; d[j + 1] = out; d[j + 2] = out
    }
  } else {
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      let g = 245 / Math.max(bg[i], 60)
      if (g > 2.4) g = 2.4
      const rr = d[j] * g, gg = d[j + 1] * g, bb = d[j + 2] * g
      d[j] = rr > 255 ? 255 : rr
      d[j + 1] = gg > 255 ? 255 : gg
      d[j + 2] = bb > 255 ? 255 : bb
    }
  }
}

/* ── Komponente ───────────────────────────────────────────────────── */

interface Props {
  /** Nur BILDER (PDFs bleiben beim Aufrufer) — werden Seite für Seite gescannt. */
  files: File[]
  /** Fertige Seiten als JPEG-Files (beleg-scan-N.jpg, ≤2000px). */
  onDone: (jpegs: File[]) => void
  onCancel: () => void
}

export default function DocScanner({ files, onDone, onCancel }: Props) {
  const [phase, setPhase] = useState<Phase>('lade')
  const [idx, setIdx] = useState(0)
  const [mode, setMode] = useState<Mode>('scan')
  const [autoOk, setAutoOk] = useState(true)
  const [applying, setApplying] = useState(false)
  const [err, setErr] = useState('')

  const srcRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const baseRef = useRef<HTMLCanvasElement | null>(null)
  const overRef = useRef<HTMLCanvasElement | null>(null)
  const resultRef = useRef<HTMLCanvasElement | null>(null)
  const cornersRef = useRef<Pt[]>([])
  const dispRef = useRef<{ w: number; h: number } | null>(null)
  const dragRef = useRef<number | null>(null)
  const warpedRef = useRef<ImageData | null>(null)
  const resultsRef = useRef<File[]>([])
  const phaseRef = useRef<Phase>('lade')
  phaseRef.current = phase

  /* Seite laden + Auto-Erkennung */
  useEffect(() => {
    let alive = true
    const run = async () => {
      setPhase('lade'); setErr('')
      try {
        const bmp = await createImageBitmap(files[idx])
        const s = Math.min(1, 2800 / Math.max(bmp.width, bmp.height))
        const c = document.createElement('canvas')
        c.width = Math.max(2, Math.round(bmp.width * s))
        c.height = Math.max(2, Math.round(bmp.height * s))
        const cctx = c.getContext('2d', { willReadFrequently: true })
        if (!cctx) throw new Error('Canvas nicht verfügbar')
        cctx.drawImage(bmp, 0, 0, c.width, c.height)
        bmp.close()
        if (!alive) return
        srcRef.current = c
        let det: Pt[] | null = null
        try { det = detectDocumentCorners(c) } catch { det = null }
        cornersRef.current = det ? orderCorners(det) : insetCorners(c.width, c.height, 0.05)
        setAutoOk(!!det)
        setPhase('anpassen')
      } catch {
        if (!alive) return
        srcRef.current = null
        setErr('Dieses Bild konnte nicht geladen werden.')
        setPhase('anpassen')
      }
    }
    run()
    return () => { alive = false }
  }, [idx, files])

  /* Ansicht layouten + zeichnen, sobald die Anpassen-Phase steht */
  useEffect(() => {
    if (phase === 'anpassen' && srcRef.current) layoutView()
    if (phase === 'ergebnis') renderResult(mode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  useEffect(() => {
    if (phase === 'ergebnis') renderResult(mode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  useEffect(() => {
    const onR = () => { if (phaseRef.current === 'anpassen' && srcRef.current) layoutView() }
    window.addEventListener('resize', onR)
    return () => window.removeEventListener('resize', onR)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dpr = () => Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)

  const layoutView = () => {
    const src = srcRef.current, wrap = stageRef.current
    const base = baseRef.current, over = overRef.current
    if (!src || !wrap || !base || !over) return
    const availW = Math.max(60, wrap.clientWidth - 12)
    const availH = Math.max(60, wrap.clientHeight - 12)
    const f = Math.min(availW / src.width, availH / src.height)
    const w = Math.max(40, Math.floor(src.width * f))
    const h = Math.max(40, Math.floor(src.height * f))
    dispRef.current = { w, h }
    const p = dpr()
    for (const cv of [base, over]) {
      cv.width = Math.round(w * p); cv.height = Math.round(h * p)
      cv.style.width = `${w}px`; cv.style.height = `${h}px`
    }
    const bctx = base.getContext('2d')
    if (bctx) {
      bctx.setTransform(p, 0, 0, p, 0, 0)
      bctx.drawImage(src, 0, 0, w, h)
    }
    drawOverlay()
  }

  const drawOverlay = (loupeFor?: number | null) => {
    const over = overRef.current, src = srcRef.current, disp = dispRef.current
    if (!over || !src || !disp) return
    const ctx = over.getContext('2d')
    if (!ctx) return
    const p = dpr()
    ctx.setTransform(p, 0, 0, p, 0, 0)
    ctx.clearRect(0, 0, disp.w, disp.h)
    const fx = disp.w / src.width, fy = disp.h / src.height
    const P = cornersRef.current.map((q) => ({ x: q.x * fx, y: q.y * fy }))
    if (P.length !== 4) return

    // Außenbereich abdunkeln (evenodd)
    ctx.beginPath()
    ctx.rect(0, 0, disp.w, disp.h)
    ctx.moveTo(P[0].x, P[0].y)
    for (let k = 1; k < 4; k++) ctx.lineTo(P[k].x, P[k].y)
    ctx.closePath()
    ctx.fillStyle = 'rgba(6,10,14,0.52)'
    ctx.fill('evenodd')

    // Rahmen
    ctx.beginPath()
    ctx.moveTo(P[0].x, P[0].y)
    for (let k = 1; k < 4; k++) ctx.lineTo(P[k].x, P[k].y)
    ctx.closePath()
    ctx.strokeStyle = GOLD_HELL
    ctx.lineWidth = 2
    ctx.stroke()

    // Eck-Griffe
    for (let k = 0; k < 4; k++) {
      ctx.beginPath()
      ctx.arc(P[k].x, P[k].y, 11, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255,255,255,0.95)'
      ctx.fill()
      ctx.lineWidth = 3
      ctx.strokeStyle = GOLD
      ctx.stroke()
    }

    // 🔍 Lupe beim Ziehen — zeigt den Bereich unter dem Finger vergrößert
    if (loupeFor != null && P[loupeFor]) {
      const q = cornersRef.current[loupeFor]
      const L = 104, Z = 2.4
      const swin = L / (Z * fx), shin = L / (Z * fy)
      const inLeft = P[loupeFor].x < disp.w / 2
      const lx = inLeft ? disp.w - L - 10 : 10
      const ly = 10
      ctx.save()
      ctx.beginPath()
      ctx.arc(lx + L / 2, ly + L / 2, L / 2, 0, Math.PI * 2)
      ctx.clip()
      ctx.fillStyle = '#0E141A'
      ctx.fillRect(lx, ly, L, L)
      ctx.drawImage(src, q.x - swin / 2, q.y - shin / 2, swin, shin, lx, ly, L, L)
      ctx.strokeStyle = GOLD_HELL
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(lx + L / 2 - 12, ly + L / 2); ctx.lineTo(lx + L / 2 + 12, ly + L / 2)
      ctx.moveTo(lx + L / 2, ly + L / 2 - 12); ctx.lineTo(lx + L / 2, ly + L / 2 + 12)
      ctx.stroke()
      ctx.restore()
      ctx.beginPath()
      ctx.arc(lx + L / 2, ly + L / 2, L / 2, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }

  /* Ecken ziehen (Pointer Events; Canvas hat touch-action none) */
  const cornerAtDisplay = (dx: number, dy: number): number | null => {
    const src = srcRef.current, disp = dispRef.current
    if (!src || !disp) return null
    const fx = disp.w / src.width, fy = disp.h / src.height
    let best = -1, bestD = 34
    cornersRef.current.forEach((q, k) => {
      const d2 = Math.hypot(q.x * fx - dx, q.y * fy - dy)
      if (d2 < bestD) { bestD = d2; best = k }
    })
    return best >= 0 ? best : null
  }
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const over = overRef.current
    if (!over) return
    const rect = over.getBoundingClientRect()
    const k = cornerAtDisplay(e.clientX - rect.left, e.clientY - rect.top)
    if (k == null) return
    dragRef.current = k
    over.setPointerCapture(e.pointerId)
    drawOverlay(k)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const k = dragRef.current
    const over = overRef.current, src = srcRef.current, disp = dispRef.current
    if (k == null || !over || !src || !disp) return
    const rect = over.getBoundingClientRect()
    const fx = disp.w / src.width, fy = disp.h / src.height
    cornersRef.current[k] = {
      x: clampN((e.clientX - rect.left) / fx, 0, src.width),
      y: clampN((e.clientY - rect.top) / fy, 0, src.height),
    }
    drawOverlay(k)
  }
  const onPointerUp = () => {
    if (dragRef.current == null) return
    dragRef.current = null
    drawOverlay()
  }

  const rotate = () => {
    const src = srcRef.current
    if (!src) return
    const nc = document.createElement('canvas')
    nc.width = src.height; nc.height = src.width
    const ctx = nc.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.translate(nc.width, 0)
    ctx.rotate(Math.PI / 2)
    ctx.drawImage(src, 0, 0)
    cornersRef.current = orderCorners(cornersRef.current.map((q) => ({ x: src.height - q.y, y: q.x })))
    srcRef.current = nc
    layoutView()
  }

  const ganzeSeite = () => {
    const src = srcRef.current
    if (!src) return
    cornersRef.current = [
      { x: 0, y: 0 }, { x: src.width, y: 0 },
      { x: src.width, y: src.height }, { x: 0, y: src.height },
    ]
    drawOverlay()
  }

  const weiter = () => {
    const src = srcRef.current
    if (!src) return
    const pts = orderCorners(cornersRef.current)
    if (!isConvex(pts) || polyArea(pts) < 900) {
      setErr('Die Ecken überkreuzen sich — bitte neu ziehen.')
      return
    }
    cornersRef.current = pts
    setErr('')
    setPhase('verarbeite')
    setTimeout(() => {
      try {
        const cctx = src.getContext('2d', { willReadFrequently: true })
        if (!cctx) throw new Error('Canvas nicht verfügbar')
        const img = cctx.getImageData(0, 0, src.width, src.height)
        const [tl, tr, br, bl] = pts
        const ow0 = Math.max(dist(tl, tr), dist(bl, br))
        const oh0 = Math.max(dist(tl, bl), dist(tr, br))
        const sc = Math.min(1, 2000 / Math.max(ow0, oh0))
        const ow = Math.max(24, Math.round(ow0 * sc))
        const oh = Math.max(24, Math.round(oh0 * sc))
        const warped = warpPerspective(img, pts, ow, oh)
        if (!warped) throw new Error('Zuschnitt fehlgeschlagen — Ecken bitte anpassen.')
        warpedRef.current = warped
        setPhase('ergebnis')
      } catch (e) {
        setErr(String(e instanceof Error ? e.message : e))
        setPhase('anpassen')
      }
    }, 30)
  }

  const renderResult = (m: Mode) => {
    const pristine = warpedRef.current, cv = resultRef.current
    if (!pristine || !cv) return
    setApplying(true)
    setTimeout(() => {
      try {
        const copy = new ImageData(new Uint8ClampedArray(pristine.data), pristine.width, pristine.height)
        enhanceImage(copy, m)
        cv.width = copy.width; cv.height = copy.height
        const ctx = cv.getContext('2d')
        if (ctx) ctx.putImageData(copy, 0, 0)
      } finally {
        setApplying(false)
      }
    }, 15)
  }

  const confirmPage = () => {
    const cv = resultRef.current
    if (!cv || applying) return
    setPhase('verarbeite')
    cv.toBlob((b) => {
      if (!b) { setErr('Export fehlgeschlagen — bitte erneut versuchen.'); setPhase('ergebnis'); return }
      resultsRef.current.push(new File([b], `beleg-scan-${resultsRef.current.length + 1}.jpg`, { type: 'image/jpeg' }))
      if (idx + 1 < files.length) setIdx(idx + 1)
      else onDone(resultsRef.current)
    }, 'image/jpeg', 0.85)
  }

  const skipPage = () => {
    setErr('')
    if (idx + 1 < files.length) setIdx(idx + 1)
    // Auch mit 0 übernommenen Seiten onDone (ggf. leer) — die Eltern halten
    // mitgewählte PDFs zurück und dürfen die nicht verlieren, nur weil ein
    // Foto nicht lesbar war. Explizites ✕-Abbrechen verwirft dagegen alles.
    else onDone(resultsRef.current)
  }

  /* ── UI ── */

  const btn = (primary: boolean): CSSProperties => ({
    border: 'none', borderRadius: 12, padding: '12px 16px', fontSize: 15, fontWeight: 700,
    cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
    background: primary ? GOLD : 'rgba(255,255,255,0.12)',
    color: '#fff',
  })
  const chip = (active: boolean): CSSProperties => ({
    border: 'none', borderRadius: 999, padding: '8px 14px', fontSize: 13.5, fontWeight: 700,
    cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
    background: active ? GOLD : 'rgba(255,255,255,0.12)',
    color: active ? '#fff' : 'rgba(255,255,255,0.85)',
  })

  const ladeFehler = err && !srcRef.current
  const letzteSeite = idx + 1 >= files.length

  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="team-shell" style={{
      position: 'fixed', inset: 0, zIndex: 95, background: '#10181E',
      display: 'flex', flexDirection: 'column',
    }}>
      <header style={{
        background: NAVY, color: '#fff', flexShrink: 0,
        padding: 'max(12px, env(safe-area-inset-top)) 16px 12px',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{ fontSize: 17.5, fontWeight: 800, letterSpacing: -0.3 }}>📐 Beleg zuschneiden</div>
        {files.length > 1 && (
          <div style={{ fontSize: 12.5, fontWeight: 700, background: 'rgba(255,255,255,0.14)', borderRadius: 999, padding: '3px 10px' }}>
            Seite {idx + 1} von {files.length}
          </div>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={onCancel} style={{ background: 'rgba(255,255,255,0.14)', border: 'none', color: '#fff', fontSize: 15, fontWeight: 700, borderRadius: 999, padding: '6px 13px', cursor: 'pointer' }}>✕</button>
      </header>

      <div ref={stageRef} style={{
        flex: 1, minHeight: 0, position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 6,
      }}>
        {phase === 'lade' && <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14.5 }}>⏳ Bild wird analysiert…</div>}
        {phase === 'verarbeite' && <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14.5 }}>⏳ Wird verarbeitet…</div>}

        {phase === 'anpassen' && ladeFehler && (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.85)', fontSize: 14.5, padding: 20, lineHeight: 1.6 }}>
            ⚠️ {err}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
              <button onClick={skipPage} style={btn(true)}>Seite überspringen</button>
              <button onClick={onCancel} style={btn(false)}>Abbrechen</button>
            </div>
          </div>
        )}

        {phase === 'anpassen' && !ladeFehler && (
          <div style={{ position: 'relative', lineHeight: 0 }}>
            <canvas ref={baseRef} style={{ display: 'block', borderRadius: 6 }} />
            <canvas
              ref={overRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              style={{ position: 'absolute', inset: 0, touchAction: 'none', borderRadius: 6, cursor: 'crosshair' }}
            />
          </div>
        )}

        {phase === 'ergebnis' && (
          <div style={{ position: 'relative', maxWidth: '100%', maxHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <canvas ref={resultRef} style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 6, background: '#fff', opacity: applying ? 0.45 : 1, transition: 'opacity 0.15s' }} />
            {applying && (
              <div style={{ position: 'absolute', color: NAVY, fontSize: 13.5, fontWeight: 700, background: 'rgba(255,255,255,0.85)', borderRadius: 999, padding: '6px 13px' }}>
                ⏳ wird angewendet…
              </div>
            )}
          </div>
        )}
      </div>

      <footer style={{
        flexShrink: 0, padding: '10px 14px calc(12px + env(safe-area-inset-bottom))',
        display: 'grid', gap: 9,
      }}>
        {err && !ladeFehler && (
          <div style={{ background: '#FFEBE9', color: '#D70015', borderRadius: 11, padding: '9px 13px', fontSize: 13.5 }}>{err}</div>
        )}

        {phase === 'anpassen' && !ladeFehler && (
          <>
            <div style={{ textAlign: 'center', fontSize: 12.5, color: 'rgba(255,255,255,0.6)' }}>
              {autoOk ? 'Zuschnitt prüfen — Ecken bei Bedarf an den Belegrand ziehen' : 'Kein Rand erkannt — Ecken bitte an den Belegrand ziehen'}
            </div>
            <div style={{ display: 'flex', gap: 9 }}>
              <button onClick={rotate} style={btn(false)} title="90° drehen">↻</button>
              <button onClick={ganzeSeite} style={btn(false)}>Ganze Seite</button>
              <div style={{ flex: 1 }} />
              <button onClick={weiter} style={{ ...btn(true), padding: '12px 26px' }}>Weiter →</button>
            </div>
          </>
        )}

        {phase === 'ergebnis' && (
          <>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => setMode('scan')} style={chip(mode === 'scan')}>📄 Scan</button>
              <button onClick={() => setMode('farbe')} style={chip(mode === 'farbe')}>🎨 Farbe</button>
              <button onClick={() => setMode('original')} style={chip(mode === 'original')}>📷 Original</button>
            </div>
            <div style={{ display: 'flex', gap: 9 }}>
              <button onClick={() => { setErr(''); setPhase('anpassen') }} style={btn(false)}>‹ Zuschnitt</button>
              <div style={{ flex: 1 }} />
              <button onClick={confirmPage} disabled={applying} style={{ ...btn(true), padding: '12px 22px', opacity: applying ? 0.55 : 1 }}>
                {letzteSeite ? '✓ Fertig' : '✓ Seite übernehmen'}
              </button>
            </div>
          </>
        )}
      </footer>
    </div>,
    document.body,
  )
}
