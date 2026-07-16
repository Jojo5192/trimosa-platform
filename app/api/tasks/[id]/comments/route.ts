import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendPushToUser } from '@/lib/push'
import { getTaskAuth, canSeeTask } from '@/lib/tasks'

/**
 * Kommentare zu einer Aufgabe (Team + Zugewiesene/Ersteller):
 *  GET  → Liste mit Autoren-Vornamen
 *  POST → { content } anlegen; pusht den Zugewiesenen (falls nicht selbst)
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

async function loadAccess(id: string) {
  const auth = await getTaskAuth()
  if (!auth) return { error: NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 }) }
  const { data: task } = await supabaseAdmin.from('tasks').select('*').eq('id', id).maybeSingle()
  if (!task) return { error: NextResponse.json({ error: 'Aufgabe nicht gefunden.' }, { status: 404 }) }
  if (!canSeeTask(auth, task)) return { error: NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 }) }
  return { auth, task }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await loadAccess(id)
  if ('error' in access) return access.error

  const { data: comments } = await supabaseAdmin
    .from('task_comments')
    .select('id, author_id, content, created_at')
    .eq('task_id', id)
    .order('created_at', { ascending: true })
    .limit(200)

  const authorIds = [...new Set((comments ?? []).map((c) => c.author_id).filter(Boolean))] as string[]
  const names = new Map<string, string>()
  if (authorIds.length) {
    const { data: profs } = await supabaseAdmin.from('profiles').select('id, display_name').in('id', authorIds)
    for (const p of profs ?? []) names.set(p.id, ((p.display_name as string | null) ?? '').trim().split(/\s+/)[0] || '—')
  }

  return NextResponse.json({
    comments: (comments ?? []).map((c) => ({
      id: c.id,
      author: c.author_id ? names.get(c.author_id) ?? '—' : '—',
      mine: c.author_id === access.auth.userId,
      content: c.content,
      created_at: c.created_at,
    })),
  }, NO_STORE)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await loadAccess(id)
  if ('error' in access) return access.error

  const body = await req.json().catch(() => ({}))
  const content = typeof body.content === 'string' ? body.content.trim().slice(0, 2000) : ''
  if (!content) return NextResponse.json({ error: 'Kommentar ist leer.' }, { status: 400 })

  const { data: comment, error } = await supabaseAdmin
    .from('task_comments')
    .insert({ task_id: id, author_id: access.auth.userId, content })
    .select('id, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Zugewiesenen informieren (falls jemand anderes kommentiert)
  const assignee = access.task.assignee_id as string | null
  if (assignee && assignee !== access.auth.userId) {
    sendPushToUser(assignee, `💬 Kommentar zu: ${access.task.title}`, content, '/team?tab=aufgaben')
      .catch((e) => console.error('[tasks] comment push:', e))
  }

  return NextResponse.json({ ok: true, id: comment.id }, NO_STORE)
}
