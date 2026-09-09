'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  COOKIE_ACTIVE, COOKIE_CURTAIN, COOKIE_SPRUCH, cookieFor, curtainDueOnReturn, greetingFor, pickSpruch, pushSpruchHistory, type Spruch,
} from '@/lib/start-curtain'

/**
 * 🎬 Start-Vorhang (Pascal, Chefsache 8.9.2026 — §281): Vollbild-Begrüßung
 * ~6 s beim Öffnen der Team-App. Der Server (app/team/page.tsx) rendert ihn
 * schon ins HTML (kein Aufblitzen der App), die Ebenen laufen als reine CSS-
 * Animationen (app/globals.css, .tm-curtain), die App lädt dahinter weiter.
 * Ausblenden nach 6 s (Deckkraft → 0, scale 1.03, 0,8 s, Vibration 6 ms),
 * Notbremse 11 s, Tipp ab 1,5 s beendet ihn früher. Rückkehr aus dem
 * Hintergrund nach ≥ 4 h oder am neuen Tag zeigt ihn erneut (Client).
 * Reduced Motion: statisch, 3 s.
 */

type Shown = { greeting: string; spruch: Spruch }

function setCookie(name: string, value: string) {
  try {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
  } catch { /* egal */ }
}
function getCookie(name: string): string | null {
  try {
    const m = document.cookie.split('; ').find((c) => c.startsWith(name + '='))
    return m ? decodeURIComponent(m.slice(name.length + 1)) : null
  } catch { return null }
}

const LETTERS = ['T', 'R', 'I', 'M', 'O', 'S', 'A']

export default function StartCurtain({ initialShow, firstName, initialGreeting, initialSpruch, userId }: {
  initialShow: boolean
  firstName: string | null
  initialGreeting: string
  initialSpruch: Spruch
  /** Cookies je Benutzer und Gerät (Pascal 9.9.) */
  userId: string
}) {
  const cActive = cookieFor(COOKIE_ACTIVE, userId)
  const cCurtain = cookieFor(COOKIE_CURTAIN, userId)
  const cSpruch = cookieFor(COOKIE_SPRUCH, userId)
  const touchActive = () => setCookie(cActive, String(Date.now()))
  const [shown, setShown] = useState<Shown | null>(initialShow ? { greeting: initialGreeting, spruch: initialSpruch } : null)
  const [leaving, setLeaving] = useState(false)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startedAt = useRef(0)

  const leave = useCallback(() => {
    setLeaving((l) => {
      if (l) return l
      try { (navigator as Navigator & { vibrate?: (n: number) => boolean }).vibrate?.(6) } catch { /* egal */ }
      leaveTimer.current = setTimeout(() => { setShown(null); setLeaving(false) }, 820)
      return true
    })
  }, [])

  // Lauf: Cookies (zuletzt gezeigt + Spruch), Ausblenden nach 6 s, Notbremse 11 s
  useEffect(() => {
    if (!shown) return
    startedAt.current = Date.now()
    setCookie(cCurtain, String(Date.now()))
    setCookie(cSpruch, pushSpruchHistory(getCookie(cSpruch), shown.spruch.id))
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    const t1 = setTimeout(leave, reduce ? 3000 : 6000)
    const t2 = setTimeout(() => { setShown(null); setLeaving(false) }, 11000)
    return () => { clearTimeout(t1); clearTimeout(t2); if (leaveTimer.current) clearTimeout(leaveTimer.current) }
  }, [shown, leave])

  // „Zuletzt aktiv" alle 60 s + beim Ausblenden merken; Rückkehr prüfen
  useEffect(() => {
    touchActive()
    const iv = setInterval(() => { if (document.visibilityState === 'visible') touchActive() }, 60_000)
    const onVis = () => {
      if (document.visibilityState === 'hidden') { touchActive(); return }
      const lastActive = Number(getCookie(cActive) ?? 0) || null
      const lastCurtain = Number(getCookie(cCurtain) ?? 0) || null
      if (curtainDueOnReturn(lastActive, lastCurtain)) {
        const now = new Date()
        setLeaving(false)
        setShown({ greeting: greetingFor(now, firstName), spruch: pickSpruch(now, getCookie(cSpruch)) })
      }
      touchActive()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', touchActive)
    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', touchActive)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstName, userId])

  if (!shown) return null
  const words = shown.spruch.text.split(' ')

  return (
    <div
      className={`tm-curtain${leaving ? ' is-leaving' : ''}`}
      role="presentation"
      onClick={() => { if (Date.now() - startedAt.current > 1500) leave() }}
    >
      {/* 1 Lichtkreise · 2 Gitter · 3 Leuchtender Rand · 4 Halo */}
      <div className="c-orb o1" /><div className="c-orb o2" /><div className="c-orb o3" />
      <div className="c-grid" />
      <div className="c-edge glow" /><div className="c-edge sharp" />
      <div className="c-halo" />

      <div className="c-center">
        {/* 5 Wortmarke: Symbol (Kontur zeichnet sich, pulst danach) + Buchstaben aus der Unschärfe */}
        <div className="c-mark">
          <span className="c-logo" aria-hidden="true">
            <svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" /></svg>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.png" alt="" />
          </span>
          <span className="c-word" aria-label="TRIMOSA">
            {LETTERS.map((ch, i) => <span key={i} style={{ animationDelay: `${0.25 + i * 0.15}s` }}>{ch}</span>)}
          </span>
        </div>
        {/* 6 Akzent-Strich */}
        <div className="c-line" />
        {/* 7 Begrüßung + 8 Spruch */}
        <p className="c-greet"><span className="shimmer">{shown.greeting}</span></p>
        <p className="c-say" aria-label={shown.spruch.text}>
          {words.map((w, i) => <span key={i} style={{ animationDelay: `${3.3 + i * 0.16}s` }}>{w}</span>)}
        </p>
      </div>

      {/* 9 Punkte */}
      <div className="c-dots" aria-hidden="true"><i /><i /><i /></div>
    </div>
  )
}
