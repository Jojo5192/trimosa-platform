import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCleaningState } from '@/lib/cleaning-done'
import ConfirmClient from './ConfirmClient'

/**
 * 🧹 §231: Öffentliche Fertigmelde-Seite hinter dem NFC-Tag in der Wohnung.
 * Kein Login — der unerratbare Token IST der Zugang; die eigentliche
 * Absicherung (Zeitfenster, einmal je Slot, Nuki-Log-Zeuge) sitzt im Server.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Reinigung melden',
  robots: { index: false, follow: false },
}

export default async function ReinigungPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const state = await getCleaningState(token)
  if (!state) notFound()

  return (
    <div style={{
      minHeight: '100dvh', background: '#12222E', display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '24px 18px', fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <p style={{
        color: '#E3C878', fontSize: 13, fontWeight: 800, letterSpacing: '0.25em',
        textTransform: 'uppercase', margin: '0 0 6px',
      }}>TRIMOSA</p>
      <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, margin: '0 0 26px' }}>
        Reinigungs-Meldung · nur für das Reinigungspersonal
      </p>
      <ConfirmClient
        token={token}
        title={state.title}
        slotDate={state.slotDate}
        alreadyAt={state.alreadyAt}
      />
    </div>
  )
}
