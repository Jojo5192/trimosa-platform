'use client'

import { useState } from 'react'
import Image from 'next/image'
import { darfNextImage } from '@/lib/image-proxy'
import Overlay from './Overlay'
import { t, type UiLang } from '@/lib/i18n'

/* ── 3. Floor Plan Section (multiple with labels) + Overlay ── */
export function FloorPlanSection({ urls, labels = [], lang = 'de' }: { urls: string[]; labels?: string[]; lang?: UiLang }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  if (urls.length === 0) return null
  return (
    <div style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '12px' }}>
        {urls.length === 1 ? t(lang, 'Grundriss') : t(lang, 'Grundrisse')}
      </h2>
      <div className="detail-floorplan-grid" style={{ display: 'grid', gridTemplateColumns: urls.length === 1 ? '1fr' : '1fr 1fr', gap: '12px' }}>
        {urls.map((url, i) => (
          <div key={i} onClick={() => setOpenIdx(i)} style={{ cursor: 'pointer', position: 'relative' }}>
            <div style={{ borderRadius: '14px', overflow: 'hidden', border: '1px solid #E5E5EA', background: '#fff', position: 'relative', aspectRatio: '3 / 2', maxHeight: '300px' }}>
              {/* next/image: 3000-px-Original als ≈ 400–800 px WebP statt 1 MB JPG je Grundriss (Audit 14.10.2026) */}
              {darfNextImage(url)
                ? <Image src={url} alt={labels[i] ? t(lang, labels[i]) : `${t(lang, 'Grundriss')} ${i + 1}`} fill
                    sizes={urls.length === 1 ? '(max-width: 768px) 100vw, 490px' : '(max-width: 768px) 100vw, 310px'} loading="lazy"
                    style={{ objectFit: 'contain' }} />
                // eslint-disable-next-line @next/next/no-img-element -- unbekannter Host
                : <img src={url} loading="lazy" alt={labels[i] ? t(lang, labels[i]) : `${t(lang, 'Grundriss')} ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
              <div style={{ position: 'absolute', bottom: '10px', right: '10px', background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: '11px', fontWeight: 600, padding: '5px 12px', borderRadius: '99px' }}>
                🔍 {t(lang, 'Vergrößern')}
              </div>
            </div>
            {labels[i] && (
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#6E6E73', marginTop: '6px', textAlign: 'center' }}>{t(lang, labels[i])}</div>
            )}
          </div>
        ))}
      </div>

      {openIdx !== null && (
        <Overlay onClose={() => setOpenIdx(null)} title={labels[openIdx] ? t(lang, labels[openIdx]) : (urls.length === 1 ? t(lang, 'Grundriss') : `${t(lang, 'Grundriss')} ${openIdx + 1}`)}>
          {darfNextImage(urls[openIdx])
            ? <Image src={urls[openIdx]} alt="Grundriss" width={1600} height={1100} sizes="(max-width: 640px) 100vw, 552px" style={{ width: '100%', height: 'auto', objectFit: 'contain', borderRadius: '8px' }} />
            // eslint-disable-next-line @next/next/no-img-element -- unbekannter Host
            : <img src={urls[openIdx]} alt="Grundriss" style={{ width: '100%', objectFit: 'contain', borderRadius: '8px' }} />}
          {urls.length > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '16px' }}>
              {urls.map((_, i) => (
                <button key={i} type="button" onClick={() => setOpenIdx(i)} style={{
                  padding: '6px 14px', borderRadius: '8px', border: i === openIdx ? '2px solid #1D1D1F' : '1px solid #E5E5EA',
                  background: i === openIdx ? '#F5F5F7' : '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: '#1D1D1F',
                }}>{labels[i] ? t(lang, labels[i]) : `${i + 1}`}</button>
              ))}
            </div>
          )}
        </Overlay>
      )}
    </div>
  )
}
