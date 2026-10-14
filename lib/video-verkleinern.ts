'use client'

/**
 * 🎬 Große Videos im Browser verkleinern (Pascal, Chefsache 7.10.2026; Inhaber 14.10.: „Im Browser verkleinern",
 * kein Supabase Pro). Supabase Free erlaubt höchstens 50 MB pro Datei — längere Handy-Videos sind schnell größer.
 *
 * Ablauf: Das Video läuft unsichtbar ab, jedes Bild wird auf ein Canvas gezeichnet (max. 1280 px lange Kante),
 * der Ton läuft über WebAudio (hörbar ist nichts), und MediaRecorder nimmt beides mit einer Bitrate auf, die das
 * Ergebnis unter ~40 MB hält. Das dauert so lange wie das Video selbst (Echtzeit) — dafür ohne Server, ohne
 * Zusatz-Bibliothek und auf iPhone (MP4/H.264) wie Android/Desktop (MP4 oder WebM).
 *
 * WICHTIG (iOS): verkleinereVideo() muss SYNCHRON aus einem Tipp heraus aufgerufen werden — AudioContext und das
 * erste play() brauchen die Nutzer-Geste. Darum fragt der Chat erst nach („Verkleinern") statt sofort zu starten.
 */

export const VIDEO_LIMIT_BYTES = 50 * 1024 * 1024
/** Ziel mit Puffer: MediaRecorder hält die Bitrate nur ungefähr ein */
export const VIDEO_ZIEL_BYTES = 40 * 1024 * 1024
/** Länger als 10 Minuten: Wartezeit unzumutbar und Bild würde zu matschig */
export const VIDEO_MAX_SEKUNDEN = 10 * 60

const MIME_KANDIDATEN = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

type MitFrameCallback = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }
type MitWebkitAudio = typeof globalThis & { webkitAudioContext?: typeof AudioContext }

/** Formatwahl: bevorzugt MP4 (spielt überall, auch auf dem iPhone), sonst WebM */
export function videoMime(): string | null {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') return null
  for (const m of MIME_KANDIDATEN) {
    try { if (MediaRecorder.isTypeSupported(m)) return m } catch { /* weiter */ }
  }
  return null
}

/** Kann dieser Browser überhaupt verkleinern? (MediaRecorder + Canvas-Stream) */
export function kannVideoVerkleinern(): boolean {
  if (typeof document === 'undefined') return false
  const c = document.createElement('canvas') as HTMLCanvasElement & { captureStream?: unknown }
  return typeof c.captureStream === 'function' && videoMime() !== null
}

/** Grund-Typ fürs Hochladen (Upload-Route kennt nur video/mp4 und video/webm) */
export function basisMime(mime: string): 'video/mp4' | 'video/webm' {
  return mime.split(';')[0].trim().toLowerCase() === 'video/mp4' ? 'video/mp4' : 'video/webm'
}

/** Bitrate (Bit/s) für Ziel-Größe und Dauer; Ton bekommt fest 96 kbit/s, 10 % Puffer für Container/Schwankung */
export function zielBitrate(dauerSek: number, zielBytes = VIDEO_ZIEL_BYTES): number {
  if (!Number.isFinite(dauerSek) || dauerSek <= 0) return 1_500_000
  const gesamt = (zielBytes * 8 * 0.9) / dauerSek
  return Math.round(Math.max(300_000, Math.min(4_000_000, gesamt - 96_000)))
}

/** Lange Kante passend zur Bitrate — wenig Bitrate in großem Bild sieht schlechter aus als ein kleineres Bild */
export function zielKante(bitrate: number): number {
  if (bitrate >= 2_000_000) return 1280
  if (bitrate >= 1_000_000) return 960
  return 720
}

