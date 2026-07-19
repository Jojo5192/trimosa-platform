import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTaskAuth } from '@/lib/tasks'

/**
 * 💼 Interner Team-Messenger:
 *  GET  → meine Gruppen (mit Mitgliedern, letzter Nachricht, Unread) +
 *         Team-Verzeichnis (für Gruppen-Erstellung durch Admins/Gastgeber)
 *  POST → neue Gruppe { name, emoji, memberIds } (nur Admins/Gastgeber)
 * Auch Dienstleister haben Zugriff — sie sehen NUR ihre internen Gruppen.
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

export async function GET() {
  const auth = await getTaskAuth()
  if (!auth) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  const { data: memberships, error: mErr } = await supabaseAdmin
    .from('team_chat_members')
    .select('chat_id, last_read_at, team_chats(id, name, emoji, created_by)')
    .eq('user_id', auth.userId)
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })

  const chatIds = (memberships ?? []).map((m) => m.chat_id)

  // Mitglieder aller meiner Chats (Namen + Avatare für die Anzeige)
  const memberNames = new Map<string, { id: string; name: string; avatar: string | null }[]>()
  if (chatIds.length) {
    const { data: allMembers } = await supabaseAdmin
      .from('team_chat_members')
      .select('chat_id, user_id, profiles(display_name, avatar_url)')
      .in('chat_id', chatIds)
    for (const m of allMembers ?? []) {
      const p = (Array.isArray(m.profiles) ? m.profiles[0] : m.profiles) as { display_name?: string; avatar_url?: string } | null
      const arr = memberNames.get(m.chat_id) ?? []
      arr.push({
        id: m.user_id,
        name: (p?.display_name ?? '').trim().split(/\s+/)[0] || 'Team',
        avatar: p?.avatar_url ?? null,
      })
      memberNames.set(m.chat_id, arr)
    }
  }

  // Letzte Nachricht + Unread je Chat (eine Query, Auswertung in JS)
  const lastMsg = new Map<string, { content: string; at: string; senderId: string; attachmentType: string | null }>()
  const unread = new Map<string, number>()
  if (chatIds.length) {
    const { data: msgs } = await supabaseAdmin
      .from('team_messages')
      .select('chat_id, content, created_at, sender_id, attachment_type')
      .in('chat_id', chatIds)
      .order('created_at', { ascending: false })
      .limit(600)
    const readAt = new Map((memberships ?? []).map((m) => [m.chat_id, m.last_read_at as string]))
    for (const m of msgs ?? []) {
      if (!lastMsg.has(m.chat_id)) {
        lastMsg.set(m.chat_id, { content: m.content, at: m.created_at, senderId: m.sender_id, attachmentType: m.attachment_type })
      }
      const r = readAt.get(m.chat_id)
      if (r && m.created_at > r && m.sender_id !== auth.userId) {
        unread.set(m.chat_id, (unread.get(m.chat_id) ?? 0) + 1)
      }
    }
  }

  const chats = (memberships ?? [])
    .map((m) => {
      const c = (Array.isArray(m.team_chats) ? m.team_chats[0] : m.team_chats) as { id: string; name: string; emoji: string; created_by: string | null } | null
      if (!c) return null
      const last = lastMsg.get(c.id)
      return {
        id: c.id,
        name: c.name,
        emoji: c.emoji,
        createdBy: c.created_by,
        members: memberNames.get(c.id) ?? [],
        lastAt: last?.at ?? null,
        lastPreview: last
          ? (last.attachmentType === 'image' ? '📷 Foto' : last.attachmentType === 'video' ? '🎬 Video' : last.attachmentType === 'pdf' ? '📄 PDF' : last.content.slice(0, 90))
          : null,
        lastFromMe: last?.senderId === auth.userId,
        unread: unread.get(c.id) ?? 0,
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b!.lastAt ?? '').localeCompare(a!.lastAt ?? ''))

  // Team-Verzeichnis für die Gruppen-Erstellung (nur Verwalter brauchen es)
  let directory: { id: string; name: string; role: string }[] = []
  if (auth.role === 'admin') {
    const { data: team } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, is_admin, is_host, is_staff, is_provider')
      .or('is_admin.eq.true,is_host.eq.true,is_staff.eq.true,is_provider.eq.true')
      .order('display_name')
    directory = (team ?? []).map((p) => ({
      id: p.id,
      name: (p.display_name as string | null)?.trim() || 'Ohne Namen',
      role: p.is_admin || p.is_host ? 'Chef-Etage' : p.is_staff ? 'Team' : 'Dienstleister',
    }))
  }

  return NextResponse.json({ userId: auth.userId, canCreate: auth.role === 'admin', chats, directory }, NO_STORE)
}

export async function POST(req: NextRequest) {
  const auth = await getTaskAuth()
  if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Nur Admins/Gastgeber können Gruppen anlegen.' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : ''
  if (!name) return NextResponse.json({ error: 'Name fehlt.' }, { status: 400 })
  const emoji = typeof body.emoji === 'string' && body.emoji.trim() ? body.emoji.trim().slice(0, 4) : '💬'
  const memberIds: string[] = Array.isArray(body.memberIds) ? body.memberIds.filter((x: unknown) => typeof x === 'string') : []

  const { data: chat, error } = await supabaseAdmin
    .from('team_chats').insert({ name, emoji, created_by: auth.userId }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = [...new Set([auth.userId, ...memberIds])]
  const { error: mErr } = await supabaseAdmin
    .from('team_chat_members')
    .insert(ids.map((uid) => ({ chat_id: chat.id, user_id: uid })))
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })

  return NextResponse.json({ id: chat.id })
}
