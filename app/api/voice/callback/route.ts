import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// §224: KI-Rückruf — die Assistentin ruft den Anrufer mit einer Team-Anweisung
// zurück (ElevenLabs Outbound-Call über die Twilio-Nummer). EISERNE Leitplanke
// (§175): NUR nach explizitem Team-Klick, nie automatisch.
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID ?? 'agent_1301kya169areasafmcmd58cft83'
const PHONE_NUMBER_ID = process.env.ELEVENLABS_PHONE_NUMBER_ID ?? 'phnum_7101kypssys1edybw2vwz89s24n8'

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host, is_staff, display_name').eq('id', user.id).maybeSingle()
  if (!me?.is_admin && !me?.is_host && !me?.is_staff) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  }

  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ELEVENLABS_API_KEY fehlt (Vercel-Env).' }, { status: 503 })

  let body: { toNumber?: string; instruction?: string; taskId?: string }
  try { body = await request.json() } catch { body = {} }

  // Nummer normalisieren: nur Ziffern/+; deutsche 0-Vorwahl → +49
  let to = String(body.toNumber ?? '').replace(/[^\d+]/g, '')
  if (to.startsWith('00')) to = '+' + to.slice(2)
  if (to.startsWith('0')) to = '+49' + to.slice(1)
  if (!/^\+\d{8,15}$/.test(to)) {
    return NextResponse.json({ error: 'Rückrufnummer unvollständig — bitte im Format +49… angeben.' }, { status: 400 })
  }
  const instruction = String(body.instruction ?? '').trim()
  if (instruction.length < 5 || instruction.length > 600) {
    return NextResponse.json({ error: 'Anweisung fehlt (5–600 Zeichen) — was soll die KI ausrichten?' }, { status: 400 })
  }

  if (!(await checkRateLimit(`voice-callback:${user.id}`, 10, 3600))) {
    return NextResponse.json({ error: 'Zu viele Rückrufe — bitte später erneut.' }, { status: 429 })
  }

  const callbackBy = (me.display_name ?? '').split(/\s+/)[0] || 'dem TRIMOSA-Team'
  const res = await fetch('https://api.elevenlabs.io/v1/convai/twilio/outbound-call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
    body: JSON.stringify({
      agent_id: AGENT_ID,
      agent_phone_number_id: PHONE_NUMBER_ID,
      to_number: to,
      conversation_initiation_client_data: {
        dynamic_variables: {
          callback_instruction: instruction,
          callback_by: callbackBy,
        },
        // Override in den Agent-Sicherheitseinstellungen freigeschaltet (Erste Nachricht)
        conversation_config_override: {
          agent: {
            first_message: `Hallo! Hier ist die digitale Assistentin von TRIMOSA — ich rufe dich im Auftrag von ${callbackBy} zurück.`,
          },
        },
      },
    }),
  })
  const detail = await res.text().catch(() => '')
  if (!res.ok) {
    console.error('[voice-callback] outbound failed:', res.status, detail.slice(0, 300))
    return NextResponse.json({ error: `Rückruf fehlgeschlagen (HTTP ${res.status}): ${detail.slice(0, 160)}` }, { status: 502 })
  }
  console.log('[voice-callback] gestartet:', to, 'von', me.display_name, '·', instruction.slice(0, 80))

  // Protokoll an der Aufgabe (best effort)
  if (typeof body.taskId === 'string' && body.taskId) {
    await supabaseAdmin.from('task_comments').insert({
      task_id: body.taskId,
      author_id: user.id,
      content: `🤖 KI-Rückruf gestartet (an ${to}): „${instruction}"`,
    }).then(() => {}, () => {})
  }

  return NextResponse.json({ ok: true, hinweis: `Die KI ruft ${to} jetzt an und richtet deine Anweisung aus.` })
}
