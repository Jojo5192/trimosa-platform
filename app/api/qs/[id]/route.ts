import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTaskAuth, type TaskAuth } from '@/lib/tasks'
import { isDayFree, getQsTemplateStore, resolveQsTemplate, QS_MAX_SHIFT_DAYS, type QsSection } from '@/lib/qs'
import { generateQsPdf } from '@/lib/qs-pdf'
import { sendPushToTeam, sendPushToUser } from '@/lib/push'

/**
 * Einzelner QS-Check:
 *  PATCH — { dueDate, force? }   verschieben (Assignee/Admin); belegter Tag
 *                                → 409 mit Warnung, force:true überschreibt
 *          { report }            Protokoll zwischenspeichern
 *          { complete, report }  abschließen → PDF erzeugen + ablegen
 *  DELETE — Admin entfernt einen geplanten Termin.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 120
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

type CheckRow = {
  id: string; listing_id: string; assignee_id: string | null; due_date: string
  status: string; report: unknown; photos: unknown; completed_at: string | null
}

function canTouch(me: TaskAuth, check: CheckRow): boolean {
  return me.role === 'admin' || check.assignee_id === me.userId
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const me = await getTaskAuth()
  if (!me) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { data: check } = await supabaseAdmin.from('qs_checks').select('*').eq('id', id).maybeSingle()
  if (!check) return NextResponse.json({ error: 'Termin nicht gefunden.' }, { status: 404 })
  if (!canTouch(me, check)) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const now = new Date()

  /* ── PDF auf Abruf (Archiv-Ansicht) — einmal erzeugt, dann gecacht ── */
  if (body.generatePdf) {
    if (check.status !== 'erledigt') return NextResponse.json({ error: 'Erst nach Abschluss möglich.' }, { status: 400 })
    if (check.pdf_url) return NextResponse.json({ ok: true, pdfUrl: check.pdf_url }, NO_STORE)
    const [{ data: listing }, { data: inspector }] = await Promise.all([
      supabaseAdmin.from('listings').select('title, location_group').eq('id', check.listing_id).maybeSingle(),
      check.completed_by
        ? supabaseAdmin.from('profiles').select('display_name').eq('id', check.completed_by).maybeSingle()
        : Promise.resolve({ data: null as { display_name: string | null } | null }),
    ])
    // Snapshot der Abschluss-Checkliste bevorzugen — sonst aktuelle Auflösung
    const snapTpl = (check.report as { template?: QsSection[] } | null)?.template
    const template = Array.isArray(snapTpl) && snapTpl.length
      ? snapTpl
      : resolveQsTemplate(await getQsTemplateStore(), check.listing_id, listing?.location_group)
    const pdfUrl = await generateQsPdf({
      checkId: id,
      listingTitle: listing?.title ?? 'Wohnung',
      dueDate: check.due_date,
      completedAt: check.completed_at ? new Date(check.completed_at) : now,
      inspectorName: (inspector?.display_name ?? '').trim() || 'Team',
      report: check.report ?? {},
      photos: (Array.isArray(check.photos) ? check.photos : []) as { url: string }[],
      template,
    })
    if (!pdfUrl) return NextResponse.json({ error: 'PDF-Erzeugung fehlgeschlagen.' }, { status: 500 })
    await supabaseAdmin.from('qs_checks').update({ pdf_url: pdfUrl, updated_at: now.toISOString() }).eq('id', id)
    return NextResponse.json({ ok: true, pdfUrl }, NO_STORE)
  }

  /* ── Verschieben ── */
  if (typeof body.dueDate === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)) return NextResponse.json({ error: 'Ungültiges Datum.' }, { status: 400 })
    if (check.status !== 'geplant') return NextResponse.json({ error: 'Termin ist bereits abgeschlossen.' }, { status: 400 })
    // „Nicht zu weit verschiebbar": Nicht-Admins max. 6 Wochen im Voraus
    if (me.role !== 'admin') {
      const maxIso = new Date(Date.now() + QS_MAX_SHIFT_DAYS * 86400_000).toISOString().slice(0, 10)
      if (body.dueDate > maxIso) {
        return NextResponse.json({ error: `Maximal ${QS_MAX_SHIFT_DAYS / 7} Wochen im Voraus verschiebbar — bei Dauerbelegung bitte kurz mit dem Team abstimmen.` }, { status: 400 })
      }
    }
    if (!body.force) {
      const free = await isDayFree(check.listing_id, body.dueDate)
      if (!free) {
        return NextResponse.json({
          warning: 'Die Wohnung ist an diesem Tag belegt (oder An-/Abreisetag). Trotzdem so eintragen?',
        }, { status: 409 })
      }
    }
    const { error } = await supabaseAdmin
      .from('qs_checks')
      .update({ due_date: body.dueDate, updated_at: now.toISOString() })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // Admin verschiebt fremden Termin → zuständige Person informieren
    if (check.assignee_id && check.assignee_id !== me.userId) {
      const [y, m, d] = body.dueDate.split('-')
      sendPushToUser(check.assignee_id, '🧾 QS-Termin verschoben', `Neuer Termin: ${Number(d)}.${Number(m)}.${y}`, '/team?tab=aufgaben').catch(() => {})
    }
    return NextResponse.json({ ok: true, dueDate: body.dueDate }, NO_STORE)
  }

  /* ── Protokoll speichern / abschließen ── */
  if (body.report != null || body.complete) {
    if (check.status !== 'geplant') return NextResponse.json({ error: 'Termin ist bereits abgeschlossen.' }, { status: 400 })
    const report = body.report != null && typeof body.report === 'object' ? body.report : (check.report ?? {})

    if (!body.complete) {
      const { error } = await supabaseAdmin
        .from('qs_checks')
        .update({ report, updated_at: now.toISOString() })
        .eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true }, NO_STORE)
    }

    /* Abschluss: Protokoll fixieren — PDF entsteht erst auf Abruf im Archiv.
       Die beim Abschluss gültige Checkliste wird als Snapshot mitgespeichert,
       damit spätere Vorlagen-Änderungen alte Protokolle nicht verfälschen. */
    const [{ data: listing }, { data: inspector }, tplStore] = await Promise.all([
      supabaseAdmin.from('listings').select('title, location_group').eq('id', check.listing_id).maybeSingle(),
      supabaseAdmin.from('profiles').select('display_name').eq('id', me.userId).maybeSingle(),
      getQsTemplateStore(),
    ])
    const inspectorName = (inspector?.display_name ?? '').trim() || 'Team'
    const snapshot = {
      ...report,
      template: resolveQsTemplate(tplStore, check.listing_id, listing?.location_group),
    }

    const { error } = await supabaseAdmin
      .from('qs_checks')
      .update({
        report: snapshot, status: 'erledigt',
        completed_at: now.toISOString(), completed_by: me.userId, updated_at: now.toISOString(),
      })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    /* Festgestellte Mängel → Aufgaben-VORSCHLÄGE (Admin reviewt/priorisiert/
       weist zu — wie bei den KI-Vorschlägen). Elektro/Sicherheit = prio hoch.
       Dedupe gegen bestehende offene Aufgaben/Vorschläge derselben Wohnung. */
    let maengelCount = 0
    try {
      const items = (report.items ?? {}) as Record<string, { s?: string; note?: string }>
      const defects: { title: string; description: string; prio: string }[] = []
      for (const sec of snapshot.template) {
        for (const item of sec.items) {
          const v = items[item.id]
          if (v?.s !== 'mangel') continue
          defects.push({
            title: `${item.label} — ${listing?.title ?? 'Wohnung'}`.slice(0, 120),
            description: `Aus dem QS-Protokoll vom ${now.toLocaleDateString('de-DE')} (geprüft von ${inspectorName}):\n„${(v.note ?? '').trim() || 'Mangel festgestellt'}“\nBereich: ${sec.title}`,
            prio: sec.id === 'elektro' || sec.id === 'sicherheit' ? 'hoch' : 'mittel',
          })
        }
      }
      maengelCount = defects.length
      if (defects.length) {
        const { data: existing } = await supabaseAdmin
          .from('tasks').select('title')
          .eq('listing_id', check.listing_id)
          .in('status', ['vorschlag', 'offen', 'in_arbeit'])
        const have = new Set((existing ?? []).map((t) => t.title))
        const rows = defects.filter((d) => !have.has(d.title)).map((d) => ({
          title: d.title, description: d.description,
          source: 'qs', source_ref: id,
          listing_id: check.listing_id, prio: d.prio,
          status: 'vorschlag', visibility: 'admin', created_by: me.userId,
        }))
        if (rows.length) await supabaseAdmin.from('tasks').insert(rows)
      }
    } catch (e) { console.error('[qs] defect suggestions failed:', e) }

    sendPushToTeam(
      '🧾 QS-Protokoll abgeschlossen',
      `${listing?.title ?? 'Wohnung'} — geprüft von ${inspectorName.split(/\s+/)[0]}${maengelCount ? ` · ${maengelCount === 1 ? '1 Mangel' : `${maengelCount} Mängel`} → Aufgaben-Vorschläge` : ' · ohne Mängel'}`,
      '/team?tab=aufgaben'
    ).catch(() => {})
    return NextResponse.json({ ok: true }, NO_STORE)
  }

  return NextResponse.json({ error: 'Nichts zu ändern.' }, { status: 400 })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const me = await getTaskAuth()
  if (!me || me.role !== 'admin') return NextResponse.json({ error: 'Nur für Admins/Gastgeber.' }, { status: 403 })
  const { error } = await supabaseAdmin.from('qs_checks').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true }, NO_STORE)
}
