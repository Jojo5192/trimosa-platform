'use client'

import { useCallback, useState, useEffect } from 'react'
import { supabaseBrowser as supabase } from '@/lib/supabase-browser'

interface Props {
  pricePerNight: number
}

export default function MobileBookingBar({ pricePerNight }: Props) {
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setIsLoggedIn(!!data.user))
  }, [])

  const handleReservieren = useCallback(() => {
    // Scroll to occupancy calendar for date selection
    const calendar = document.querySelector('#occupancy-calendar')
    if (calendar) {
      calendar.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    // Fallback: scroll to booking box
    const bookingCol = document.querySelector('.detail-booking-col')
    if (bookingCol) {
      bookingCol.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  const handleChat = useCallback(() => {
    // Dispatch a custom event that the NavBar's ChatOverlay can listen to
    window.dispatchEvent(new CustomEvent('open-chat'))
  }, [])

  return (
    <div className="mobile-booking-bar">
      {/* Chat button */}
      {isLoggedIn && (
        <button
          type="button"
          onClick={handleChat}
          title="Nachrichten"
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            border: 'none',
            background: 'linear-gradient(135deg, #C4A235, #8A6818)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 2px 8px rgba(164,130,40,0.3)',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
        </button>
      )}

      {/* Price */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {pricePerNight > 0 ? (
          <>
            <span style={{ fontSize: '16px', fontWeight: 700, color: '#111' }}>€ {pricePerNight}</span>
            <span style={{ fontSize: '11px', color: '#6E6E73', marginLeft: '3px' }}>/ Nacht</span>
          </>
        ) : (
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#888' }}>Preis auf Anfrage</span>
        )}
      </div>

      {/* Reservieren button */}
      <button
        type="button"
        onClick={handleReservieren}
        style={{
          padding: '12px 24px',
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
