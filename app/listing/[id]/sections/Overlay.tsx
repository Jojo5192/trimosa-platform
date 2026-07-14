'use client'

import { useEffect } from 'react'

/* ── Overlay backdrop ──────────────────────────────────────── */
export default function Overlay({ onClose, children, title }: { onClose: () => void; children: ReactNode; title: string }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])
  return (
    <div onClick={onClose} className="detail-overlay-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div onClick={e => e.stopPropagation()} className="detail-overlay-box" style={{ background: '#fff', borderRadius: '20px', width: '100%', maxWidth: '600px', maxHeight: '85vh', overflow: 'auto', position: 'relative' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 1, background: '#fff', borderRadius: '20px 20px 0 0', padding: '20px 24px 16px', borderBottom: '1px solid #F0EEE8', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#1D1D1F' }}>{title}</h3>
          <button type="button" onClick={onClose} style={{ width: '32px', height: '32px', borderRadius: '50%', border: 'none', background: '#F5F5F7', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', flexShrink: 0 }}>✕</button>
        </div>
        <div style={{ padding: '20px 24px 24px' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
