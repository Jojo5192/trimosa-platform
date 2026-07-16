import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendPushToUser } from '@/lib/push'
import { getTaskAuth, TASK_PRIOS as PRIOS } from '@/lib/tasks'

/**
 * PATCH /api/tasks/[id]
 *  manage:  alle Felder (Zuordnung, Prio, Rotfrist, Zuweisung, Status, verwerfen)
 *  sonst:   nur die EIGENE (zugewiesene) Aufgabe, nur Status offen ⇄ in_arbeit ⇄ erledigt
 * DELETE — nur mit manage-Recht.
 */
const STATUS = ['vorschlag', 'offen', 'in_arbeit', 'erledigt', 'verworfen']
const OWN_STATUS = ['offen', 'in_arbeit', 'erledigt']

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getTaskAuth()
  if (!auth) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  const { data: task } = await supabaseAdmin.from('tasks').select('*').eq('id', id).maybeSingle()
  if (!task) return NextResponse.json({ error: 'Aufgabe nicht gefunden.' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const upd: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (!auth.manage) {
    if (task.assignee_id !== auth.userId) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
    if (!OWN_STATUS.includes(body.status)) return NextResponse.json({ error: 'Ungültiger Status.' }, { status: 400 })
    upd.status = body.status
  } else {
    if (typeof body.title === 'string' && body.title.trim()) upd.title = body.title.trim().slice(0, 200)
    if (typeof body.description === 'string') upd.description = body.description.trim().slice(0, 4000)
    if (PRIOS.includes(body.prio)) upd.prio = body.prio
    if (STATUS.includes(body.status)) upd.status = body.status
    if ('due_date' in body) {
      upd.due_date = typeof body.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.due_date) ? body.due_date : null
    }
    if ('assignee_id' in body) {
      upd.assignee_id = typeof body.assignee_id === 'string' && body.assignee_id ? body.assignee_id : null
    }
    // Zuordnung: genau eine Welt (Wohnung > Standort > allgemein)
    if ('listing_id' in body || 'location_group' in body || 'is_general' in body) {
      const listingId = typeof body.listing_id === 'string' && body.listing_id ? body.listing_id : null
      const locationGroup = typeof body.location_group === 'string' && body.location_group.trim() ? body.location_group.trim() : null
      upd.listing_id = listingId
      upd.location_group = listingId ? null : locationGroup
      upd.is_general = !listingId && !locationGroup
    }
  }

  const status = (upd.status as string | undefined) ?? task.status
  if (status === 'erledigt' && task.status !== 'erledigt') upd.completed_at = new Date().toISOString()
  if (status !== 'erledigt' && task.status === 'erledigt') upd.completed_at = null

  const { data: saved, error } = await supabaseAdmin.from('tasks').update(upd).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Neu-/Umzuweisung → Push an den Empfänger
  const newAssignee = upd.assignee_id as string | null | undefined
  if (typeof newAssignee === 'string' && newAssignee && newAssignee !== task.assignee_id && newAssignee !== auth.userId) {
    sendPushToUser(newAssignee, '✅ Neue Aufgabe für dich', saved.title, '/team?tab=aufgaben')
      .catch((e) => console.error('[tasks] assign push:', e))
  }

  return NextResponse.json({ task: saved })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getTaskAuth()
  if (!auth || !auth.manage) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { error } = await supabaseAdmin.from('tasks').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
