'use client'

import { useSyncExternalStore } from 'react'
import { haptic } from '@/components/team/ux'
import {
  KOSTUEME, KOSTUEM_KEY, KOSTUEM_NAME, KOSTUEM_ANLASS, istKostuemWahl, wirksamesKostuem,
  type AssistentKostuem, type KostuemWahl,
} from '@/lib/assistent-logik'

/**
 * 🤖 Die Figur des KI-Assistenten „Claude" (Pascal, Chefsache 7.10.2026, Bereich 5):
 * freundliche Kugel in Marken-Gold mit Navy-Gesicht; zur Jahreszeit ein Accessoire
 * (Hasenohren · Strohhut · Hexenhut · Zipfelmütze · Partyhut). Auswahl je Gerät
 * unter Mehr → DARSTELLUNG → „Assistent-Kostüm" (Automatisch / fest / Aus).
 * Feste Farben statt Tokens: die Figur sieht in Hell und Dunkel gleich aus; alles,
 * was über den Kopf hinausragt, hat eine Kontur, die auf Weiß UND Dunkel trägt.
 */

const GOLD = '#AE8D2D'
const GOLD_HELL = '#C9A44A'
const GOLD_DUNKEL = '#8A7020'
const NAVY = '#12222E'

/* ── Auswahl je Gerät (localStorage, reaktiv über alle Instanzen) ── */

const KOSTUEM_EVENT = 'trimosa-assistent-kostuem'

export function getKostuemWahl(): KostuemWahl {
  try {
    const v = localStorage.getItem(KOSTUEM_KEY)
    return istKostuemWahl(v) ? v : 'auto'
  } catch { return 'auto' }
}

export function setKostuemWahl(wahl: KostuemWahl) {
  try { localStorage.setItem(KOSTUEM_KEY, wahl) } catch { /* privater Modus o. Ä. */ }
  try { window.dispatchEvent(new Event(KOSTUEM_EVENT)) } catch { /* SSR */ }
}

// Ein gemeinsamer Abonnent statt einer Uhr je Avatar; die Uhr zieht das
// Saison-Kostüm nach, wenn die App über einen Stichtag hinweg offen bleibt
const hoerer = new Set<() => void>()
let uhr: ReturnType<typeof setInterval> | null = null
function melde() { hoerer.forEach((f) => f()) }
function abonniere(cb: () => void) {
  hoerer.add(cb)
  if (hoerer.size === 1) {
    window.addEventListener(KOSTUEM_EVENT, melde)
    window.addEventListener('storage', melde)
    uhr = setInterval(melde, 15 * 60_000)
  }
  return () => {
    hoerer.delete(cb)
    if (!hoerer.size) {
      window.removeEventListener(KOSTUEM_EVENT, melde)
      window.removeEventListener('storage', melde)
      if (uhr) { clearInterval(uhr); uhr = null }
    }
  }
}

/** Gespeicherte Auswahl dieses Geräts (reaktiv) */
export function useKostuemWahl(): KostuemWahl {
  return useSyncExternalStore(abonniere, getKostuemWahl, () => 'auto' as KostuemWahl)
}

/** Kostüm, das die Figur gerade trägt (Saison nach Europe/Berlin bzw. fest gewählt; null = ohne) */
export function useAssistentKostuem(): AssistentKostuem | null {
  const v = useSyncExternalStore(
    abonniere,
    () => wirksamesKostuem(getKostuemWahl(), new Date()) ?? '',
    () => '',
  )
  return v ? (v as AssistentKostuem) : null
}

/* ── Figur ── */

function Kostuem({ k }: { k: AssistentKostuem }) {
  switch (k) {
    case 'ostern':
      return (
        <g>
          <ellipse cx="22.5" cy="11" rx="5" ry="10.5" transform="rotate(-14 22.5 11)" fill="#FBF6EA" stroke={GOLD_DUNKEL} strokeWidth="1.6" />
          <ellipse cx="22.5" cy="11.5" rx="2.3" ry="7" transform="rotate(-14 22.5 11.5)" fill="#F2A7B5" />
          <ellipse cx="41.5" cy="11" rx="5" ry="10.5" transform="rotate(14 41.5 11)" fill="#FBF6EA" stroke={GOLD_DUNKEL} strokeWidth="1.6" />
          <ellipse cx="41.5" cy="11.5" rx="2.3" ry="7" transform="rotate(14 41.5 11.5)" fill="#F2A7B5" />
        </g>
      )
    case 'sommer':
      return (
        <g>
          <ellipse cx="32" cy="17.5" rx="25.5" ry="5.4" fill="#E9C46A" stroke="#9C7A1E" strokeWidth="1.4" />
          <path d="M19 17.5 C19 5.5, 45 5.5, 45 17.5 Z" fill="#EFCF7C" stroke="#9C7A1E" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M19.4 13.6 C26 15.4, 38 15.4, 44.6 13.6 L45 16.6 C38 18.4, 26 18.4, 19 16.6 Z" fill="#2F8F9D" />
        </g>
      )
    case 'halloween':
      return (
        <g>
          <ellipse cx="32" cy="17.5" rx="22.5" ry="4.6" fill="#4A3A78" stroke="#A08FD6" strokeWidth="1.3" />
          <path d="M20.5 17 L30 3.5 Q32.6 -0.4 37.6 0.8 Q34.8 3 35.6 6.4 L43.5 17 Z" fill="#4A3A78" stroke="#A08FD6" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M22.2 14.4 L41.8 14.4 L43.2 16.8 L20.8 16.8 Z" fill="#E07A1F" />
        </g>
      )
    case 'advent':
      return (
        <g>
          <path d="M13 21 C15 9, 27 2.5, 38 3 C47 3.6, 54 10, 57 18.5 L53.8 19.6 C51 13.5, 47 10.4, 43 10.2 C46 13.4, 49 17, 51 21 Z" fill="#C8102E" stroke="#8E0B20" strokeWidth="1" strokeLinejoin="round" />
          <path d="M11 21.5 Q32 13.5 53 21.5 L53 26 Q32 18 11 26 Z" fill="#FFFFFF" stroke="#C9C2B4" strokeWidth="1" />
          <circle cx="56" cy="20.5" r="4.4" fill="#FFFFFF" stroke="#C9C2B4" strokeWidth="1" />
        </g>
      )
    case 'silvester':
      return (
        <g transform="translate(0 2) rotate(12 34 18) translate(34 18) scale(1.2) translate(-34 -18)">
          <path d="M23 18.5 L34 3 L45 18.5 Z" fill="#E4572E" stroke="#A83A1A" strokeWidth="1.1" strokeLinejoin="round" />
          <path d="M30.4 8 L37.6 8 L39.4 10.6 L28.6 10.6 Z" fill="#FFD23F" />
          <path d="M26.7 13.2 L41.3 13.2 L43.1 15.8 L24.9 15.8 Z" fill="#FFD23F" />
          <circle cx="34" cy="3" r="3.2" fill="#FFD23F" stroke="#B8860B" strokeWidth="1" />
          <circle cx="14" cy="9" r="1.5" fill="#2BB3A3" />
          <circle cx="52" cy="6" r="1.3" fill="#7B5CD6" />
          <circle cx="18" cy="2.5" r="1.1" fill="#FFD23F" />
        </g>
      )
  }
}

