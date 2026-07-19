'use client'

/**
 * 🧹 Reinigungsplaner (Kalender-Tab), drei Ansichten mit GLOBALEM Filter
 * nach Reinigungskraft (Alle · 👤 Vanessa · 👤 Tip-Top · Ohne Zuordnung):
 *  📋 Liste  — jede Abreise ein Slot; Wechseltage = Pflicht, sonst flexibel.
 *              KLUGE EMPFEHLUNG: Sonn-/Feiertage meiden (Regeln der
 *              JEWEILIGEN Reinigungskraft!) UND Reinigungen desselben
 *              Standorts + derselben Kraft bündeln (eine Anfahrt).
 *  🗺 Touren — Tages-Einsatzpläne, Blöcke je Standort × Reinigungskraft.
 *  💶 Kosten — NUR Admins: erwartete „Rechnung" je KALENDERMONAT mit den
 *              SÄTZEN DER JEWEILIGEN KRAFT (perPerson-Overrides), zweistufig
 *              auffächerbar; Rechnungs-Upload mit KI-Abgleich (§116/§117).
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { supabaseBrowser as supabase } from '@/lib/supabase-browser'

type Stay = { id: string; listingId: string; checkIn: string; checkOut: string; guestName: string | null; channel?: string | null }
type Rules = { avoidSundays: boolean; avoidHolidays: boolean }
type Rates = { hourlyRate: number; travelFee: number; sundaySurchargePct: number; holidaySurchargePct: number }
export type CleaningInfo = {
  settings: Rules
  settingsByPerson?: Record<string, Rules>
  rates: Rates | null
  ratesByPerson?: Record<string, Rates> | null
  holidays: string[]
  responsible: Record<string, { id: string; name: string }>
  minutes: Record<string, number>
  mine: string[]
}
type Invoice = {
  id: string; month: string; person_id: string | null
  file_url: string; file_name: string | null
  amount_expected: number | null; amount_invoiced: number | null
  analysis: { betrag_rechnung?: number | null; positionen?: { text: string; betrag: number | null }[]; differenz?: number | null; einschaetzung?: string; auffaelligkeiten?: string[] } | null
  status: string; created_at: string
}

const DE_DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
const DE_MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const FALLBACK_MINUTES = 120

function isoOffset(days: number): string {
  const d = new Date(Date.now() + days * 86400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function addDays(iso: string, n: number): string {
  return new Date(new Date(iso + 'T00:00:00Z').getTime() + n * 86400_000).toISOString().slice(0, 10)
}
function fmtShort(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${Number(d)}.${Number(m)}.`
}
function wdShort(iso: string): string {
  return DE_DAYS[new Date(iso + 'T00:00:00Z').getUTCDay()].slice(0, 2)
}
function dayLabel(iso: string, today: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  const base = `${DE_DAYS[d.getUTCDay()]}, ${d.getUTCDate()}. ${DE_MONTHS[d.getUTCMonth()]}`
  if (iso === today) return `Heute · ${base}`
  if (iso === isoOffset(1)) return `Morgen · ${base}`
  return base
}
function fmtDur(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`
}
const eur = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 })
const eurSigned = (n: number) => (n > 0 ? '+' : '') + eur(n)

type Slot = {
  stay: Stay
  listingId: string
  sameDayArrival: boolean
  nextIn: string | null
  /** effektiver (empfohlener bzw. Pflicht-)Reinigungstag */
  effDay: string
  recommended: string | null
  reason: 'sonntag' | 'feiertag' | 'buendel' | null
  minutes: number
  hasMinutes: boolean
  group: string
  /** verantwortliche Reinigungskraft ('-' = keine Zuordnung) */
  personId: string
}

