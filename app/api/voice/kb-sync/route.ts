import { NextResponse } from 'next/server'
import { syncVoiceKb } from '@/lib/voice-kb'
import { getTaskAuth } from '@/lib/tasks'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * ☎️📚 KB-Auto-Sync der Telefon-Assistentin (§175 Phase 2b):
 *  GET  = täglicher Vercel-Cron (Bearer CRON_SECRET) — läuft NACH der
 *         4:30-Wissens-Destillation, damit frisches Chat-Wissen sofort
 *         auch am Telefon verfügbar ist.
 *  POST = manueller Lauf (Admin, für Tests/Sofort-Aktualisierung).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht berechtigt' }, { status: 401 })
  }
  try {
    const result = await syncVoiceKb()
    console.log('[voice-kb] Cron-Sync:', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (e) {
    console.error('[voice-kb] Cron-Sync fehlgeschlagen:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST() {
  const auth = await getTaskAuth()
  if (!auth || auth.role !== 'admin') {
    return NextResponse.json({ error: 'Nicht berechtigt' }, { status: 403 })
  }
  try {
    const result = await syncVoiceKb()
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
