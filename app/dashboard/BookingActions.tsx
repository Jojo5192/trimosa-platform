'use client'

import { useState } from 'react'
import { acceptBooking, declineBooking } from './actions'

interface BookingActionsProps {
  bookingId: string
}

export default function BookingActions({ bookingId }: BookingActionsProps) {
  const [loading, setLoading] = useState<'accept' | 'decline' | null>(null)
  const [done, setDone] = useState<'accepted' | 'declined' | null>(null)
  const [error, setError] = useState('')

  async function handleAccept() {
    setLoading('accept')
    setError('')
    try {
      await acceptBooking(bookingId)
      setDone('accepted')
    } catch (e) {
      setError('Fehler beim Annehmen.')
    } finally {
      setLoading(null)
    }
  }

  async function handleDecline() {
    setLoading('decline')
    setError('')
    try {
      await declineBooking(bookingId)
      setDone('declined')
    } catch (e) {
      setError('Fehler beim Ablehnen.')
    } finally {
      setLoading(null)
    }
  }

  if (done === 'accepted') {
    return (
      <span className="text-xs bg-green-100 text-green-700 px-3 py-1.5 rounded-full font-medium">
        ✓ Angenommen
      </span>
    )
  }

  if (done === 'declined') {
    return (
      <span className="text-xs bg-gray-100 text-gray-500 px-3 py-1.5 rounded-full font-medium">
        Abgelehnt
      </span>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {error && <p className="text-red-500 text-xs">{error}</p>}
      <button
        onClick={handleDecline}
        disabled={loading !== null}
        className="text-sm text-gray-500 border border-gray-200 px-3 py-1.5 rounded-full hover:border-gray-400 transition-colors disabled:opacity-50"
      >
        {loading === 'decline' ? '...' : 'Ablehnen'}
      </button>
      <button
        onClick={handleAccept}
        disabled={loading !== null}
        className="text-sm bg-black text-white px-3 py-1.5 rounded-full hover:bg-gray-800 transition-colors disabled:opacity-50"
      >
        {loading === 'accept' ? '...' : 'Annehmen'}
      </button>
    </div>
  )
}
