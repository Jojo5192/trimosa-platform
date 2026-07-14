'use client'

/**
 * Site-wide language picker (flag button + dropdown) in the NavBar.
 * Writes the 'uilang' cookie and reloads so server components re-render
 * in the chosen language.
 */
import { useEffect, useRef, useState } from 'react'
import { UI_COOKIE, UI_LANGS, UI_LANG_META, isUiLang, type UiLang } from '@/lib/i18n'

export default function LangSwitcher({ lang = 'de', compact = false }: { lang?: UiLang; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [cur, setCur] = useState<UiLang>(lang)
  const ref = useRef<HTMLDivElement>(null)

  // Pages that don't pass `lang` still show the real cookie choice
  useEffect(() => {
    const m = document.cookie.match(/(?:^|; )uilang=([a-z]{2})/)
    if (m && isUiLang(m[1])) setCur(m[1])
  }, [])

  useEffect(() => {
    if (!open) return
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [open])

  function choose(l: UiLang) {
    document.cookie = `${UI_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`
    setOpen(false)
    window.location.reload()
  }

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label="Sprache wählen"
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          height: compact ? 34 : 40, padding: compact ? '0 8px' : '0 11px',
          borderRadius: 999, border: '1px solid #E5E5EA', background: '#fff',
          cursor: 'pointer', fontSize: compact ? 15 : 16, lineHeight: 1,
        }}
      >
        <span aria-hidden>{UI_LANG_META[cur].flag}</span>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#98938A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 200,
          background: '#fff', borderRadius: 14, border: '1px solid #ECEAE4',
          boxShadow: '0 10px 34px rgba(0,0,0,0.14)', padding: 6, minWidth: 168,
        }}>
          {UI_LANGS.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => choose(l)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '9px 12px', borderRadius: 9, border: 'none', textAlign: 'left',
                background: l === cur ? '#FAF5E4' : 'transparent', cursor: 'pointer',
                fontSize: 14, fontWeight: l === cur ? 700 : 500,
                color: l === cur ? 'var(--gold-dark)' : '#1D1D1F',
              }}
            >
              <span style={{ fontSize: 17 }}>{UI_LANG_META[l].flag}</span>
              {UI_LANG_META[l].label}
              {l === cur && <span style={{ marginLeft: 'auto', color: 'var(--gold)' }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
