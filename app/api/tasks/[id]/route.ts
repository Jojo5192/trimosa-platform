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

  // Admin-Schutz: von Admins/Gastgebern erstellte Aufgaben dürfen Nicht-Admins
  // NICHT verändern — nur den Status ihrer eigenen (zugewiesenen) abarbeiten.
  let editable = auth.role === 'admin'
  if (!editable && auth.manage) {
    const { data: creator } = task.created_by
      ? await supabaseAdmin.from('profiles').select('is_admin, is_host').eq('id', task.created_by).maybeSingle()
      : { data: null }
    editable = !(creator?.is_admin || creator?.is_host)
  }

  if (!auth.manage || !editable) {
    if (task.assignee_id !== auth.userId && task.created_by !== auth.userId) {
      return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
    }
    if (!OWN_STATUS.includes(body.status)) return NextResponse.json({ error: 'Ungültiger Status.' }, { status: 400 })
    upd.status = body.status
  } else {
    if (typeof body.title === 'string' && body.title.trim()) upd.title = body.title.trim().slice(0, 200)
    if (typeof body.description === 'string') upd.description = body.description.trim().slice(0, 4000)
    if (PRIOS.includes(body.prio)) upd.prio = body.prio
    if (STATUS.includes(body.status)) upd.status = body.status
    if (['admin', 'team', 'alle'].includes(body.visibility)) upd.visibility = body.visibility
    if ('recur_days' in body) {
      upd.recur_days = Number.isInteger(body.recur_days) && body.recur_days >= 1 && body.recur_days <= 365 ? body.recur_days : null
    }
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

  let { data: saved, error } = await supabaseAdmin.from('tasks').update(upd).eq('id', id).select('*').single()
  if (error && /visibility|recur_days|photos/i.test(error.message)) {
    delete upd.visibility
    delete upd.recur_days
    ;({ data: saved, error } = await supabaseAdmin.from('tasks').update(upd).eq('id', id).select('*').single())
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 🔁 Wiederkehrende Aufgabe erledigt → nächste Ausgabe automatisch anlegen
  // (Rotfrist = heute + Intervall; Fotos/Kommentare wandern NICHT mit — die
  // erledigte Aufgabe bleibt als Historie stehen).
  if (status === 'erledigt' && task.status !== 'erledigt' && saved.recur_days) {
    const next = new Date(Date.now() + saved.recur_days * 86400_000).toISOString().slice(0, 10)
    await supabaseAdmin.from('tasks').insert({
      title: saved.title,
      description: saved.description,
      source: saved.source,
      listing_id: saved.listing_id,
      location_group: saved.location_group,
      is_general: saved.is_general,
      prio: saved.prio,
      status: 'offen',
      visibility: saved.visibility ?? 'admin',
      assignee_id: saved.assignee_id,
      due_date: next,
      recur_days: saved.recur_days,
      created_by: saved.created_by,
    }).then(({ error: e }) => { if (e) console.error('[tasks] recur insert:', e.message) })
  }

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
  if (auth.role !== 'admin') {
    // Nicht-Admins dürfen Admin-/Gastgeber-Aufgaben auch nicht löschen
    const { data: task } = await supabaseAdmin.from('tasks').select('created_by').eq('id', id).maybeSingle()
    if (!task) return NextResponse.json({ error: 'Aufgabe nicht gefunden.' }, { status: 404 })
    const { data: creator } = task.created_by
      ? await supabaseAdmin.from('profiles').select('is_admin, is_host').eq('id', task.created_by).maybeSingle()
      : { data: null }
    if (creator?.is_admin || creator?.is_host) {
      return NextResponse.json({ error: 'Nur Admins können diese Aufgabe löschen.' }, { status: 403 })
    }
  }
  const { error } = await supabaseAdmin.from('tasks').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
