import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTaskAuth } from '@/lib/tasks'
import { sendPushToUser } from '@/lib/push'

/**
 * ❤️ Tapback auf eine Team-Chat-Nachricht (iMessage-Verhalten):
 * EINE Reaktion pro Person und Nachricht — ein neues Emoji ersetzt die alte,
 * dasselbe Emoji erneut = entfernen. POST { messageId, emoji } → { reactions }.
 * Der Nachrichten-Autor bekommt einen Push (respektiert push_team_chats).
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

const ALLOWED_EMOJI = ['❤️', '👍', '👎', '😂', '‼️', '❓']

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getTaskAuth()
  if (!auth) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { data: member } = await supabaseAdmin
    .from('team_chat_members').select('chat_id').eq('chat_id', id).eq('user_id', auth.userId).maybeSingle()
  if (!member) return NextResponse.json({ error: 'Kein Mitglied.' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const messageId = typeof body.messageId === 'string' ? body.messageId : null
  const emoji = ALLOWED_EMOJI.includes(body.emoji) ? (body.emoji as string) : null
  if (!messageId || !emoji) return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })

  const { data: msg } = await supabaseAdmin
    .from('team_messages')
    .select('id, chat_id, sender_id, content, attachment_type, reactions')
    .eq('id', messageId).eq('chat_id', id)
    .maybeSingle()
  if (!msg) return NextResponse.json({ error: 'Nachricht nicht gefunden.' }, { status: 404 })

  // Toggle: Nutzer überall entfernen; hatte er DIESES Emoji nicht → hinzufügen
  const reactions: Record<string, string[]> = {}
  let hadThis = false
  for (const [e, users] of Object.entries((msg.reactions ?? {}) as Record<string, string[]>)) {
    if (!Array.isArray(users)) continue
    if (e === emoji && users.includes(auth.userId)) hadThis = true
    const rest = users.filter((u) => u !== auth.userId)
    if (rest.length) reactions[e] = rest
  }
  if (!hadThis) reactions[emoji] = [...(reactions[emoji] ?? []), auth.userId]

  const { error } = await supabaseAdmin
    .from('team_messages').update({ reactions }).eq('id', messageId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Push an den Autor (nur beim HINZUFÜGEN, nicht an sich selbst)
  if (!hadThis && msg.sender_id && msg.sender_id !== auth.userId) {
    ;(async () => {
      const [{ data: chat }, { data: me }, { data: author }] = await Promise.all([
        supabaseAdmin.from('team_chats').select('name, emoji').eq('id', id).maybeSingle(),
        supabaseAdmin.from('profiles').select('display_name').eq('id', auth.userId).maybeSingle(),
        supabaseAdmin.from('profiles').select('*').eq('id', msg.sender_id).maybeSingle(),
      ])
      if (author && (author as Record<string, unknown>).push_team_chats === false) return
      const sender = (me?.display_name ?? '').trim().split(/\s+/)[0] || 'Team'
      const target = (msg.content || '').slice(0, 40) || (msg.attachment_type === 'audio' ? 'Sprachnachricht' : msg.attachment_type === 'image' ? 'Foto' : 'Anhang')
      await sendPushToUser(msg.sender_id, `${chat?.emoji ?? '💬'} ${chat?.name ?? 'Team'}`, `${sender} hat mit ${emoji} auf „${target}“ reagiert`, '/team?tab=intern')
    })().catch(() => {})
  }

  return NextResponse.json({ ok: true, reactions }, NO_STORE)
}
