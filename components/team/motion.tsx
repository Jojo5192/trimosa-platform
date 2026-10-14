'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { flushSync } from 'react-dom'

/**
 * 🎬 Bewegungs-Bausteine der Team-App (Pascal, Chefsache 6.10.2026: „bitte die gesamte App mit einem
 * premium motion Design ausstatten"). Ruhig, kurz, Apple-Anmutung — nie verspielt oder langsam.
 * CSS dazu: Abschnitt „🎬 Motion" in app/globals.css (Tokens --tm-dur-s/-m/-l, --tm-ease, --tm-spring).
 *  · useSheetMotion  — Blätter/Overlays: federnd herein, beim Schließen kurz hinaus (statt hart weg)
 *  · heroTransition  — Karte → Chat: Avatar + Name fliegen in die Kopfleiste (View Transitions)
 *  · useFlipList     — Listen rücken weich nach, wenn ein Eintrag verschwindet oder umsortiert wird
 *  · ToastStack      — Toasts weich herein/heraus, gestapelt ohne Springen
 * Alles respektiert „Bewegung reduzieren": dann sofort, ohne Animation.
 */

/** Dauern in ms — identisch mit --tm-dur-s/-m/-l in globals.css */
export const MOTION = { s: 160, m: 240, l: 380 } as const
/** „Feder" (leichtes Überschwingen, ~2 %) — identisch mit --tm-spring */
export const SPRING = 'cubic-bezier(0.3, 1.25, 0.5, 1)'

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/* ═══════════════ Blätter / Overlays ═══════════════ */

/**
 * Schließen mit Ausblend-Animation: `close()` statt `onClose` an ✕/Hintergrund/Zurück hängen, `hostProps`
 * auf die Portal-Wurzel spreizen. Die Wurzel bekommt dann data-tm-leaving, die CSS-Klassen
 * (.tm-mo-scrim/-sheet/-screen/-fade/-pop) spielen die Ausblendung, und onClose läuft erst danach.
 * Bei „Bewegung reduzieren" ruft close() onClose sofort. Logik/Datenfluss der Komponente bleiben gleich —
 * nur der Zeitpunkt, zu dem sie aus dem Baum fällt, rückt um eine kurze Animation nach hinten.
 * Fällt das Blatt während der Ausblendung aus anderem Grund aus dem Baum (z. B. Ansichtswechsel), läuft
 * onClose sofort beim Aushängen — ein angefordertes Schließen geht nie verloren.
 */
export function useSheetMotion(onClose: () => void, exitMs: number = MOTION.m) {
  const [leaving, setLeaving] = useState(false)
  const closeRef = useRef(onClose)
  useLayoutEffect(() => { closeRef.current = onClose })
  const leavingRef = useRef(false)
  const offenRef = useRef(false) // Schließen angefordert, onClose aber noch nicht gelaufen
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => {
    timers.current.forEach(clearTimeout)
    if (offenRef.current) { offenRef.current = false; closeRef.current() }
  }, [])

  const close = useCallback(() => {
    if (leavingRef.current) return
    if (prefersReducedMotion()) { closeRef.current(); return }
    leavingRef.current = true
    offenRef.current = true
    setLeaving(true)
    timers.current.push(setTimeout(() => {
      offenRef.current = false
      closeRef.current()
      // Sicherheitsnetz: hängt die Eltern-Komponente das Blatt NICHT aus, wird es wieder sichtbar
      timers.current.push(setTimeout(() => { leavingRef.current = false; setLeaving(false) }, 120))
    }, exitMs))
  }, [exitMs])

  return {
    close,
    leaving,
    hostProps: { 'data-tm-leaving': leaving ? 'true' : undefined } as { 'data-tm-leaving'?: string },
  }
}

/* ═══════════════ Hero-Übergang Karte ↔ Chat ═══════════════ */

type ViewTransitionLike = { ready: Promise<void>; finished: Promise<void>; updateCallbackDone: Promise<void> }
type DocVT = Document & { startViewTransition?: (cb: () => void) => ViewTransitionLike }

const HERO_TEILE = [['av', 'data-hero-av'], ['name', 'data-hero-name']] as const

/** Attribute für Avatar und Name — in der Listen-Karte UND in der Kopfleiste des Chats setzen.
 *  key eindeutig je Chat (z. B. `g-${id}` Gäste, `i-${id}` Intern). */
