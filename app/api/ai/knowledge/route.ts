import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { backfillSmoobuMessages, refreshChatKnowledge } from '@/lib/chat-knowledge'

/**
 * Chat knowledge base management.
 *   GET  ?secret=CRON_SECRET  → weekly cron: re-distil the knowledge documents
 *   GET  (admin)              → status (archive size, documents, last update)
 *   POST (admin) { action: 'backfill', page } → one history-import page
 *   POST (admin) { action: 'refresh' }        → re-distil now
 */
export const maxDuration = 300

async function requireAdmin() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabaseAdmin
    .from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  return profile?.is_admin ? user : null
}

export async function GET(request: Request) {
  // Vercel cron calls arrive with "Authorization: Bearer ${CRON_SECRET}"
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && request.headers.get('authorization') === `Bearer ${cronSecret}`) {
    const results = await refreshChatKnowledge()
    return NextResponse.json({ cron: true, results })
  }

  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  const [{ count: archiveCount }, { data: docs }] = await Promise.all([
    supabaseAdmin.from('smoobu_message_archive').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('chat_knowledge').select('scope, listing_id, source_count, updated_at, listings(title)'),
  ])
  return NextResponse.json({
    archiveCount: archiveCount ?? 0,
    documents: (docs ?? []).map((d) => ({
      scope: d.scope,
      title: d.scope === 'global' ? 'Allgemein' : ((Array.isArray(d.listings) ? d.listings[0] : d.listings) as { title: string } | null)?.title ?? '—',
      sources: d.source_count,
      updatedAt: d.updated_at,
    })),
  })
}

export async function POST(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  const { action, page } = await request.json()

  if (action === 'backfill') {
    const p = Number.isInteger(page) && page > 0 ? page : 1
    const result = await backfillSmoobuMessages(p)
    return NextResponse.json(result)
  }
  if (action === 'refresh') {
    const results = await refreshChatKnowledge()
    return NextResponse.json({ results })
  }
  return NextResponse.json({ error: 'Unbekannte Aktion.' }, { status: 400 })
}
