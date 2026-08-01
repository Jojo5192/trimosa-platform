import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { runMailScan, peekMail, getGraphMailState, saveGraphMailState, graphConfigured } from '@/lib/graph-mail'

/**
 * 📥 Graph-Mail-Scan (§237) — der Postfach-Poller:
 *  GET  → Vercel-Cron alle 10 Min (Bearer CRON_SECRET); läuft nur, wenn
 *         der Schalter an ist (erst Setup + Kalibrierung).
 *  POST → Admin: { action: 'status' | 'peek' | 'scan' | 'enable' | 'mailboxes' }
 *         peek      = { hours } Mails NUR auflisten (Kalibrierung)
 *         scan      = { hours } einmalig scannen + verarbeiten
 *         enable    = { on: true|false }
 *         mailboxes = { list: ['fewo@trimosa.de', …] }
 */
export const maxDuration = 300
export const dynamic = 'force-dynamic'
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 401 })
  }
  try {
    const state = await getGraphMailState()
    if (!state.enabled) return NextResponse.json({ skipped: 'Mail-Scan ist aus (erst Setup + action enable).' })
    return NextResponse.json(await runMailScan())
  } catch (err) {
    console.error('[mail-scan] cron:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host').eq('id', user.id).maybeSingle()
  if (!me?.is_admin && !me?.is_host) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  try {
    const b = await request.json().catch(() => ({}))
    if (b.action === 'status') {
      const state = await getGraphMailState()
      return NextResponse.json({ konfiguriert: graphConfigured(), ...state, processed: state.processed.length }, NO_STORE)
    }
    if (b.action === 'peek') {
      return NextResponse.json({ mails: await peekMail(typeof b.hours === 'number' ? b.hours : 24) }, NO_STORE)
    }
    if (b.action === 'scan') {
      return NextResponse.json(await runMailScan({ ...(typeof b.hours === 'number' ? { hours: b.hours } : {}) }), NO_STORE)
    }
    if (b.action === 'enable') {
      const state = await getGraphMailState()
      await saveGraphMailState({ ...state, enabled: b.on === true })
      return NextResponse.json({ enabled: b.on === true }, NO_STORE)
    }
    if (b.action === 'mailboxes') {
      const list = Array.isArray(b.list)
        ? b.list.map(String).map((s: string) => s.trim().toLowerCase()).filter((s: string) => /^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(s)).slice(0, 10)
        : null
      if (!list) return NextResponse.json({ error: 'list fehlt (Array von Mail-Adressen).' }, { status: 400 })
      const state = await getGraphMailState()
      await saveGraphMailState({ ...state, mailboxes: list })
      return NextResponse.json({ mailboxes: list }, NO_STORE)
    }
    return NextResponse.json({ error: 'Unbekannte action.' }, { status: 400 })
  } catch (err) {
    console.error('[mail-scan] manual:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
