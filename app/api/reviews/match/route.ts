import { NextRequest, NextResponse } from 'next/server'
import { matchPropertyReviews } from '@/lib/review-match'

/**
 * 🎯 Eigener Cron für das Property-Review-Matching (§126) — läuft um 4:25,
 * ZWISCHEN Review-Sync (4:00, stellt Property-Kopien wieder her) und
 * KI-Aufgaben-Analyse (4:45, würde die Kopien sonst als „neue Bewertungen"
 * lesen). Als Anhang des Sync-Crons riss der Lauf das 300s-Limit — darum
 * jetzt separat und mit pageSize 100 deutlich schneller.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }
  const report = await matchPropertyReviews(false)
  return NextResponse.json(report)
}
