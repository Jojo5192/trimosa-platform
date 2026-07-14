'use client'

/**
 * Sticky section pills for the region pages with scroll-spy: the section
 * currently in view gets the gold highlight. Sticks right below the NavBar.
 */
import { useEffect, useState } from 'react'

export interface NavSection {
  id: string
  label: string
}

export default function SectionNav({ sections }: { sections: NavSection[] }) {
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    const targets = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => !!el)
    if (targets.length === 0) return

    // The section whose heading last crossed the upper viewport band wins.
    const pickActive = () => {
      let current: string | null = null
      for (const el of targets) {
        if (el.getBoundingClientRect().top <= 170) current = el.id
      }
      setActiveId(current)
    }
    pickActive()
    window.addEventListener('scroll', pickActive, { passive: true })
    window.addEventListener('resize', pickActive)
    return () => {
      window.removeEventListener('scroll', pickActive)
      window.removeEventListener('resize', pickActive)
    }
  }, [sections])

  return (
    <nav style={{
      position: 'sticky', top: '88px', zIndex: 30,
      margin: '0 -20px', padding: '10px 20px',
      background: 'rgba(245,245,247,0.92)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
      display: 'flex', gap: '8px', overflowX: 'auto', WebkitOverflowScrolling: 'touch',
    }}>
      {sections.map((sec) => {
        const active = activeId === sec.id
        return (
          <a key={sec.id} href={`#${sec.id}`} style={{
            flexShrink: 0, padding: '8px 15px', borderRadius: '999px', textDecoration: 'none',
            fontSize: '12.5px', fontWeight: 700,
            color: active ? '#fff' : '#3A3427',
            background: active ? 'linear-gradient(135deg, var(--gold), var(--gold-dark))' : '#fff',
            border: active ? '1px solid transparent' : '1px solid #E5E1D6',
            boxShadow: active ? '0 3px 12px rgba(168,136,42,0.35)' : '0 2px 8px rgba(0,0,0,0.05)',
            transition: 'all 0.2s',
          }}>{sec.label}</a>
        )
      })}
    </nav>
  )
}
