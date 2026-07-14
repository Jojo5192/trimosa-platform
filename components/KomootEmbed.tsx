'use client'

/**
 * Two-click Komoot tour embed: shows a local placeholder card first and only
 * creates the iframe (= the first request to komoot.com) after the visitor
 * explicitly opts in. Keeps the page free of third-party requests by default.
 */
import { useState } from 'react'

interface Props {
  title: string
  embedUrl: string
  lang?: UiLang
}

export default function KomootEmbed({ title, embedUrl, lang = 'de' }: Props) {
  const [loaded, setLoaded] = useState(false)

  if (loaded) {
    return (
      <div style={{ borderRadius: '16px', overflow: 'hidden', border: '1px solid #E0DDD6', background: '#fff' }}>
        <iframe
          src={embedUrl}
          title={`Komoot-Tour: ${title}`}
          loading="lazy"
          style={{ display: 'block', width: '100%', height: 'clamp(340px, 50vh, 480px)', border: 0 }}
          allow="fullscreen"
        />
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setLoaded(true)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px',
        width: '100%', minHeight: '190px', padding: '26px 20px', cursor: 'pointer',
        borderRadius: '16px', border: '1.5px dashed #C9C3B4',
        background: 'linear-gradient(135deg, #12222E, #1E3A4C)', textAlign: 'center',
      }}
    >
      <span style={{ fontSize: '30px', lineHeight: 1 }}>🚴</span>
      <span style={{ fontSize: '15px', fontWeight: 700, color: '#fff' }}>{title}</span>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '12.5px', fontWeight: 700,
        color: '#1A1400', background: 'linear-gradient(135deg, var(--gold), #E3C878)',
        padding: '9px 18px', borderRadius: '999px',
      }}>{t(lang, 'Tour laden →')}</span>
      <span style={{ fontSize: '10.5px', color: 'rgba(255,255,255,0.55)', maxWidth: '340px', lineHeight: 1.5 }}>
        {t(lang, 'Beim Laden werden Inhalte von komoot.com nachgeladen und dabei deine IP-Adresse an Komoot übermittelt.')}
      </span>
    </button>
  )
}
