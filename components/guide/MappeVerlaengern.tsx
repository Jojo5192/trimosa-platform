'use client'

/**
 * 🌙 Aufenthalt verlängern in der Gästemappe (Pascal, Chefsache 6.10.2026): Gast wählt die Zahl der Zusatznächte,
 * sieht Live-Verfügbarkeit + Preis (Smoobu, wie auf der Website) und bezahlt per Stripe. Nach der Zahlung legt der
 * Webhook die Zusatznächte als eigene Direktbuchung an (lib/zahlungen.ts). Labels kommen übersetzt vom Server.
 * ?verlaengern=<n> (Link aus dem Chat) wählt die Nächte vor und holt das Angebot sofort.
 */
import { useEffect, useState, type CSSProperties } from 'react'

export interface MappeVerlaengernLabels {
  navLabel: string
  title: string
  hint: string
  nights1: string
  nightsN: string
  check: string
  free: string
  price: string
  pay: string
  busy: string
  taken: string
  error: string
  paidTitle: string
  paidHint: string
  extendedUntil: string
  newCode: string
  newCodeLater: string
}

export interface MappeVerlaengerung { von: string; bis: string; doorCode: string | null }

interface Angebot { ok: boolean; grund?: string; naechte: number; von: string; bis: string; preis: number; preisProNacht: number }

const fmt = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}` }
const euro = (n: number, lang: string) => n.toLocaleString(lang === 'de' ? 'de-DE' : lang, { style: 'currency', currency: 'EUR' })

const knopf: CSSProperties = {
  display: 'block', width: '100%', textAlign: 'center', marginTop: 12, padding: '12px 16px', borderRadius: 12, border: 'none',
  background: 'var(--gold, #AE8D2D)', color: '#fff', fontSize: 14.5, fontWeight: 800, cursor: 'pointer',
}
const rund: CSSProperties = {
  width: 44, height: 44, borderRadius: '50%', border: '1px solid #E2DCCC', background: '#fff', fontSize: 20, color: '#2A2620', cursor: 'pointer',
}

export default function MappeVerlaengern({ token, lang, labels, startNaechte, bezahlt, bestehende, moeglich }: {
  token: string
  lang: string
  labels: MappeVerlaengernLabels
  startNaechte: number | null
  bezahlt: boolean
  bestehende: MappeVerlaengerung[]
  /** false = Aufenthalt vorbei oder Wohnung ohne Online-Buchung → nur bestehende Verlängerungen zeigen */
  moeglich: boolean
}) {
  const [naechte, setNaechte] = useState(Math.max(1, Math.min(14, startNaechte ?? 1)))
  const [angebot, setAngebot] = useState<Angebot | null>(null)
  const [busy, setBusy] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)

  async function pruefen(n: number) {
    setBusy(true); setFehler(null); setAngebot(null)
    try {
      const r = await fetch(`/api/mappe/verlaengerung?token=${encodeURIComponent(token)}&naechte=${n}`, { cache: 'no-store' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setFehler(labels.error); return }
      setAngebot(d.angebot ?? null)
    } catch {
      setFehler(labels.error)
    } finally {
      setBusy(false)
    }
  }

  // Link aus dem Chat (?verlaengern=n): Angebot direkt holen
  useEffect(() => {
    if (startNaechte && moeglich && !bezahlt) void pruefen(Math.max(1, Math.min(14, startNaechte)))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur beim ersten Laden
  }, [])

  async function bezahlen() {
    if (!angebot?.ok) return
    setBusy(true); setFehler(null)
    try {
      const r = await fetch('/api/mappe/verlaengerung', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, naechte: angebot.naechte }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.url) {
        setFehler(r.status === 409 ? labels.taken : labels.error)
        setAngebot(null)
        setBusy(false)
        return
      }
      window.location.href = d.url
    } catch {
      setFehler(labels.error)
      setBusy(false)
    }
  }

  const nText = (n: number) => (n === 1 ? labels.nights1 : labels.nightsN).replace('{n}', String(n))

  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: '18px 18px 16px', boxShadow: '0 1px 4px rgba(35,28,10,0.06)' }}>
      <div style={{ fontSize: 15.5, fontWeight: 800, color: '#2A2620' }}>🌙 {labels.title}</div>

      {bezahlt && (
        <div role="status" style={{ marginTop: 12, padding: '10px 13px', borderRadius: 10, background: '#F0FDF4', color: '#166534', fontSize: 13, lineHeight: 1.5 }}>
          <strong>{labels.paidTitle}</strong><br />{labels.paidHint}
        </div>
      )}

      {bestehende.map((v) => (
        <div key={v.von + v.bis} style={{ marginTop: 12, padding: '10px 13px', borderRadius: 10, background: '#F7F3E8', color: '#2A2620', fontSize: 13.5, lineHeight: 1.55 }}>
          ✓ {labels.extendedUntil.replace('{datum}', fmt(v.bis))}
          <div style={{ marginTop: 4 }}>
            {v.doorCode
              ? <>{labels.newCode.replace('{datum}', fmt(v.von))} <strong style={{ fontSize: 17, letterSpacing: 2, fontVariantNumeric: 'tabular-nums' }}>{v.doorCode}</strong></>
              : <span style={{ color: '#8A8065' }}>{labels.newCodeLater}</span>}
          </div>
        </div>
      ))}

      {moeglich && (
        <>
          <p style={{ margin: '8px 0 12px', fontSize: 13.5, color: '#6B6555', lineHeight: 1.55 }}>{labels.hint}</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
            <button type="button" aria-label="−1" disabled={naechte <= 1 || busy} onClick={() => { setNaechte((n) => Math.max(1, n - 1)); setAngebot(null) }} style={rund}>−</button>
            <div style={{ minWidth: 110, textAlign: 'center', fontSize: 17, fontWeight: 800, color: '#2A2620' }}>{nText(naechte)}</div>
            <button type="button" aria-label="+1" disabled={naechte >= 14 || busy} onClick={() => { setNaechte((n) => Math.min(14, n + 1)); setAngebot(null) }} style={rund}>+</button>
          </div>

          {!angebot && (
            <button type="button" disabled={busy} onClick={() => pruefen(naechte)} style={{ ...knopf, opacity: busy ? 0.6 : 1 }}>{busy ? labels.busy : labels.check}</button>
          )}

          {angebot && !angebot.ok && (
            <div role="status" style={{ marginTop: 12, padding: '10px 13px', borderRadius: 10, background: '#FEF2F2', color: '#B91C1C', fontSize: 13, lineHeight: 1.5 }}>
              {labels.taken}
            </div>
          )}

          {angebot?.ok && (
            <>
              <div role="status" style={{ marginTop: 12, padding: '10px 13px', borderRadius: 10, background: '#F0FDF4', color: '#166534', fontSize: 13.5, lineHeight: 1.6 }}>
                <strong>{labels.free}</strong> {fmt(angebot.von)}–{fmt(angebot.bis)} · {nText(angebot.naechte)}<br />
                <strong>{labels.price}</strong> {euro(angebot.preis, lang)}
              </div>
              <button type="button" disabled={busy} onClick={bezahlen} style={{ ...knopf, opacity: busy ? 0.6 : 1 }}>{busy ? labels.busy : labels.pay}</button>
            </>
          )}
        </>
      )}

      {fehler && <div role="alert" style={{ marginTop: 10, fontSize: 13, color: '#B91C1C' }}>{fehler}</div>}
    </div>
  )
}
