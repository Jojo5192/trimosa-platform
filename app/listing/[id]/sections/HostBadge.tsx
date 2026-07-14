'use client'

import Image from 'next/image'
import Link from 'next/link'
import { t, type UiLang } from '@/lib/i18n'

interface HostProfile {
  id: string
  display_name?: string
  avatar_url?: string
  bio?: string
  location?: string
  member_since?: string
  languages?: string[]
}

/* ── 1. Host Badge — the TRIMOSA host trio, links to "Über uns" ── */
const TEAM = [
  { name: 'Johannes', initials: 'JG' },
  { name: 'Pascal', initials: 'PJ' },
  { name: 'Dominik', initials: 'DP' },
]

export function HostBadge({ host, lang = 'de' }: { host: HostProfile; lang?: UiLang }) {
  return (
    <Link href="/ueber-uns" title="Mehr über TRIMOSA erfahren" className="listing-card" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 16px 8px 10px', borderRadius: '99px', backgroundColor: '#fff', border: '1px solid #E5E5EA', textDecoration: 'none', flexShrink: 0 }}>
      {/* Overlapping avatar stack: uploaded avatar for the primary host,
          gold initials for the others */}
      <div style={{ display: 'flex', flexShrink: 0 }}>
        {TEAM.map((m, i) => (
          <div key={m.initials} style={{
            position: 'relative', width: '32px', height: '32px', borderRadius: '50%', overflow: 'hidden',
            marginLeft: i === 0 ? 0 : '-10px', zIndex: 3 - i,
            border: '2px solid #fff', boxSizing: 'content-box',
            background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {i === 0 && host.avatar_url ? (
              <Image src={host.avatar_url} alt="" fill sizes="32px" style={{ objectFit: 'cover' }} />
            ) : (
              <span style={{ color: '#fff', fontSize: '11px', fontWeight: 700 }}>{m.initials}</span>
            )}
          </div>
        ))}
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: '13px', color: '#1D1D1F', lineHeight: 1.2 }}>Johannes, Pascal &amp; Dominik</div>
        <div style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--gold-dark)' }}>{t(lang, 'Deine Gastgeber · Über TRIMOSA →')}</div>
      </div>
    </Link>
  )
}
