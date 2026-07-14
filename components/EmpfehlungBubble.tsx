/**
 * Speech-bubble display for the hosts' personal recommendations: round face
 * with a gold ring + bubble with the comment. Works in server AND client
 * components (no hooks). `dark` tunes it for the navy Kulinarik panel,
 * default is for light card backgrounds.
 */
import Image from 'next/image'
import type { EmpfehlungView } from '@/lib/empfehlungen'
import { t, type UiLang } from '@/lib/i18n'

function Face({ e, size = 30 }: { e: EmpfehlungView; size?: number }) {
  return (
    <span style={{
      position: 'relative', width: `${size}px`, height: `${size}px`, borderRadius: '50%',
      flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))',
      boxShadow: '0 0 0 2px #E6C15A, 0 2px 8px rgba(0,0,0,0.25)',
      color: '#fff', fontSize: `${size * 0.42}px`, fontWeight: 800,
    }}>
      {e.avatarUrl
        ? <Image src={e.avatarUrl} alt={e.name} fill sizes="64px" style={{ objectFit: 'cover' }} />
        : e.name.charAt(0).toUpperCase()}
    </span>
  )
}

export default function EmpfehlungBubble({ empfehlungen, dark = false, lang = 'de' }: { empfehlungen: EmpfehlungView[]; dark?: boolean; lang?: UiLang }) {
  if (!empfehlungen || empfehlungen.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {empfehlungen.map((e) => (
        <div key={e.name + e.comment.slice(0, 16)} style={{ display: 'flex', alignItems: 'flex-start', gap: '9px' }}>
          <Face e={e} />
          <div style={{
            position: 'relative', flex: 1, minWidth: 0,
            borderRadius: '4px 14px 14px 14px', padding: '9px 12px 9px',
            background: dark ? 'rgba(230,193,90,0.13)' : '#FBF6E9',
            border: dark ? '1px solid rgba(230,193,90,0.35)' : '1px solid #EBDCB2',
          }}>
            <p style={{
              fontSize: '10px', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase',
              color: dark ? '#E6C15A' : 'var(--gold-dark)', margin: '0 0 3px',
            }}>
              {e.name} {t(lang, 'empfiehlt')}
            </p>
            <p style={{
              fontSize: '12.5px', fontStyle: 'italic', lineHeight: 1.55, margin: 0,
              color: dark ? 'rgba(255,255,255,0.85)' : '#4A4232',
            }}>
              „{e.comment}“
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
