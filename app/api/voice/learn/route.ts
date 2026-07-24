import { NextResponse } from 'next/server'
import { learnFromCalls } from '@/lib/voice-learn'
import { getTaskAuth } from '@/lib/tasks'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * ☎️🧠 Transkript-Lernen (§183, Phase 2b):
 *  GET  = täglicher Vercel-Cron (Bearer CRON_SECRET) — läuft um 4:40,
 *         also VOR dem KB-Sync (4:50): frische Erkenntnisse landen noch
 *         in derselben Nacht in der ElevenLabs-Wissensdatenbank.
 *  POST = manueller Lauf (Admin).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht berechtigt' }, { status: 401 })
  }
  try {
    const result = await learnFromCalls()
    console.log('[voice-learn] Cron:', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (e) {
    console.error('[voice-learn] Cron fehlgeschlagen:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST() {
  const auth = await getTaskAuth()
  if (!auth || auth.role !== 'admin') {
    return NextResponse.json({ error: 'Nicht berechtigt' }, { status: 403 })
  }
  try {
    const result = await learnFromCalls()
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