export function heroAv(key: string) { return { 'data-hero-av': key } }
export function heroName(key: string) { return { 'data-hero-name': key } }

/**
 * 🦸 Hero-Übergang (View-Transitions-API): Avatar + Name fliegen von der Karte in die Kopfleiste und
 * zurück. Die view-transition-names werden NUR während des Übergangs gesetzt (je Chat eindeutig);
 * ohne API-Unterstützung oder bei „Bewegung reduzieren" läuft update() einfach direkt.
 * update() wird per flushSync synchron gerendert, damit der neue Zustand im selben Bild erfasst wird.
 */
export function heroTransition(key: string, update: () => void): void {
  const doc = (typeof document !== 'undefined' ? document : null) as DocVT | null
  if (!doc || typeof doc.startViewTransition !== 'function' || prefersReducedMotion()) { update(); return }
  const sicher = key.replace(/[^a-zA-Z0-9_-]/g, '_')
  const sel = (attr: string) => `[${attr}="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(key) : key}"]`
  const markieren = () => {
    for (const [teil, attr] of HERO_TEILE) {
      // nur sichtbare Elemente (ausgeblendete Kopien hätten doppelte Namen → Übergang fiele aus)
      const el = Array.from(doc.querySelectorAll<HTMLElement>(sel(attr))).find((n) => n.getClientRects().length > 0)
      if (!el) continue
      el.style.setProperty('view-transition-name', `tm-hero-${teil}-${sicher}`)
      el.style.setProperty('view-transition-class', `tm-hero-${teil}`)
    }
  }
  const loesen = () => {
    doc.querySelectorAll<HTMLElement>('[data-hero-av], [data-hero-name]').forEach((n) => {
      n.style.removeProperty('view-transition-name')
      n.style.removeProperty('view-transition-class')
    })
  }
  const root = doc.documentElement
  markieren()
  root.classList.add('tm-hero-vt')
  let vt: ViewTransitionLike
  try {
    vt = doc.startViewTransition(() => {
      loesen()
      flushSync(update)
      markieren()
    })
  } catch {
    loesen(); root.classList.remove('tm-hero-vt')
    update()
    return
  }
  const aufraeumen = () => { loesen(); root.classList.remove('tm-hero-vt') }
  vt.ready.catch(() => { /* übersprungen (z. B. doppelte Namen) — update lief trotzdem */ })
  vt.updateCallbackDone.catch(() => { /* Fehler im update — Komponente meldet selbst */ })
  vt.finished.then(aufraeumen, aufraeumen)
}

/* ═══════════════ Listen rücken weich nach (FLIP) ═══════════════ */

const STANDARD_KEY = (el: HTMLElement) => el.getAttribute('data-flip-key')

/**
 * 📋 FLIP für Listen: Verschwindet ein Eintrag (erledigt, gewischt, gefiltert) oder ändert sich die
 * Reihenfolge, gleiten die übrigen direkten Kinder von `ref` von ihrer alten an die neue Stelle, statt zu
 * springen. Nur transform (GPU), nur sichtbare Einträge, nicht bei „Bewegung reduzieren", nicht wenn
 * die Liste ausgeblendet ist oder sich fast komplett austauscht (Filterwechsel).
 * keyOf liefert den Schlüssel eines Kindes (Standard: data-flip-key); Kinder ohne Schlüssel bleiben außen vor.
 */
