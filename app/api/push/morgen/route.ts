import { NextRequest, NextResponse } from 'next/server'
import { sendeMorgenSammlung } from '@/lib/push'

/**
 * 🌅 Sammel-Mitteilung nach der Ruhezeit (Pascal, Chefsache 7.10.2026 „Mitteilungs-Design"): was nachts
 * zurückgehalten wurde (lib/push-ruhe.ts), kommt als EINE Mitteilung „🌅 Über Nacht: N Mitteilungen".
 *  GET → Vercel-Cron stündlich zu Minute 3 (Bearer CRON_SECRET, fail-closed). Die Berliner Stunde prüft
 *        lib/push.ts je Nutzer selbst (eigene Ruhezeiten); ein doppelter Lauf sendet nichts doppelt.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 401 })
  }
  try {
    return NextResponse.json(await sendeMorgenSammlung())
  } catch (err) {
    console.error('[push-morgen]', err)
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err).slice(0, 300) }, { status: 500 })
  }
}
