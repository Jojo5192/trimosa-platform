import { NextResponse } from 'next/server'
import { ensureUpcomingDoorCodes } from '@/lib/locks'

/**
 * Türcode-Automatik (§132): täglicher Cron legt Keypad-Codes für alle
 * Anreisen der nächsten 7 Tage auf die Nuki-Schlösser der Wohnungen und
 * räumt abgelaufene Codes ab. Kurzfristige Buchungen fängt zusätzlich die
 * On-Demand-Erzeugung beim Öffnen der Gästemappe ab.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 401 })
  }
  const result = await ensureUpcomingDoorCodes()
  console.log('[locks-sync]', JSON.stringify(result))
  return NextResponse.json(result)
}
