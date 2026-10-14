import { NextResponse } from 'next/server'
import { sweepPendingPayments } from '@/lib/booking-sweep'

/**
 * Cron (alle 15 Min, vercel.json): verfallene Sofortbuchungen (pending_payment > 40 Min, unbezahlt) auf
 * 'cancelled' setzen und Überbuchungs-Alarme dazu auflösen. Details lib/booking-sweep.ts.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 401 })
  }
  const r = await sweepPendingPayments()
  return NextResponse.json(r, { status: r.fehler ? 500 : 200 })
}
