import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTaskAuth } from '@/lib/tasks'
import { getClaudeBotId } from '@/lib/claude-bot'
import { sendPushToUser } from '@/lib/push'

/**
 * 🤖 Claude schreibt als eigenständiges Mitglied in eine interne Gruppe
 * (Änderungs-Updates nach Coding-Runden, Antworten auf Team-Anweisungen).
 * Admin-gated: nur Admins/Gastgeber können Claude sprechen lassen — der
 * Aufruf kommt aus Claudes Coding-Session über die eingeloggte Admin-Session.
 * POST { content } → legt das Claude-Konto bei Bedarf an, macht es zum
 * Gruppen-Mitglied und sendet die Nachricht in seinem Namen (+ Push an die
 * anderen Mitglieder, push_team_chats respektiert).
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const me = await getTaskAuth()
  if (!me || me.role !== 'admin') return NextResponse.json({ error: 'Nur Admins können Claude sprechen lassen.' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const content = typeof body.content === 'string' ? body.content.trim().slice(0, 4000) : ''
  if (!content) return NextResponse.json({ error: 'Leere Nachricht.' }, { status: 400 })

  const { data: chat } = await supabaseAdmin
    .from('team_chats').select('id, name, emoji').eq('id', id).maybeSingle()
  if (!chat) return NextResponse.json({ error: 'Gruppe nicht gefunden.' }, { status: 404 })

  const claudeId = await getClaudeBotId(true)
  if (!claudeId) return NextResponse.json({ error: 'Claude-Konto konnte nicht angelegt werden.' }, { status: 500 })

  // Claude als Mitglied sicherstellen (Mitgliederliste + Verwaltbarkeit)
  await supabaseAdmin
    .from('team_chat_members')
    .upsert({ chat_id: id, user_id: claudeId }, { onConflict: 'chat_id,user_id' })

  const { data: msg, error } = await supabaseAdmin
    .from('team_messages')
    .insert({ chat_id: id, sender_id: claudeId, content })
    .select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Lesestand des Auslösers mitziehen (er hat die Nachricht ja verfasst)
  await supabaseAdmin
    .from('team_chat_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('chat_id', id).eq('user_id', me.userId)

  ;(async () => {
    const { data: members } = await supabaseAdmin
      .from('team_chat_members')
      .select('user_id, profiles(push_team_chats)')
      .eq('chat_id', id)
      .neq('user_id', claudeId)
    for (const m of members ?? []) {
      if (m.user_id === me.userId) continue
      const p = (Array.isArray(m.profiles) ? m.profiles[0] : m.profiles) as { push_team_chats?: boolean } | null
      if (p && p.push_team_chats === false) continue
      sendPushToUser(m.user_id, `${chat.emoji} ${chat.name} · Claude`, content.slice(0, 160), '/team?tab=intern').catch(() => {})
    }
  })().catch(() => {})

  return NextResponse.json({ ok: true, id: msg.id }, NO_STORE)
}
