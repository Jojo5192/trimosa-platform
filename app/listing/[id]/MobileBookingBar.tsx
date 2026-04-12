'use client'

import { useCallback } from 'react'

interface Props {
  pricePerNight: number
}

export default function MobileBookingBar({ pricePerNight }: Props) {
  const handleClick = useCallback(() => {
    // Try to scroll to booking box first, then calendar as fallback
    const bookingCol = document.querySelector('.detail-booking-col')
    if (bookingCol) {
      bookingCol.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    // Fallback: scroll to occupancy calendar
    const calendar = document.querySelector('#occupancy-calendar')
    if (calendar) {
      calendar.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  return (
    <div className="mobile-booking-bar">
      <div>
        {pricePerNight > 0 ? (
          <>
            <span style={{ fontSize: '17px', fontWeight: 700, color: '#111' }}>€ {pricePerNight}</span>
            <span style={{ fontSize: '12px', color: '#6E6E73', marginLeft: '4px' }}>/ Nacht</span>
          </>
        ) : (
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#888' }}>Preis auf Anfrage</span>
        )}
      </div>
      <button
        type="button"
        onClick={handleClick}
        style={{
          padding: '12px 28px',
          borderRadius: '12px',
          border: 'none',
          background: 'linear-gradient(135deg, #C4A235, #8A6818)',
          color: '#fff',
          fontSize: '14px',
          fontWeight: 700,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        Reservieren
      </button>
    </div>
  )
}
