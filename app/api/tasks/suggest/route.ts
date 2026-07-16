import { NextRequest, NextResponse } from 'next/server'
import { runTaskSuggest } from '@/lib/task-suggest'
import { getTaskAuth } from '@/lib/tasks'

/**
 * 🤖 KI-Aufgabenvorschläge:
 *  GET  → täglicher Vercel-Cron (Bearer CRON_SECRET)
 *  POST → manueller „Jetzt analysieren"-Button (nur Admins/Gastgeber)
 */
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 401 })
  }
  try {
    return NextResponse.json(await runTaskSuggest())
  } catch (err) {
    console.error('[task-suggest]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST() {
  const auth = await getTaskAuth()
  if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  try {
    return NextResponse.json(await runTaskSuggest())
  } catch (err) {
    console.error('[task-suggest]', err)
    return NextResponse.json({ error: 'Analyse fehlgeschlagen — Details im Log.' }, { status: 500 })
  }
}
