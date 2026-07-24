import { NextRequest, NextResponse } from 'next/server'
import { getTaskAuth } from '@/lib/tasks'
import { getScoreHistory, snapshotScores } from '@/lib/score-history'

/**
 * 📈 Score-Entwicklung (§171): GET liefert die Snapshot-Historie für die
 * Grafik im Mehr-Tab (Team: Admin/Gastgeber/Mitarbeiter — keine
 * Dienstleister); POST = Snapshot sofort (erster Datenpunkt nach Deploy).
 */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await getTaskAuth()
  if (!auth || auth.role === 'provider') {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  }
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days')) || 365, 7), 730)
  const points = await getScoreHistory(days)
  return NextResponse.json(
    { points },
    { headers: { 'Cache-Control': 'no-store, must-revalidate' } },
  )
}

export async function POST() {
  const auth = await getTaskAuth()
  if (!auth || auth.role === 'provider') {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  }
  return NextResponse.json(await snapshotScores())
}
