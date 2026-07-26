import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { runAutoMessages } from '@/lib/auto-messages-engine'

/**
 * 📨 Auto-Nachrichten-Versand (Phase B, §148):
 *  GET  → Vercel-Cron alle 10 Min (Bearer CRON_SECRET) — echter Versand,
 *         respektiert den Master-Schalter (app_settings 'auto_messages').
 *  POST → Admin/Gastgeber: { dryRun: true } (Default) zeigt, was gesendet
 *         WÜRDE (inkl. Vorschau-Texte), ohne irgendetwas zu senden;
 *         { dryRun: false } stößt einen echten Lauf an (Master-Schalter gilt).
 */
export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 401 })
  }
  try {
    return NextResponse.json(await runAutoMessages())
  } catch (err) {
    console.error('[auto-messages] cron:', err)
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
    const report = await runAutoMessages({ dryRun: b.dryRun !== false })
    // §210: Die letzten Versand-Protokolle mitliefern — zeigt je Nachricht,
    // über WELCHEN Kanal sie ging ('smoobu' | 'chat+email' | 'email
    // (smoobu-fehler)' …). Diagnose-Werkzeug für Doppelversand-Verdacht.
    const { data: log } = await supabaseAdmin
      .from('auto_message_log')
      .select('created_at, channel, booking_id, auto_message_id')
      .order('created_at', { ascending: false })
      .limit(25)
    return NextResponse.json({ ...report, letzteSendungen: log ?? [] })
  } catch (err) {
    const detail = String(err instanceof Error ? err.message : err).slice(0, 300)
    return NextResponse.json({ error: `Lauf fehlgeschlagen: ${detail}` }, { status: 500 })
  }
}
