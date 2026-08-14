import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { parseMeldungen, checkWarenkoerbe } from '@/lib/material'

/**
 * 🛒 §266f Material-Cron (alle 15 Min): liest neue Nachrichten der
 * „🛒 Material"-Gruppe → Haiku strukturiert → Bedarf; danach ggf.
 * Warenkorb-Post je Standort. POST = manueller Admin-Trigger.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Lauf-Lock (gleiche Instanz): manueller Admin-Trigger + Cron dürfen
// nicht parallel über denselben Cursor laufen. Cross-Instanz-Races sind
// selten und durch addBedarf-Dedupe + Cooldown-Check entschärft.
const g = globalThis as unknown as { __materialRun?: boolean }

async function run() {
  if (g.__materialRun) return { gelesen: 0, bedarf: 0, posts: 0, fehler: 'Lauf bereits aktiv' }
  g.__materialRun = true
  try {
    const scan = await parseMeldungen()
    const koerbe = await checkWarenkoerbe()
    return { ...scan, posts: koerbe.posts }
  } finally {
    g.__materialRun = false
  }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const r = await run()
  console.log('[material-cron]', JSON.stringify(r))
  return NextResponse.json(r)
}

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  const { data: p } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host').eq('id', user.id).maybeSingle()
  if (!p?.is_admin && !p?.is_host) return NextResponse.json({ error: 'Nur Admins' }, { status: 403 })
  return NextResponse.json(await run())
}
