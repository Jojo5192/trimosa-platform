import { NextResponse } from 'next/server'
import { ensureUpcomingDoorCodes, checkLockBatteries } from '@/lib/locks'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * Türcode-Automatik (§132): täglicher Cron legt Keypad-Codes für alle
 * Anreisen der nächsten 7 Tage auf die Nuki-Schlösser der Wohnungen und
 * räumt abgelaufene Codes ab. Kurzfristige Buchungen fängt zusätzlich die
 * On-Demand-Erzeugung beim Öffnen der Gästemappe ab.
 *
 * §265 zusätzlich: Batterie-Wächter (schwache Schloss-Akkus → Push an die
 * Reinigungs-Verantwortliche, alle 3 Tage bis getauscht) + Aufräumen der
 * Push-Historie (push_log, 30 Tage).
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 401 })
  }
  const result = await ensureUpcomingDoorCodes()

  // §265 Batterie-Wächter — fail-soft, darf die Code-Automatik nie stören
  let batterien: Awaited<ReturnType<typeof checkLockBatteries>> | { error: string } = { error: 'übersprungen' }
  try {
    batterien = await checkLockBatteries()
  } catch (e) {
    batterien = { error: String(e instanceof Error ? e.message : e) }
  }

  // §265 Push-Historie: Einträge älter als 30 Tage abräumen (fail-soft,
  // Migration 20260814_push_log.sql evtl. noch nicht ausgeführt)
  try {
    const grenze = new Date(Date.now() - 30 * 86_400_000).toISOString()
    await supabaseAdmin.from('push_log').delete().lt('created_at', grenze)
  } catch { /* Tabelle fehlt noch → nichts zu tun */ }

  console.log('[locks-sync]', JSON.stringify({ ...result, batterien }))
  return NextResponse.json({ ...result, batterien })
}
