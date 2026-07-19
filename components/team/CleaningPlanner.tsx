'use client'

/**
 * 🧹 Reinigungsplaner (Kalender-Tab): jede Abreise = ein Reinigungs-Slot.
 * Wechseltage (Abreise + Anreise am selben Tag) sind Pflicht-Termine mit
 * Deadline zur Anreise; sonst zeigt der Planer das freie Fenster und —
 * je nach Admin-Regeln — eine Empfehlung, Sonn-/Feiertage zu meiden.
 * „Meine"-Filter für Reinigungs-Verantwortliche, Ø-Dauer als Chip.
 */
import { useState } from 'react'

type Stay = { id: string; listingId: string; checkIn: string; checkOut: string; guestName: string | null; channel?: string | null }
export type CleaningInfo = {
  settings: { avoidSundays: boolean; avoidHolidays: boolean }
  holidays: string[]
  responsible: Record<string, { id: string; name: string }>
  minutes: Record<string, number>
  mine: string[]
}

const DE_DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
const DE_MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

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

export default function CleaningPlanner({ stays, listings, cleaning }: {
  stays: Stay[]
  listings: Record<string, { title: string; group: string | null }>
  cleaning: CleaningInfo
}) {
  const hasMine = cleaning.mine.length > 0
  const [scope, setScope] = useState<'meine' | 'alle'>(hasMine ? 'meine' : 'alle')

  const today = isoOffset(0)
  const horizon = isoOffset(28)
  const isBlocked = (iso: string) => {
    const dow = new Date(iso + 'T00:00:00Z').getUTCDay()
    return (cleaning.settings.avoidSundays && dow === 0)
      || (cleaning.settings.avoidHolidays && cleaning.holidays.includes(iso))
  }

  // Slots aus Abreisen ableiten
  const slots = stays
    .filter((s) => s.checkOut >= today && s.checkOut <= horizon && listings[s.listingId])
    .filter((s) => scope === 'alle' || cleaning.mine.includes(s.listingId))
    .map((s) => {
      const sameDayArrival = stays.some((x) => x.listingId === s.listingId && x.checkIn === s.checkOut)
      const nextIn = stays
        .filter((x) => x.listingId === s.listingId && x.checkIn >= s.checkOut)
        .sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0]?.checkIn ?? null
      // Empfehlung: Sonn-/Feiertag meiden, aber spätestens am Anreisetag fertig
      let recommended: string | null = null
      if (!sameDayArrival && isBlocked(s.checkOut)) {
        let d = s.checkOut
        for (let i = 0; i < 7; i++) {
          const next = addDays(d, 1)
          if (nextIn && next > nextIn) break
          d = next
          if (!isBlocked(d)) { recommended = d; break }
        }
      }
      return { stay: s, sameDayArrival, nextIn, recommended, blockedDay: isBlocked(s.checkOut) }
    })
    .sort((a, b) => a.stay.checkOut.localeCompare(b.stay.checkOut))

  // Nach Tagen gruppieren
  const days: { iso: string; items: typeof slots }[] = []
  for (const slot of slots) {
    const last = days[days.length - 1]
    if (last && last.iso === slot.stay.checkOut) last.items.push(slot)
    else days.push({ iso: slot.stay.checkOut, items: [slot] })
  }

  return (
    <div>
      {hasMine && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {([['meine', '🧹 Meine Wohnungen'], ['alle', 'Alle']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setScope(id)} style={{
              padding: '6px 13px', borderRadius: 999, border: 'none', fontSize: 12.5, fontWeight: 700,
              background: scope === id ? 'var(--gold, #AE8D2D)' : 'rgba(120,120,128,0.12)',
              color: scope === id ? '#fff' : '#3C3C43', cursor: 'pointer',
            }}>{label}</button>
          ))}
        </div>
      )}

      {days.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: '#8E8E93' }}>
          <p style={{ fontSize: 40, margin: '0 0 8px' }}>🧹</p>
          <p style={{ fontSize: 15, fontWeight: 600, margin: 0, color: '#3C3C43' }}>
            Keine anstehenden Reinigungen in den nächsten 4 Wochen.
          </p>
        </div>
      ) : days.map(({ iso, items }) => (
        <div key={iso} style={{ marginBottom: 16 }}>
          <p style={{
            fontSize: 12.5, fontWeight: 800, margin: '0 0 7px',
            color: iso === today ? 'var(--gold, #AE8D2D)' : '#6B7280',
            textTransform: 'uppercase', letterSpacing: '0.03em',
          }}>{dayLabel(iso, today)}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {items.map(({ stay, sameDayArrival, nextIn, recommended }) => {
              const info = listings[stay.listingId]
              const resp = cleaning.responsible[stay.listingId]
              const mins = cleaning.minutes[stay.listingId]
              const isMine = cleaning.mine.includes(stay.listingId)
              return (
                <div key={stay.id} style={{
                  background: '#fff', borderRadius: 14, padding: '11px 13px',
                  boxShadow: sameDayArrival
                    ? 'inset 0 0 0 1.5px #C2410C'
                    : isMine ? 'inset 0 0 0 1.5px var(--gold, #AE8D2D)' : 'inset 0 0 0 0.5px rgba(60,60,67,0.15)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: '#111' }}>🧹 {info?.title ?? 'Wohnung'}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: sameDayArrival ? '#C2410C' : '#15803D', flexShrink: 0 }}>
                      {sameDayArrival
                        ? 'WECHSELTAG — bis zur Anreise fertig'
                        : nextIn ? `flexibel · nächste Anreise ${fmtShort(nextIn)}` : 'flexibel · nichts geplant'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {mins != null && (
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: '#F3F4F6', color: '#374151' }}>
                        ⏱ Ø {mins} Min.
                      </span>
                    )}
                    {resp && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
                        background: isMine ? '#FAF5E4' : '#F3F4F6', color: isMine ? '#8A7020' : '#374151',
                      }}>
                        👤 {isMine ? 'Du' : resp.name}
                      </span>
                    )}
                    {recommended && (
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: '#EFF6FF', color: '#1D4ED8' }}>
                        🔔 {new Date(stay.checkOut + 'T00:00:00Z').getUTCDay() === 0 ? 'Sonntag' : 'Feiertag'} — empfohlen: {fmtShort(recommended)}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
