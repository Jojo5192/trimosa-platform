'use client'

/**
 * 🧹 Reinigungsplaner (Kalender-Tab), drei Ansichten:
 *  📋 Liste  — jede Abreise ein Slot; Wechseltage = Pflicht, sonst flexibel.
 *              KLUGE EMPFEHLUNG: Sonn-/Feiertage meiden UND Reinigungen
 *              desselben STANDORTS bündeln (eine Anfahrt) — der Planer
 *              schlägt den besten Tag im freien Fenster vor.
 *  🗺 Touren — Tages-Einsatzpläne: je Einsatztag Standort-Blöcke mit
 *              Wohnungen, Gesamtdauer und Anfahrts-Zähler.
 *  💶 Kosten — NUR Admins (rates kommen nur für sie von der API): erwartete
 *              „Rechnung" der nächsten 4 Wochen — Stunden × Satz je Wohnung,
 *              Sonn-/Feiertags-Zulagen, Anfahrten, Summe + Monats-Hochrechnung.
 */
import { useMemo, useState } from 'react'

type Stay = { id: string; listingId: string; checkIn: string; checkOut: string; guestName: string | null; channel?: string | null }
export type CleaningInfo = {
  settings: { avoidSundays: boolean; avoidHolidays: boolean }
  rates: { hourlyRate: number; travelFee: number; sundaySurchargePct: number; holidaySurchargePct: number } | null
  holidays: string[]
  responsible: Record<string, { id: string; name: string }>
  minutes: Record<string, number>
  mine: string[]
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
}

