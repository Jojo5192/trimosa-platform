import { NextRequest, NextResponse } from 'next/server'
import { runWeeklyDigest } from '@/lib/weekly-digest'
import { getTaskAuth } from '@/lib/tasks'

/**
 * 📬 Wochenbericht-Mail ans Team:
 *  GET  → Vercel-Cron mittwochs (Bearer CRON_SECRET)
 *  POST → manueller Test-Versand (nur Admins/Gastgeber)
 */
export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 401 })
  }
  try {
    return NextResponse.json(await runWeeklyDigest())
  } catch (err) {
    console.error('[weekly-digest]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST() {
  const auth = await getTaskAuth()
  if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  try {
    return NextResponse.json(await runWeeklyDigest())
  } catch (err) {
    console.error('[weekly-digest]', err)
    // Admin-gated: konkrete Fehlermeldung zurückgeben (Diagnose ohne Vercel-Logs)
    const detail = String(err instanceof Error ? err.message : err).slice(0, 400)
    return NextResponse.json({ error: `Wochenbericht fehlgeschlagen: ${detail}` }, { status: 500 })
  }
}
