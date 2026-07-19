'use client'

/**
 * 🧾 Qualitätssicherung im Aufgaben-Tab (HANDOFF §100):
 *  - QsBlock: Karten der geplanten Checks (Termin, überfällig, Verschieben mit
 *    Belegungs-Warnung) + zuletzt abgeschlossene Protokolle mit PDF-Link.
 *  - QsProtocol: Fullscreen-Formular (Sektionen → Punkte mit OK/Mangel/n. z.,
 *    Stückzahlen, Mangel-Notizen, Fotos, Gesamtnotiz) → Abschluss erzeugt das
 *    PDF server-seitig. Overlay via createPortal(body) — position:fixed darf
 *    auf iOS NIE in einem Touch-Scroller leben (§83-Lektion).
 */
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { QsSection, QsReport, QsItemValue } from '@/lib/qs'

type QsCheck = {
  id: string; listingId: string; listingTitle: string
  assigneeId: string | null; assigneeName: string | null
  dueDate: string; status: string; report: QsReport | null
  photos: { url: string }[]; pdfUrl: string | null; completedAt: string | null
  completedByName?: string | null
}

const TEAL = '#0F766E'
const TEAL_BG = 'linear-gradient(135deg, #F7FDFC, #EFFAF7)'
const TEAL_RING = 'inset 0 0 0 1px #A7E8DC'

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${Number(d)}.${Number(m)}.${y.slice(2)}`
}

async function compressToJpeg(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file)
    const max = 1600
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.82))
    return blob ?? file
  } catch { return file }
}

/** Checkliste eines Checks auflösen: Abschluss-Snapshot > Wohnungs-Vorlage > Standard. */
function tplFor(check: QsCheck, templates: Record<string, QsSection[]>, fallback: QsSection[]): QsSection[] {
  const snap = check.report?.template
  if (check.status === 'erledigt' && Array.isArray(snap) && snap.length) return snap
  return templates[check.listingId] ?? fallback
}

export default function QsBlock({ personFilter = '' }: { personFilter?: string }) {
  const [checks, setChecks] = useState<QsCheck[]>([])
  const [templates, setTemplates] = useState<Record<string, QsSection[]>>({})
  const [defaultTpl, setDefaultTpl] = useState<QsSection[]>([])
  const [openCheck, setOpenCheck] = useState<QsCheck | null>(null)
  const [viewCheck, setViewCheck] = useState<QsCheck | null>(null)
  const [moveFor, setMoveFor] = useState<string | null>(null)
  const [moveDate, setMoveDate] = useState('')
  const [moving, setMoving] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/qs', { cache: 'no-store' })
      if (!r.ok) return
      const d = await r.json()
      setChecks(d.checks ?? [])
      setTemplates(d.templates ?? {})
      setDefaultTpl(d.defaultTemplate ?? [])
    } catch { /* still — Block bleibt einfach leer */ }
  }, [])
  useEffect(() => { load() }, [load])

  async function move(check: QsCheck, force = false) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(moveDate) || moving) return
    setMoving(true)
    try {
      const r = await fetch(`/api/qs/${check.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dueDate: moveDate, force }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.status === 409 && d.warning) {
        if (confirm(d.warning)) { setMoving(false); return move(check, true) }
        return
      }
      if (!r.ok) { alert(d.error ?? 'Verschieben fehlgeschlagen.'); return }
      setMoveFor(null)
      await load()
    } finally { setMoving(false) }
  }

  const today = todayIso()
  // Personen-Filter des Aufgaben-Tabs gilt auch hier (Inhaber-Wunsch 19.7.):
  // '' = alle · 'none' = ohne Zuweisung · sonst nur Checks dieser Person
  const matchesPerson = (c: QsCheck) =>
    !personFilter ? true : personFilter === 'none' ? !c.assigneeId : c.assigneeId === personFilter
  const planned = checks.filter((c) => c.status === 'geplant' && matchesPerson(c))
  const done = checks.filter((c) => c.status === 'erledigt' && matchesPerson(c))
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    .slice(0, 3)
  if (!planned.length && !done.length) return null

  return (
    <div style={{ padding: '12px 16px 0' }}>
      <p style={{ fontSize: 13, fontWeight: 800, color: TEAL, margin: '0 0 8px' }}>🧾 Qualitätssicherung</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {planned.map((c) => {
          const overdue = c.dueDate < today
          return (
            <div key={c.id} style={{
              background: TEAL_BG, borderRadius: 14, padding: '12px 14px',
              boxShadow: overdue ? 'inset 0 0 0 1.5px #EF4444' : TEAL_RING,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: '#111' }}>{c.listingTitle}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: overdue ? '#B91C1C' : TEAL, flexShrink: 0 }}>
                  {overdue ? `⚠︎ überfällig seit ${fmtDate(c.dueDate)}` : `Termin: ${fmtDate(c.dueDate)}`}
                </span>
              </div>
              {c.assigneeName && (
                <p style={{ fontSize: 11.5, color: '#6B7280', margin: '3px 0 0' }}>Halbjahres-Check · zuständig: {c.assigneeName}</p>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <button onClick={() => setOpenCheck(c)} style={{
                  padding: '7px 14px', borderRadius: 999, border: 'none', fontSize: 12.5, fontWeight: 700,
                  background: TEAL, color: '#fff', cursor: 'pointer',
                }}>📋 Protokoll ausfüllen</button>
                {moveFor === c.id ? (
                  <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="date" value={moveDate} min={today}
                      onChange={(e) => setMoveDate(e.target.value)}
                      style={{ WebkitAppearance: 'none', appearance: 'none', display: 'block', border: '1px solid #A7E8DC', borderRadius: 10, padding: '6px 9px', fontSize: 13, background: '#fff', color: '#111', minHeight: 34 }}
                    />
                    <button onClick={() => move(c)} disabled={moving} style={{ padding: '7px 12px', borderRadius: 999, border: 'none', fontSize: 12, fontWeight: 700, background: '#111', color: '#fff', cursor: 'pointer' }}>
                      {moving ? '…' : 'OK'}
                    </button>
                    <button onClick={() => setMoveFor(null)} style={{ border: 'none', background: 'none', color: '#6B7280', fontWeight: 700, cursor: 'pointer' }}>✕</button>
                  </span>
                ) : (
                  <button onClick={() => { setMoveFor(c.id); setMoveDate(c.dueDate) }} style={{
                    padding: '7px 12px', borderRadius: 999, border: 'none', fontSize: 12.5, fontWeight: 700,
                    background: 'rgba(15,118,110,0.1)', color: TEAL, cursor: 'pointer',
                  }}>📅 Verschieben</button>
                )}
              </div>
            </div>
          )
        })}
        {done.map((c) => (
          <button key={c.id} onClick={() => setViewCheck(c)} style={{
            background: '#fff', borderRadius: 12, padding: '9px 13px', border: 'none', textAlign: 'left',
            boxShadow: 'inset 0 0 0 0.5px rgba(60,60,67,0.15)', cursor: 'pointer',
            display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', width: '100%',
          }}>
            <span style={{ fontSize: 12.5, color: '#3C3C43' }}>
              ✅ {c.listingTitle} · {c.completedAt ? fmtDate(c.completedAt.slice(0, 10)) : fmtDate(c.dueDate)}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: TEAL, flexShrink: 0 }}>Ansehen ›</span>
          </button>
        ))}
      </div>
      {openCheck && (
        <QsProtocol
          check={openCheck}
          template={tplFor(openCheck, templates, defaultTpl)}
          onClose={() => { setOpenCheck(null); load() }}
        />
      )}
      {viewCheck && (
        <QsView check={viewCheck} template={tplFor(viewCheck, templates, defaultTpl)} onClose={() => setViewCheck(null)} />
      )}
    </div>
  )
}

