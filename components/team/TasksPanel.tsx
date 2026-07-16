'use client'

/**
 * ✅ Aufgaben-Tab der Team-App.
 *  team:     alle Aufgaben, anlegen/bearbeiten/zuweisen (Prio + Rotfrist),
 *            KI-Vorschläge (Phase 3) erscheinen später als eigener Filter.
 *  provider: nur die eigenen Aufgaben, Status-Buttons (In Arbeit / Erledigt).
 * Rotfrist: due_date überschritten → Aufgabe wird rot markiert + sortiert
 * nach ganz oben.
 */
import { useState, useEffect, useCallback, useMemo, type CSSProperties } from 'react'

export interface Task {
  id: string
  title: string
  description: string
  source: string
  listing_id: string | null
  location_group: string | null
  is_general: boolean
  prio: 'hoch' | 'mittel' | 'niedrig'
  status: 'vorschlag' | 'offen' | 'in_arbeit' | 'erledigt' | 'verworfen'
  assignee_id: string | null
  due_date: string | null
  created_at: string
  visibility?: 'admin' | 'team' | 'alle'
}

const VIS_META: Record<string, string> = {
  admin: '🔒 Nur Admins', team: '👥 + Mitarbeiter', alle: '🌐 Alle',
}

type Person = { id: string; name: string; isProvider: boolean }
type ListingOpt = { id: string; title: string }

