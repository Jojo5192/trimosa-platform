import { NextRequest, NextResponse } from 'next/server'
import { runWeeklyDigest } from '@/lib/weekly-digest'
import { getTaskAuth } from '@/lib/tasks'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * 📬 Wochenbericht-Mail ans Team:
 *  GET  → Vercel-Cron mittwochs (Bearer CRON_SECRET) — an ALLE Team-Mitglieder
 *  POST → manueller TEST-Versand (Admins/Gastgeber) — nur an den Auslöser selbst
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

export async function POST(request: NextRequest) {
  const auth = await getTaskAuth()
  if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  try {
    // { all: true } → echter Versand an ALLE Team-Mitglieder inkl. Speichern
    // (wie der Mittwoch-Cron); ohne all → Test nur an den Auslöser, ohne Speichern.
    const body = await request.json().catch(() => ({}))
    if (body.all === true) {
      return NextResponse.json({ test: false, an: 'alle Team-Mitglieder', ...(await runWeeklyDigest()) })
    }
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(auth.userId)
    const onlyEmail = u?.user?.email
    if (!onlyEmail) return NextResponse.json({ error: 'Eigene E-Mail nicht gefunden.' }, { status: 500 })
    return NextResponse.json({ test: true, an: onlyEmail, ...(await runWeeklyDigest({ onlyEmail })) })
  } catch (err) {
    console.error('[weekly-digest]', err)
    // Admin-gated: konkrete Fehlermeldung zurückgeben (Diagnose ohne Vercel-Logs)
    const detail = String(err instanceof Error ? err.message : err).slice(0, 400)
    return NextResponse.json({ error: `Wochenbericht fehlgeschlagen: ${detail}` }, { status: 500 })
  }
}