/** Ausgabegröße (gerade Zahlen, Encoder mögen keine ungeraden) */
export function zielMasse(breite: number, hoehe: number, kante: number): { w: number; h: number } {
  const s = Math.min(1, kante / Math.max(breite, hoehe))
  const gerade = (n: number) => Math.max(2, Math.round((n * s) / 2) * 2)
  return { w: gerade(breite), h: gerade(hoehe) }
}

/** Länge eines Videos in Sekunden (nur Metadaten, spielt nichts ab). null = unbekannt/nicht abspielbar */
export function videoDauer(file: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    let fertig = false
    const ende = (wert: number | null) => {
      if (fertig) return
      fertig = true
      clearTimeout(timer)
      v.removeAttribute('src'); v.load()
      URL.revokeObjectURL(url)
      resolve(wert)
    }
    const timer = setTimeout(() => ende(null), 15_000)
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) { ende(v.duration); return }
      // Browser-Aufnahmen (WebM) haben oft keine Längenangabe → ans Ende springen lassen, dann ist sie bekannt
      v.ondurationchange = () => { if (Number.isFinite(v.duration) && v.duration > 0) ende(v.duration) }
      v.ontimeupdate = () => { if (Number.isFinite(v.duration) && v.duration > 0) ende(v.duration) }
      try { v.currentTime = 1e101 } catch { ende(null) }
    }
    v.onerror = () => ende(null)
    v.src = url
  })
}

export class VideoFehler extends Error {}

export interface VerkleinertesVideo { blob: Blob; mime: 'video/mp4' | 'video/webm'; ohneTon: boolean }

/**
 * Verkleinert ein Video in Echtzeit. MUSS synchron aus einem Klick/Tipp aufgerufen werden (siehe oben).
 * onFortschritt bekommt 0…1. Abbruch über signal → Promise wird mit AbortError abgelehnt.
 */
