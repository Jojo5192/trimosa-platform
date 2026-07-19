import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { askClaude } from '@/lib/ai'
import { getPrompt } from '@/lib/prompts'
import { getClaudeBotId, postAsClaude } from '@/lib/claude-bot'
import { buildBotContext } from '@/lib/team-bot-context'

/**
 * 🤖 @c-Antwort-Bot (Inhaber-Wunsch 19.07.): minütlicher Cron scannt neue
 * Team-Chat-Nachrichten — beginnt eine mit „@c" (oder „@claude"), antwortet
 * Claude als Gruppenmitglied direkt im Chat (Wissensfragen/Auskünfte;
 * Änderungswünsche bestätigt er nur — Umsetzung bleibt bei den Sessions).
 * Cursor in app_settings 'claude_bot_cursor'; Erstlauf greift max. 10 Min
 * zurück (keine Historien-Antworten).
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TRIGGER = /^\s*@c(laude)?\b/i

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  }

  let cursor: string | null = null
  try {
    const { data } = await supabaseAdmin
      .from('app_settings').select('value').eq('key', 'claude_bot_cursor').maybeSingle()
    cursor = (data?.value as { at?: string } | null)?.at ?? null
  } catch { /* Erstlauf */ }
  if (!cursor) cursor = new Date(Date.now() - 10 * 60_000).toISOString()

  const { data: msgs } = await supabaseAdmin
    .from('team_messages')
    .select('id, chat_id, sender_id, content, created_at')
    .gt('created_at', cursor)
    .order('created_at', { ascending: true })
    .limit(30)
  if (!msgs?.length) return NextResponse.json({ ok: true, answered: 0 })

  const claudeId = await getClaudeBotId(false)
  let answered = 0

  for (const m of msgs) {
    if (!TRIGGER.test(m.content ?? '')) continue
    if (claudeId && m.sender_id === claudeId) continue

    // Datensparsamkeit: sitzt ein Dienstleister in der Gruppe, bekommt der
    // Bot die Belegung OHNE Gastnamen (wie der Team-Kalender)
    let includeGuestNames = true
    try {
      const { data: members } = await supabaseAdmin
        .from('team_chat_members')
        .select('user_id, profiles(is_provider)')
        .eq('chat_id', m.chat_id)
      includeGuestNames = !(members ?? []).some((x) => {
        const p = (Array.isArray(x.profiles) ? x.profiles[0] : x.profiles) as { is_provider?: boolean } | null
        return !!p?.is_provider
      })
    } catch { includeGuestNames = false }
    const liveData = await buildBotContext(includeGuestNames)

    // Gesprächskontext: die letzten 15 Nachrichten bis einschließlich dieser
    const { data: ctx } = await supabaseAdmin
      .from('team_messages')
      .select('content, attachment_type, created_at, profiles(display_name)')
      .eq('chat_id', m.chat_id)
      .lte('created_at', m.created_at)
      .order('created_at', { ascending: false })
      .limit(15)
    const lines = (ctx ?? []).reverse().map((x) => {
      const p = (Array.isArray(x.profiles) ? x.profiles[0] : x.profiles) as { display_name?: string } | null
      const name = (p?.display_name ?? '').trim().split(/\s+/)[0] || 'Team'
      const body = (x.content || '').trim() || (x.attachment_type ? `[${x.attachment_type}]` : '')
      return `${name}: ${body}`
    })
    const question = (m.content ?? '').replace(TRIGGER, '').trim()

    try {
      const system = await getPrompt('team_bot')
      const user = `${liveData}

═══ Chat-Verlauf (neueste unten):
${lines.join('\n')}

DIE AN DICH GERICHTETE NACHRICHT: ${question || m.content}`
      const answer = (await askClaude(system, user, 5000)).trim()
      if (answer) {
        await postAsClaude(m.chat_id, answer)
        answered++
      }
    } catch (e) {
      console.error('[team-bot] answer failed:', e)
    }
  }

  await supabaseAdmin.from('app_settings').upsert({
    key: 'claude_bot_cursor',
    value: { at: msgs[msgs.length - 1].created_at },
    updated_at: new Date().toISOString(),
  })
  return NextResponse.json({ ok: true, answered })
}