export default function CleaningPlanner({ stays, listings, cleaning }: {
  stays: Stay[]
  listings: Record<string, { title: string; group: string | null }>
  cleaning: CleaningInfo
}) {
  const hasMine = cleaning.mine.length > 0
  const isAdmin = !!cleaning.rates
  const [scope, setScope] = useState<'meine' | 'alle'>(hasMine ? 'meine' : 'alle')
  const [mode, setMode] = useState<'liste' | 'touren' | 'kosten'>('liste')

  const today = isoOffset(0)
  // Slots reichen so weit wie die Kalender-Daten (+56 Tage) — die Kosten-
  // Ansicht rechnet damit echte KALENDERMONATE; Liste/Touren zeigen 4 Wochen.
  const horizon = isoOffset(56)
  const listHorizon = isoOffset(28)
  const isBlocked = (iso: string) => {
    const dow = new Date(iso + 'T00:00:00Z').getUTCDay()
    return (cleaning.settings.avoidSundays && dow === 0)
      || (cleaning.settings.avoidHolidays && cleaning.holidays.includes(iso))
  }
  const blockReason = (iso: string): 'sonntag' | 'feiertag' | null =>
    cleaning.holidays.includes(iso) ? 'feiertag'
      : new Date(iso + 'T00:00:00Z').getUTCDay() === 0 ? 'sonntag' : null

  const slots: Slot[] = useMemo(() => {
    const base = stays.filter((s) => s.checkOut >= today && s.checkOut <= horizon && listings[s.listingId])
    // Pflicht-Tage je Standort (Wechseltage) — die Bündelungs-Anker
    const anchorDays = new Set<string>()
    for (const s of base) {
      if (stays.some((x) => x.listingId === s.listingId && x.checkIn === s.checkOut)) {
        const g = listings[s.listingId]?.group ?? s.listingId
        anchorDays.add(`${s.checkOut}|${g}`)
      }
    }
    return base.map((s) => {
      const group = listings[s.listingId]?.group ?? s.listingId
      const sameDayArrival = stays.some((x) => x.listingId === s.listingId && x.checkIn === s.checkOut)
      const nextIn = stays
        .filter((x) => x.listingId === s.listingId && x.checkIn >= s.checkOut)
        .sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0]?.checkIn ?? null

      // Kluge Tag-Wahl im freien Fenster: Sonn-/Feiertage meiden + mit
      // Pflicht-Reinigungen desselben Standorts bündeln (spart Anfahrten)
      let effDay = s.checkOut
      let recommended: string | null = null
      let reason: Slot['reason'] = null
      if (!sameDayArrival) {
        const lastDay = nextIn ? (nextIn < addDays(s.checkOut, 7) ? nextIn : addDays(s.checkOut, 7)) : addDays(s.checkOut, 7)
        let best = { day: s.checkOut, score: (isBlocked(s.checkOut) ? 0 : 2) + (anchorDays.has(`${s.checkOut}|${group}`) ? 1 : 0) }
        let d = s.checkOut
        let i = 0
        while (d < lastDay && i < 8) {
          d = addDays(d, 1)
          i++
          const score = (isBlocked(d) ? 0 : 2) + (anchorDays.has(`${d}|${group}`) ? 1 : 0) - i * 0.05
          if (score > best.score) best = { day: d, score }
        }
        if (best.day !== s.checkOut) {
          effDay = best.day
          recommended = best.day
          reason = anchorDays.has(`${best.day}|${group}`) ? 'buendel' : blockReason(s.checkOut)
        }
      }
      const hasMinutes = cleaning.minutes[s.listingId] != null
      return {
        stay: s, listingId: s.listingId, sameDayArrival, nextIn,
        effDay, recommended, reason,
        minutes: cleaning.minutes[s.listingId] ?? FALLBACK_MINUTES, hasMinutes, group,
      }
    }).sort((a, b) => a.effDay.localeCompare(b.effDay) || a.group.localeCompare(b.group))
  }, [stays, listings, cleaning, today, horizon]) // eslint-disable-line react-hooks/exhaustive-deps

  const visible = slots.filter((s) =>
    s.effDay <= listHorizon && (scope === 'alle' || cleaning.mine.includes(s.listingId)))

  /* ── Kosten (nur Admins, immer über ALLE Wohnungen) — echte KALENDERMONATE,
        weil die Rechnungen der Reinigungskräfte monatsweise kommen ── */
  const costs = useMemo(() => {
    if (!cleaning.rates) return null
    const r = cleaning.rates
    type MonthRow = {
      key: string; label: string; partialStart: boolean; partialEnd: boolean
      perListing: Map<string, { count: number; minutes: number; base: number }>
      surcharge: number; trips: Set<string>
    }
    const months = new Map<string, MonthRow>()
    let missingMinutes = 0
    for (const s of slots) {
      const key = s.effDay.slice(0, 7)
      let m = months.get(key)
      if (!m) {
        const [y, mo] = key.split('-').map(Number)
        const lastDay = `${key}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`
        m = {
          key, label: `${DE_MONTHS[mo - 1]} ${y}`,
          partialStart: `${key}-01` < today,
          partialEnd: lastDay > horizon,
          perListing: new Map(), surcharge: 0, trips: new Set(),
        }
        months.set(key, m)
      }
      const row = m.perListing.get(s.listingId) ?? { count: 0, minutes: 0, base: 0 }
      const cost = (s.minutes / 60) * r.hourlyRate
      row.count++
      row.minutes += s.minutes
      row.base += cost
      m.perListing.set(s.listingId, row)
      if (!s.hasMinutes) missingMinutes++
      const br = blockReason(s.effDay)
      if (br === 'feiertag') m.surcharge += cost * (r.holidaySurchargePct / 100)
      else if (br === 'sonntag') m.surcharge += cost * (r.sundaySurchargePct / 100)
      m.trips.add(`${s.effDay}|${s.group}`)
    }
    const list = [...months.values()].sort((a, b) => a.key.localeCompare(b.key)).map((m) => {
      const baseSum = [...m.perListing.values()].reduce((a, x) => a + x.base, 0)
      const travel = m.trips.size * r.travelFee
      return { ...m, baseSum, travel, tripCount: m.trips.size, total: baseSum + m.surcharge + travel }
    })
    return { months: list, missingMinutes }
  }, [slots, cleaning.rates]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Touren: Einsatztage → Standort-Blöcke ── */
  const tours = useMemo(() => {
    const byDay = new Map<string, Map<string, Slot[]>>()
    for (const s of visible) {
      const day = byDay.get(s.effDay) ?? new Map<string, Slot[]>()
      const arr = day.get(s.group) ?? []
      arr.push(s)
      day.set(s.group, arr)
      byDay.set(s.effDay, day)
    }
    return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [visible])

  const chip = (bg: string, color: string, text: string, key?: string) => (
    <span key={key} style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: bg, color }}>{text}</span>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {([['liste', '📋 Liste'], ['touren', '🗺 Touren'], ...(isAdmin ? [['kosten', '💶 Kosten']] : [])] as [typeof mode, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setMode(id)} style={{
            padding: '6px 13px', borderRadius: 999, border: 'none', fontSize: 12.5, fontWeight: 700,
            background: mode === id ? '#1A1814' : 'rgba(120,120,128,0.12)',
            color: mode === id ? '#fff' : '#3C3C43', cursor: 'pointer',
          }}>{label}</button>
        ))}
        {hasMine && mode !== 'kosten' && (
          <button onClick={() => setScope(scope === 'meine' ? 'alle' : 'meine')} style={{
            marginLeft: 'auto', padding: '6px 13px', borderRadius: 999, border: 'none', fontSize: 12.5, fontWeight: 700,
            background: scope === 'meine' ? 'var(--gold, #AE8D2D)' : 'rgba(120,120,128,0.12)',
            color: scope === 'meine' ? '#fff' : '#3C3C43', cursor: 'pointer',
          }}>{scope === 'meine' ? '🧹 Meine' : 'Alle'}</button>
        )}
      </div>

      {/* ═══ 💶 KOSTEN (Admins) — erwartete Rechnung je KALENDERMONAT ═══ */}
      {mode === 'kosten' && costs && (
        <div>
          {costs.months.map((m) => (
            <div key={m.key} style={{ background: '#fff', borderRadius: 16, padding: '16px 16px 14px', marginBottom: 12, boxShadow: 'inset 0 0 0 0.5px rgba(60,60,67,0.15)' }}>
              <p style={{ fontSize: 11.5, fontWeight: 700, color: '#8A8578', letterSpacing: '0.06em', margin: '0 0 2px' }}>ERWARTETE RECHNUNG</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                <span style={{ fontSize: 17, fontWeight: 800, color: '#111' }}>{m.label}</span>
                <span style={{ fontSize: 12, color: '#9CA3AF' }}>
                  {[...m.perListing.values()].reduce((a, x) => a + x.count, 0)} Reinigungen · alle Wohnungen
                </span>
              </div>
              {[...m.perListing.entries()].sort((a, b) => b[1].base - a[1].base).map(([id, row]) => (
                <div key={id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.1)' }}>
                  <span style={{ fontSize: 13, color: '#111', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {listings[id]?.title ?? 'Wohnung'} <span style={{ color: '#9CA3AF', fontSize: 12 }}>· {row.count}× · {fmtDur(row.minutes)}</span>
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#111', flexShrink: 0 }}>{eur(row.base)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.1)' }}>
                <span style={{ fontSize: 13, color: '#6B7280' }}>Sonn-/Feiertags-Zulagen</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: m.surcharge ? '#B45309' : '#9CA3AF' }}>{eur(m.surcharge)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.1)' }}>
                <span style={{ fontSize: 13, color: '#6B7280' }}>Anfahrten ({m.tripCount}× je {eur(cleaning.rates!.travelFee)})</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{eur(m.travel)}</span>
              </div>
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
            </div>
          ))}
          {costs.months.length === 0 && (
            <p style={{ textAlign: 'center', color: '#8E8E93', fontSize: 13.5, padding: 30 }}>Keine anstehenden Reinigungen im Datenfenster.</p>
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
        <p style={{ textAlign: 'center', color: '#8E8E93', fontSize: 13.5, padding: 30 }}>Keine Einsätze in den nächsten 4 Wochen.</p>
      ) : tours.map(([day, groups]) => {
        const all = [...groups.values()].flat()
        const totalMin = all.reduce((a, s) => a + s.minutes, 0)
        const br = blockReason(day)
        return (
          <div key={day} style={{ marginBottom: 14, background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: 'inset 0 0 0 0.5px rgba(60,60,67,0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '11px 14px', background: day === today ? '#FAF5E4' : '#FCFBF9', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13.5, fontWeight: 800, color: day === today ? '#8A7020' : '#111' }}>{dayLabel(day, today)}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#6B7280' }}>
                ⏱ {fmtDur(totalMin)} · 🚗 {groups.size} Anfahrt{groups.size === 1 ? '' : 'en'}{br ? (br === 'sonntag' ? ' · ☀️ Sonntag' : ' · 🎌 Feiertag') : ''}
              </span>
            </div>
            {[...groups.entries()].map(([g, items]) => (
              <div key={g} style={{ padding: '9px 14px', boxShadow: 'inset 0 0.5px 0 rgba(60,60,67,0.1)' }}>
                <p style={{ fontSize: 11.5, fontWeight: 800, color: '#8A7020', margin: '0 0 6px' }}>
                  📍 {listings[items[0].listingId]?.group ?? listings[items[0].listingId]?.title ?? g} · {fmtDur(items.reduce((a, s) => a + s.minutes, 0))}
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
            ))}
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
            <p style={{ fontSize: 15, fontWeight: 600, margin: 0, color: '#3C3C43' }}>Keine anstehenden Reinigungen in den nächsten 4 Wochen.</p>
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
                return (
                  <div key={s.stay.id} style={{
                    background: '#fff', borderRadius: 14, padding: '11px 13px',
                    boxShadow: s.sameDayArrival
                      ? 'inset 0 0 0 1.5px #C2410C'
                      : isMine ? 'inset 0 0 0 1.5px var(--gold, #AE8D2D)' : 'inset 0 0 0 0.5px rgba(60,60,67,0.15)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: '#111' }}>🧹 {info?.title ?? 'Wohnung'}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: s.sameDayArrival ? '#C2410C' : '#15803D', flexShrink: 0 }}>
                        {s.sameDayArrival
                          ? 'WECHSELTAG — bis zur Anreise fertig'
                          : s.nextIn ? `flexibel · nächste Anreise ${fmtShort(s.nextIn)}` : 'flexibel · nichts geplant'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {chip('#F3F4F6', '#374151', `⏱ Ø ${fmtDur(s.minutes)}${s.hasMinutes ? '' : ' (Schätzung)'}`)}
                      {resp && chip(isMine ? '#FAF5E4' : '#F3F4F6', isMine ? '#8A7020' : '#374151', `👤 ${isMine ? 'Du' : resp.name}`)}
                      {s.recommended && s.reason === 'buendel' && chip('#F5F3FF', '#6D28D9', `🚗 gebündelt: ${fmtShort(s.recommended)} (Abreise ${fmtShort(s.stay.checkOut)})`)}
                      {s.recommended && s.reason !== 'buendel' && chip('#EFF6FF', '#1D4ED8', `🔔 ${s.reason === 'sonntag' ? 'Sonntag' : 'Feiertag'} — empfohlen: ${fmtShort(s.recommended)}`)}
                    </div>
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
