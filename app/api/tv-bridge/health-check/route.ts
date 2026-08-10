import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendPushToTeam } from '@/lib/push'

export const dynamic = 'force-dynamic'

/**
 * 📺 Ausfall-Wächter für den TV-SERVER selbst (tv.trimosa.de, Hetzner).
 *
 * Der TV-Server kann seinen eigenen Ausfall nicht melden (dann ist er ja weg) —
 * deshalb pollt die Plattform seinen Health-Endpoint per Cron und pusht bei
 * Zustandswechsel an die Admins. Zustand in app_settings 'tv_server_state'
 * { down: boolean, since: iso, fails: number }. Push nur bei online↔offline-
 * Wechsel (kein Dauer-Spam); Offline-Bestätigung erst nach 2 Fehlversuchen
 * in Folge (transiente Netz-Hänger überspringen).
 *
 * Auth: Vercel-Cron sendet "Authorization: Bearer ${CRON_SECRET}".
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht berechtigt' }, { status: 401 })
  }

  let ok = false
  try {
    const r = await fetch('https://tv.trimosa.de/api/health', {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    })
    ok = r.ok
  } catch {
    ok = false
  }

  const { data } = await supabaseAdmin
    .from('app_settings').select('value').eq('key', 'tv_server_state').maybeSingle()
  const prev = (data?.value as { down?: boolean; since?: string; fails?: number } | null) || {}
  const wasDown = !!prev.down
  const fails = ok ? 0 : (prev.fails || 0) + 1

  let pushed: string | null = null
  if (ok && wasDown) {
    // Wieder online → Entwarnung
    await sendPushToTeam('📺 TV-Server wieder online', 'tv.trimosa.de ist wieder erreichbar.', '/team')
    pushed = 'recovered'
    await supabaseAdmin.from('app_settings').upsert({ key: 'tv_server_state', value: { down: false, fails: 0 } })
  } else if (!ok && !wasDown && fails >= 2) {
    // Zweiter Fehlschlag in Folge → als offline bestätigen + Alarm
    await sendPushToTeam(
      '📺 TV-Server offline',
      'tv.trimosa.de antwortet nicht mehr. Die TV-Oberflächen der Gäste könnten betroffen sein — Hetzner-Server prüfen.',
      '/team',
    )
    pushed = 'offline_alert'
    await supabaseAdmin.from('app_settings').upsert({ key: 'tv_server_state', value: { down: true, since: new Date().toISOString(), fails } })
  } else {
    // Kein Zustandswechsel → nur Fail-Zähler fortschreiben
    await supabaseAdmin.from('app_settings').upsert({ key: 'tv_server_state', value: { down: wasDown, since: prev.since, fails } })
  }

  return NextResponse.json({ ok, wasDown, fails, pushed })
}