export function verkleinereVideo(file: Blob, opts: {
  dauerSek?: number | null
  zielBytes?: number
  signal?: AbortSignal
  onFortschritt?: (anteil: number) => void
} = {}): Promise<VerkleinertesVideo> {
  const mimeWahl = videoMime()
  if (!mimeWahl || !kannVideoVerkleinern()) {
    return Promise.reject(new VideoFehler('Dieser Browser kann Videos nicht verkleinern. Kürze das Video bitte in der Fotos-App und versuch es noch einmal.'))
  }

  // ── synchroner Teil (Nutzer-Geste): Element, AudioContext, erstes play() ──
  const url = URL.createObjectURL(file)
  const video = document.createElement('video') as MitFrameCallback
  video.playsInline = true
  video.setAttribute('playsinline', '')
  video.setAttribute('webkit-playsinline', '')
  video.preload = 'auto'
  // Im DOM, aber unsichtbar: Safari dekodiert losgelöste Elemente teils nicht
  Object.assign(video.style, { position: 'fixed', left: '-10px', top: '-10px', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' })
  document.body.appendChild(video)
  video.src = url

  let ctx: AudioContext | null = null
  let tonZiel: MediaStreamAudioDestinationNode | null = null
  try {
    const Ctx = window.AudioContext ?? (globalThis as MitWebkitAudio).webkitAudioContext
    if (Ctx) {
      ctx = new Ctx()
      const quelle = ctx.createMediaElementSource(video)
      tonZiel = ctx.createMediaStreamDestination()
      quelle.connect(tonZiel) // bewusst NICHT an ctx.destination → man hört nichts
      void ctx.resume().catch(() => {})
    }
  } catch {
    ctx = null; tonZiel = null
  }
  let ohneTon = !tonZiel
  if (ohneTon) video.muted = true // ohne WebAudio würde das Video sonst laut abspielen

  // Freischalt-play() noch innerhalb der Geste; danach gilt das Element auf iOS als „erlaubt"
  const freischalten = video.play()

  return new Promise<VerkleinertesVideo>((resolve, reject) => {
    let beendet = false
    let recorder: MediaRecorder | null = null
    let stream: MediaStream | null = null
    let wakeLock: { release: () => Promise<void> } | null = null
    let stauTimer: ReturnType<typeof setInterval> | null = null
    const chunks: Blob[] = []

    const aufraeumen = () => {
      document.removeEventListener('visibilitychange', sichtbarkeit)
      opts.signal?.removeEventListener('abort', abbrechen)
      if (stauTimer) clearInterval(stauTimer)
      video.ontimeupdate = null; video.onended = null // video.load() unten meldet sonst noch „0 %"
      try { video.pause() } catch { /* egal */ }
      stream?.getTracks().forEach((t) => t.stop())
      void ctx?.close().catch(() => {})
      void wakeLock?.release().catch(() => {})
      video.removeAttribute('src'); video.load(); video.remove()
      URL.revokeObjectURL(url)
    }
    const scheitern = (e: Error) => {
      if (beendet) return
      beendet = true
      try { if (recorder && recorder.state !== 'inactive') recorder.stop() } catch { /* egal */ }
      aufraeumen()
      reject(e)
    }
    function abbrechen() { scheitern(new DOMException('Abgebrochen', 'AbortError') as unknown as Error) }
    if (opts.signal?.aborted) { abbrechen(); return }
    opts.signal?.addEventListener('abort', abbrechen)

    // App im Hintergrund: Video + Aufnahme anhalten, beim Zurückkommen weiter (sonst Standbild-Lücken)
    function sichtbarkeit() {
      if (beendet || !recorder) return
      if (document.hidden) {
        video.pause()
        if (recorder.state === 'recording') recorder.pause()
      } else {
        if (recorder.state === 'paused') recorder.resume()
        void video.play().catch(() => scheitern(new VideoFehler('Das Video konnte nach der Pause nicht weiterlaufen. Bitte noch einmal starten und die App dabei offen lassen.')))
      }
    }

    void (async () => {
      try {
        // 1) Freischalten abwarten; klappt Ton nicht (Autoplay-Sperre), stumm weitermachen
        try {
          await freischalten
        } catch (e) {
          if ((e as DOMException)?.name !== 'NotAllowedError') throw e
          video.muted = true; ohneTon = true
          await video.play()
        }
        video.pause()
        if (beendet) return

        // 2) Metadaten + Maße
        if (video.readyState < 1) { // HAVE_METADATA noch nicht erreicht
          await new Promise<void>((res, rej) => {
            const t = setTimeout(() => rej(new VideoFehler('Das Video lässt sich hier nicht öffnen.')), 15_000)
            video.addEventListener('loadedmetadata', () => { clearTimeout(t); res() }, { once: true })
          })
        }
        const dauer = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : (opts.dauerSek ?? 0)
        if (!dauer) throw new VideoFehler('Die Länge des Videos ist unbekannt – es lässt sich nicht verkleinern.')
        if (dauer > VIDEO_MAX_SEKUNDEN + 1) throw new VideoFehler('Das Video ist länger als 10 Minuten. Kürze es bitte vorher in der Fotos-App.')
        if (!video.videoWidth || !video.videoHeight) throw new VideoFehler('Dieses Videoformat kann der Browser nicht abspielen. Bitte als MP4 aufnehmen oder kürzen.')

        const bitrate = zielBitrate(dauer, opts.zielBytes ?? VIDEO_ZIEL_BYTES)
        const { w, h } = zielMasse(video.videoWidth, video.videoHeight, zielKante(bitrate))

        // 3) An den Anfang spulen
        if (video.currentTime > 0.01) {
          await new Promise<void>((res) => { video.addEventListener('seeked', () => res(), { once: true }); video.currentTime = 0 })
        }
        if (beendet) return

        // 4) Canvas + Aufnahme
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const g = canvas.getContext('2d')
        if (!g) throw new VideoFehler('Dieser Browser kann Videos nicht verkleinern.')
        g.fillStyle = '#000'; g.fillRect(0, 0, w, h)
        g.drawImage(video, 0, 0, w, h)
        const bild = canvas.captureStream(30)
        stream = new MediaStream([...bild.getVideoTracks(), ...(!ohneTon && tonZiel ? tonZiel.stream.getAudioTracks() : [])])
        recorder = new MediaRecorder(stream, {
          mimeType: mimeWahl,
          videoBitsPerSecond: bitrate,
          ...(ohneTon ? {} : { audioBitsPerSecond: 96_000 }),
        })
        recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) chunks.push(ev.data) }
        recorder.onerror = () => scheitern(new VideoFehler('Beim Verkleinern ist etwas schiefgelaufen. Bitte versuch es noch einmal.'))
        const gestoppt = new Promise<void>((res) => { recorder!.onstop = () => res() })

        // Bildschirm wach halten (sonst pausiert das Handy nach 30 s und mit ihm das Video)
        try {
          const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
          wakeLock = (await nav.wakeLock?.request('screen')) ?? null
        } catch { /* nicht schlimm */ }

        // Bild für Bild zeichnen — requestVideoFrameCallback (genau je Videobild), sonst requestAnimationFrame
        const zeichne = () => {
          if (beendet || video.ended) return
          g.drawImage(video, 0, 0, w, h)
          naechstes()
        }
        const naechstes = () => {
          if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(zeichne)
          else requestAnimationFrame(zeichne)
        }

        let letzteZeit = -1
        let stillstand = 0
        video.ontimeupdate = () => opts.onFortschritt?.(Math.min(0.99, video.currentTime / dauer))
        // Hängt das Video (sichtbar, aber keine Bewegung) länger als 20 s → abbrechen statt ewig warten
        stauTimer = setInterval(() => {
          if (beendet || document.hidden || video.paused) { stillstand = 0; return }
          if (Math.abs(video.currentTime - letzteZeit) < 0.01) {
            stillstand += 2
            if (stillstand >= 20) scheitern(new VideoFehler('Das Video hängt beim Abspielen. Bitte noch einmal versuchen und die App dabei offen lassen.'))
          } else { stillstand = 0; letzteZeit = video.currentTime }
        }, 2000)

        document.addEventListener('visibilitychange', sichtbarkeit)
        const fertig = new Promise<void>((res) => { video.onended = () => res() })
        recorder.start(1000)
        await video.play()
        naechstes()
        await fertig
        if (beendet) return
        g.drawImage(video, 0, 0, w, h)
        if (recorder.state !== 'inactive') recorder.stop()
        await gestoppt
        if (beendet) return

        const mime = basisMime(recorder.mimeType || mimeWahl)
        const blob = new Blob(chunks, { type: mime })
        beendet = true
        aufraeumen()
        opts.onFortschritt?.(1)
        if (blob.size === 0) { reject(new VideoFehler('Beim Verkleinern ist etwas schiefgelaufen. Bitte versuch es noch einmal.')); return }
        if (blob.size > VIDEO_LIMIT_BYTES) { reject(new VideoFehler('Das Video ist auch verkleinert noch zu groß. Kürze es bitte in der Fotos-App.')); return }
        resolve({ blob, mime, ohneTon })
      } catch (e) {
        scheitern(e instanceof VideoFehler || (e as DOMException)?.name === 'AbortError'
          ? e as Error
          : new VideoFehler('Das Video lässt sich hier nicht verkleinern. Kürze es bitte in der Fotos-App.'))
        if ((e as DOMException)?.name !== 'AbortError') console.error('[video-verkleinern]', e)
      }
    })()
  })
}

/** „IMG_1234.MOV" → „IMG_1234.mp4" passend zum neuen Format */
export function neuerVideoName(name: string, mime: 'video/mp4' | 'video/webm'): string {
  const basis = name.replace(/\.[^.]+$/, '') || 'Video'
  return `${basis}.${mime === 'video/mp4' ? 'mp4' : 'webm'}`
}