export default function CleaningPlanner({ stays, listings, cleaning }: {
  stays: Stay[]
  listings: Record<string, { title: string; group: string | null }>
  cleaning: CleaningInfo
}) {
  const isAdmin = !!cleaning.rates
  const [mode, setMode] = useState<'liste' | 'touren' | 'kosten'>('liste')
  const [openKeys, setOpenKeys] = useState<Record<string, boolean>>({})
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [invOpen, setInvOpen] = useState<string | null>(null)
  const [invBusy, setInvBusy] = useState<string | null>(null)
  const [invError, setInvError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pendingRef = useRef<{ month: string; expected: Record<string, unknown>; personId: string; personName: string } | null>(null)

  /* ── Personen (aus den Zuordnungen) + globaler Filter für ALLE Ansichten ── */
  const persons = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of Object.values(cleaning.responsible)) m.set(r.id, r.name)
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [cleaning.responsible])
  const hasUnassigned = Object.keys(listings).some((id) => !cleaning.responsible[id])
  // Eigene Verantwortung → eigener Chip vorausgewählt (Vanessa/Tip-Top sehen
  // sofort ihre Touren; Provider bekommen ohnehin nur die eigenen Wohnungen)
  const myPersonId = cleaning.mine.length ? (cleaning.responsible[cleaning.mine[0]]?.id ?? '') : ''
  const [personFilter, setPersonFilter] = useState<string>(myPersonId) // '' alle · 'none' ohne · sonst userId
  const personLabel = personFilter === '' ? 'alle Wohnungen'
    : personFilter === 'none' ? 'Wohnungen ohne Zuordnung'
      : (persons.find((p) => p.id === personFilter)?.name ?? '—')
  const matchPerson = (lid: string) =>
    personFilter === '' ? true
      : personFilter === 'none' ? !cleaning.responsible[lid]
        : cleaning.responsible[lid]?.id === personFilter

  /* ── Regeln & Sätze der JEWEILIGEN Kraft (Wohnung erbt über Zuordnung) ── */
  const personOf = (lid: string) => cleaning.responsible[lid]?.id ?? null
  const rulesFor = (lid: string): Rules => {
    const p = personOf(lid)
    return (p && cleaning.settingsByPerson?.[p]) || cleaning.settings
  }
  const ratesFor = (lid: string): Rates | null => {
    const p = personOf(lid)
    return (p && cleaning.ratesByPerson?.[p]) || cleaning.rates
  }

  const today = isoOffset(0)
  // Slots reichen so weit wie die Kalender-Daten (+56 Tage) — die Kosten-
  // Ansicht rechnet damit echte KALENDERMONATE; Liste/Touren zeigen 4 Wochen.
  const horizon = isoOffset(56)
  const listHorizon = isoOffset(28)
  const isBlockedFor = (iso: string, lid: string) => {
    const rules = rulesFor(lid)
    const dow = new Date(iso + 'T00:00:00Z').getUTCDay()
    return (rules.avoidSundays && dow === 0)
      || (rules.avoidHolidays && cleaning.holidays.includes(iso))
  }
  /** Kalender-Fakt (unabhängig von Meidungs-Regeln) — Basis der Zulagen. */
  const dayKind = (iso: string): 'sonntag' | 'feiertag' | null =>
    cleaning.holidays.includes(iso) ? 'feiertag'
      : new Date(iso + 'T00:00:00Z').getUTCDay() === 0 ? 'sonntag' : null

  const slots: Slot[] = useMemo(() => {
    const base = stays.filter((s) => s.checkOut >= today && s.checkOut <= horizon && listings[s.listingId])
    // Pflicht-Tage je Standort × Reinigungskraft (Wechseltage) — Bündelungs-
    // Anker: gebündelt wird nur, wenn DIESELBE Kraft am selben Ort putzt
    const anchorDays = new Set<string>()
    for (const s of base) {
      if (stays.some((x) => x.listingId === s.listingId && x.checkIn === s.checkOut)) {
        const g = listings[s.listingId]?.group ?? s.listingId
        anchorDays.add(`${s.checkOut}|${g}|${personOf(s.listingId) ?? '-'}`)
      }
    }
    return base.map((s) => {
      const group = listings[s.listingId]?.group ?? s.listingId
      const personId = personOf(s.listingId) ?? '-'
      const anchorKey = (day: string) => `${day}|${group}|${personId}`
      const sameDayArrival = stays.some((x) => x.listingId === s.listingId && x.checkIn === s.checkOut)
      const nextIn = stays
        .filter((x) => x.listingId === s.listingId && x.checkIn >= s.checkOut)
        .sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0]?.checkIn ?? null

      // Kluge Tag-Wahl (Inhaber-Doktrin §118): IMMER SCHNELLSTMÖGLICH reinigen
      // (kurzfristige Buchungen können jederzeit reinkommen!) — nur Sonn-/
      // Feiertage nach den Regeln DIESER Kraft überspringen, und mit ihren
      // Pflicht-Terminen am selben Ort bündeln, wenn das höchstens EINEN Tag
      // Verzögerung kostet (eine Anfahrt gespart, Wohnung bleibt trotzdem
      // schnell wieder bezugsfertig).
      let effDay = s.checkOut
      let recommended: string | null = null
      let reason: Slot['reason'] = null
      if (!sameDayArrival) {
        const lastDay = nextIn ? (nextIn < addDays(s.checkOut, 7) ? nextIn : addDays(s.checkOut, 7)) : addDays(s.checkOut, 7)
        const windowDays: string[] = []
        for (let d = s.checkOut; d <= lastDay && windowDays.length < 9; d = addDays(d, 1)) windowDays.push(d)
        const earliest = windowDays.find((d) => !isBlockedFor(d, s.listingId)) ?? s.checkOut
        const bundle = windowDays.find((d) => !isBlockedFor(d, s.listingId) && anchorDays.has(anchorKey(d))) ?? null
        effDay = bundle && bundle <= addDays(earliest, 1) ? bundle : earliest
        if (effDay !== s.checkOut) {
          recommended = effDay
          // Hauptgrund: Abreisetag war Sonn-/Feiertag → das erklärt die
          // Verschiebung; sonst wurde rein für die gemeinsame Anfahrt gebündelt
          reason = dayKind(s.checkOut) ?? 'buendel'
        }
      }
      const hasMinutes = cleaning.minutes[s.listingId] != null
      return {
        stay: s, listingId: s.listingId, sameDayArrival, nextIn,
        effDay, recommended, reason,
        minutes: cleaning.minutes[s.listingId] ?? FALLBACK_MINUTES, hasMinutes, group, personId,
      }
    }).sort((a, b) => a.effDay.localeCompare(b.effDay) || a.group.localeCompare(b.group))
  }, [stays, listings, cleaning, today, horizon]) // eslint-disable-line react-hooks/exhaustive-deps

  const visible = slots.filter((s) => s.effDay <= listHorizon && matchPerson(s.listingId))

  const slotCost = (s: Slot) => (s.minutes / 60) * (ratesFor(s.listingId)?.hourlyRate ?? 0)
  const slotSurcharge = (s: Slot) => {
    const kind = dayKind(s.effDay)
    const r = ratesFor(s.listingId)
    if (!kind || !r) return 0
    return slotCost(s) * ((kind === 'feiertag' ? r.holidaySurchargePct : r.sundaySurchargePct) / 100)
  }

  /* ── Kosten — echte KALENDERMONATE, Sätze je Kraft, gefiltert ── */
  const costs = useMemo(() => {
    if (!cleaning.rates) return null
    const filtered = slots.filter((s) => matchPerson(s.listingId))

    type Trip = { day: string; group: string; personId: string; count: number; fee: number }
    type MonthRow = {
      key: string; label: string; partialStart: boolean; partialEnd: boolean
      perListing: Map<string, { count: number; minutes: number; base: number }>
      surcharge: number; trips: Map<string, Trip>
      slots: Slot[]
    }
    const months = new Map<string, MonthRow>()
    let missingMinutes = 0
    for (const s of filtered) {
      const key = s.effDay.slice(0, 7)
      let m = months.get(key)
      if (!m) {
        const [y, mo] = key.split('-').map(Number)
        const lastDay = `${key}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`
        m = {
          key, label: `${DE_MONTHS[mo - 1]} ${y}`,
          partialStart: `${key}-01` < today,
          partialEnd: lastDay > horizon,
          perListing: new Map(), surcharge: 0, trips: new Map(), slots: [],
        }
        months.set(key, m)
      }
      m.slots.push(s)
      const row = m.perListing.get(s.listingId) ?? { count: 0, minutes: 0, base: 0 }
      row.count++
      row.minutes += s.minutes
      row.base += slotCost(s)
      m.perListing.set(s.listingId, row)
      if (!s.hasMinutes) missingMinutes++
      m.surcharge += slotSurcharge(s)
      // Anfahrt = Einsatztag × Standort × KRAFT, zum Satz dieser Kraft
      const tKey = `${s.effDay}|${s.group}|${s.personId}`
      const t = m.trips.get(tKey) ?? { day: s.effDay, group: s.group, personId: s.personId, count: 0, fee: ratesFor(s.listingId)?.travelFee ?? 0 }
      t.count++
      m.trips.set(tKey, t)
    }
    const list = [...months.values()].sort((a, b) => a.key.localeCompare(b.key)).map((m) => {
      const baseSum = [...m.perListing.values()].reduce((a, x) => a + x.base, 0)
      const travel = [...m.trips.values()].reduce((a, t) => a + t.fee, 0)
      return { ...m, baseSum, travel, tripCount: m.trips.size, total: baseSum + m.surcharge + travel }
    })
    return { months: list, missingMinutes }
  }, [slots, cleaning.rates, cleaning.ratesByPerson, cleaning.responsible, personFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Rechnungen laden (nur Kosten-Ansicht) ── */
  useEffect(() => {
    if (mode !== 'kosten' || !isAdmin) return
    fetch('/api/cleaning-invoices', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setInvoices(d.invoices ?? []))
      .catch(() => { /* fail-soft */ })
  }, [mode, isAdmin])

  function startUpload(month: string, expected: Record<string, unknown>) {
    pendingRef.current = {
      month, expected,
      personId: personFilter === '' || personFilter === 'none' ? '' : personFilter,
      personName: personFilter === '' || personFilter === 'none' ? '' : (persons.find((p) => p.id === personFilter)?.name ?? ''),
    }
    fileRef.current?.click()
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    const ctx = pendingRef.current
    if (!file || !ctx) return
    const type = file.type || 'application/pdf'
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(type)) {
      setInvError('Nur PDF oder Foto (JPG/PNG/WebP).')
      return
    }
    if (file.size > 15 * 1024 * 1024) { setInvError('Datei zu groß (max. 15 MB).'); return }
    setInvError(null)
    setInvBusy(ctx.month)
    try {
      const u = await fetch('/api/cleaning-invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'upload-url', fileType: type, month: ctx.month }),
      }).then((r) => r.json())
      if (!u.token) throw new Error(u.error ?? 'Upload-URL fehlgeschlagen.')
      const { error: upErr } = await supabase.storage.from(u.bucket)
        .uploadToSignedUrl(u.path, u.token, file, { contentType: type })
      if (upErr) throw new Error(upErr.message)
      const res = await fetch('/api/cleaning-invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'analyze', path: u.path, publicUrl: u.publicUrl,
          fileName: file.name, fileType: type, month: ctx.month,
          personId: ctx.personId || undefined, personName: ctx.personName || undefined,
          expected: ctx.expected,
        }),
      }).then((r) => r.json())
      if (res.error) throw new Error(res.error)
      // Liste frisch laden + die neue Analyse direkt aufklappen
      const d = await fetch('/api/cleaning-invoices', { cache: 'no-store' }).then((r) => r.json())
      setInvoices(d.invoices ?? [])
      if (res.id) setInvOpen(res.id)
    } catch (err) {
      setInvError(err instanceof Error ? err.message : 'Prüfung fehlgeschlagen.')
    } finally {
      setInvBusy(null)
      pendingRef.current = null
    }
  }

  async function deleteInvoice(id: string) {
    if (!confirm('Rechnung und Analyse löschen?')) return
    await fetch('/api/cleaning-invoices', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setInvoices((list) => list.filter((x) => x.id !== id))
  }

  /* ── Touren: Einsatztage → Blöcke je Standort × Reinigungskraft ── */
  const tours = useMemo(() => {
    const byDay = new Map<string, Map<string, Slot[]>>()
    for (const s of visible) {
      const day = byDay.get(s.effDay) ?? new Map<string, Slot[]>()
      const bKey = `${s.group}|${s.personId}`
      const arr = day.get(bKey) ?? []
      arr.push(s)
      day.set(bKey, arr)
      byDay.set(s.effDay, day)
    }
    return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [visible])

  const chip = (bg: string, color: string, text: string, key?: string) => (
    <span key={key} style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: bg, color }}>{text}</span>
  )
  const toggle = (k: string) => setOpenKeys((o) => ({ ...o, [k]: !o[k] }))
  const rowStyle = { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.1)' } as const
  const subRowStyle = { display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0 4px 14px', fontSize: 12, color: '#6B7280' } as const

  const personChips = (persons.length > 0 || hasUnassigned) && (
    <div style={{ display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 8, marginBottom: 6 }}>
      {[{ id: '', name: 'Alle' }, ...persons, ...(hasUnassigned ? [{ id: 'none', name: 'Ohne Zuordnung' }] : [])].map((p) => (
        <button key={p.id || 'alle'} onClick={() => setPersonFilter(p.id)} style={{
          flexShrink: 0, padding: '6px 13px', borderRadius: 999, border: 'none', fontSize: 12.5, fontWeight: 700,
          background: personFilter === p.id ? 'var(--gold, #AE8D2D)' : 'rgba(120,120,128,0.12)',
          color: personFilter === p.id ? '#fff' : '#3C3C43', cursor: 'pointer', whiteSpace: 'nowrap',
        }}>{p.id && p.id !== 'none' ? `👤 ${p.name}` : p.name}</button>
      ))}
    </div>
  )

  return (
    <div>
      <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={handleFile} style={{ display: 'none' }} />
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {([['liste', '📋 Liste'], ['touren', '🗺 Touren'], ...(isAdmin ? [['kosten', '💶 Kosten']] : [])] as [typeof mode, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setMode(id)} style={{
            padding: '6px 13px', borderRadius: 999, border: 'none', fontSize: 12.5, fontWeight: 700,
            background: mode === id ? '#1A1814' : 'rgba(120,120,128,0.12)',
            color: mode === id ? '#fff' : '#3C3C43', cursor: 'pointer',
          }}>{label}</button>
        ))}
      </div>
      {/* 👤 Filter nach Reinigungskraft — gilt für ALLE drei Ansichten */}
      {personChips}

      {/* ═══ 💶 KOSTEN (Admins) — Rechnung je KALENDERMONAT + Kraft ═══ */}
      {mode === 'kosten' && costs && (
        <div>
          {invError && (
            <p style={{ margin: '0 0 10px', padding: '9px 12px', borderRadius: 12, background: '#FEE2E2', color: '#B91C1C', fontSize: 12.5 }}>
              {invError} <button onClick={() => setInvError(null)} style={{ border: 'none', background: 'none', color: '#B91C1C', fontWeight: 800, cursor: 'pointer' }}>✕</button>
            </p>
          )}

          {costs.months.map((m) => {
            const expectedPayload = {
              monat: m.label,
              reinigungskraft: personLabel,
              saetze: personFilter && personFilter !== 'none'
                ? (cleaning.ratesByPerson?.[personFilter] ?? cleaning.rates)
                : cleaning.rates,
              total: Math.round(m.total * 100) / 100,
              basis: Math.round(m.baseSum * 100) / 100,
              zulagen: Math.round(m.surcharge * 100) / 100,
              anfahrten: { anzahl: m.tripCount, betrag: m.travel },
              wohnungen: [...m.perListing.entries()].map(([id, row]) => ({
                wohnung: listings[id]?.title ?? 'Wohnung', anzahl: row.count,
                minuten: row.minutes, betrag: Math.round(row.base * 100) / 100,
              })),
              einzelne_reinigungen: m.slots.map((s) => ({
                datum: s.effDay, wohnung: listings[s.listingId]?.title ?? '—',
                dauer_min: s.minutes, betrag: Math.round(slotCost(s) * 100) / 100,
                zulage: Math.round(slotSurcharge(s) * 100) / 100 || undefined,
              })),
              hinweis: m.partialStart ? 'Laufender Monat ab heute — frühere Reinigungen des Monats fehlen in der Erwartung.' : undefined,
            }
            const monthInvoices = invoices.filter((inv) => inv.month === m.key
              && (personFilter === '' || (personFilter === 'none' ? inv.person_id === null : inv.person_id === personFilter)))
            return (
              <div key={m.key} style={{ background: '#fff', borderRadius: 16, padding: '16px 16px 14px', marginBottom: 12, boxShadow: 'inset 0 0 0 0.5px rgba(60,60,67,0.15)' }}>
                <p style={{ fontSize: 11.5, fontWeight: 700, color: '#8A8578', letterSpacing: '0.06em', margin: '0 0 2px' }}>ERWARTETE RECHNUNG</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                  <span style={{ fontSize: 17, fontWeight: 800, color: '#111' }}>{m.label}</span>
                  <span style={{ fontSize: 12, color: '#9CA3AF' }}>{m.slots.length} Reinigungen · {personLabel}</span>
                </div>

                {/* Wohnungen — Tap fächert die einzelnen Reinigungen auf */}
                {[...m.perListing.entries()].sort((a, b) => b[1].base - a[1].base).map(([id, row]) => {
                  const k = `${m.key}|l|${id}`
                  const open = !!openKeys[k]
                  return (
                    <div key={id}>
                      <button onClick={() => toggle(k)} style={{ ...rowStyle, width: '100%', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', alignItems: 'center' }}>
                        <span style={{ fontSize: 13, color: '#111', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span style={{ color: '#B0AA9C', fontSize: 10, marginRight: 5 }}>{open ? '▾' : '▸'}</span>
                          {listings[id]?.title ?? 'Wohnung'} <span style={{ color: '#9CA3AF', fontSize: 12 }}>· {row.count}× · {fmtDur(row.minutes)}</span>
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#111', flexShrink: 0 }}>{eur(row.base)}</span>
                      </button>
                      {open && m.slots.filter((s) => s.listingId === id).map((s) => (
                        <div key={s.stay.id} style={subRowStyle}>
                          <span>
                            {wdShort(s.effDay)} {fmtShort(s.effDay)} · {fmtDur(s.minutes)}
                            {s.sameDayArrival ? ' · Wechseltag' : s.reason === 'buendel' ? ` · gebündelt (Abreise ${fmtShort(s.stay.checkOut)})` : ''}
                            {slotSurcharge(s) > 0 ? ` · zzgl. ${eur(slotSurcharge(s))} Zulage` : ''}
                          </span>
                          <span style={{ fontWeight: 700, flexShrink: 0 }}>{eur(slotCost(s))}</span>
                        </div>
                      ))}
                    </div>
                  )
                })}

                {/* Zulagen — aufklappbar */}
                {(() => {
                  const k = `${m.key}|z`
                  const zSlots = m.slots.filter((s) => slotSurcharge(s) > 0)
                  return (
                    <div>
                      <button onClick={() => zSlots.length && toggle(k)} style={{ ...rowStyle, width: '100%', border: 'none', background: 'none', cursor: zSlots.length ? 'pointer' : 'default', textAlign: 'left', alignItems: 'center' }}>
                        <span style={{ fontSize: 13, color: '#6B7280' }}>
                          {zSlots.length > 0 && <span style={{ color: '#B0AA9C', fontSize: 10, marginRight: 5 }}>{openKeys[k] ? '▾' : '▸'}</span>}
                          Sonn-/Feiertags-Zulagen
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: m.surcharge ? '#B45309' : '#9CA3AF', flexShrink: 0 }}>{eur(m.surcharge)}</span>
                      </button>
                      {openKeys[k] && zSlots.map((s) => (
                        <div key={s.stay.id} style={subRowStyle}>
                          <span>{wdShort(s.effDay)} {fmtShort(s.effDay)} · {listings[s.listingId]?.title ?? '—'} · {dayKind(s.effDay) === 'feiertag' ? 'Feiertag' : 'Sonntag'}</span>
                          <span style={{ fontWeight: 700, color: '#B45309', flexShrink: 0 }}>{eurSigned(slotSurcharge(s))}</span>
                        </div>
                      ))}
                    </div>
                  )
                })()}

                {/* Anfahrten — aufklappbar (Satz der jeweiligen Kraft) */}
                {(() => {
                  const k = `${m.key}|a`
                  const trips = [...m.trips.values()].sort((a, b) => a.day.localeCompare(b.day))
                  return (
                    <div>
                      <button onClick={() => trips.length && toggle(k)} style={{ ...rowStyle, width: '100%', border: 'none', background: 'none', cursor: trips.length ? 'pointer' : 'default', textAlign: 'left', alignItems: 'center' }}>
                        <span style={{ fontSize: 13, color: '#6B7280' }}>
                          {trips.length > 0 && <span style={{ color: '#B0AA9C', fontSize: 10, marginRight: 5 }}>{openKeys[k] ? '▾' : '▸'}</span>}
                          Anfahrten ({m.tripCount}×)
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#111', flexShrink: 0 }}>{eur(m.travel)}</span>
                      </button>
                      {openKeys[k] && trips.map((t) => {
                        const s0 = m.slots.find((s) => s.group === t.group && s.personId === t.personId)
                        const info = s0 ? listings[s0.listingId] : null
                        const pName = t.personId !== '-' ? (persons.find((p) => p.id === t.personId)?.name ?? null) : null
                        return (
                          <div key={`${t.day}|${t.group}|${t.personId}`} style={subRowStyle}>
                            <span>{wdShort(t.day)} {fmtShort(t.day)} · {info?.group ?? info?.title ?? '—'}{pName && personFilter === '' ? ` · ${pName}` : ''} · {t.count} Reinigung{t.count === 1 ? '' : 'en'}</span>
                            <span style={{ fontWeight: 700, flexShrink: 0 }}>{eur(t.fee)}</span>
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 0 2px' }}>
                  <span style={{ fontSize: 14.5, fontWeight: 800, color: '#111' }}>Summe {m.label}</span>
                  <span style={{ fontSize: 19, fontWeight: 800, color: '#8A7020' }}>{eur(m.total)}</span>
                </div>
                {(m.partialStart || m.partialEnd) && (
                  <p style={{ fontSize: 11.5, color: '#9CA3AF', margin: '4px 0 0', textAlign: 'right' }}>
                    {m.partialStart
                      ? 'ab heute gerechnet — Reinigungen vor heute fehlen in dieser Summe'
                      : `teilweise erfasst (Buchungsdaten bis ${fmtShort(horizon)})`}
                  </p>
                )}

                {/* ── Rechnungs-Abgleich ── */}
                <div style={{ marginTop: 12, paddingTop: 10, boxShadow: 'inset 0 0.5px 0 rgba(60,60,67,0.15)' }}>
                  {monthInvoices.map((inv) => {
                    const diff = inv.amount_invoiced != null && inv.amount_expected != null
                      ? inv.amount_invoiced - inv.amount_expected : (inv.analysis?.differenz ?? null)
                    const ok = inv.status === 'geprueft' && diff != null && Math.abs(diff) <= (inv.amount_expected ?? 0) * 0.1
                    const personName = inv.person_id ? (persons.find((p) => p.id === inv.person_id)?.name ?? 'Person') : null
                    const open = invOpen === inv.id
                    return (
                      <div key={inv.id} style={{ marginBottom: 8 }}>
                        <button onClick={() => setInvOpen(open ? null : inv.id)} style={{
                          width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none',
                          background: inv.status === 'fehler' ? '#FEF2F2' : ok ? '#F0FDF4' : '#FFFBEB',
                          borderRadius: 12, padding: '9px 12px',
                          boxShadow: `inset 0 0 0 1px ${inv.status === 'fehler' ? '#FECACA' : ok ? '#BBF7D0' : '#FDE68A'}`,
                        }}>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#111', display: 'block' }}>
                            📄 {inv.file_name ?? 'Rechnung'}{personName ? ` · ${personName}` : ''}
                          </span>
                          <span style={{ fontSize: 12, color: '#6B7280' }}>
                            {inv.status === 'fehler' ? 'Analyse fehlgeschlagen — antippen für Details'
                              : `Rechnung ${inv.amount_invoiced != null ? eur(inv.amount_invoiced) : '?'} · erwartet ${inv.amount_expected != null ? eur(inv.amount_expected) : '?'}${diff != null ? ` · ${eurSigned(diff)}` : ''}`}
                          </span>
                        </button>
                        {open && (
                          <div style={{ padding: '10px 12px', fontSize: 12.5, color: '#374151', lineHeight: 1.55 }}>
                            {inv.analysis?.einschaetzung && <p style={{ margin: '0 0 8px' }}>{inv.analysis.einschaetzung}</p>}
                            {(inv.analysis?.auffaelligkeiten ?? []).length > 0 && (
                              <div style={{ margin: '0 0 8px' }}>
                                {(inv.analysis!.auffaelligkeiten!).map((a, i) => (
                                  <p key={i} style={{ margin: '0 0 3px', color: '#B45309' }}>⚠️ {a}</p>
                                ))}
                              </div>
                            )}
                            {(inv.analysis?.positionen ?? []).length > 0 && (
                              <div style={{ margin: '0 0 8px' }}>
                                {(inv.analysis!.positionen!).map((p, i) => (
                                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0' }}>
                                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.text}</span>
                                    <span style={{ fontWeight: 700, flexShrink: 0 }}>{p.betrag != null ? eur(p.betrag) : '—'}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            <span style={{ display: 'inline-flex', gap: 12 }}>
                              <a href={inv.file_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 700, color: '#8A7020' }}>Datei öffnen ↗</a>
                              <button onClick={() => deleteInvoice(inv.id)} style={{ border: 'none', background: 'none', fontSize: 12, fontWeight: 700, color: '#B91C1C', cursor: 'pointer', padding: 0 }}>🗑 Löschen</button>
                            </span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {invBusy === m.key ? (
                    <p style={{ fontSize: 12.5, color: '#8A7020', fontWeight: 700, margin: '4px 0 0' }}>🔍 Claude liest die Rechnung und gleicht sie ab…</p>
                  ) : (
                    <button onClick={() => startUpload(m.key, expectedPayload)} disabled={!!invBusy} style={{
                      marginTop: 2, padding: '8px 14px', borderRadius: 999, border: 'none', cursor: 'pointer',
                      fontSize: 12.5, fontWeight: 700, color: '#fff',
                      background: 'linear-gradient(135deg, var(--gold, #AE8D2D), #8A7020)', opacity: invBusy ? 0.5 : 1,
                    }}>📄 Rechnung hochladen & prüfen{personFilter && personFilter !== 'none' ? ` (${personLabel})` : ''}</button>
                  )}
                </div>
              </div>
            )
          })}
          {costs.months.length === 0 && (
            <p style={{ textAlign: 'center', color: '#8E8E93', fontSize: 13.5, padding: 30 }}>Keine anstehenden Reinigungen für {personLabel} im Datenfenster.</p>
          )}
          {costs.missingMinutes > 0 && (
            <p style={{ fontSize: 11.5, color: '#B45309', margin: '2px 4px 0', lineHeight: 1.5 }}>
              ⚠️ Bei {costs.missingMinutes} Reinigung(en) fehlt die Ø-Dauer der Wohnung — gerechnet mit {FALLBACK_MINUTES} Min. (Admin → 🧹 Reinigung pflegen).
            </p>
          )}
        </div>
      )}

      {/* ═══ 🗺 TOUREN ═══ */}
      {mode === 'touren' && (tours.length === 0 ? (
        <p style={{ textAlign: 'center', color: '#8E8E93', fontSize: 13.5, padding: 30 }}>Keine Einsätze für {personLabel} in den nächsten 4 Wochen.</p>
      ) : tours.map(([day, groups]) => {
        const all = [...groups.values()].flat()
        const totalMin = all.reduce((a, s) => a + s.minutes, 0)
        const kind = dayKind(day)
        return (
          <div key={day} style={{ marginBottom: 14, background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: 'inset 0 0 0 0.5px rgba(60,60,67,0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '11px 14px', background: day === today ? '#FAF5E4' : '#FCFBF9', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13.5, fontWeight: 800, color: day === today ? '#8A7020' : '#111' }}>{dayLabel(day, today)}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#6B7280' }}>
                ⏱ {fmtDur(totalMin)} · 🚗 {groups.size} Anfahrt{groups.size === 1 ? '' : 'en'}{kind ? (kind === 'sonntag' ? ' · ☀️ Sonntag' : ' · 🎌 Feiertag') : ''}
              </span>
            </div>
            {[...groups.entries()].map(([g, items]) => {
              const info = listings[items[0].listingId]
              const pName = items[0].personId !== '-' ? (persons.find((p) => p.id === items[0].personId)?.name ?? null) : null
              return (
                <div key={g} style={{ padding: '9px 14px', boxShadow: 'inset 0 0.5px 0 rgba(60,60,67,0.1)' }}>
                  <p style={{ fontSize: 11.5, fontWeight: 800, color: '#8A7020', margin: '0 0 6px' }}>
                    📍 {info?.group ?? info?.title ?? '—'}{pName && personFilter === '' ? ` · 👤 ${pName}` : ''} · {fmtDur(items.reduce((a, s) => a + s.minutes, 0))}
                  </p>
                  {items.map((s) => (
                    <div key={s.stay.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>
                        {listings[s.listingId]?.title}
                        {cleaning.mine.includes(s.listingId) && <span style={{ color: '#8A7020' }}> · du</span>}
                      </span>
                      <span style={{ display: 'inline-flex', gap: 5, flexShrink: 0, alignItems: 'center' }}>
                        <span style={{ fontSize: 11.5, color: '#6B7280' }}>{fmtDur(s.minutes)}</span>
                        {s.sameDayArrival
                          ? chip('#FFF7ED', '#C2410C', 'Wechsel')
                          : s.recommended ? chip('#EFF6FF', '#1D4ED8', `von ${fmtShort(s.stay.checkOut)}`) : chip('#F0FDF4', '#15803D', 'flexibel')}
                      </span>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )
      }))}

      {/* ═══ 📋 LISTE ═══ */}
      {mode === 'liste' && (() => {
        const days: { iso: string; items: Slot[] }[] = []
        for (const s of visible) {
          const last = days[days.length - 1]
          if (last && last.iso === s.effDay) last.items.push(s)
          else days.push({ iso: s.effDay, items: [s] })
        }
        return days.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: '#8E8E93' }}>
            <p style={{ fontSize: 40, margin: '0 0 8px' }}>🧹</p>
            <p style={{ fontSize: 15, fontWeight: 600, margin: 0, color: '#3C3C43' }}>Keine anstehenden Reinigungen für {personLabel} in den nächsten 4 Wochen.</p>
          </div>
        ) : days.map(({ iso, items }) => (
          <div key={iso} style={{ marginBottom: 16 }}>
            <p style={{
              fontSize: 12.5, fontWeight: 800, margin: '0 0 7px',
              color: iso === today ? 'var(--gold, #AE8D2D)' : '#6B7280',
              textTransform: 'uppercase', letterSpacing: '0.03em',
            }}>{dayLabel(iso, today)}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {items.map((s) => {
                const info = listings[s.listingId]
                const resp = cleaning.responsible[s.listingId]
                const isMine = cleaning.mine.includes(s.listingId)
                // Namen nur zeigen, wenn man MEHRERE Kräfte sieht (Team-Sicht
                // „Alle") — wer nur die eigenen Reinigungen sieht, weiß es eh
                const showName = personFilter === '' && persons.length > 1 && !!resp
                // Bündel-Partner: der Pflicht-Termin derselben Kraft am selben
                // Tag & Standort (für den „eine Anfahrt"-Chip)
                const partner = slots.find((x) => x.sameDayArrival && x.effDay === s.effDay
                  && x.group === s.group && x.personId === s.personId && x.listingId !== s.listingId)
                const partnerTitle = partner ? listings[partner.listingId]?.title ?? null : null
                const fromLabel = s.stay.checkOut === today ? 'heute' : `${wdShort(s.stay.checkOut)} ${fmtShort(s.stay.checkOut)}`
                return (
                  <div key={s.stay.id} style={{
                    background: '#fff', borderRadius: 14, padding: '11px 13px',
                    boxShadow: s.sameDayArrival
                      ? 'inset 0 0 0 1.5px #C2410C'
                      : showName && isMine ? 'inset 0 0 0 1.5px var(--gold, #AE8D2D)' : 'inset 0 0 0 0.5px rgba(60,60,67,0.15)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>🧹 {info?.title ?? 'Wohnung'}</span>
                      {showName && chip(isMine ? '#FAF5E4' : '#F3F4F6', isMine ? '#8A7020' : '#374151', `👤 ${isMine ? 'Du' : resp!.name}`)}
                    </div>
                    {s.sameDayArrival ? (
                      <p style={{ fontSize: 12.5, fontWeight: 800, color: '#C2410C', margin: '7px 0 0' }}>
                        ⏰ WECHSELTAG — bis zur Anreise fertig
                      </p>
                    ) : (
                      <>
                        <p style={{ fontSize: 12.5, fontWeight: 600, color: '#374151', margin: '7px 0 0' }}>
                          🟢 Reinigen möglich: {fromLabel}
                          {s.nextIn
                            ? ` – ${wdShort(s.nextIn)} ${fmtShort(s.nextIn)} (Anreise)`
                            : ' — nichts gebucht, jederzeit'}
                        </p>
                        {(s.recommended || partnerTitle) && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 7 }}>
                            {s.reason === 'sonntag' && chip('#EFF6FF', '#1D4ED8', '☀️ Sonntag übersprungen')}
                            {s.reason === 'feiertag' && chip('#EFF6FF', '#1D4ED8', '🎌 Feiertag übersprungen')}
                            {partnerTitle && chip('#F5F3FF', '#6D28D9', `🚗 eine Anfahrt — zusammen mit ${partnerTitle}`)}
                            {s.reason === 'buendel' && !partnerTitle && chip('#F5F3FF', '#6D28D9', '🚗 eine Anfahrt — mit Termin am Standort')}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))
      })()}
    </div>
  )
}
