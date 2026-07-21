import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendPushToUser } from '@/lib/push'
import { getTaskAuth, TASK_PRIOS as PRIOS } from '@/lib/tasks'

/**
 * Aufgaben-API (Team-App). Rechte sind admin-konfigurierbar (lib/tasks):
 *  viewAll=false → nur Aufgaben, die einem zugewiesen sind ODER die man selbst
 *  angelegt hat. manage=false → kein Anlegen/Bearbeiten, nur Status der eigenen.
 * Zuweisung pusht den Empfänger („✅ Neue Aufgabe") auf /team?tab=aufgaben.
 */

// iOS-PWA cachte API-Antworten (Safari lieferte dann leere/stale Bodies →
// „string did not match the expected pattern") → niemals cachen
export const dynamic = 'force-dynamic'
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

export async function GET() {
  const auth = await getTaskAuth()
  if (!auth) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  let query = supabaseAdmin.from('tasks').select('*').order('created_at', { ascending: false }).limit(500)
  if (auth.role !== 'admin') {
    // Sichtbar: eigene (zugewiesen/selbst angelegt) + je nach Rollen-Recht die
    // für die Gruppe FREIGEGEBENEN Aufgaben (visibility). Admin-Aufgaben
    // ('admin', Default) sieht außer dem Zugewiesenen niemand.
    const own = `assignee_id.eq.${auth.userId},created_by.eq.${auth.userId}`
    if (!auth.viewAll) query = query.or(own)
    else if (auth.role === 'staff') query = query.or(`${own},visibility.in.(team,alle)`)
    else query = query.or(`${own},visibility.eq.alle`)
    query = query.in('status', ['offen', 'in_arbeit', 'erledigt'])
  }
  const { data: tasks, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: listings } = await supabaseAdmin
    .from('listings').select('id, title, location_group').order('title')
  const groups = [...new Set((listings ?? []).map((l) => (l.location_group ?? '').trim()).filter(Boolean))].sort()

  // Personen: Verwalter (manage/viewAll) bekommen die komplette Team-Liste
  // (Zuweisungs-Dropdown + Personen-Filter); sonst nur Namen der Beteiligten.
  let people: { id: string; name: string; isProvider: boolean }[] = []
  if (auth.manage || auth.viewAll) {
    const { data: profs } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, is_admin, is_host, is_staff, is_provider')
      .or('is_admin.eq.true,is_host.eq.true,is_staff.eq.true,is_provider.eq.true')
      .order('display_name')
    people = (profs ?? []).map((p) => ({
      id: p.id,
      name: (p.display_name as string | null)?.trim() || 'Ohne Namen',
      isProvider: !!p.is_provider && !p.is_admin && !p.is_host && !p.is_staff,
    }))
  } else {
    const ids = [...new Set((tasks ?? []).map((t) => t.assignee_id).filter(Boolean))] as string[]
    if (ids.length) {
      const { data: profs } = await supabaseAdmin.from('profiles').select('id, display_name').in('id', ids)
      people = (profs ?? []).map((p) => ({ id: p.id, name: (p.display_name as string | null)?.trim() || 'Ohne Namen', isProvider: false }))
    }
  }

  // editable je Aufgabe: Admins alles; manage-Nicht-Admins nur Aufgaben, die
  // NICHT von Admins/Gastgebern erstellt wurden (Admin-Schutz).
  let adminCreators = new Set<string>()
  if (auth.role !== 'admin' && auth.manage) {
    const creatorIds = [...new Set((tasks ?? []).map((t) => t.created_by).filter(Boolean))] as string[]
    if (creatorIds.length) {
      const { data: profs } = await supabaseAdmin
        .from('profiles').select('id, is_admin, is_host').in('id', creatorIds)
      adminCreators = new Set((profs ?? []).filter((p) => p.is_admin || p.is_host).map((p) => p.id))
    }
  }
  const withEditable = (tasks ?? []).map((t) => ({
    ...t,
    editable: auth.role === 'admin' || (auth.manage && !(t.created_by && adminCreators.has(t.created_by))),
  }))

  // Kommentar-Zähler der sichtbaren Aufgaben (ein Query, Zählung in JS)
  const taskIds = (tasks ?? []).map((t) => t.id)
  const commentCounts: Record<string, number> = {}
  if (taskIds.length) {
    const { data: rows } = await supabaseAdmin
      .from('task_comments').select('task_id').in('task_id', taskIds).limit(3000)
    for (const r of rows ?? []) commentCounts[r.task_id] = (commentCounts[r.task_id] ?? 0) + 1
  }

  return NextResponse.json({
    userId: auth.userId,
    role: auth.role,
    viewAll: auth.viewAll,
    manage: auth.manage,
    tasks: withEditable,
    commentCounts,
    people,
    listings: (listings ?? []).map((l) => ({ id: l.id, title: l.title })),
    groups,
  }, NO_STORE)
}

export async function POST(req: NextRequest) {
  const auth = await getTaskAuth()
  if (!auth || !auth.manage) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return NextResponse.json({ error: 'Titel fehlt.' }, { status: 400 })

  const listingId = typeof body.listing_id === 'string' && body.listing_id ? body.listing_id : null
  const locationGroup = typeof body.location_group === 'string' && body.location_group.trim() ? body.location_group.trim() : null

  const row = {
    title: title.slice(0, 200),
    description: typeof body.description === 'string' ? body.description.trim().slice(0, 4000) : '',
    listing_id: listingId,
    location_group: listingId ? null : locationGroup,
    is_general: !listingId && !locationGroup,
    prio: PRIOS.includes(body.prio) ? body.prio : 'mittel',
    status: 'offen',
    visibility: ['admin', 'team', 'alle'].includes(body.visibility) ? body.visibility : 'admin',
    assignee_id: typeof body.assignee_id === 'string' && body.assignee_id ? body.assignee_id : null,
    due_date: typeof body.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.due_date) ? body.due_date : null,
    recur_days: Number.isInteger(body.recur_days) && body.recur_days >= 1 && body.recur_days <= 365 ? body.recur_days : null,
    created_by: auth.userId,
  }

  let { data: task, error } = await supabaseAdmin.from('tasks').insert(row).select('*').single()
  if (error && /visibility|recur_days|photos/i.test(error.message)) {
    // Phase-4-/Visibility-Migration noch nicht ausgeführt → ohne neue Spalten anlegen
    delete (row as Record<string, unknown>).visibility
    delete (row as Record<string, unknown>).recur_days
    ;({ data: task, error } = await supabaseAdmin.from('tasks').insert(row).select('*').single())
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (task.assignee_id && task.assignee_id !== auth.userId) {
    await sendPushToUser(task.assignee_id, '✅ Neue Aufgabe für dich', task.title, '/team?tab=aufgaben')
      .catch((e) => console.error('[tasks] assign push:', e))
  }

  return NextResponse.json({ task })
}