/**
 * Avatar der Figur. `kostuem` weglassen = aktuelles Kostüm dieses Geräts;
 * `null` = bewusst ohne (z. B. Vorschau „Aus").
 */
export function AssistentAvatar({ size = 34, kostuem, titel }: {
  size?: number
  kostuem?: AssistentKostuem | null
  /** zugänglicher Name; ohne Titel ist die Figur dekorativ (Name steht daneben) */
  titel?: string
}) {
  const aktuell = useAssistentKostuem()
  const k = kostuem === undefined ? aktuell : kostuem
  return (
    <svg
      width={size} height={size} viewBox="0 0 64 64"
      role={titel ? 'img' : undefined} aria-label={titel} aria-hidden={titel ? undefined : true}
      style={{ flexShrink: 0, overflow: 'visible', display: 'block' }}
    >
      {/* Antenne nur ohne Kostüm (Hüte sitzen an derselben Stelle) */}
      {!k && (
        <g>
          <line x1="32" y1="16" x2="32" y2="8.5" stroke={GOLD_DUNKEL} strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="32" cy="6.5" r="3.6" fill="#F3DE9A" stroke={GOLD_DUNKEL} strokeWidth="1.6" />
        </g>
      )}
      {/* Körper */}
      <circle cx="32" cy="38.5" r="23" fill={GOLD} />
      <ellipse cx="24" cy="27.5" rx="10.5" ry="6.5" fill={GOLD_HELL} opacity="0.6" />
      {/* Gesicht */}
      <ellipse cx="19" cy="45" rx="3.6" ry="2.3" fill="#E9967A" opacity="0.6" />
      <ellipse cx="45" cy="45" rx="3.6" ry="2.3" fill="#E9967A" opacity="0.6" />
      <ellipse cx="24.5" cy="37.5" rx="3.5" ry="4.3" fill={NAVY} />
      <ellipse cx="39.5" cy="37.5" rx="3.5" ry="4.3" fill={NAVY} />
      <circle cx="25.7" cy="35.8" r="1.3" fill="#FFFFFF" />
      <circle cx="40.7" cy="35.8" r="1.3" fill="#FFFFFF" />
      <path d="M25 46.5 Q32 53 39 46.5" fill="none" stroke={NAVY} strokeWidth="2.7" strokeLinecap="round" />
      {k && <Kostuem k={k} />}
    </svg>
  )
}

/* ── Einstellung: Mehr → DARSTELLUNG → „Assistent-Kostüm" ── */

const WAHL_SELECT: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, padding: '6px 8px', borderRadius: 10, flexShrink: 0, maxWidth: 150,
  border: '0.5px solid var(--tm-line)', background: 'var(--tm-card)', color: 'var(--tm-text)',
}

export function AssistentKostuemWahl({ style }: { style?: React.CSSProperties }) {
  const wahl = useKostuemWahl()
  const k = useAssistentKostuem()
  const hinweis = wahl === 'aus' ? 'Ohne Kostüm'
    : wahl === 'auto'
      ? (k ? `Nach Jahreszeit – gerade ${KOSTUEM_NAME[k]} (${KOSTUEM_ANLASS[k]})` : 'Nach Jahreszeit – gerade ohne')
      : `Immer ${KOSTUEM_NAME[wahl]}`
  return (
    <div className="tm-card" style={{ padding: '12px 16px', marginBottom: 22, display: 'flex', alignItems: 'center', gap: 12, ...style }}>
      <AssistentAvatar size={34} kostuem={k} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--tm-text)' }}>Assistent-Kostüm</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--tm-muted)', marginTop: 1, lineHeight: 1.4 }}>{hinweis}</span>
      </span>
      <select
        aria-label="Assistent-Kostüm"
        value={wahl}
        onChange={(e) => { haptic(); setKostuemWahl(e.target.value as KostuemWahl) }}
        style={WAHL_SELECT}
      >
        <option value="auto">Automatisch</option>
        {KOSTUEME.map((x) => <option key={x} value={x}>{KOSTUEM_NAME[x]}</option>)}
        <option value="aus">Aus</option>
      </select>
    </div>
  )
}
