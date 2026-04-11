'use client'

import { useState } from 'react'

export default function BookingDetail({ bookingId }: { bookingId: string }) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    if (detail) { setOpen(true); return }
    setLoading(true)
    const res = await fetch(`/api/bookings/${bookingId}`)
    if (res.ok) setDetail(await res.json())
    setLoading(false)
    setOpen(true)
  }

  return (
    <>
      <button
        onClick={load}
        disabled={loading}
        style={{
          fontSize: '12px', fontWeight: 600, padding: '6px 14px',
          borderRadius: '99px', border: '1.5px solid #E0DDD6',
          background: '#fff', color: '#555', cursor: 'pointer',
        }}
      >
        {loading ? '…' : 'Details'}
      </button>

      {open && detail && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '20px',
        }} onClick={() => setOpen(false)}>
          <div style={{
            background: '#fff', borderRadius: '20px', padding: '28px',
            maxWidth: '480px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: '#111' }}>Buchungsdetails</h2>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#999' }}>✕</button>
            </div>

            {([
              ['Buchungs-ID', (detail.id as string)?.slice(0, 8) + '…'],
              ['Status', detail.status as string],
              ['Check-in', detail.check_in as string],
              ['Check-out', detail.check_out as string],
              ['Gäste', detail.guests as string],
              ['Gesamtpreis', `€ ${(detail.total_price as number)?.toFixed(2)}`],
              ['Provision (10%)', `€ ${((detail.total_price as number) * 0.1)?.toFixed(2)}`],
              ['Auszahlung', `€ ${((detail.total_price as number) * 0.9)?.toFixed(2)}`],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #F0EDE8' }}>
                <span style={{ fontSize: '13px', color: '#888' }}>{k}</span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#111' }}>{v}</span>
              </div>
            ))}

            {(detail.notes as string | undefined) && (
              <div style={{ marginTop: '14px', padding: '12px', background: '#F9F7F2', borderRadius: '10px' }}>
                <p style={{ fontSize: '12px', color: '#888', margin: '0 0 4px', fontWeight: 600 }}>Notiz vom Gast</p>
                <p style={{ fontSize: '13px', color: '#444', margin: 0 }}>{detail.notes as string}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