export function useFlipList(ref: RefObject<HTMLElement | null>, keyOf: (el: HTMLElement) => string | null = STANDARD_KEY) {
  const keyRef = useRef(keyOf)
  useLayoutEffect(() => { keyRef.current = keyOf })
  const st = useRef<{
    box: HTMLElement | null
    pos: Map<string, number>
    knoten: Map<string, HTMLElement>
    ro: ResizeObserver | null
    laeufe: WeakMap<HTMLElement, Animation>
  }>({ box: null, pos: new Map(), knoten: new Map(), ro: null, laeufe: new WeakMap() })

  // nach JEDEM Render: vorher/nachher vergleichen (läuft vor dem Zeichnen)
  useLayoutEffect(() => {
    const s = st.current
    const box = ref.current
    if (box !== s.box) {
      s.ro?.disconnect()
      s.ro = null
      s.pos = new Map()
      s.knoten = new Map()
      s.box = box
    }
    if (!box) return

    const messen = () => {
      const m = new Map<string, { el: HTMLElement; top: number }>()
      // ausgeblendet (Reiter/Segment mit display:none) → keine verwertbaren Positionen
      if (!box.getClientRects().length) return m
      for (const kind of Array.from(box.children) as HTMLElement[]) {
        const k = keyRef.current(kind)
        if (!k || m.has(k)) continue
        // offsetTop ignoriert transforms und Scrollen — also die echte Layout-Position
        const top = kind.offsetTop - (kind.offsetParent === box ? 0 : box.offsetTop)
        m.set(k, { el: kind, top })
      }
      return m
    }
    const jetzt = messen()
    const vorher = s.pos

    if (vorher.size && jetzt.size && !prefersReducedMotion()) {
      const vorherKeys = Array.from(vorher.keys())
      const jetztKeys = Array.from(jetzt.keys())
      const gemeinsam = jetztKeys.filter((k) => vorher.has(k))
      const mengeAnders = gemeinsam.length !== jetztKeys.length || gemeinsam.length !== vorherKeys.length
      const altReihe = vorherKeys.filter((k) => jetzt.has(k))
      const reiheAnders = gemeinsam.some((k, i) => altReihe[i] !== k)
      // Filterwechsel/Neuaufbau (weniger als die Hälfte bleibt) → nicht animieren
      const genugGleich = gemeinsam.length >= Math.min(vorherKeys.length, jetztKeys.length) * 0.5
      if ((mengeAnders || reiheAnders) && gemeinsam.length && genugGleich) {
        const hoehe = window.innerHeight
        for (const k of gemeinsam) {
          const { el, top } = jetzt.get(k)!
          let dy = vorher.get(k)! - top
          const lauf = s.laeufe.get(el)
          if (lauf && lauf.playState === 'running') {
            // läuft noch eine Bewegung: von der aktuell SICHTBAREN Stelle weiter (kein Ruck)
            try { dy += new DOMMatrixReadOnly(getComputedStyle(el).transform).m42 } catch { /* egal */ }
            lauf.cancel()
          }
          if (Math.abs(dy) < 1 || Math.abs(dy) > 1600) continue
          const r = el.getBoundingClientRect()
          if (r.bottom + Math.max(0, dy) < -80 || r.top + Math.min(0, dy) > hoehe + 80) continue
          if (typeof el.animate !== 'function') continue
          s.laeufe.set(el, el.animate(
            [{ transform: `translate3d(0, ${dy}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
            { duration: MOTION.l, easing: SPRING },
          ))
        }
      }
    }

    s.pos = new Map(Array.from(jetzt, ([k, v]) => [k, v.top]))
    // Größenänderungen ohne Render (Fotos laden, Kommentare klappen auf) → Positionen still nachführen
    if (!s.ro && typeof ResizeObserver !== 'undefined') {
      s.ro = new ResizeObserver(() => {
        const cur = st.current
        if (cur.box !== box) return
        if (!box.getClientRects().length) { cur.pos = new Map(); return }
        const neu = new Map<string, number>()
        for (const kind of Array.from(box.children) as HTMLElement[]) {
          const k = keyRef.current(kind)
          if (!k || neu.has(k)) continue
          neu.set(k, kind.offsetTop - (kind.offsetParent === box ? 0 : box.offsetTop))
        }
        cur.pos = neu
      })
      s.ro.observe(box)
    }
    if (s.ro) {
      for (const [k, el] of s.knoten) if (jetzt.get(k)?.el !== el) { s.ro.unobserve(el); s.knoten.delete(k) }
      for (const [k, { el }] of jetzt) if (!s.knoten.has(k)) { s.ro.observe(el); s.knoten.set(k, el) }
    }
  })

  useEffect(() => () => { st.current.ro?.disconnect() }, [])
}

/* ═══════════════ Toasts ═══════════════ */

type ToastItem = { id: number; text: string; leaving: boolean }
const TOAST_MS = 2000
const TOAST_MAX = 3
const TOAST_GAP = 8

/**
 * 🍞 Toast-Stapel (Host für tmToast aus ux.tsx — EINMAL in der TeamShell rendern): neue Toasts federn
 * von unten herein, ältere rücken weich nach oben (max. 3), jeder geht nach 2 s mit kurzer Ausblendung.
 * Gleicher Text direkt hintereinander → kein zweiter Toast, nur die Zeit beginnt neu.
 * Rein visuell (aria-hidden): angesagt werden Toasts über die Live-Region des BedienhilfenHost (ux.tsx).
 */
export function ToastStack({ bottom, zIndex = 60 }: { bottom: string; zIndex?: number }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const wraps = useRef(new Map<number, HTMLDivElement>())
  const pills = useRef(new Map<number, HTMLDivElement>())

  useEffect(() => {
    // Die Liste lebt hier (Quelle), der State ist nur ihr Abbild fürs Rendern — so bleiben die
    // Zustands-Updates frei von Nebenwirkungen (Timer)
    let liste: ToastItem[] = []
    let seq = 0
    const timer = new Map<number, ReturnType<typeof setTimeout>>()
    const raus: ReturnType<typeof setTimeout>[] = []
    const setzen = (next: ToastItem[]) => { liste = next; setItems(next) }
    const ausblenden = (id: number) => {
      const t = timer.get(id)
      if (t) clearTimeout(t)
      timer.delete(id)
      setzen(liste.map((x) => (x.id === id ? { ...x, leaving: true } : x)))
      raus.push(setTimeout(() => setzen(liste.filter((x) => x.id !== id)), prefersReducedMotion() ? 0 : MOTION.m))
    }
    const planen = (id: number) => {
      const alt = timer.get(id)
      if (alt) clearTimeout(alt)
      timer.set(id, setTimeout(() => ausblenden(id), TOAST_MS))
    }
    const onToast = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text
      if (!text) return
      const lebend = liste.filter((x) => !x.leaving)
      const letzter = lebend[lebend.length - 1]
      if (letzter && letzter.text === text) { planen(letzter.id); return }
      const id = ++seq
      setzen([...liste, { id, text, leaving: false }])
      planen(id)
      // mehr als 3 sichtbar → die älteste geht sofort (mit Ausblendung)
      lebend.slice(0, Math.max(0, lebend.length + 1 - TOAST_MAX)).forEach((x) => ausblenden(x.id))
    }
    window.addEventListener('trimosa-toast', onToast)
    return () => {
      window.removeEventListener('trimosa-toast', onToast)
      timer.forEach(clearTimeout)
      raus.forEach(clearTimeout)
    }
  }, [])

  // Stapel-Versatz direkt am DOM (vor dem Zeichnen): neuester unten, ältere darüber; die Bewegung
  // übernimmt die CSS-Transition der Hülle — dadurch springt nichts, wenn einer kommt oder geht.
  // Gehende zählen mit (sie sind die ältesten, also oben): so rücken sie beim Ausblenden mit hoch,
  // statt von einem nachrückenden überdeckt zu werden, und ihr Wegfall verschiebt niemanden.
  useLayoutEffect(() => {
    let versatz = 0
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      const w = wraps.current.get(it.id)
      const p = pills.current.get(it.id)
      if (!w || !p) continue
      w.style.transform = `translate3d(0, ${-versatz}px, 0)`
      versatz += p.offsetHeight + TOAST_GAP
    }
  }, [items])

  return (
    <div aria-hidden="true" className="tm-toast-stack" style={{ position: 'absolute', left: 0, right: 0, bottom, zIndex, height: 0, pointerEvents: 'none' }}>
      {items.map((it) => (
        <div key={it.id} className="tm-toast-wrap"
          ref={(el) => { if (el) wraps.current.set(it.id, el); else wraps.current.delete(it.id) }}>
          <div className={`tm-toast-pill${it.leaving ? ' is-leaving' : ''}`}
            ref={(el) => { if (el) pills.current.set(it.id, el); else pills.current.delete(it.id) }}
            style={{
              background: 'var(--tm-text)', color: 'var(--tm-bg)', fontSize: 13, fontWeight: 600,
              borderRadius: 18, padding: '10px 16px', boxShadow: 'var(--tm-shadow-float)',
              // bis zu 2 Zeilen statt abgeschnitten („Vorlage … eingefügt — bitte prüfen und senden")
              width: 'max-content', maxWidth: '100%', boxSizing: 'border-box', textAlign: 'center', lineHeight: 1.35,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>{it.text}</div>
        </div>
      ))}
    </div>
  )
}