/* ═══════════ Fullscreen-Protokoll ═══════════ */

function QsProtocol({ check, template, onClose }: {
  check: QsCheck; template: QsSection[]; onClose: () => void
}) {
  const [items, setItems] = useState<Record<string, QsItemValue>>(() => ({ ...(check.report?.items ?? {}) }))
  const [note, setNote] = useState(check.report?.note ?? '')
  const [photos, setPhotos] = useState<{ url: string }[]>(check.photos)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [completing, setCompleting] = useState(false)

  const total = template.reduce((s, sec) => s + sec.items.length, 0)
  const answered = Object.values(items).filter((v) => v.s).length

  function setItem(id: string, patch: Partial<QsItemValue>) {
    setItems((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  async function save(complete = false): Promise<boolean> {
    const body = { report: { items, note }, ...(complete ? { complete: true } : {}) }
    const r = await fetch(`/api/qs/${check.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      alert(d.error ?? 'Speichern fehlgeschlagen.')
      return false
    }
    return true
  }

  async function saveAndClose() {
    if (saving) return
    setSaving(true)
    await save(false)
    setSaving(false)
    onClose()
  }

  async function finish() {
    if (completing) return
    const open = total - answered
    const msg = open > 0
      ? `${open} ${open === 1 ? 'Punkt ist' : 'Punkte sind'} noch nicht geprüft. Trotzdem abschließen? Das Protokoll wird als PDF abgelegt und kann danach nicht mehr geändert werden.`
      : 'Protokoll abschließen? Es wird als PDF abgelegt und kann danach nicht mehr geändert werden.'
    if (!confirm(msg)) return
    setCompleting(true)
    const ok = await save(true)
    setCompleting(false)
    if (ok) onClose()
  }

  async function addPhoto(file: File) {
    if (uploading) return
    setUploading(true)
    try {
      const blob = await compressToJpeg(file)
      const fd = new FormData()
      fd.append('file', new File([blob], 'qs.jpg', { type: 'image/jpeg' }))
      const r = await fetch(`/api/qs/${check.id}/photos`, { method: 'POST', body: fd })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) alert(d.error ?? 'Foto-Upload fehlgeschlagen.')
      else setPhotos((p) => [...p, d.photo])
    } finally { setUploading(false) }
  }

  async function removePhoto(url: string) {
    const r = await fetch(`/api/qs/${check.id}/photos`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    if (r.ok) setPhotos((p) => p.filter((x) => x.url !== url))
  }

  const seg = (id: string, current: QsItemValue | undefined) => (
    <span style={{ display: 'inline-flex', borderRadius: 999, background: 'rgba(120,120,128,0.12)', padding: 2, flexShrink: 0 }}>
      {([['ok', '✓ OK', '#15803D'], ['mangel', '⚠ Mangel', '#B91C1C'], ['na', '–', '#6B7280']] as const).map(([val, label, color]) => {
        const active = current?.s === val
        return (
          <button key={val} onClick={() => setItem(id, { s: active ? undefined : val })} style={{
            padding: '5px 10px', borderRadius: 999, border: 'none', fontSize: 11.5, fontWeight: 700,
            background: active ? '#fff' : 'transparent', color: active ? color : '#8E8E93',
            boxShadow: active ? '0 1px 3px rgba(0,0,0,0.12)' : 'none', cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{label}</button>
        )
      })}
    </span>
  )

  const overlay = (
    // className team-shell: Portal liegt im body AUSSERHALB der Shell — so
    // gelten Zoom-Sperre + 16px-Input-Regel (iOS-Auto-Zoom) auch hier
    <div className="team-shell" style={{
      position: 'fixed', inset: 0, zIndex: 90, background: '#F7F7F8',
      display: 'flex', flexDirection: 'column',
      paddingTop: 'env(safe-area-inset-top)',
    }}>
      {/* Kopf */}
      <div style={{
        padding: '12px 16px', background: 'rgba(255,255,255,0.92)', flexShrink: 0,
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.15)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={saveAndClose} style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'rgba(120,120,128,0.12)', cursor: 'pointer', color: '#3C3C43', fontSize: 15, flexShrink: 0 }}>‹</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 800, color: '#111' }}>QS-Protokoll</div>
          <div style={{ fontSize: 11.5, color: '#8E8E93' }}>{check.listingTitle} · {fmtDate(check.dueDate)}</div>
        </div>
        <span style={{ fontSize: 12, fontWeight: 800, color: answered === total ? '#15803D' : TEAL, flexShrink: 0 }}>
          {answered}/{total}
        </span>
      </div>

      {/* Inhalt */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', padding: '14px 16px 24px' }}>
        {template.map((sec) => (
          <div key={sec.id} style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 13, fontWeight: 800, color: '#111', margin: '0 0 8px' }}>{sec.emoji} {sec.title}</p>
            <div style={{ background: '#fff', borderRadius: 14, boxShadow: 'inset 0 0 0 0.5px rgba(60,60,67,0.12)', overflow: 'hidden' }}>
              {sec.items.map((item, i) => {
                const v = items[item.id]
                return (
                  <div key={item.id} style={{ padding: '11px 13px', boxShadow: i < sec.items.length - 1 ? 'inset 0 -0.5px 0 rgba(60,60,67,0.12)' : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ flex: '1 1 150px', minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#111' }}>{item.label}</div>
                        {item.hint && <div style={{ fontSize: 11, color: '#8E8E93', marginTop: 1 }}>{item.hint}</div>}
                      </div>
                      {seg(item.id, v)}
                    </div>
                    {item.type === 'anzahl' && (
                      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, color: '#6B7280' }}>Anzahl:</span>
                        <input
                          type="number" inputMode="numeric" min={0} value={v?.count ?? ''}
                          onChange={(e) => setItem(item.id, { count: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })}
                          style={{ width: 84, border: '1px solid #E0DDD6', borderRadius: 10, padding: '6px 9px', fontSize: 14, background: '#fff', color: '#111' }}
                        />
                      </div>
                    )}
                    {v?.s === 'mangel' && (
                      <textarea
                        value={v.note ?? ''}
                        onChange={(e) => setItem(item.id, { note: e.target.value })}
                        placeholder="Was ist zu tun? (z. B. „2 Bezüge vergilbt — waschen“)"
                        rows={2}
                        style={{ marginTop: 8, width: '100%', boxSizing: 'border-box', border: '1px solid #FECACA', background: '#FFFBFA', borderRadius: 10, padding: '8px 10px', fontSize: 13.5, fontFamily: 'inherit', resize: 'vertical', color: '#111', outline: 'none' }}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {/* Fotos */}
        <p style={{ fontSize: 13, fontWeight: 800, color: '#111', margin: '0 0 8px' }}>📷 Fotos ({photos.length})</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {photos.map((p) => (
            <span key={p.url} style={{ position: 'relative' }}>
              <a href={p.url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" style={{ width: 74, height: 74, objectFit: 'cover', borderRadius: 10, display: 'block' }} />
              </a>
              <button onClick={() => removePhoto(p.url)} style={{
                position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%',
                border: 'none', background: '#111', color: '#fff', fontSize: 10, cursor: 'pointer', lineHeight: 1,
              }}>✕</button>
            </span>
          ))}
          <label style={{
            width: 74, height: 74, borderRadius: 10, border: '2px dashed #C9E8E1', background: '#F7FDFC',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            fontSize: 22, color: TEAL, opacity: uploading ? 0.5 : 1,
          }}>
            {uploading ? '⏳' : '+'}
            <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) addPhoto(f); e.target.value = '' }} />
          </label>
        </div>

        {/* Gesamtnotiz */}
        <p style={{ fontSize: 13, fontWeight: 800, color: '#111', margin: '0 0 8px' }}>Weitere Anmerkungen</p>
        <textarea
          value={note} onChange={(e) => setNote(e.target.value)} rows={3}
          placeholder="Alles, was sonst noch auffällt …"
          style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #E0DDD6', borderRadius: 12, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', resize: 'vertical', background: '#fff', color: '#111', outline: 'none' }}
        />
      </div>

      {/* Fuß */}
      <div style={{
        flexShrink: 0, display: 'flex', gap: 10, padding: '10px 16px',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        boxShadow: 'inset 0 0.5px 0 rgba(60,60,67,0.15)',
      }}>
        <button onClick={saveAndClose} disabled={saving} style={{
          flex: 1, padding: '12px 0', borderRadius: 999, border: 'none', fontSize: 14, fontWeight: 700,
          background: 'rgba(120,120,128,0.12)', color: '#3C3C43', cursor: 'pointer',
        }}>{saving ? 'Speichert…' : 'Zwischenspeichern'}</button>
        <button onClick={finish} disabled={completing} style={{
          flex: 1.4, padding: '12px 0', borderRadius: 999, border: 'none', fontSize: 14, fontWeight: 800,
          background: completing ? '#9CA3AF' : TEAL, color: '#fff', cursor: 'pointer',
        }}>{completing ? 'PDF wird erstellt…' : '✅ Abschließen'}</button>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(overlay, document.body) : null
}

/* ═══════════ Read-only-Protokoll-Ansicht (Archiv) ═══════════ */

function countMaengel(report: QsReport | null): number {
  return Object.values(report?.items ?? {}).filter((v) => v?.s === 'mangel').length
}
function maengelLabel(m: number): string {
  return m === 1 ? '1 Mangel' : `${m} Mängel`
}

export function QsView({ check, template, onClose }: {
  check: QsCheck; template: QsSection[]; onClose: () => void
}) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(check.pdfUrl)
  const [pdfBusy, setPdfBusy] = useState(false)
  const items = check.report?.items ?? {}

  async function makePdf() {
    if (pdfBusy) return
    setPdfBusy(true)
    try {
      const r = await fetch(`/api/qs/${check.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generatePdf: true }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) alert(d.error ?? 'PDF-Erzeugung fehlgeschlagen.')
      else if (d.pdfUrl) setPdfUrl(d.pdfUrl)
    } finally { setPdfBusy(false) }
  }

  const statusChip = (v: QsItemValue | undefined) => {
    const map = {
      ok: { label: '✓ OK', color: '#15803D', bg: '#F0FDF4' },
      mangel: { label: '⚠ Mangel', color: '#B91C1C', bg: '#FEF2F2' },
      na: { label: 'n. geprüft', color: '#6B7280', bg: 'rgba(120,120,128,0.1)' },
    } as const
    const m = v?.s ? map[v.s] : { label: '—', color: '#B0AA9C', bg: 'transparent' }
    return (
      <span style={{ fontSize: 11.5, fontWeight: 700, color: m.color, background: m.bg, borderRadius: 999, padding: '4px 10px', flexShrink: 0, whiteSpace: 'nowrap' }}>
        {m.label}
      </span>
    )
  }

  const overlay = (
    <div className="team-shell" style={{
      position: 'fixed', inset: 0, zIndex: 95, background: '#F7F7F8',
      display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top)',
    }}>
      <div style={{
        padding: '12px 16px', background: 'rgba(255,255,255,0.92)', flexShrink: 0,
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.15)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'rgba(120,120,128,0.12)', cursor: 'pointer', color: '#3C3C43', fontSize: 15, flexShrink: 0 }}>‹</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 800, color: '#111' }}>QS-Protokoll</div>
          <div style={{ fontSize: 11.5, color: '#8E8E93' }}>
            {check.listingTitle} · {check.completedAt ? fmtDate(check.completedAt.slice(0, 10)) : fmtDate(check.dueDate)}
            {check.completedByName ? ` · geprüft von ${check.completedByName}` : ''}
          </div>
        </div>
        <span style={{ fontSize: 12, fontWeight: 800, color: countMaengel(check.report) ? '#B91C1C' : '#15803D', flexShrink: 0 }}>
          {countMaengel(check.report) ? maengelLabel(countMaengel(check.report)) : 'ohne Mängel'}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', padding: '14px 16px 24px' }}>
        {template.map((sec) => (
          <div key={sec.id} style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 13, fontWeight: 800, color: '#111', margin: '0 0 8px' }}>{sec.emoji} {sec.title}</p>
            <div style={{ background: '#fff', borderRadius: 14, boxShadow: 'inset 0 0 0 0.5px rgba(60,60,67,0.12)', overflow: 'hidden' }}>
              {sec.items.map((item, i) => {
                const v = items[item.id]
                return (
                  <div key={item.id} style={{ padding: '10px 13px', boxShadow: i < sec.items.length - 1 ? 'inset 0 -0.5px 0 rgba(60,60,67,0.12)' : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: '#111', minWidth: 0 }}>
                        {item.label}
                        {item.type === 'anzahl' && v?.count != null && (
                          <span style={{ fontWeight: 700, color: '#6B7280' }}> · {v.count} Stk.</span>
                        )}
                      </span>
                      {statusChip(v)}
                    </div>
                    {v?.note && (
                      <p style={{ margin: '6px 0 0', padding: '7px 10px', borderRadius: 8, background: '#FFFBFA', boxShadow: 'inset 0 0 0 1px #FECACA', fontSize: 12.5, color: '#7F1D1D', lineHeight: 1.5 }}>
                        {v.note}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {check.photos.length > 0 && (
          <>
            <p style={{ fontSize: 13, fontWeight: 800, color: '#111', margin: '0 0 8px' }}>📷 Fotos ({check.photos.length})</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              {check.photos.map((p) => (
                <a key={p.url} href={p.url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 10, display: 'block' }} />
                </a>
              ))}
            </div>
          </>
        )}

        {check.report?.note?.trim() && (
          <>
            <p style={{ fontSize: 13, fontWeight: 800, color: '#111', margin: '0 0 8px' }}>Weitere Anmerkungen</p>
            <p style={{ margin: 0, padding: '10px 12px', borderRadius: 12, background: '#fff', boxShadow: 'inset 0 0 0 0.5px rgba(60,60,67,0.12)', fontSize: 13.5, color: '#3C3C43', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
              {check.report.note}
            </p>
          </>
        )}
      </div>

      <div style={{
        flexShrink: 0, padding: '10px 16px', paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        boxShadow: 'inset 0 0.5px 0 rgba(60,60,67,0.15)',
      }}>
        {pdfUrl ? (
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer" style={{
            display: 'block', textAlign: 'center', padding: '12px 0', borderRadius: 999,
            background: TEAL, color: '#fff', fontSize: 14, fontWeight: 800, textDecoration: 'none',
          }}>📄 PDF öffnen ↗</a>
        ) : (
          <button onClick={makePdf} disabled={pdfBusy} style={{
            width: '100%', padding: '12px 0', borderRadius: 999, border: 'none',
            background: pdfBusy ? '#9CA3AF' : 'rgba(15,118,110,0.1)', color: pdfBusy ? '#fff' : TEAL,
            fontSize: 14, fontWeight: 800, cursor: 'pointer',
          }}>{pdfBusy ? 'PDF wird erstellt…' : '📄 Als PDF erzeugen'}</button>
        )}
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(overlay, document.body) : null
}

/* ═══════════ Archiv: Protokolle je Wohnung (⚙️ Mehr → Qualitätssicherung) ═══════════ */

export function QsArchive({ onClose }: { onClose: () => void }) {
  const [checks, setChecks] = useState<QsCheck[]>([])
  const [templates, setTemplates] = useState<Record<string, QsSection[]>>({})
  const [defaultTpl, setDefaultTpl] = useState<QsSection[]>([])
  const [sel, setSel] = useState('')
  const [view, setView] = useState<QsCheck | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/qs', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        setChecks(d.checks ?? [])
        setTemplates(d.templates ?? {})
        setDefaultTpl(d.defaultTemplate ?? [])
        const first = (d.checks ?? [])[0]
        if (first) setSel((prev: string) => prev || first.listingId)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const apartments: { id: string; title: string }[] = []
  for (const c of checks) {
    if (!apartments.some((a) => a.id === c.listingId)) apartments.push({ id: c.listingId, title: c.listingTitle })
  }
  apartments.sort((a, b) => a.title.localeCompare(b.title))

  const mine = checks.filter((c) => c.listingId === sel)
  const planned = mine.filter((c) => c.status === 'geplant')
  const done = mine.filter((c) => c.status === 'erledigt')
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))

  let lastYear = ''

  const overlay = (
    <div className="team-shell" style={{
      position: 'fixed', inset: 0, zIndex: 90, background: '#F7F7F8',
      display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top)',
    }}>
      <div style={{
        padding: '12px 16px 10px', background: 'rgba(255,255,255,0.92)', flexShrink: 0,
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.15)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: apartments.length ? 10 : 0 }}>
          <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'rgba(120,120,128,0.12)', cursor: 'pointer', color: '#3C3C43', fontSize: 15, flexShrink: 0 }}>‹</button>
          <div style={{ fontSize: 16.5, fontWeight: 800, color: '#111' }}>🧾 Qualitätssicherung</div>
        </div>
        {apartments.length > 0 && (
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            {apartments.map((a) => (
              <button key={a.id} onClick={() => setSel(a.id)} style={{
                padding: '6px 13px', borderRadius: 999, border: 'none', fontSize: 12.5, fontWeight: 700, flexShrink: 0,
                background: sel === a.id ? TEAL : 'rgba(120,120,128,0.12)',
                color: sel === a.id ? '#fff' : '#3C3C43', cursor: 'pointer', whiteSpace: 'nowrap',
              }}>{a.title}</button>
            ))}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', padding: '14px 16px 30px' }}>
        {loading ? (
          <p style={{ textAlign: 'center', color: '#8E8E93', fontSize: 14, padding: 40 }}>Laden…</p>
        ) : apartments.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: '#8E8E93' }}>
            <p style={{ fontSize: 40, margin: '0 0 8px' }}>🧾</p>
            <p style={{ fontSize: 15, fontWeight: 600, margin: 0, color: '#3C3C43' }}>Noch keine QS-Termine.</p>
            <p style={{ fontSize: 12.5, margin: '6px 0 0' }}>Termine werden automatisch geplant, sobald im Admin-Bereich eine zuständige Person gesetzt ist.</p>
          </div>
        ) : (
          <>
            {planned.map((c) => (
              <div key={c.id} style={{
                background: TEAL_BG, borderRadius: 12, padding: '10px 13px', marginBottom: 10,
                boxShadow: TEAL_RING, fontSize: 12.5, color: '#0F5A54',
              }}>
                📅 Nächster Termin: <strong>{fmtDate(c.dueDate)}</strong> — Protokoll im Aufgaben-Tab ausfüllen.
              </div>
            ))}
            {done.length === 0 && (
              <p style={{ textAlign: 'center', color: '#8E8E93', fontSize: 13.5, padding: '30px 10px' }}>
                Für diese Wohnung gibt es noch kein abgeschlossenes Protokoll.
              </p>
            )}
            {done.map((c) => {
              const year = (c.completedAt ?? c.dueDate).slice(0, 4)
              const showYear = year !== lastYear
              lastYear = year
              const m = countMaengel(c.report)
              return (
                <div key={c.id}>
                  {showYear && (
                    <p style={{ fontSize: 12, fontWeight: 800, color: '#6B7280', margin: '14px 0 7px', letterSpacing: '0.04em' }}>{year}</p>
                  )}
                  <button onClick={() => setView(c)} style={{
                    width: '100%', textAlign: 'left', background: '#fff', borderRadius: 14, padding: '12px 14px',
                    border: 'none', cursor: 'pointer', marginBottom: 8,
                    boxShadow: 'inset 0 0 0 0.5px rgba(60,60,67,0.15)',
                    display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center',
                  }}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: '#111' }}>
                        {c.completedAt ? fmtDate(c.completedAt.slice(0, 10)) : fmtDate(c.dueDate)}
                      </span>
                      <span style={{ display: 'block', fontSize: 11.5, color: '#8E8E93', marginTop: 1 }}>
                        {c.completedByName ? `geprüft von ${c.completedByName}` : 'Protokoll'}
                        {c.photos.length ? ` · ${c.photos.length} Fotos` : ''}
                      </span>
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <span style={{
                        fontSize: 11.5, fontWeight: 800, borderRadius: 999, padding: '4px 10px',
                        background: m ? '#FEF2F2' : '#F0FDF4', color: m ? '#B91C1C' : '#15803D',
                      }}>{m ? maengelLabel(m) : '✓ ohne Mängel'}</span>
                      <span style={{ color: '#C7C7CC', fontSize: 15 }}>›</span>
                    </span>
                  </button>
                </div>
              )
            })}
          </>
        )}
      </div>

      {view && (
        <QsView check={view} template={tplFor(view, templates, defaultTpl)} onClose={() => setView(null)} />
      )}
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(overlay, document.body) : null
}
