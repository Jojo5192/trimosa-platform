import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTaskAuth } from '@/lib/tasks'
import { sendPushToUser } from '@/lib/push'

/**
 * 💼 Einzelner Team-Chat:
 *  GET    → Nachrichten (älteste zuerst) + markiert als gelesen
 *  POST   → Nachricht senden (Text und/oder Anhang) + Push an die anderen
 *           Mitglieder (respektiert push_team_chats)
 *  PATCH  → Name/Emoji/Mitglieder ändern (Admins/Gastgeber)
 *  DELETE → Gruppe löschen (Admins/Gastgeber)
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

async function membership(chatId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from('team_chat_members').select('chat_id').eq('chat_id', chatId).eq('user_id', userId).maybeSingle()
  return !!data
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getTaskAuth()
  if (!auth) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  if (!(await membership(id, auth.userId))) return NextResponse.json({ error: 'Kein Mitglied.' }, { status: 403 })

  // ?media=1 → nur Anhänge (Medien-Galerie der Gruppen-Info), neueste zuerst
  // ?peek=1  → NICHT als gelesen markieren (Hintergrund-Polling, §122-Badge-Fix)
  const search = new URL(req.url).searchParams
  const mediaOnly = search.get('media') === '1'
  const peek = search.get('peek') === '1'

  const buildQuery = (withReply: boolean) => {
    let q = supabaseAdmin
      .from('team_messages')
      .select(`id, sender_id, content, attachment_url, attachment_type, attachment_name, reactions${withReply ? ', reply_to_id' : ''}, created_at, profiles(display_name, avatar_url)`)
      .eq('chat_id', id)
    return mediaOnly
      ? q.not('attachment_url', 'is', null).order('created_at', { ascending: false }).limit(400)
      : q.order('created_at', { ascending: true }).limit(300)
  }
  // Deploy-Retry: reply_to_id existiert erst nach Migration 20260719_team_reply.
  // Breiter Typ nötig: supabase-js kann den DYNAMISCHEN Select-String nicht
  // parsen (ParserError-Typ, §95-Lektion)
  type MsgRow = {
    id: string; sender_id: string; content: string
    attachment_url: string | null; attachment_type: string | null; attachment_name: string | null
    reactions?: Record<string, string[]>; reply_to_id?: string | null; created_at: string
    profiles: { display_name?: string; avatar_url?: string } | { display_name?: string; avatar_url?: string }[] | null
  }
  type MsgRes = { data: MsgRow[] | null; error: { message: string } | null }
  let res = (await buildQuery(true)) as unknown as MsgRes
  if (res.error) res = (await buildQuery(false)) as unknown as MsgRes
  if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 })
  const msgs = res.data

  if (!mediaOnly && !peek) {
    await supabaseAdmin
      .from('team_chat_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('chat_id', id).eq('user_id', auth.userId)
  }

  return NextResponse.json({
    messages: (msgs ?? []).map((m) => {
      const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
      return {
        id: m.id,
        senderId: m.sender_id,
        senderName: (p?.display_name ?? '').trim().split(/\s+/)[0] || 'Team',
        senderAvatar: p?.avatar_url ?? null,
        content: m.content,
        attachmentUrl: m.attachment_url,
        attachmentType: m.attachment_type,
        attachmentName: m.attachment_name,
        reactions: m.reactions ?? {},
        replyToId: m.reply_to_id ?? null,
        createdAt: m.created_at,
      }
    }),
  }, NO_STORE)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getTaskAuth()
  if (!auth) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  if (!(await membership(id, auth.userId))) return NextResponse.json({ error: 'Kein Mitglied.' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const content = typeof body.content === 'string' ? body.content.trim().slice(0, 4000) : ''
  const attachmentUrl = typeof body.attachmentUrl === 'string' && body.attachmentUrl ? body.attachmentUrl : null
  const attachmentType = ['image', 'video', 'pdf', 'audio'].includes(body.attachmentType) ? body.attachmentType : null
  const attachmentName = typeof body.attachmentName === 'string' ? body.attachmentName.slice(0, 160) : null
  if (!content && !attachmentUrl) return NextResponse.json({ error: 'Leere Nachricht.' }, { status: 400 })

  // ↩︎ Antwort auf eine Nachricht (iMessage-Zitat): nur gültig, wenn die
  // zitierte Nachricht in DIESEM Chat existiert
  let replyToId: string | null = null
  if (typeof body.replyToId === 'string' && body.replyToId) {
    const { data: orig } = await supabaseAdmin
      .from('team_messages').select('id').eq('id', body.replyToId).eq('chat_id', id).maybeSingle()
    if (orig) replyToId = orig.id
  }

  const row = {
    chat_id: id, sender_id: auth.userId, content,
    attachment_url: attachmentUrl, attachment_type: attachmentUrl ? attachmentType : null, attachment_name: attachmentName,
  }
  // Deploy-Retry: reply_to_id existiert erst nach Migration 20260719_team_reply
  let { data: msg, error } = replyToId
    ? await supabaseAdmin.from('team_messages').insert({ ...row, reply_to_id: replyToId }).select('id').single()
    : await supabaseAdmin.from('team_messages').insert(row).select('id').single()
  if (error && replyToId) ({ data: msg, error } = await supabaseAdmin.from('team_messages').insert(row).select('id').single())
  if (error || !msg) return NextResponse.json({ error: error?.message ?? 'Senden fehlgeschlagen.' }, { status: 500 })

  // Eigener Lesestand mitziehen (die eigene Nachricht zählt nicht als ungelesen)
  await supabaseAdmin
    .from('team_chat_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('chat_id', id).eq('user_id', auth.userId)

  // Push an die anderen Mitglieder (fire-and-forget), push_team_chats respektieren
  ;(async () => {
    const [{ data: chat }, { data: members }, { data: me }] = await Promise.all([
      supabaseAdmin.from('team_chats').select('name, emoji').eq('id', id).maybeSingle(),
      supabaseAdmin.from('team_chat_members').select('user_id, profiles(push_team_chats)').eq('chat_id', id).neq('user_id', auth.userId),
      supabaseAdmin.from('profiles').select('display_name').eq('id', auth.userId).maybeSingle(),
    ])
    const sender = (me?.display_name ?? '').trim().split(/\s+/)[0] || 'Team'
    // Sprachnachricht: Push zeigt das Transkript MIT 🎙️-Hinweis (iMessage-Stil)
    const preview = attachmentType === 'audio'
      ? `🎙️ ${content || 'Sprachnachricht'}`
      : content || (attachmentType === 'image' ? '📷 Foto' : attachmentType === 'video' ? '🎬 Video' : '📄 PDF')
    for (const m of members ?? []) {
      const p = (Array.isArray(m.profiles) ? m.profiles[0] : m.profiles) as { push_team_chats?: boolean } | null
      if (p && p.push_team_chats === false) continue
      sendPushToUser(m.user_id, `${chat?.emoji ?? '💬'} ${chat?.name ?? 'Team'} · ${sender}`, preview, '/team?tab=intern', `intern-${id}`).catch(() => {})
    }
  })().catch((e) => console.error('[team-chat] push:', e))

  return NextResponse.json({ id: msg.id })
}

/** Verwalten dürfen Admins ODER der Ersteller der Gruppe (Staff, 19.7.). */
async function canManageChat(chatId: string, userId: string, role: string): Promise<boolean> {
  if (role === 'admin') return true
  if (role === 'provider') return false
  const { data } = await supabaseAdmin.from('team_chats').select('created_by').eq('id', chatId).maybeSingle()
  return data?.created_by === userId
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getTaskAuth()
  if (!auth || !(await canManageChat(id, auth.userId, auth.role))) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  if (typeof body.name === 'string' && body.name.trim()) {
    const { error } = await supabaseAdmin.from('team_chats')
      .update({ name: body.name.trim().slice(0, 60), ...(typeof body.emoji === 'string' && body.emoji.trim() ? { emoji: body.emoji.trim().slice(0, 4) } : {}) })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (Array.isArray(body.memberIds)) {
    const ids = [...new Set(body.memberIds.filter((x: unknown) => typeof x === 'string'))] as string[]
    if (ids.length === 0) return NextResponse.json({ error: 'Mindestens ein Mitglied.' }, { status: 400 })
    const { data: current } = await supabaseAdmin.from('team_chat_members').select('user_id').eq('chat_id', id)
    const currentIds = new Set((current ?? []).map((m) => m.user_id))
    const toAdd = ids.filter((x) => !currentIds.has(x))
    const toRemove = [...currentIds].filter((x) => !ids.includes(x))
    if (toAdd.length) {
      await supabaseAdmin.from('team_chat_members').insert(toAdd.map((uid) => ({ chat_id: id, user_id: uid })))
    }
    if (toRemove.length) {
      await supabaseAdmin.from('team_chat_members').delete().eq('chat_id', id).in('user_id', toRemove)
    }
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getTaskAuth()
  if (!auth || !(await canManageChat(id, auth.userId, auth.role))) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  }
  const { error } = await supabaseAdmin.from('team_chats').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