const HAIR = '0.5px solid rgba(60,60,67,0.15)'
const PRIO_META: Record<string, { label: string; color: string; bg: string }> = {
  hoch: { label: 'Hoch', color: '#B91C1C', bg: '#FEE2E2' },
  mittel: { label: 'Mittel', color: '#92400E', bg: '#FEF3C7' },
  niedrig: { label: 'Niedrig', color: '#374151', bg: '#F3F4F6' },
}
const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  vorschlag: { label: 'Vorschlag', color: '#6D28D9', bg: '#EDE9FE' },
  offen: { label: 'Offen', color: '#1D4ED8', bg: '#DBEAFE' },
  in_arbeit: { label: 'In Arbeit', color: '#92400E', bg: '#FEF3C7' },
  erledigt: { label: 'Erledigt', color: '#166534', bg: '#DCFCE7' },
  verworfen: { label: 'Verworfen', color: '#6B7280', bg: '#F3F4F6' },
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fmtDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${Number(d)}.${Number(m)}.`
}
function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?'
}

type Filter = 'aktiv' | 'erledigt' | 'alle'

export default function TasksPanel({ role }: { role: 'team' | 'provider'; userId: string }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [listings, setListings] = useState<ListingOpt[]>([])
  const [groups, setGroups] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('aktiv')
  const [personFilter, setPersonFilter] = useState<string>('') // '' = alle · 'none' = ohne · sonst Personen-ID
  const [editing, setEditing] = useState<Task | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Rechte kommen vom Server (admin-konfigurierbar); Startwert = grobe Vermutung
  const [manage, setManage] = useState(role === 'team')
  const [viewAll, setViewAll] = useState(role === 'team')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks')
      const json = await res.json()
      if (res.ok) {
        setTasks(json.tasks ?? [])
        setPeople(json.people ?? [])
        setListings(json.listings ?? [])
        setGroups(json.groups ?? [])
        setManage(!!json.manage)
        setViewAll(!!json.viewAll)
      } else setError(json.error ?? 'Fehler beim Laden.')
    } catch {
      setError('Netzwerkfehler beim Laden.')
    }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const listingTitle = useMemo(() => new Map(listings.map((l) => [l.id, l.title])), [listings])
  const personName = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people])
  const today = todayIso()

  const isOverdue = useCallback((t: Task) =>
    !!t.due_date && t.due_date < today && t.status !== 'erledigt' && t.status !== 'verworfen', [today])

  const visible = useMemo(() => {
    const PRIO_RANK: Record<string, number> = { hoch: 0, mittel: 1, niedrig: 2 }
    return tasks
      .filter((t) => t.status !== 'vorschlag' && t.status !== 'verworfen')
      .filter((t) => filter === 'alle' ? true : filter === 'erledigt' ? t.status === 'erledigt' : t.status !== 'erledigt')
      .filter((t) => !personFilter ? true : personFilter === 'none' ? !t.assignee_id : t.assignee_id === personFilter)
      .sort((a, b) => {
        const oa = isOverdue(a) ? 0 : 1, ob = isOverdue(b) ? 0 : 1
        if (oa !== ob) return oa - ob
        if (a.status === 'erledigt' !== (b.status === 'erledigt')) return a.status === 'erledigt' ? 1 : -1
        const pr = PRIO_RANK[a.prio] - PRIO_RANK[b.prio]
        if (pr !== 0) return pr
        if (a.due_date !== b.due_date) return (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')
        return b.created_at.localeCompare(a.created_at)
      })
  }, [tasks, filter, personFilter, isOverdue])

  const counts = useMemo(() => ({
    aktiv: tasks.filter((t) => ['offen', 'in_arbeit'].includes(t.status)).length,
    erledigt: tasks.filter((t) => t.status === 'erledigt').length,
  }), [tasks])

  async function providerStatus(task: Task, status: 'in_arbeit' | 'erledigt' | 'offen') {
    setTasks((ts) => ts.map((t) => t.id === task.id ? { ...t, status } : t))
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (!res.ok) { setError('Speichern fehlgeschlagen.'); load() }
  }

  function scopeChip(t: Task): string {
    if (t.listing_id) return `🏠 ${listingTitle.get(t.listing_id) ?? 'Wohnung'}`
    if (t.location_group) return `📍 ${t.location_group}`
    return '🏢 Allgemein'
  }

  return (
    // Äußerer Wrapper NICHT scrollbar: iOS klemmt position:fixed-Overlays in
    // -webkit-overflow-scrolling-Containern fest (Sheet läge sonst unter der
    // Tab-Bar und scrollt mit) — Sheet + FAB leben deshalb AUSSERHALB des Scrollers.
    <div style={{ height: '100%', position: 'relative' }}>
    <div style={{ height: '100%', overflowY: 'auto', background: '#F7F7F8', WebkitOverflowScrolling: 'touch' }}>
      {/* Header + Filter */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 5, background: 'rgba(247,247,248,0.9)',
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        padding: '14px 16px 10px', paddingTop: 'max(14px, env(safe-area-inset-top))',
        boxShadow: `inset 0 -0.5px 0 rgba(60,60,67,0.15)`,
      }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 10px', color: '#111', letterSpacing: '-0.4px' }}>Aufgaben</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          {([['aktiv', `Aktiv${counts.aktiv ? ` ${counts.aktiv}` : ''}`], ['erledigt', `Erledigt${counts.erledigt ? ` ${counts.erledigt}` : ''}`], ['alle', 'Alle']] as [Filter, string][]).map(([f, label]) => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '6px 13px', borderRadius: 999, border: 'none', fontSize: 13, fontWeight: 600,
              background: filter === f ? '#111' : 'rgba(120,120,128,0.12)',
              color: filter === f ? '#fff' : '#3C3C43', cursor: 'pointer',
            }}>{label}</button>
          ))}
        </div>
        {/* Personen-Schnellfilter (nur wer alle Aufgaben sieht) */}
        {viewAll && people.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 2 }}>
            {([['', 'Alle Personen'], ['none', 'Nicht zugewiesen'], ...people.map((p) => [p.id, p.name.split(/\s+/)[0]] as [string, string])] as [string, string][]).map(([id, label]) => (
              <button key={id || 'alle'} onClick={() => setPersonFilter(id)} style={{
                padding: '5px 11px', borderRadius: 999, border: 'none', fontSize: 12, fontWeight: 600, flexShrink: 0,
                background: personFilter === id ? 'var(--gold, #AE8D2D)' : 'rgba(120,120,128,0.12)',
                color: personFilter === id ? '#fff' : '#3C3C43', cursor: 'pointer', whiteSpace: 'nowrap',
              }}>{id && id !== 'none' ? `👤 ${label}` : label}</button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div style={{ margin: '10px 16px', padding: '10px 14px', borderRadius: 12, background: '#FEE2E2', color: '#B91C1C', fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ border: 'none', background: 'none', color: '#B91C1C', cursor: 'pointer', fontWeight: 700 }}>✕</button>
        </div>
      )}

      {/* Liste */}
      <div style={{ padding: '12px 16px 100px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading ? (
          <p style={{ textAlign: 'center', color: '#8E8E93', fontSize: 14, padding: 40 }}>Laden…</p>
        ) : visible.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: '#8E8E93' }}>
            <p style={{ fontSize: 40, margin: '0 0 8px' }}>✅</p>
            <p style={{ fontSize: 15, fontWeight: 600, margin: 0, color: '#3C3C43' }}>
              {filter === 'erledigt' ? 'Noch nichts erledigt.' : !viewAll ? 'Keine Aufgaben für dich — alles erledigt!' : 'Keine offenen Aufgaben.'}
            </p>
          </div>
        ) : visible.map((t) => {
          const overdue = isOverdue(t)
          const prio = PRIO_META[t.prio] ?? PRIO_META.mittel
          const st = STATUS_META[t.status] ?? STATUS_META.offen
          const done = t.status === 'erledigt'
          return (
            <div key={t.id}
              onClick={manage ? () => setEditing(t) : undefined}
              style={{
                background: '#fff', borderRadius: 16, padding: '13px 15px',
                boxShadow: overdue ? 'inset 0 0 0 1.5px #EF4444' : `inset 0 0 0 0.5px rgba(60,60,67,0.15)`,
                cursor: manage ? 'pointer' : 'default',
                opacity: done ? 0.65 : 1,
              }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ fontSize: 14.5, fontWeight: 700, color: '#111', flex: 1, textDecoration: done ? 'line-through' : 'none' }}>
                  {t.title}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: st.bg, color: st.color, flexShrink: 0 }}>{st.label}</span>
              </div>
              {t.description && (
                <p style={{ fontSize: 13, color: '#6B7280', margin: '5px 0 0', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                  {t.description.length > 140 && manage ? t.description.slice(0, 140) + '…' : t.description}
                </p>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9, alignItems: 'center' }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 9px', borderRadius: 999, background: prio.bg, color: prio.color }}>{prio.label}</span>
                <span style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 9px', borderRadius: 999, background: '#F3F4F6', color: '#374151' }}>{scopeChip(t)}</span>
                {manage && (
                  <span style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 9px', borderRadius: 999, background: '#F3F4F6', color: '#6B7280' }}>
                    {VIS_META[t.visibility ?? 'admin']}
                  </span>
                )}
                {t.due_date && (
                  <span style={{
                    fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
                    background: overdue ? '#EF4444' : '#F3F4F6', color: overdue ? '#fff' : '#374151',
                  }}>
                    {overdue ? `⚠︎ seit ${fmtDate(t.due_date)}` : `bis ${fmtDate(t.due_date)}`}
                  </span>
                )}
                {t.assignee_id && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: '#374151' }}>
                    <span style={{
                      width: 20, height: 20, borderRadius: '50%', background: 'linear-gradient(135deg, var(--gold, #AE8D2D), #8A7020)',
                      color: '#fff', fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}>{initials(personName.get(t.assignee_id) ?? '?')}</span>
                    {(personName.get(t.assignee_id) ?? '').split(/\s+/)[0]}
                  </span>
                )}
              </div>
              {!manage && !done && (
                <div style={{ display: 'flex', gap: 8, marginTop: 11 }}>
                  {t.status === 'offen' && (
                    <button onClick={() => providerStatus(t, 'in_arbeit')} style={{
                      flex: 1, padding: '9px 0', borderRadius: 12, border: HAIR, background: '#FEF3C7',
                      color: '#92400E', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    }}>▶ In Arbeit</button>
                  )}
                  <button onClick={() => providerStatus(t, 'erledigt')} style={{
                    flex: 1, padding: '9px 0', borderRadius: 12, border: 'none', background: '#16A34A',
                    color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  }}>✓ Erledigt</button>
                </div>
              )}
              {!manage && done && (
                <button onClick={() => providerStatus(t, 'offen')} style={{
                  marginTop: 10, padding: '7px 14px', borderRadius: 10, border: HAIR, background: '#fff',
                  color: '#6B7280', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>↩︎ Wieder öffnen</button>
              )}
            </div>
          )
        })}
      </div>

    </div>

      {/* FAB (nur mit Anlegen-Recht) — außerhalb des Scrollers, im Content-Bereich */}
      {manage && (
        <button onClick={() => setEditing('new')} aria-label="Neue Aufgabe" style={{
          position: 'absolute', right: 18, bottom: 18, width: 54, height: 54, borderRadius: '50%',
          border: 'none', background: 'linear-gradient(135deg, var(--gold, #AE8D2D), #8A7020)', color: '#fff',
          fontSize: 28, fontWeight: 400, lineHeight: 1, cursor: 'pointer', zIndex: 6,
          boxShadow: '0 6px 18px rgba(0,0,0,0.22)',
        }}>+</button>
      )}

      {editing && manage && (
        <TaskSheet
          task={editing === 'new' ? null : editing}
          people={people}
          listings={listings}
          groups={groups}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}

/* ── Bottom-Sheet: Aufgabe anlegen/bearbeiten (Team) ── */
function TaskSheet({ task, people, listings, groups, onClose, onSaved }: {
  task: Task | null
  people: Person[]
  listings: ListingOpt[]
  groups: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [prio, setPrio] = useState<string>(task?.prio ?? 'mittel')
  const [status, setStatus] = useState<string>(task?.status ?? 'offen')
  const [dueDate, setDueDate] = useState(task?.due_date ?? '')
  const [assignee, setAssignee] = useState(task?.assignee_id ?? '')
  const [scopeType, setScopeType] = useState<'listing' | 'group' | 'general'>(
    task?.listing_id ? 'listing' : task?.location_group ? 'group' : 'general'
  )
  const [scopeListing, setScopeListing] = useState(task?.listing_id ?? listings[0]?.id ?? '')
  const [scopeGroup, setScopeGroup] = useState(task?.location_group ?? groups[0] ?? '')
  const [visibility, setVisibility] = useState<string>(task?.visibility ?? 'admin')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // iOS zeigt bei leeren date-Inputs GAR NICHTS an → eigener Platzhalter
  const isIOS = typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent)

  async function save() {
    if (!title.trim()) { setErr('Titel fehlt.'); return }
    setSaving(true)
    setErr(null)
    const payload = {
      title, description, prio, status, visibility,
      due_date: dueDate || null,
      assignee_id: assignee || null,
      listing_id: scopeType === 'listing' ? scopeListing : null,
      location_group: scopeType === 'group' ? scopeGroup : null,
      is_general: scopeType === 'general',
    }
    const res = task
      ? await fetch(`/api/tasks/${task.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (res.ok) onSaved()
    else {
      const json = await res.json().catch(() => ({}))
      setErr(json.error ?? 'Speichern fehlgeschlagen.')
      setSaving(false)
    }
  }

  async function remove() {
    if (!task || !confirm('Aufgabe wirklich löschen?')) return
    setSaving(true)
    const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' })
    if (res.ok) onSaved()
    else { setErr('Löschen fehlgeschlagen.'); setSaving(false) }
  }

  const inputStyle: CSSProperties = {
    width: '100%', padding: '11px 13px', borderRadius: 12, border: '1px solid #E0DDD5',
    fontSize: 14, background: '#fff', color: '#111', boxSizing: 'border-box',
  }
  const labelStyle: CSSProperties = { fontSize: 12, fontWeight: 700, color: '#6B7280', margin: '0 0 5px', display: 'block' }

  function Segmented({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: string) => void }) {
    return (
      <div style={{ display: 'flex', gap: 4, background: 'rgba(120,120,128,0.12)', borderRadius: 11, padding: 3 }}>
        {options.map(([v, label]) => (
          <button key={v} type="button" onClick={() => onChange(v)} style={{
            flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', fontSize: 12.5, fontWeight: 600,
            background: value === v ? '#fff' : 'transparent', color: '#111',
            boxShadow: value === v ? '0 1px 4px rgba(0,0,0,0.12)' : 'none', cursor: 'pointer',
          }}>{label}</button>
        ))}
      </div>
    )
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: 560, maxHeight: '88dvh', overflowY: 'auto',
        background: '#F7F7F8', borderRadius: '20px 20px 0 0', padding: '18px 18px',
        paddingBottom: 'max(18px, env(safe-area-inset-bottom))',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontSize: 17, fontWeight: 800, margin: 0, color: '#111' }}>
            {task ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}
          </h2>
          <button onClick={onClose} style={{ border: 'none', background: 'rgba(120,120,128,0.12)', width: 30, height: 30, borderRadius: '50%', fontSize: 14, color: '#3C3C43', cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <div>
            <label style={labelStyle}>Titel</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z. B. Duschkopf im Bad tauschen" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Beschreibung (optional)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
          <div>
            <label style={labelStyle}>Zuordnung</label>
            <Segmented
              options={[['listing', '🏠 Wohnung'], ['group', '📍 Standort'], ['general', '🏢 Allgemein']]}
              value={scopeType}
              onChange={(v) => setScopeType(v as 'listing' | 'group' | 'general')}
            />
            {scopeType === 'listing' && (
              <select value={scopeListing} onChange={(e) => setScopeListing(e.target.value)} style={{ ...inputStyle, marginTop: 8 }}>
                {listings.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
              </select>
            )}
            {scopeType === 'group' && (
              groups.length > 0 ? (
                <select value={scopeGroup} onChange={(e) => setScopeGroup(e.target.value)} style={{ ...inputStyle, marginTop: 8 }}>
                  {groups.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : (
                <input value={scopeGroup} onChange={(e) => setScopeGroup(e.target.value)} placeholder="Standort, z. B. Sirzenich" style={{ ...inputStyle, marginTop: 8 }} />
              )
            )}
          </div>
          <div>
            <label style={labelStyle}>Priorität</label>
            <Segmented
              options={[['hoch', '🔴 Hoch'], ['mittel', '🟡 Mittel'], ['niedrig', '⚪ Niedrig']]}
              value={prio}
              onChange={setPrio}
            />
          </div>
          <div>
            <label style={labelStyle}>Sichtbar für (Zugewiesene sehen ihre Aufgabe immer)</label>
            <Segmented
              options={[['admin', '🔒 Nur Admins'], ['team', '👥 + Mitarbeiter'], ['alle', '🌐 Alle']]}
              value={visibility}
              onChange={setVisibility}
            />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Rotfrist (fällig bis)</label>
              <div style={{ position: 'relative' }}>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                  style={{ ...inputStyle, minHeight: 44 }} />
                {isIOS && !dueDate && (
                  <span style={{
                    position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)',
                    fontSize: 14, color: '#9CA3AF', pointerEvents: 'none',
                  }}>Datum wählen…</span>
                )}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Zugewiesen an</label>
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} style={inputStyle}>
                <option value="">— niemand —</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.isProvider ? ' · Dienstleister' : ''}</option>)}
              </select>
            </div>
          </div>
          {task && (
            <div>
              <label style={labelStyle}>Status</label>
              <Segmented
                options={[['offen', 'Offen'], ['in_arbeit', 'In Arbeit'], ['erledigt', 'Erledigt']]}
                value={status}
                onChange={setStatus}
              />
            </div>
          )}

          {err && <p style={{ margin: 0, fontSize: 13, color: '#B91C1C', fontWeight: 600 }}>{err}</p>}

          <button onClick={save} disabled={saving} style={{
            padding: '13px 0', borderRadius: 999, border: 'none', fontSize: 15, fontWeight: 700,
            background: 'linear-gradient(135deg, var(--gold, #AE8D2D), #8A7020)', color: '#fff',
            cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1,
          }}>{saving ? 'Speichern…' : task ? 'Speichern' : 'Aufgabe anlegen'}</button>

          {task && (
            <button onClick={remove} disabled={saving} style={{
              padding: '10px 0', borderRadius: 999, border: 'none', fontSize: 13, fontWeight: 600,
              background: 'transparent', color: '#B91C1C', cursor: 'pointer',
            }}>Aufgabe löschen</button>
          )}
        </div>
      </div>
    </div>
  )
}
