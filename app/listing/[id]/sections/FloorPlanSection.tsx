'use client'

import Overlay from './Overlay'

/* ── 3. Floor Plan Section (multiple with labels) + Overlay ── */
export function FloorPlanSection({ urls, labels = [] }: { urls: string[]; labels?: string[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  if (urls.length === 0) return null
  return (
    <div style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '12px' }}>
        {urls.length === 1 ? 'Grundriss' : 'Grundrisse'}
      </h2>
      <div className="detail-floorplan-grid" style={{ display: 'grid', gridTemplateColumns: urls.length === 1 ? '1fr' : '1fr 1fr', gap: '12px' }}>
        {urls.map((url, i) => (
          <div key={i} onClick={() => setOpenIdx(i)} style={{ cursor: 'pointer', position: 'relative' }}>
            <div style={{ borderRadius: '14px', overflow: 'hidden', border: '1px solid #E5E5EA', maxHeight: '300px', background: '#fff' }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- no fixed-height container, low SEO value */}
              <img src={url} alt={labels[i] || `Grundriss ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'contain', maxHeight: '300px' }} />
              <div style={{ position: 'absolute', bottom: '10px', right: '10px', background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: '11px', fontWeight: 600, padding: '5px 12px', borderRadius: '99px' }}>
                🔍 Vergrößern
              </div>
            </div>
            {labels[i] && (
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#6E6E73', marginTop: '6px', textAlign: 'center' }}>{labels[i]}</div>
            )}
          </div>
        ))}
      </div>

      {openIdx !== null && (
        <Overlay onClose={() => setOpenIdx(null)} title={labels[openIdx] || (urls.length === 1 ? 'Grundriss' : `Grundriss ${openIdx + 1}`)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- natural sizing, low SEO value */}
          <img src={urls[openIdx]} alt="Grundriss" style={{ width: '100%', objectFit: 'contain', borderRadius: '8px' }} />
          {urls.length > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '16px' }}>
              {urls.map((_, i) => (
                <button key={i} type="button" onClick={() => setOpenIdx(i)} style={{
                  padding: '6px 14px', borderRadius: '8px', border: i === openIdx ? '2px solid #1D1D1F' : '1px solid #E5E5EA',
                  background: i === openIdx ? '#F5F5F7' : '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: '#1D1D1F',
                }}>{labels[i] || `${i + 1}`}</button>
              ))}
            </div>
          )}
        </Overlay>
      )}
    </div>
  )
}

/* ── 4. Occupancy Calendar — 2 months, clickable → BookingBox ─ */
const DE_MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
const DE_DAYS_SHORT = ['Mo','Di','Mi','Do','Fr','Sa','So']
