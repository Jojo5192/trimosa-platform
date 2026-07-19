import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTaskAuth } from '@/lib/tasks'
import { ensureQsChecks, findFreeDay, getQsTemplateStore, resolveQsTemplate } from '@/lib/qs'

/**
 * 🧾 QS-Termine:
 *  GET  — Cron (Bearer CRON_SECRET): plant fällige Halbjahres-Checks.
 *         Eingeloggt: Liste (Admins/Hosts alle · sonst nur eigene).
 *  POST — Admin legt manuell einen Check an { listingId, dueDate?, assigneeId? }.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

export async function GET(req: NextRequest) {
  // Cron-Pfad
  const auth = req.headers.get('authorization')
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) {
    const result = await ensureQsChecks()
    return NextResponse.json({ ok: true, ...result })
  }

  const me = await getTaskAuth()
  if (!me) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  let query = supabaseAdmin
    .from('qs_checks')
    .select('*')
    .order('due_date', { ascending: true })
    .limit(120)
  if (me.role !== 'admin') query = query.eq('assignee_id', me.userId)
  const { data: checks, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const listingIds = [...new Set((checks ?? []).map((c) => c.listing_id))]
  const userIds = [...new Set((checks ?? []).flatMap((c) => [c.assignee_id, c.completed_by]).filter(Boolean))] as string[]
  const [{ data: listings }, { data: people }, tplStore] = await Promise.all([
    listingIds.length
      ? supabaseAdmin.from('listings').select('id, title, location_group').in('id', listingIds)
      : Promise.resolve({ data: [] as { id: string; title: string; location_group: string | null }[] }),
    userIds.length
      ? supabaseAdmin.from('profiles').select('id, display_name').in('id', userIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
    getQsTemplateStore(),
  ])
  const titleOf = Object.fromEntries((listings ?? []).map((l) => [l.id, l.title]))
  const nameOf = Object.fromEntries((people ?? []).map((p) => [p.id, (p.display_name ?? '').split(/\s+/)[0] || '—']))
  // Aufgelöste Checkliste je betroffener Wohnung (Wohnung > Standort > Standard)
  const templates = Object.fromEntries(
    (listings ?? []).map((l) => [l.id, resolveQsTemplate(tplStore, l.id, l.location_group)])
  )

  return NextResponse.json({
    checks: (checks ?? []).map((c) => ({
      id: c.id,
      listingId: c.listing_id,
      listingTitle: titleOf[c.listing_id] ?? 'Wohnung',
      assigneeId: c.assignee_id,
      assigneeName: c.assignee_id ? nameOf[c.assignee_id] ?? '—' : null,
      dueDate: c.due_date,
      status: c.status,
      report: c.report ?? null,
      photos: Array.isArray(c.photos) ? c.photos : [],
      pdfUrl: c.pdf_url ?? null,
      completedAt: c.completed_at,
      completedByName: c.completed_by ? nameOf[c.completed_by] ?? null : null,
    })),
    templates,
    defaultTemplate: tplStore.base,
    isAdmin: me.role === 'admin',
    me: me.userId,
  }, NO_STORE)
}

export async function POST(req: NextRequest) {
  const me = await getTaskAuth()
  if (!me || me.role !== 'admin') return NextResponse.json({ error: 'Nur für Admins/Gastgeber.' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const listingId = typeof body.listingId === 'string' ? body.listingId : null
  if (!listingId) return NextResponse.json({ error: 'listingId fehlt.' }, { status: 400 })
  const { data: listing } = await supabaseAdmin.from('listings').select('id, title').eq('id', listingId).maybeSingle()
  if (!listing) return NextResponse.json({ error: 'Wohnung nicht gefunden.' }, { status: 404 })

  const from = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10)
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate ?? '') ? body.dueDate : await findFreeDay(listingId, from)
  const assigneeId = typeof body.assigneeId === 'string' && body.assigneeId ? body.assigneeId : null

  const { data, error } = await supabaseAdmin
    .from('qs_checks')
    .insert({ listing_id: listingId, assignee_id: assigneeId, due_date: dueDate, status: 'geplant' })
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id, dueDate }, NO_STORE)
}
