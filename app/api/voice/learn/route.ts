import { NextResponse } from 'next/server'
import { learnFromCalls, auditCalls } from '@/lib/voice-learn'
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
    // 🔍 §228: Anruf-QA im selben Cron — Fehler-/Verbesserungs-Analyse
    // jedes neuen Anrufs, Befunde gehen automatisch in die Chefsache
    const qa = await auditCalls().catch((e) => {
      console.error('[voice-qa] fehlgeschlagen:', e)
      return { calls: 0, befunde: 0, status: `Fehler: ${String(e).slice(0, 120)}` }
    })
    console.log('[voice-learn] Cron:', JSON.stringify(result), '| QA:', JSON.stringify(qa))
    return NextResponse.json({ ...result, qa })
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
    const qa = await auditCalls().catch((e) => ({ calls: 0, befunde: 0, status: `Fehler: ${String(e).slice(0, 120)}` }))
    return NextResponse.json({ ...result, qa })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
