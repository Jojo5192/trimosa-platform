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
import { Segmented } from '@/components/team/ux'

type Stay = { id: string; listingId: string; checkIn: string; checkOut: string; guestName: string | null; channel?: string | null }
type Rules = { avoidSundays: boolean; avoidHolidays: boolean; bundleTravel?: boolean }
type Rates = {
  hourlyRate: number; travelFee: number; travelPerCleaning?: boolean
  sundaySurchargePct: number; holidaySurchargePct: number
  specialSurchargePct?: number; vatPct?: number
}

/** Besondere Feiertage mit eigenem Zuschlag (Vertrag VP Glanzteam §4.3) —
    lokale Kopie von lib/cleaning (die Datei ist server-only). */
function isSpecialDay(iso: string): boolean {
  const md = iso.slice(5)
  return md === '12-24' || md === '12-25' || md === '12-26' || md === '12-31' || md === '05-01'
}
export type CleaningInfo = {
  settings: Rules
  settingsByPerson?: Record<string, Rules>
  rates: Rates | null
  ratesByPerson?: Record<string, Rates> | null
  holidays: string[]
  responsible: Record<string, { id: string; name: string }>
  minutes: Record<string, number>
  mine: string[]
  /** 🧹 §231: vor-Ort-Fertigmeldungen (NFC), Key `${listingId}|${slotDate}` */
  confirmations?: Record<string, { at: string; person: string | null; verify: string }>
}
type Invoice = {
  id: string; month: string; person_id: string | null
  file_url: string; file_name: string | null
  amount_expected: number | null; amount_invoiced: number | null
  analysis: {
    betrag_rechnung?: number | null; positionen?: { text: string; betrag: number | null }[]
    differenz?: number | null; einschaetzung?: string; auffaelligkeiten?: string[]
    /** §257: Auto-Prüfung aus dem Mail-Import — gefundene sevdesk-Belege */
    lieferant?: string
    belege?: { id: string; datum: string; betrag: number; text: string; wohnung?: string | null; zugeordnet: boolean; grund?: string; url: string }[]
    /** §257b: Wohnungs-Vergleich — erwartet vs. abgerechnet + Ursache */
    wohnungen?: { wohnung: string; erwartet: number | null; abgerechnet: number; differenz: number | null; ursache?: string }[]
  } | null
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
  reason: 'sonntag' | 'feiertag' | 'besonders' | 'buendel' | null
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
  // §257: Rückblick-Fenster für die 💶-Kosten — die vergangenen Monate
  // kommen aus einem eigenen Kalender-Fetch (?cleaningPast), inkl. der
  // Feiertage des Rückblicks (Zulagen!)
  const PAST_DAYS = 240
  const [pastData, setPastData] = useState<{ stays: Stay[]; holidays: string[] } | null>(null)
  const holidaySet = useMemo(
    () => new Set([...cleaning.holidays, ...(pastData?.holidays ?? [])]),
    [cleaning.holidays, pastData])

  const isBlockedFor = (iso: string, lid: string) => {
    const rules = rulesFor(lid)
    const dow = new Date(iso + 'T00:00:00Z').getUTCDay()
    return (rules.avoidSundays && dow === 0)
      || (rules.avoidHolidays && (holidaySet.has(iso) || isSpecialDay(iso)))
  }
  /** Kalender-Fakt (unabhängig von Meidungs-Regeln) — Basis der Zulagen.
      'besonders' (Weihnachten/Silvester/1. Mai) schlägt 'feiertag'. */
  const dayKind = (iso: string): 'besonders' | 'sonntag' | 'feiertag' | null =>
    isSpecialDay(iso) ? 'besonders'
      : holidaySet.has(iso) ? 'feiertag'
        : new Date(iso + 'T00:00:00Z').getUTCDay() === 0 ? 'sonntag' : null

  /** Slot-Berechnung über eine beliebige Aufenthalts-Menge ab fromIso —
      genutzt für die normale Planung (heute →) UND den Kosten-Rückblick. */
  const buildSlots = (source: Stay[], fromIso: string): Slot[] => {
    const base = source.filter((s) => s.checkOut >= fromIso && s.checkOut <= horizon && listings[s.listingId])
    // Pflicht-Tage je Standort × Reinigungskraft (Wechseltage) — Bündelungs-
    // Anker: gebündelt wird nur, wenn DIESELBE Kraft am selben Ort putzt
    const anchorDays = new Set<string>()
    for (const s of base) {
      if (source.some((x) => x.listingId === s.listingId && x.checkIn === s.checkOut)) {
        const g = listings[s.listingId]?.group ?? s.listingId
        anchorDays.add(`${s.checkOut}|${g}|${personOf(s.listingId) ?? '-'}`)
      }
    }
    return base.map((s) => {
      const group = listings[s.listingId]?.group ?? s.listingId
      const personId = personOf(s.listingId) ?? '-'
      const anchorKey = (day: string) => `${day}|${group}|${personId}`
      const sameDayArrival = source.some((x) => x.listingId === s.listingId && x.checkIn === s.checkOut)
      const nextIn = source
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
        // Bündeln nur, wenn es bei DIESER Kraft eine Anfahrt spart (§120):
        // bei Anfahrt-je-Reinigung (Vanessa) oder 0-€-Anfahrt (Tip-Top) zählt
        // allein „schnellstmöglich" — keine künstliche Verzögerung
        const bundle = (rulesFor(s.listingId).bundleTravel ?? true)
          ? windowDays.find((d) => !isBlockedFor(d, s.listingId) && anchorDays.has(anchorKey(d))) ?? null
          : null
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
  }

  const slots: Slot[] = useMemo(() => buildSlots(stays, today),
    [stays, listings, cleaning, today, horizon]) // eslint-disable-line react-hooks/exhaustive-deps

  /* §257: Kosten-Slots inkl. Vergangenheit — sobald der Rückblick-Fetch da
     ist, decken sie −240 Tage bis +56; bis dahin (und bei Fetch-Fehler)
     rechnet die Kosten-Ansicht wie bisher nur ab heute.
     WICHTIG (Review-Fund): Gegenwart/Zukunft kommen IMMER aus dem frischen
     stays-Prop — der Rückblick-Snapshot liefert NUR die Vergangenheit.
     Pull-to-Refresh/Resume des Kalenders wirken so auch auf die Kosten und
     der auto-check schickt nie eine veraltete Erwartung an die KI. */
  const pastFrom = isoOffset(-PAST_DAYS)
  const coveredFrom = pastData && pastData.stays.length ? pastFrom : today
  const costSlots: Slot[] = useMemo(() => {
    if (!pastData || !pastData.stays.length) return slots
    const seen = new Set(stays.map((s) => s.id))
    const merged = [...stays, ...pastData.stays.filter((s) => !seen.has(s.id) && s.checkOut < today)]
    return buildSlots(merged, pastFrom)
  }, [pastData, stays, slots, listings, cleaning, pastFrom, horizon, today]) // eslint-disable-line react-hooks/exhaustive-deps

  const visible = slots.filter((s) => s.effDay <= listHorizon && matchPerson(s.listingId))

  const slotCost = (s: Slot) => (s.minutes / 60) * (ratesFor(s.listingId)?.hourlyRate ?? 0)
  const slotSurcharge = (s: Slot) => {
    const kind = dayKind(s.effDay)
    const r = ratesFor(s.listingId)
    if (!kind || !r) return 0
    const pct = kind === 'besonders' ? (r.specialSurchargePct ?? r.holidaySurchargePct)
      : kind === 'feiertag' ? r.holidaySurchargePct : r.sundaySurchargePct
    return slotCost(s) * (pct / 100)
  }

  /* ── Kosten — echte KALENDERMONATE (inkl. Rückblick §257), Sätze je Kraft ── */
  const costs = useMemo(() => {
    if (!cleaning.rates) return null
    const filtered = costSlots.filter((s) => matchPerson(s.listingId))

    type Trip = { day: string; group: string; personId: string; listingId: string; count: number; fee: number }
    type PerListing = { count: number; minutes: number; base: number; surcharge: number; travel: number; vat: number; total: number }
    type MonthRow = {
      key: string; label: string; partialStart: boolean; partialEnd: boolean
      perListing: Map<string, PerListing>
      trips: Map<string, Trip>
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
          partialStart: `${key}-01` < coveredFrom,
          partialEnd: lastDay > horizon,
          perListing: new Map(), trips: new Map(), slots: [],
        }
        months.set(key, m)
      }
      m.slots.push(s)
      if (!s.hasMinutes) missingMinutes++
      // Anfahrt: je nach Vertragsmodell der Kraft — je EINZELNER Reinigung
      // (travelPerCleaning, z. B. VP Glanzteam) oder gebündelt je
      // Einsatztag × Standort × Kraft; jeweils zum Satz DIESER Kraft
      const r = ratesFor(s.listingId)
      const tKey = r?.travelPerCleaning ? `${s.effDay}|${s.stay.id}` : `${s.effDay}|${s.group}|${s.personId}`
      const t = m.trips.get(tKey) ?? {
        day: s.effDay, group: s.group, personId: s.personId, listingId: s.listingId,
        count: 0, fee: r?.travelFee ?? 0,
      }
      t.count++
      m.trips.set(tKey, t)
    }
    // Pass 2 (§257b): VOLLKOSTEN je Wohnung — Basis + Zulagen + Anfahrt-
    // Anteil (Trip-Gebühr auf die Reinigungen des Trips verteilt) + USt.
    // So ist die Wohnungs-Erwartung direkt mit den Rechnungs-Belegen je
    // Wohnung vergleichbar, und die Monats-Summe = Summe der Wohnungen.
    for (const m of months.values()) {
      for (const s of m.slots) {
        const r = ratesFor(s.listingId)
        const tKey = r?.travelPerCleaning ? `${s.effDay}|${s.stay.id}` : `${s.effDay}|${s.group}|${s.personId}`
        const trip = m.trips.get(tKey)
        const anfahrt = trip ? trip.fee / trip.count : 0
        const basis = slotCost(s)
        const zulage = slotSurcharge(s)
        const ust = (basis + zulage + anfahrt) * ((r?.vatPct ?? 0) / 100)
        const row = m.perListing.get(s.listingId)
          ?? { count: 0, minutes: 0, base: 0, surcharge: 0, travel: 0, vat: 0, total: 0 }
        row.count++
        row.minutes += s.minutes
        row.base += basis
        row.surcharge += zulage
        row.travel += anfahrt
        row.vat += ust
        row.total += basis + zulage + anfahrt + ust
        m.perListing.set(s.listingId, row)
      }
    }
    // §257b LOGISCHE Reihenfolge (Inhaber): EINE Zeitachse — aktueller
    // Monat oben, darunter die Vergangenheit absteigend (= Prüf-Arbeit);
    // die ZUKUNFT ist reine Prognose und wandert als eigener Block ans Ende.
    const curKey = today.slice(0, 7)
    const list = [...months.values()].map((m) => {
      const rows = [...m.perListing.values()]
      const baseSum = rows.reduce((a, x) => a + x.base, 0)
      const surcharge = rows.reduce((a, x) => a + x.surcharge, 0)
      const travel = rows.reduce((a, x) => a + x.travel, 0)
      const vat = rows.reduce((a, x) => a + x.vat, 0)
      const net = baseSum + surcharge + travel
      return { ...m, baseSum, surcharge, travel, tripCount: m.trips.size, net, vat, total: net + vat, isPast: m.key < curKey, isFuture: m.key > curKey }
    }).sort((a, b) => b.key.localeCompare(a.key))
    return {
      months: list.filter((m) => !m.isFuture),          // aktuell + Vergangenheit, absteigend
      future: list.filter((m) => m.isFuture).reverse(), // Ausblick, aufsteigend
      missingMinutes,
    }
  }, [costSlots, cleaning.rates, cleaning.ratesByPerson, cleaning.responsible, personFilter, coveredFrom]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Rechnungen laden (nur Kosten-Ansicht) ── */
  useEffect(() => {
    if (mode !== 'kosten' || !isAdmin) return
    fetch('/api/cleaning-invoices', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setInvoices(d.invoices ?? []))
      .catch(() => { /* fail-soft */ })
  }, [mode, isAdmin])

  /* ── §257: Rückblick-Aufenthalte für die vergangenen Monate laden ── */
  useEffect(() => {
    if (mode !== 'kosten' || !isAdmin || pastData !== null) return
    fetch(`/api/team/calendar?cleaningPast=${PAST_DAYS}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setPastData({
        stays: Array.isArray(d.stays) ? d.stays : [],
        holidays: Array.isArray(d.cleaning?.holidays) ? d.cleaning.holidays : [],
      }))
      .catch(() => setPastData({ stays: [], holidays: [] }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, isAdmin, pastData])

  /* ── §257: Rechnung automatisch aus dem Mail-Import suchen & prüfen ── */
  async function autoCheck(month: string, expected: Record<string, unknown>) {
    if (!personFilter || personFilter === 'none') return
    setInvError(null)
    setInvBusy(month)
    try {
      const res = await fetch('/api/cleaning-invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'auto-check', month, personId: personFilter,
          personName: persons.find((p) => p.id === personFilter)?.name ?? '',
          expected,
        }),
      }).then((r) => r.json())
      if (res.error) throw new Error(res.error)
      const d = await fetch('/api/cleaning-invoices', { cache: 'no-store' }).then((r) => r.json())
      setInvoices(d.invoices ?? [])
      if (res.id) setInvOpen(res.id)
    } catch (err) {
      setInvError(err instanceof Error ? err.message : 'Automatische Prüfung fehlgeschlagen.')
    } finally {
      setInvBusy(null)
    }
  }

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
      {/* §243ag: iOS-Segmented statt Pill-Reihe */}
      <div style={{ marginBottom: 10 }}>
        <Segmented
          options={[['liste', '📋 Liste'], ['touren', '🗺 Touren'], ...(isAdmin ? [['kosten', '💶 Kosten'] as [string, string]] : [])]}
          value={mode}
          onChange={(id) => setMode(id as typeof mode)}
        />
      </div>
      {/* 👤 Filter nach Reinigungskraft — gilt für ALLE drei Ansichten */}
      {personChips}

      {/* ═══ 💶 KOSTEN (Admins) — §257b: EINE Zeitachse (aktueller Monat →
          Vergangenheit absteigend), Ausblick als Prognose am Ende; je Wohnung
          ERWARTET vs. ABGERECHNET mit Ursache der Abweichung ═══ */}
      {mode === 'kosten' && costs && (() => {
        type MonthOut = NonNullable<typeof costs>['months'][number]
        const r2 = (x: number) => Math.round(x * 100) / 100
        const HAIR = 'inset 0 0 0 0.5px rgba(60,60,67,0.14)'
        const eyebrowStyle = { fontSize: 12, fontWeight: 700, color: '#8A8578', letterSpacing: '0.06em', margin: '16px 4px 8px' } as const
        const deltaChip = (diff: number | null, small = false) => {
          if (diff == null) return null
          const neutral = Math.abs(diff) < 1
          return (
            <span style={{
              fontSize: small ? 10.5 : 11.5, fontWeight: 700, padding: small ? '1px 7px' : '3px 9px',
              borderRadius: 999, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
              background: neutral ? 'rgba(120,120,128,0.10)' : diff > 0 ? '#FEE2E2' : '#DCFCE7',
              color: neutral ? '#8E8E93' : diff > 0 ? '#B91C1C' : '#15803D',
            }}>{neutral ? '±0 €' : eurSigned(r2(diff))}</span>
          )
        }

        const renderMonth = (m: MonthOut, kind: 'aktuell' | 'rueck' | 'aus') => {
          const expectedPayload = {
            monat: m.label,
            reinigungskraft: personLabel,
            saetze: personFilter && personFilter !== 'none'
              ? (cleaning.ratesByPerson?.[personFilter] ?? cleaning.rates)
              : cleaning.rates,
            total: r2(m.total),
            summe_netto: r2(m.net),
            umsatzsteuer: r2(m.vat),
            basis: r2(m.baseSum),
            zulagen: r2(m.surcharge),
            anfahrten: { anzahl: m.tripCount, betrag: r2(m.travel) },
            hinweis_anfahrt: m.slots.some((s) => ratesFor(s.listingId)?.travelPerCleaning)
              ? 'Anfahrtspauschale gilt je Einsatz UND pro eingesetztem Mitarbeiter — die Erwartung rechnet mit 1 Mitarbeiter je Einsatz; mehr Mitarbeiter erhöhen die Anfahrten legitim.'
              : undefined,
            // §257b: VOLLKOSTEN je Wohnung (Basis + Zulagen + Anfahrt-Anteil
            // + USt) — direkt vergleichbar mit den Rechnungs-Belegen je Wohnung
            wohnungen: [...m.perListing.entries()].map(([id, row]) => ({
              wohnung: listings[id]?.title ?? 'Wohnung', anzahl: row.count, minuten: row.minutes,
              basis: r2(row.base), zulagen: r2(row.surcharge), anfahrten: r2(row.travel),
              ust: r2(row.vat), gesamt: r2(row.total),
            })),
            einzelne_reinigungen: m.slots.map((s) => ({
              datum: s.effDay, wohnung: listings[s.listingId]?.title ?? '—',
              dauer_min: s.minutes, betrag: r2(slotCost(s)),
              zulage: r2(slotSurcharge(s)) || undefined,
            })),
            hinweis: m.partialStart
              ? (coveredFrom === today
                ? 'Laufender Monat ab heute — frühere Reinigungen des Monats fehlen in der Erwartung.'
                : `Monat nur teilweise im Datenfenster (ab ${fmtShort(coveredFrom)}).`)
              : undefined,
          }
          const monthInvoices = invoices.filter((inv) => inv.month === m.key
            && (personFilter === '' || (personFilter === 'none' ? inv.person_id === null : inv.person_id === personFilter)))
          // Review-Fund §257: Im Filter „Alle" keine Einzel-Rechnung gegen die
          // Gesamt-Erwartung stellen — dort nur neutrale Anzeige
          const showInv = personFilter !== '' && personFilter !== 'none'
          const lastInv = monthInvoices[0] ?? null
          const lastDiff = lastInv && lastInv.amount_invoiced != null && lastInv.amount_expected != null
            ? lastInv.amount_invoiced - lastInv.amount_expected : (lastInv?.analysis?.differenz ?? null)
          const lastOk = lastInv?.status === 'geprueft' && lastDiff != null && Math.abs(lastDiff) <= (lastInv.amount_expected ?? 0) * 0.1
          const checkedInv = showInv ? (monthInvoices.find((iv) => iv.status === 'geprueft') ?? null) : null
          const wByName = new Map(((checkedInv?.analysis?.wohnungen) ?? []).map((w) => [w.wohnung, w] as const))
          const expanded = kind === 'aktuell' || !!openKeys[`m|${m.key}`]

          if (!expanded) {
            return (
              <button key={m.key} onClick={() => toggle(`m|${m.key}`)} style={{
                display: 'flex', width: '100%', alignItems: 'center', gap: 10, textAlign: 'left', cursor: 'pointer',
                background: '#fff', border: 'none', borderRadius: 18, padding: '13px 16px', marginBottom: 8,
                boxShadow: HAIR, WebkitTapHighlightColor: 'transparent',
              }}>
                <span style={{ color: '#C7C2B8', fontSize: 11 }}>▸</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: '#111', letterSpacing: -0.2 }}>{m.label}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: '#9CA3AF', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {kind === 'aus'
                      ? `${m.slots.length} Reinigungen geplant${m.partialEnd ? ' · teilweise erfasst' : ''}`
                      : `${m.slots.length} Reinigungen · erwartet ${m.partialStart ? '~' : ''}${eur(m.total)}${showInv && lastInv ? ` · Rechnung ${lastInv.amount_invoiced != null ? eur(lastInv.amount_invoiced) : '?'}` : ''}`}
                  </span>
                </span>
                {kind === 'aus'
                  ? <span style={{ fontSize: 14.5, fontWeight: 700, color: '#8A7020', fontVariantNumeric: 'tabular-nums' }}>{m.partialEnd ? '~' : ''}{eur(m.total)}</span>
                  : showInv
                    ? (lastInv
                      ? chip(lastInv.status === 'fehler' ? '#FEF2F2' : lastOk ? '#DCFCE7' : '#FEF3C7',
                          lastInv.status === 'fehler' ? '#B91C1C' : lastOk ? '#15803D' : '#B45309',
                          lastInv.status === 'fehler' ? '⚠️ Fehler' : lastOk ? '✓ geprüft' : (lastDiff != null ? eurSigned(lastDiff) : 'prüfen'))
                      : chip('rgba(120,120,128,0.10)', '#8E8E93', 'ungeprüft'))
                    : chip('rgba(120,120,128,0.10)', '#8E8E93',
                        monthInvoices.length ? `${monthInvoices.length} Prüfung${monthInvoices.length === 1 ? '' : 'en'}` : 'je Kraft prüfen')}
              </button>
            )
          }

          return (
            <div key={m.key} style={{ background: '#fff', borderRadius: 18, padding: '15px 16px 13px', marginBottom: 10, boxShadow: HAIR }}>
              {/* Kopf */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {kind !== 'aktuell' && (
                  <button onClick={() => toggle(`m|${m.key}`)} style={{ border: 'none', background: 'none', color: '#C7C2B8', fontSize: 12, cursor: 'pointer', padding: 0 }}>▾</button>
                )}
                <span style={{ fontSize: 18, fontWeight: 800, color: '#111', letterSpacing: -0.3, flex: 1 }}>{m.label}</span>
                <span style={{ fontSize: 12, color: '#9CA3AF' }}>{m.slots.length} Reinigungen · {personLabel}</span>
              </div>

              {/* Hero: ERWARTET · ABGERECHNET · Δ */}
              <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap', margin: '10px 0 6px' }}>
                <span>
                  <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, color: '#B0AA9C', letterSpacing: '0.05em' }}>ERWARTET</span>
                  <span style={{ fontSize: 26, fontWeight: 800, color: '#8A7020', letterSpacing: -0.4, fontVariantNumeric: 'tabular-nums' }}>{eur(m.total)}</span>
                </span>
                {checkedInv && checkedInv.amount_invoiced != null && (
                  <>
                    <span>
                      <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, color: '#B0AA9C', letterSpacing: '0.05em' }}>ABGERECHNET</span>
                      <span style={{ fontSize: 26, fontWeight: 800, color: '#12222E', letterSpacing: -0.4, fontVariantNumeric: 'tabular-nums' }}>{eur(checkedInv.amount_invoiced)}</span>
                    </span>
                    <span style={{ paddingBottom: 6 }}>{deltaChip(checkedInv.amount_invoiced - m.total)}</span>
                  </>
                )}
              </div>

              {/* Je Wohnung — erwartet vs. abgerechnet, Tap fächert Reinigungen auf */}
              <p style={{ fontSize: 10.5, fontWeight: 700, color: '#B0AA9C', letterSpacing: '0.05em', margin: '8px 0 0' }}>
                JE WOHNUNG{checkedInv ? ' — ERWARTET · ABGERECHNET' : ''}
              </p>
              {[...m.perListing.entries()].sort((a, b) => b[1].total - a[1].total).map(([id, row]) => {
                const k = `${m.key}|l|${id}`
                const open = !!openKeys[k]
                const title = listings[id]?.title ?? 'Wohnung'
                const wa = wByName.get(title)
                return (
                  <div key={id}>
                    <button onClick={() => toggle(k)} style={{ ...rowStyle, width: '100%', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', alignItems: 'center' }}>
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span style={{ color: '#C7C2B8', fontSize: 10, marginRight: 5 }}>{open ? '▾' : '▸'}</span>{title}
                        </span>
                        <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF', marginTop: 1, paddingLeft: 15 }}>
                          {row.count}× · {fmtDur(row.minutes)}
                          {row.surcharge > 0.005 ? ` · Zulagen ${eur(row.surcharge)}` : ''}
                          {row.travel > 0.005 ? ` · Anfahrten ${eur(row.travel)}` : ''}
                        </span>
                        {wa?.ursache && (
                          <span style={{ display: 'block', fontSize: 11, color: '#B45309', marginTop: 2, paddingLeft: 15, whiteSpace: 'normal', lineHeight: 1.4 }}>→ {wa.ursache}</span>
                        )}
                      </span>
                      <span style={{ textAlign: 'right', flexShrink: 0 }}>
                        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: '#111', fontVariantNumeric: 'tabular-nums' }}>{eur(row.total)}</span>
                        {wa && (
                          <span style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end', marginTop: 2 }}>
                            <span style={{ fontSize: 11, color: '#6B7280', fontVariantNumeric: 'tabular-nums' }}>abger. {eur(wa.abgerechnet)}</span>
                            {deltaChip(wa.abgerechnet - row.total, true)}
                          </span>
                        )}
                      </span>
                    </button>
                    {open && m.slots.filter((s) => s.listingId === id).map((s) => (
                      <div key={s.stay.id} style={subRowStyle}>
                        <span>
                          {wdShort(s.effDay)} {fmtShort(s.effDay)} · {fmtDur(s.minutes)}
                          {s.sameDayArrival ? ' · Wechseltag' : s.reason === 'buendel' ? ` · gebündelt (Abreise ${fmtShort(s.stay.checkOut)})` : ''}
                          {slotSurcharge(s) > 0 ? ` · zzgl. ${eur(slotSurcharge(s))} Zulage` : ''}
                        </span>
                        <span style={{ fontWeight: 700, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{eur(slotCost(s))}</span>
                      </div>
                    ))}
                  </div>
                )
              })}
              {/* Sammel-/Standort-Belege ohne eindeutige Wohnung — NEUTRAL zeigen
                  (Review §257b: sie stecken in der Gesamtsumme, kein Alarm) */}
              {checkedInv && (checkedInv.analysis?.wohnungen ?? [])
                .filter((w) => w.wohnung === 'Ohne Wohnungs-Zuordnung' && w.abgerechnet > 0.005)
                .map((w) => (
                  <div key="ohne-zu" style={{ ...rowStyle, alignItems: 'center' }}>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: '#6B7280' }}>Sammel-Belege ohne Wohnungs-Zuordnung</span>
                      <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF', marginTop: 1 }}>in der Gesamtsumme enthalten — Aufteilung siehe Beleg-PDFs</span>
                      {w.ursache && <span style={{ display: 'block', fontSize: 11, color: '#B45309', marginTop: 2, whiteSpace: 'normal' }}>→ {w.ursache}</span>}
                    </span>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: '#6B7280', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{eur(w.abgerechnet)}</span>
                  </div>
                ))}
              {/* Abgerechnet, aber gar nicht erwartet (z. B. Wohnung ohne geplante Reinigung) */}
              {checkedInv && (checkedInv.analysis?.wohnungen ?? [])
                .filter((w) => w.wohnung !== 'Ohne Wohnungs-Zuordnung' && w.abgerechnet > 0.005 && ![...m.perListing.keys()].some((id) => (listings[id]?.title ?? '') === w.wohnung))
                .map((w) => (
                  <div key={`x-${w.wohnung}`} style={{ ...rowStyle, alignItems: 'center' }}>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: '#B91C1C' }}>{w.wohnung}</span>
                      <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF', marginTop: 1 }}>abgerechnet, aber nicht in der Erwartung</span>
                      {w.ursache && <span style={{ display: 'block', fontSize: 11, color: '#B45309', marginTop: 2, whiteSpace: 'normal' }}>→ {w.ursache}</span>}
                    </span>
                    <span style={{ textAlign: 'right', flexShrink: 0 }}>
                      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: '#B91C1C', fontVariantNumeric: 'tabular-nums' }}>{eur(w.abgerechnet)}</span>
                      {deltaChip(w.abgerechnet, true)}
                    </span>
                  </div>
                ))}

              {/* Zulagen — aufklappbar */}
              {(() => {
                const k = `${m.key}|z`
                const zSlots = m.slots.filter((s) => slotSurcharge(s) > 0)
                return (
                  <div>
                    <button onClick={() => zSlots.length && toggle(k)} style={{ ...rowStyle, width: '100%', border: 'none', background: 'none', cursor: zSlots.length ? 'pointer' : 'default', textAlign: 'left', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, color: '#6B7280' }}>
                        {zSlots.length > 0 && <span style={{ color: '#C7C2B8', fontSize: 10, marginRight: 5 }}>{openKeys[k] ? '▾' : '▸'}</span>}
                        Sonn-/Feiertags-Zulagen
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: m.surcharge > 0.005 ? '#B45309' : '#9CA3AF', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{eur(m.surcharge)}</span>
                    </button>
                    {openKeys[k] && zSlots.map((s) => {
                      const zk = dayKind(s.effDay)
                      return (
                        <div key={s.stay.id} style={subRowStyle}>
                          <span>{wdShort(s.effDay)} {fmtShort(s.effDay)} · {listings[s.listingId]?.title ?? '—'} · {zk === 'besonders' ? 'bes. Feiertag' : zk === 'feiertag' ? 'Feiertag' : 'Sonntag'}</span>
                          <span style={{ fontWeight: 700, color: '#B45309', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{eurSigned(slotSurcharge(s))}</span>
                        </div>
                      )
                    })}
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
                        {trips.length > 0 && <span style={{ color: '#C7C2B8', fontSize: 10, marginRight: 5 }}>{openKeys[k] ? '▾' : '▸'}</span>}
                        Anfahrten ({m.tripCount}×)
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#111', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{eur(m.travel)}</span>
                    </button>
                    {openKeys[k] && trips.map((t, ti) => {
                      const info = listings[t.listingId]
                      const perCleaning = t.count === 1 && cleaning.ratesByPerson?.[t.personId]?.travelPerCleaning
                      const pName = t.personId !== '-' ? (persons.find((p) => p.id === t.personId)?.name ?? null) : null
                      return (
                        <div key={ti} style={subRowStyle}>
                          <span>{wdShort(t.day)} {fmtShort(t.day)} · {perCleaning ? info?.title ?? '—' : info?.group ?? info?.title ?? '—'}{pName && personFilter === '' ? ` · ${pName}` : ''} · {t.count} Reinigung{t.count === 1 ? '' : 'en'}</span>
                          <span style={{ fontWeight: 700, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{eur(t.fee)}</span>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}

              {m.vat > 0.005 && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0' }}>
                    <span style={{ fontSize: 13, color: '#6B7280' }}>Zwischensumme (netto)</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#111', fontVariantNumeric: 'tabular-nums' }}>{eur(m.net)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0 0' }}>
                    <span style={{ fontSize: 13, color: '#6B7280' }}>zzgl. Umsatzsteuer</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#111', fontVariantNumeric: 'tabular-nums' }}>{eur(m.vat)}</span>
                  </div>
                </>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 0 2px' }}>
                <span style={{ fontSize: 14.5, fontWeight: 800, color: '#111' }}>Summe {m.label}{m.vat > 0.005 ? ' (brutto)' : ''}</span>
                <span style={{ fontSize: 19, fontWeight: 800, color: '#8A7020', fontVariantNumeric: 'tabular-nums' }}>{eur(m.total)}</span>
              </div>
              {(m.partialStart || m.partialEnd) && (
                <p style={{ fontSize: 11.5, color: '#9CA3AF', margin: '4px 0 0', textAlign: 'right' }}>
                  {m.partialStart
                    ? (coveredFrom === today
                      ? 'ab heute gerechnet — Reinigungen vor heute fehlen in dieser Summe'
                      : `teilweise erfasst (Datenfenster ab ${fmtShort(coveredFrom)})`)
                    : `teilweise erfasst (Buchungsdaten bis ${fmtShort(horizon)})`}
                </p>
              )}

              {/* ── Rechnungs-Prüfung (nicht im Ausblick — dort gibt es noch keine Rechnung) ── */}
              {kind !== 'aus' && (
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
                            {inv.file_url === 'auto' ? '🔍' : '📄'} {inv.file_name ?? 'Rechnung'}{personName ? ` · ${personName}` : ''}
                          </span>
                          <span style={{ fontSize: 12, color: '#6B7280', fontVariantNumeric: 'tabular-nums' }}>
                            {inv.status === 'fehler' ? 'Analyse fehlgeschlagen — antippen für Details'
                              : `Rechnung ${inv.amount_invoiced != null ? eur(inv.amount_invoiced) : '?'} · erwartet ${inv.amount_expected != null ? eur(inv.amount_expected) : '?'}${diff != null ? ` · ${eurSigned(diff)}` : ''}`}
                          </span>
                        </button>
                        {open && (
                          <div style={{ padding: '10px 12px', fontSize: 12.5, color: '#374151', lineHeight: 1.55 }}>
                            {inv.analysis?.einschaetzung && <p style={{ margin: '0 0 8px' }}>{inv.analysis.einschaetzung}</p>}
                            {/* §257b: Wohnungs-Vergleich — erwartet vs. abgerechnet + Ursache */}
                            {(inv.analysis?.wohnungen ?? []).length > 0 && (
                              <div style={{ margin: '0 0 10px', borderRadius: 12, boxShadow: 'inset 0 0 0 0.5px rgba(60,60,67,0.18)', overflow: 'hidden' }}>
                                <div style={{ display: 'flex', gap: 8, padding: '6px 10px', background: '#FAFAF8', fontSize: 10, fontWeight: 700, color: '#8A8578', letterSpacing: '0.04em' }}>
                                  <span style={{ flex: 1 }}>WOHNUNG</span>
                                  <span style={{ width: 62, textAlign: 'right' }}>ERWARTET</span>
                                  <span style={{ width: 62, textAlign: 'right' }}>ABGER.</span>
                                  <span style={{ width: 56, textAlign: 'right' }}>Δ</span>
                                </div>
                                {(inv.analysis!.wohnungen!).map((w, i) => (
                                  <div key={i} style={{ padding: '6px 10px', boxShadow: i ? 'inset 0 0.5px 0 rgba(60,60,67,0.1)' : 'none' }}>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                      <span style={{ flex: 1, fontSize: 12, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.wohnung}</span>
                                      <span style={{ width: 62, textAlign: 'right', fontSize: 12, color: '#6B7280', fontVariantNumeric: 'tabular-nums' }}>{w.erwartet != null ? eur(w.erwartet) : '—'}</span>
                                      <span style={{ width: 62, textAlign: 'right', fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{eur(w.abgerechnet)}</span>
                                      <span style={{ width: 56, display: 'flex', justifyContent: 'flex-end' }}>{deltaChip(w.differenz, true)}</span>
                                    </div>
                                    {w.ursache && <p style={{ margin: '3px 0 0', fontSize: 11, color: '#B45309', lineHeight: 1.4 }}>→ {w.ursache}</p>}
                                  </div>
                                ))}
                              </div>
                            )}
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
                            {/* §257: gefundene Belege aus dem Mail-Import — antippen öffnet das PDF */}
                            {(inv.analysis?.belege ?? []).length > 0 && (
                              <div style={{ margin: '0 0 8px' }}>
                                {(inv.analysis!.belege!).map((b, i) => (
                                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0', opacity: b.zugeordnet ? 1 : 0.55 }}>
                                    <a href={b.url} target="_blank" rel="noreferrer" style={{ color: '#8A7020', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      📎 {fmtShort(b.datum)} · {b.wohnung ? `${b.wohnung} · ` : ''}{b.text}{b.zugeordnet ? '' : ` — nicht mitgezählt${b.grund ? ` (${b.grund})` : ''}`}
                                    </a>
                                    <span style={{ fontWeight: 700, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{eur(b.betrag)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            <span style={{ display: 'inline-flex', gap: 12 }}>
                              {inv.file_url && inv.file_url !== 'auto' && (
                                <a href={inv.file_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 700, color: '#8A7020' }}>Datei öffnen ↗</a>
                              )}
                              <button onClick={() => deleteInvoice(inv.id)} style={{ border: 'none', background: 'none', fontSize: 12, fontWeight: 700, color: '#B91C1C', cursor: 'pointer', padding: 0 }}>🗑 Löschen</button>
                            </span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {invBusy === m.key ? (
                    <p style={{ fontSize: 12.5, color: '#8A7020', fontWeight: 700, margin: '4px 0 0' }}>🔍 Claude sucht die Belege im Mail-Import und gleicht ab…</p>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
                      {personFilter && personFilter !== 'none' ? (
                        <button onClick={() => autoCheck(m.key, expectedPayload)} disabled={!!invBusy} style={{
                          padding: '8px 14px', borderRadius: 999, border: 'none', cursor: 'pointer',
                          fontSize: 12.5, fontWeight: 700, color: '#fff',
                          background: 'linear-gradient(135deg, var(--gold, #AE8D2D), #8A7020)', opacity: invBusy ? 0.5 : 1,
                        }}>🔍 Rechnung aus Mail-Import prüfen ({personLabel})</button>
                      ) : (
                        <span style={{ fontSize: 11.5, color: '#9CA3AF' }}>Für die automatische Prüfung oben eine 👤 Reinigungskraft wählen.</span>
                      )}
                      <button onClick={() => startUpload(m.key, expectedPayload)} disabled={!!invBusy} style={{
                        padding: '8px 12px', borderRadius: 999, border: 'none', cursor: 'pointer',
                        fontSize: 12, fontWeight: 700, color: '#6B7280',
                        background: 'rgba(120,120,128,0.10)', opacity: invBusy ? 0.5 : 1,
                      }}>📄 Selbst hochladen</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        }

        const aktuell = costs.months.find((m) => !m.isPast) ?? null
        const rueck = costs.months.filter((m) => m.isPast)
        return (
          <div>
            {invError && (
              <p style={{ margin: '0 0 10px', padding: '9px 12px', borderRadius: 12, background: '#FEE2E2', color: '#B91C1C', fontSize: 12.5 }}>
                {invError} <button onClick={() => setInvError(null)} style={{ border: 'none', background: 'none', color: '#B91C1C', fontWeight: 800, cursor: 'pointer' }}>✕</button>
              </p>
            )}
            {pastData === null && (
              <p style={{ margin: '0 0 10px', fontSize: 12, color: '#9CA3AF' }}>⏳ Lade zurückliegende Monate…</p>
            )}

            {aktuell && (
              <>
                <p style={{ ...eyebrowStyle, marginTop: 4 }}>AKTUELLER MONAT</p>
                {renderMonth(aktuell, 'aktuell')}
              </>
            )}
            {rueck.length > 0 && (
              <>
                <p style={eyebrowStyle}>ZURÜCKLIEGEND — RECHNUNGS-PRÜFUNG</p>
                {rueck.map((m) => renderMonth(m, 'rueck'))}
                <p style={{ fontSize: 10.5, color: '#B0AA9C', margin: '2px 4px 0', lineHeight: 1.5 }}>
                  Rückblick-Erwartungen rechnen mit den heutigen Zuordnungen & Sätzen — vor einem
                  Zuständigkeits-Wechsel (z. B. Sweet/Cozy bis Juni bei Tip-Top) weichen sie ab.
                </p>
              </>
            )}
            {costs.future.length > 0 && (
              <>
                <p style={eyebrowStyle}>AUSBLICK — PROGNOSE</p>
                {costs.future.map((m) => renderMonth(m, 'aus'))}
              </>
            )}

            {!aktuell && rueck.length === 0 && costs.future.length === 0 && (
              <p style={{ textAlign: 'center', color: '#8E8E93', fontSize: 13.5, padding: 30 }}>Keine Reinigungen für {personLabel} im Datenfenster.</p>
            )}
            {costs.missingMinutes > 0 && (
              <p style={{ fontSize: 11.5, color: '#B45309', margin: '10px 4px 0', lineHeight: 1.5 }}>
                ⚠️ Bei {costs.missingMinutes} Reinigung(en) fehlt die Ø-Dauer der Wohnung — gerechnet mit {FALLBACK_MINUTES} Min. (Admin → 🧹 Reinigung pflegen).
              </p>
            )}
          </div>
        )
      })()}

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
                // 🧹 §231: vor-Ort-Fertigmeldung (NFC-Tag) zu diesem Slot?
                const conf = cleaning.confirmations?.[`${s.listingId}|${s.stay.checkOut}`]
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
                    {conf ? (
                      <p style={{
                        fontSize: 12.5, fontWeight: 800, margin: '7px 0 0',
                        color: '#16A34A',
                      }}>
                        {'✅ Gereinigt gemeldet'}
                        {' · '}
                        {new Date(conf.at).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })}
                        {conf.person ? ` · ${conf.person}` : ''}
                      </p>
                    ) : s.sameDayArrival ? (
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
                            {(s.reason === 'feiertag' || s.reason === 'besonders') && chip('#EFF6FF', '#1D4ED8', '🎌 Feiertag übersprungen')}
                            {partnerTitle && (rulesFor(s.listingId).bundleTravel ?? true) && chip('#F5F3FF', '#6D28D9', `🚗 eine Anfahrt — zusammen mit ${partnerTitle}`)}
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
