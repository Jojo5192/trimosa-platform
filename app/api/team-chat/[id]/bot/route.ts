import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTaskAuth } from '@/lib/tasks'
import { postAsClaude } from '@/lib/claude-bot'

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

  const msgId = await postAsClaude(id, content, { excludeUserId: me.userId })
  if (!msgId) return NextResponse.json({ error: 'Senden fehlgeschlagen.' }, { status: 500 })

  // Lesestand des Auslösers mitziehen (er hat die Nachricht ja verfasst)
  await supabaseAdmin
    .from('team_chat_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('chat_id', id).eq('user_id', me.userId)

  return NextResponse.json({ ok: true, id: msgId }, NO_STORE)
}
