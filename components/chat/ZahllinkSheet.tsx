'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { haptic, tmToast } from '@/components/team/ux'

/**
 * 💶 Zahllink aus dem Gäste-Chat (Pascal, Chefsache 5./6.10.2026): Jedes Team-Mitglied erzeugt in der Gast-Info
 * einen Stripe-Zahllink für Extras (Zusatzgast, Haustier, Late Check-out …) oder ein Verlängerungs-Angebot mit
 * Live-Preis aus Smoobu. Der fertige Text landet im Eingabefeld — gesendet wird wie immer per Senden (der Text
 * wird dabei automatisch in die Gastsprache übersetzt, Links bleiben geschützt).
 * APIs: /api/zahlung/link (lib/zahlungen.ts) und /api/zahlung/verlaengerung.
 */

const ZWECKE = ['Zusatzgast', 'Haustier', 'Late Check-out', 'Early Check-in', 'Zusatzleistung', 'Sonstiges'] as const

interface Link { id: string; url: string; betrag: number; zweck: string; von: string | null; at: string; status: 'offen' | 'bezahlt' | 'deaktiviert' }
interface Angebot { ok: boolean; grund?: string; naechte: number; von: string; bis: string; preis: number; preisProNacht: number }

const euro = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const datum = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}` }

export default function ZahllinkSheet({ bookingId, vorname, onInsert, onClose }: {
  bookingId: string
  vorname: string
  /** fertiger Nachrichtentext → Eingabefeld */
  onInsert: (text: string) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<'extra' | 'verlaengerung'>('extra')
  const [zweck, setZweck] = useState<string>('Zusatzgast')
  const [betrag, setBetrag] = useState('')
  const [notiz, setNotiz] = useState('')
  const [busy, setBusy] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [links, setLinks] = useState<Link[] | null>(null)
  const [naechte, setNaechte] = useState(1)
  const [angebot, setAngebot] = useState<Angebot | null>(null)
  const [angebotLink, setAngebotLink] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/zahlung/link?bookingId=${bookingId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { links: [] }))
      .then((d) => { if (alive) setLinks(d.links ?? []) })
      .catch(() => { if (alive) setLinks([]) })
    return () => { alive = false }
  }, [bookingId])

  async function linkErstellen() {
    const wert = Number(betrag.replace(',', '.'))
    if (!(wert >= 1)) { setFehler('Bitte einen Betrag ab 1 € eingeben.'); return }
    setBusy(true); setFehler(null)
    try {
      const r = await fetch('/api/zahlung/link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, betrag: wert, zweck, text: notiz || null }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.link) { setFehler(d.error ?? 'Der Zahllink konnte nicht erstellt werden.'); return }
      haptic('success')
      const zusatz = notiz.trim() ? ` (${notiz.trim()})` : ''
      onInsert(`Hallo ${vorname}, hier ist dein Zahlungslink für ${zweck}${zusatz} über ${euro(d.link.betrag)}: ${d.link.url}\nDie Zahlung ist per Karte, Apple Pay oder Google Pay möglich. Danke dir!`)
      tmToast('Zahllink erstellt — steht im Eingabefeld, bitte prüfen und senden')
      onClose()
    } catch {
      setFehler('Keine Verbindung — bitte erneut versuchen.')
    } finally {
      setBusy(false)
    }
  }

  async function angebotHolen(n: number) {
    setBusy(true); setFehler(null); setAngebot(null); setAngebotLink(null)
    try {
      const r = await fetch(`/api/zahlung/verlaengerung?bookingId=${bookingId}&naechte=${n}`, { cache: 'no-store' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setFehler(d.error ?? 'Angebot konnte nicht geladen werden.'); return }
      setAngebot(d.angebot ?? null)
      setAngebotLink(d.link ?? null)
    } catch {
      setFehler('Keine Verbindung — bitte erneut versuchen.')
    } finally {
      setBusy(false)
    }
  }

  function angebotUebernehmen() {
    if (!angebot?.ok || !angebotLink) return
    haptic('success')
    const n = angebot.naechte
    onInsert(`Hallo ${vorname}, gute Nachricht: Du kannst deinen Aufenthalt um ${n} ${n === 1 ? 'Nacht' : 'Nächte'} bis zum ${datum(angebot.bis)} verlängern — Preis ${euro(angebot.preis)}. Hier kannst du direkt buchen und bezahlen: ${angebotLink}`)
    tmToast('Verlängerungs-Angebot steht im Eingabefeld — bitte prüfen und senden')
    onClose()
  }

  const chip = (on: boolean) => ({
    border: 'none', cursor: 'pointer', padding: '7px 12px', borderRadius: 999, fontSize: 13, fontWeight: 700,
    background: on ? 'var(--tm-text)' : 'var(--tm-surface2)', color: on ? 'var(--tm-bg)' : 'var(--tm-text)',
    boxShadow: on ? 'none' : 'inset 0 0 0 0.5px var(--tm-line)',
  } as const)
  const feld = {
    width: '100%', boxSizing: 'border-box' as const, padding: '11px 13px', borderRadius: 12, border: 'none',
    background: 'var(--tm-surface2)', color: 'var(--tm-text)', fontSize: 16, boxShadow: 'inset 0 0 0 0.5px var(--tm-line)',
  }
  const hauptKnopf = (aktiv: boolean) => ({
    width: '100%', border: 'none', borderRadius: 14, padding: '13px 16px', fontSize: 15, fontWeight: 800,
    cursor: aktiv ? 'pointer' : 'default', background: aktiv ? 'var(--tm-text)' : 'var(--tm-fill)',
    color: aktiv ? 'var(--tm-bg)' : 'var(--tm-muted)',
  } as const)

  const body = (
    <div className="team-shell" style={{ position: 'fixed', inset: 0, zIndex: 85, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div className="tm-scrim" onClick={onClose} style={{ position: 'absolute', inset: 0 }} />
      <div className="tm-sheet tm-sheet-in" role="dialog" aria-label="Zahllink erstellen" style={{
        position: 'relative', maxHeight: '88dvh', overflowY: 'auto', padding: '18px 18px calc(18px + env(safe-area-inset-bottom))',
        background: 'var(--tm-card)', borderRadius: 'var(--tm-r-sheet, 26px) var(--tm-r-sheet, 26px) 0 0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1, fontSize: 17, fontWeight: 800, color: 'var(--tm-text)' }}>💶 Zahllink für {vorname}</div>
          <button type="button" className="tm-close" aria-label="Schließen" onClick={onClose}>✕</button>
        </div>

        <div role="tablist" aria-label="Art" style={{ display: 'flex', padding: 3, borderRadius: 999, background: 'var(--tm-seg-track)', marginBottom: 16 }}>
          {([['extra', 'Extra bezahlen'], ['verlaengerung', 'Verlängerung']] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { haptic(); setTab(id); setFehler(null) }} style={{
              flex: 1, border: 'none', cursor: 'pointer', padding: '8px 10px', borderRadius: 999, fontSize: 13.5, fontWeight: 700,
              background: tab === id ? 'var(--tm-seg-on, var(--tm-card))' : 'transparent', color: tab === id ? 'var(--tm-text)' : 'var(--tm-muted)',
              boxShadow: tab === id ? '0 1px 3px rgba(0,0,0,0.16)' : 'none',
            }}>{label}</button>
          ))}
        </div>

        {tab === 'extra' ? (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-muted)', marginBottom: 7 }}>WOFÜR?</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {ZWECKE.map((z) => (
                <button key={z} type="button" aria-pressed={zweck === z} onClick={() => { haptic(); setZweck(z) }} style={chip(zweck === z)}>{z}</button>
              ))}
            </div>
            <label htmlFor="zl-betrag" style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--tm-muted)', marginBottom: 7 }}>BETRAG IN €</label>
            <input id="zl-betrag" inputMode="decimal" placeholder="z. B. 35" value={betrag} onChange={(e) => setBetrag(e.target.value)} style={{ ...feld, marginBottom: 12 }} />
            <label htmlFor="zl-notiz" style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--tm-muted)', marginBottom: 7 }}>HINWEIS (OPTIONAL)</label>
            <input id="zl-notiz" placeholder="z. B. 1 Person, 2 Nächte" value={notiz} onChange={(e) => setNotiz(e.target.value)} style={{ ...feld, marginBottom: 16 }} />
            <button type="button" disabled={busy} onClick={linkErstellen} style={hauptKnopf(!busy)}>{busy ? 'Erstelle Link…' : 'Link erstellen und einfügen'}</button>
            <div style={{ fontSize: 12, color: 'var(--tm-muted)', lineHeight: 1.5, marginTop: 10 }}>
              Der Link ist einmal bezahlbar und läuft nicht ab. Sobald bezahlt ist, kommt ein Push und im Chat erscheint eine interne Notiz.
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-muted)', marginBottom: 7 }}>WIE VIELE NÄCHTE ZUSÄTZLICH?</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <button type="button" aria-label="Eine Nacht weniger" disabled={naechte <= 1 || busy} onClick={() => { haptic(); setNaechte((n) => Math.max(1, n - 1)); setAngebot(null) }} style={{ ...chip(false), width: 44, height: 44, padding: 0, fontSize: 20 }}>−</button>
              <div style={{ minWidth: 90, textAlign: 'center', fontSize: 17, fontWeight: 800, color: 'var(--tm-text)' }}>{naechte} {naechte === 1 ? 'Nacht' : 'Nächte'}</div>
              <button type="button" aria-label="Eine Nacht mehr" disabled={naechte >= 14 || busy} onClick={() => { haptic(); setNaechte((n) => Math.min(14, n + 1)); setAngebot(null) }} style={{ ...chip(false), width: 44, height: 44, padding: 0, fontSize: 20 }}>+</button>
            </div>
            {!angebot && (
              <button type="button" disabled={busy} onClick={() => angebotHolen(naechte)} style={hauptKnopf(!busy)}>{busy ? 'Prüfe Verfügbarkeit…' : 'Verfügbarkeit und Preis prüfen'}</button>
            )}
            {angebot && !angebot.ok && (
              <div role="status" style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--tm-red-soft)', color: 'var(--tm-red)', fontSize: 13.5, lineHeight: 1.5 }}>
                {angebot.grund ?? 'Verlängerung nicht möglich.'}
              </div>
            )}
            {angebot?.ok && (
              <>
                <div role="status" style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--tm-green-soft)', color: 'var(--tm-text)', fontSize: 13.5, lineHeight: 1.55, marginBottom: 12 }}>
                  <strong>Frei:</strong> {datum(angebot.von)} – {datum(angebot.bis)} · {angebot.naechte} {angebot.naechte === 1 ? 'Nacht' : 'Nächte'}<br />
                  <strong>Preis:</strong> {euro(angebot.preis)} ({euro(angebot.preisProNacht)} pro Nacht, wie auf der Website)
                </div>
                <button type="button" onClick={angebotUebernehmen} style={hauptKnopf(true)}>Angebot mit Link einfügen</button>
              </>
            )}
            <div style={{ fontSize: 12, color: 'var(--tm-muted)', lineHeight: 1.5, marginTop: 10 }}>
              Der Link führt in die Gästemappe: Dort werden Verfügbarkeit und Preis beim Klick neu geprüft, der Gast bezahlt per Stripe, die Zusatznächte werden automatisch als eigene Buchung (mit eigenem Türcode) in Smoobu angelegt.
            </div>
          </>
        )}

        {fehler && <div role="alert" style={{ marginTop: 12, fontSize: 13, color: 'var(--tm-red)' }}>⚠️ {fehler}</div>}

        {links && links.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-muted)', marginBottom: 7 }}>BISHERIGE ZAHLLINKS</div>
            {links.map((l) => (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '0.5px solid var(--tm-line)', fontSize: 13 }}>
                <span style={{ flex: 1, minWidth: 0, color: 'var(--tm-text)' }}>{l.zweck} · {euro(l.betrag)}<span style={{ color: 'var(--tm-muted)' }}>{l.von ? ` · ${l.von}` : ''}</span></span>
                <span style={{
                  fontSize: 11.5, fontWeight: 800, padding: '3px 9px', borderRadius: 999,
                  background: l.status === 'bezahlt' ? 'var(--tm-green-soft)' : 'var(--tm-yellow-soft, var(--tm-surface2))',
                  color: l.status === 'bezahlt' ? 'var(--tm-green)' : 'var(--tm-accent-dark)',
                }}>{l.status === 'bezahlt' ? '✓ bezahlt' : 'offen'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
  return typeof document === 'undefined' ? null : createPortal(body, document.body)
}
