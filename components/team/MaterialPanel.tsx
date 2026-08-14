'use client'

/**
 * 🛒 §266f/§267b Material-Bereich (Mehr-Tab → MATERIAL) — Merkliste-first
 * (Inhaber-Entscheid 14.8.): Standort wählen → Produkt aus der EINEN
 * globalen Merkliste antippen (🟡 knapp / 🔴 leer) → fertig. Für alles
 * außerhalb des Sortiments ein Freitext-Feld, das die KI gegen die
 * Merkliste matcht und einen Vorschlag macht (Melder bestätigt selbst).
 * Bestell-Ansage kommt als Push; Warenkorb-/Produkt-Links stehen hier.
 * Admins pflegen Merkliste (Name + Link + ASIN + Menge) und Adress-Labels.
 * Vollbild-Portal (§83-Muster: nie fixed im Touch-Scroller).
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { haptic } from '@/components/team/ux'

const NAVY = '#12222E'

interface Artikel { id: string; name: string; url?: string; bild?: string; asin?: string; menge?: number }
interface Bedarf {
  id: string; standort: string; artikelId?: string; name: string
  prio: 'knapp' | 'leer'; status: 'offen' | 'bestellt' | 'aufgefuellt'
  von: string; at: string
}
interface Data {
  standorte: string[]
  artikel: Artikel[]
  adressen: Record<string, { label: string; hinweis?: string }>
  gruppeId: string | null
  merklisteUrl: string | null
  bedarf: Bedarf[]
  links: Record<string, string | null>
  admin: boolean
}
interface Vorschlag { name: string; artikelId?: string; prio: 'knapp' | 'leer'; hinweis?: string }

const CARD: CSSProperties = {
  background: '#fff', borderRadius: 16, padding: '14px 16px',
  boxShadow: 'inset 0 0 0 0.5px rgba(60,60,67,0.15)',
}
const INPUT: CSSProperties = {
  borderRadius: 10, border: '0.5px solid rgba(60,60,67,0.25)', padding: '9px 11px', fontSize: 16,
}

export default function MaterialPanel({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [ort, setOrt] = useState<string>('')
  const [suche, setSuche] = useState('')
  const [frei, setFrei] = useState('')
  const [freiBusy, setFreiBusy] = useState(false)
  const [vorschlag, setVorschlag] = useState<Vorschlag | null>(null)
  const [editListe, setEditListe] = useState(false)
  const [editAdr, setEditAdr] = useState(false)
  const [neuArtikel, setNeuArtikel] = useState({ name: '', url: '', asin: '', menge: '1' })
  // Adress-Entwürfe lokal — load() darf getippte Zeichen nie überschreiben
  const [adrDraft, setAdrDraft] = useState<Record<string, string>>({})
  const [gruppen, setGruppen] = useState<{ id: string; name: string; emoji: string }[] | null>(null)
  // PATCHes serialisieren (onBlur-Adresse + onClick-Liste dürfen sich
  // nicht gegenseitig per Read-Modify-Write überschreiben)
  const patchQueue = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    try { const s = localStorage.getItem('material-standort'); if (s) setOrt(s) } catch {}
  }, [])
  function pickOrt(s: string) {
    setOrt(s)
    try { localStorage.setItem('material-standort', s) } catch {}
  }

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/material', { cache: 'no-store' })
      const t = await r.text()
      const j = JSON.parse(t)
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setData(j); setError(null)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    }
  }, [])
  useEffect(() => { load() }, [load])

  function patch(body: Record<string, unknown>, busyKey: string): Promise<void> {
    const job = patchQueue.current.then(async () => {
      setBusy(busyKey)
      try {
        const r = await fetch('/api/material', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
        await load()
      } catch (e) {
        alert('Fehler: ' + String(e instanceof Error ? e.message : e))
      } finally {
        setBusy(null)
      }
    })
    patchQueue.current = job
    return job
  }

  function melden(name: string, prio: 'knapp' | 'leer', key: string) {
    if (!ort) { alert('Bitte oben zuerst den Standort wählen.'); return }
    haptic()
    patch({ melden: { standort: ort, name, prio } }, key)
  }

  async function analysieren() {
    const text = frei.trim()
    if (text.length < 3) return
    setFreiBusy(true); setVorschlag(null)
    try {
      const r = await fetch('/api/material', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ analyse: text }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setVorschlag(j.vorschlag)
    } catch (e) {
      alert('Fehler: ' + String(e instanceof Error ? e.message : e))
    } finally {
      setFreiBusy(false)
    }
  }

  // Intern-Gruppen für die optionale Chat-Verknüpfung (Admin, lazy)
  async function loadGruppen() {
    try {
      const r = await fetch('/api/team-chat', { cache: 'no-store' })
      const j = await r.json()
      setGruppen(Array.isArray(j.chats) ? j.chats : [])
    } catch { setGruppen([]) }
  }

  const artikelFor = (b: Bedarf): Artikel | undefined =>
    data?.artikel.find((a) => a.id === b.artikelId || a.name.toLowerCase() === b.name.toLowerCase())

  /** Bedarfs-Block eines Standorts (Offen + Bestellt + Warenkorb) */
  function bedarfBlock(s: string) {
    if (!data) return null
    const offen = data.bedarf.filter((b) => b.standort === s && b.status === 'offen')
    const bestellt = data.bedarf.filter((b) => b.standort === s && b.status === 'bestellt')
    if (!offen.length && !bestellt.length) return null
    const adr = data.adressen[s]
    const bestellreif = offen.some((b) => b.prio === 'leer') || offen.length >= 3
    return (
      <div key={s} style={CARD}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 15.5, fontWeight: 800, color: '#111' }}>
            📍 {s}{bestellreif && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 800, color: '#B91C1C', background: '#FEE2E2', borderRadius: 999, padding: '2px 8px', verticalAlign: 'middle' }}>Bestellung fällig</span>}
          </span>
          <span style={{ fontSize: 11, color: '#8E8E93', whiteSpace: 'nowrap' }}>{adr ? `📦 ${adr.label}` : ''}</span>
        </div>
        {offen.map((b) => {
          const a = artikelFor(b)
          return (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.1)' }}>
              <span style={{ fontSize: 13 }}>{b.prio === 'leer' ? '🔴' : '🟡'}</span>
              {a?.bild && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.bild} alt="" loading="lazy"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  style={{ width: 34, height: 34, objectFit: 'contain', flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1A1814' }}>
                  {a?.url ? <a href={a.url} target="_blank" rel="noreferrer" style={{ color: '#1A1814', textDecoration: 'underline', textDecorationColor: 'rgba(60,60,67,0.3)' }}>{b.name} ↗</a> : b.name}
                </div>
                <div style={{ fontSize: 10.5, color: '#A9A499' }}>{b.von} · {new Date(b.at).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' })}</div>
              </div>
              <button onClick={() => { haptic(); patch({ bedarfId: b.id, status: 'bestellt' }, b.id) }} disabled={busy === b.id}
                style={{ border: 'none', borderRadius: 999, padding: '6px 11px', fontSize: 11.5, fontWeight: 700, background: NAVY, color: '#fff', cursor: 'pointer' }}>Bestellt</button>
              <button onClick={() => { haptic(); patch({ bedarfId: b.id, status: 'entfernt' }, b.id) }} disabled={busy === b.id}
                style={{ border: 'none', borderRadius: 999, padding: '6px 9px', fontSize: 11.5, background: 'rgba(118,118,128,0.12)', color: '#666', cursor: 'pointer' }}>✕</button>
            </div>
          )
        })}
        {bestellt.map((b) => (
          <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.1)', opacity: 0.75 }}>
            <span style={{ fontSize: 13 }}>📦</span>
            <div style={{ flex: 1, minWidth: 0, fontSize: 14, color: '#1A1814' }}>{b.name} <span style={{ fontSize: 11, color: '#A9A499' }}>· bestellt</span></div>
            <button onClick={() => { haptic(); patch({ bedarfId: b.id, status: 'aufgefuellt' }, b.id) }} disabled={busy === b.id}
              style={{ border: 'none', borderRadius: 999, padding: '6px 11px', fontSize: 11.5, fontWeight: 700, background: '#E8F5EC', color: '#166534', cursor: 'pointer' }}>✓ Aufgefüllt</button>
          </div>
        ))}
        {offen.length > 0 && data.merklisteUrl && (
          <a href={data.merklisteUrl} target="_blank" rel="noreferrer" onClick={() => haptic()}
            style={{ display: 'block', textAlign: 'center', marginTop: 10, padding: '11px 14px', borderRadius: 12, background: 'var(--gold, #AE8D2D)', color: '#fff', fontSize: 13.5, fontWeight: 800, textDecoration: 'none' }}>
            🧺 dm-Merkliste öffnen{adr ? ` — Adresse „${adr.label}" wählen!` : ''}
          </a>
        )}
        {offen.length > 0 && data.links[s] && (
          <a href={data.links[s]!} target="_blank" rel="noreferrer" onClick={() => haptic()}
            style={{ display: 'block', textAlign: 'center', marginTop: 8, padding: '11px 14px', borderRadius: 12, background: NAVY, color: '#fff', fontSize: 13.5, fontWeight: 800, textDecoration: 'none' }}>
            🛒 Amazon-Warenkorb öffnen{adr ? ` — Adresse „${adr.label}" wählen!` : ''}
          </a>
        )}
      </div>
    )
  }

  const gefiltert = (data?.artikel ?? []).filter((a) => !suche.trim() || a.name.toLowerCase().includes(suche.trim().toLowerCase()))

  const body = (
    <div className="team-shell" style={{
      position: 'fixed', inset: 0, zIndex: 90, background: '#F5F5F7',
      display: 'flex', flexDirection: 'column',
      paddingTop: 'env(safe-area-inset-top)',
    }}>
      {/* Kopf */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 8px', flexShrink: 0 }}>
        <span style={{ fontSize: 28, fontWeight: 800, color: '#111', letterSpacing: '-0.6px' }}>🛒 Material</span>
        <button onClick={onClose} style={{ border: 'none', background: 'rgba(118,118,128,0.12)', fontSize: 15, color: '#333', width: 32, height: 32, borderRadius: '50%', cursor: 'pointer' }}>✕</button>
      </div>

      {/* Standort-Chips */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '2px 16px 10px', flexShrink: 0, WebkitOverflowScrolling: 'touch' }}>
        {(data?.standorte ?? []).map((s) => (
          <button key={s} onClick={() => { haptic(); pickOrt(ort === s ? '' : s) }}
            style={{
              border: 'none', borderRadius: 999, padding: '7px 14px', fontSize: 13, fontWeight: 700,
              whiteSpace: 'nowrap', cursor: 'pointer',
              background: ort === s ? NAVY : '#fff', color: ort === s ? '#fff' : '#333',
              boxShadow: ort === s ? 'none' : 'inset 0 0 0 0.5px rgba(60,60,67,0.2)',
            }}>{s}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '0 14px', paddingBottom: 'max(20px, env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && (
          <div style={{ ...CARD, background: '#FEF2F2', color: '#B91C1C', fontSize: 13 }}>
            ⚠️ {error} <button onClick={load} style={{ border: 'none', background: 'none', color: '#B91C1C', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}>Erneut</button>
          </div>
        )}
        {!data && !error && <div style={{ ...CARD, color: '#999', fontSize: 13 }}>Laden…</div>}

        {/* Bedarf (aktiver Standort oder alle) */}
        {data && (ort ? [bedarfBlock(ort)] : data.standorte.map((s) => bedarfBlock(s)))}
        {data && !data.bedarf.some((b) => (b.status === 'offen' || b.status === 'bestellt') && (!ort || b.standort === ort)) && (
          <div style={{ ...CARD, fontSize: 12.5, color: '#B0ABA0' }}>Nichts offen 🎉</div>
        )}

        {/* Merkliste */}
        {data && (
          <div style={CARD}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 15.5, fontWeight: 800, color: '#111' }}>🧺 Merkliste</span>
              <span style={{ fontSize: 11, color: '#8E8E93' }}>{data.artikel.length} Produkte</span>
            </div>
            {!ort && <p style={{ margin: '8px 0 2px', fontSize: 12, color: '#92400E' }}>Oben Standort wählen, dann melden: 🟡 wird knapp · 🔴 leer.</p>}
            {data.artikel.length > 8 && (
              <input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Suchen…"
                style={{ ...INPUT, width: '100%', boxSizing: 'border-box', marginTop: 8 }} />
            )}
            {data.artikel.length === 0 && <p style={{ margin: '8px 0 2px', fontSize: 12, color: '#A9A499' }}>Merkliste ist leer — unten pflegen (Admin).</p>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6, marginTop: 8 }}>
              {gefiltert.map((a) => (
                <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: 5, border: '0.5px solid rgba(60,60,67,0.15)', borderRadius: 12, padding: '8px 10px', background: '#fff' }}>
                  {a.bild && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.bild} alt="" loading="lazy"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                      style={{ width: '100%', height: 74, objectFit: 'contain' }} />
                  )}
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: '#1A1814', lineHeight: 1.25, minHeight: 31 }}>{a.name}</span>
                  <div style={{ display: 'flex', gap: 5 }}>
                    <button onClick={() => melden(a.name, 'knapp', 'm' + a.id)} disabled={busy === 'm' + a.id || !ort}
                      style={{ flex: 1, border: 'none', borderRadius: 999, padding: '5px 0', fontSize: 11, fontWeight: 700, background: '#FEF3C7', color: '#92400E', cursor: 'pointer', opacity: ort ? 1 : 0.45 }}>🟡 knapp</button>
                    <button onClick={() => melden(a.name, 'leer', 'l' + a.id)} disabled={busy === 'l' + a.id || !ort}
                      style={{ flex: 1, border: 'none', borderRadius: 999, padding: '5px 0', fontSize: 11, fontWeight: 700, background: '#FEE2E2', color: '#B91C1C', cursor: 'pointer', opacity: ort ? 1 : 0.45 }}>🔴 leer</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Freitext-KI */}
        {data && (
          <div style={CARD}>
            <span style={{ fontSize: 15.5, fontWeight: 800, color: '#111' }}>✨ Etwas Besonderes?</span>
            <p style={{ margin: '6px 0 8px', fontSize: 12, color: '#8A8578', lineHeight: 1.45 }}>
              Kurz beschreiben, was fehlt — die KI schlägt das passende Produkt vor (auch wenn es nicht auf der Merkliste steht).
            </p>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={frei} onChange={(e) => setFrei(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') analysieren() }}
                placeholder={'z. B. „so ein Entkalker für den Wasserkocher“'}
                style={{ ...INPUT, flex: 1, minWidth: 0 }} />
              <button onClick={analysieren} disabled={freiBusy || frei.trim().length < 3}
                style={{ border: 'none', borderRadius: 10, padding: '0 14px', background: NAVY, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: freiBusy ? 0.6 : 1 }}>
                {freiBusy ? '…' : '✨'}
              </button>
            </div>
            {vorschlag && (
              <div style={{ marginTop: 10, borderRadius: 12, background: '#FAFAF8', border: '0.5px solid rgba(60,60,67,0.15)', padding: '10px 12px' }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1A1814' }}>
                  {vorschlag.name} {vorschlag.artikelId ? <span style={{ fontSize: 10.5, fontWeight: 700, color: '#166534', background: '#E8F5EC', borderRadius: 999, padding: '2px 7px' }}>aus der Merkliste</span> : <span style={{ fontSize: 10.5, fontWeight: 700, color: '#8E8E93', background: 'rgba(118,118,128,0.1)', borderRadius: 999, padding: '2px 7px' }}>neu</span>}
                </div>
                {vorschlag.hinweis && <div style={{ fontSize: 11.5, color: '#8A8578', marginTop: 3 }}>{vorschlag.hinweis}</div>}
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button onClick={() => { melden(vorschlag.name, 'knapp', 'v1'); setVorschlag(null); setFrei('') }} disabled={!ort}
                    style={{ flex: 1, border: 'none', borderRadius: 999, padding: '7px 0', fontSize: 12, fontWeight: 700, background: '#FEF3C7', color: '#92400E', cursor: 'pointer', opacity: ort ? 1 : 0.45 }}>🟡 knapp melden</button>
                  <button onClick={() => { melden(vorschlag.name, 'leer', 'v2'); setVorschlag(null); setFrei('') }} disabled={!ort}
                    style={{ flex: 1, border: 'none', borderRadius: 999, padding: '7px 0', fontSize: 12, fontWeight: 700, background: '#FEE2E2', color: '#B91C1C', cursor: 'pointer', opacity: ort ? 1 : 0.45 }}>🔴 leer melden</button>
                  <button onClick={() => setVorschlag(null)}
                    style={{ border: 'none', borderRadius: 999, padding: '7px 11px', fontSize: 12, background: 'rgba(118,118,128,0.12)', color: '#666', cursor: 'pointer' }}>✕</button>
                </div>
                {!ort && <div style={{ marginTop: 6, fontSize: 11, color: '#92400E' }}>Oben zuerst den Standort wählen.</div>}
              </div>
            )}
          </div>
        )}

        {/* Admin: Merkliste pflegen */}
        {data?.admin && (
          <div style={CARD}>
            <button onClick={() => setEditListe(!editListe)}
              style={{ border: 'none', background: 'none', padding: 0, fontSize: 13, color: '#555', fontWeight: 700, cursor: 'pointer' }}>
              {editListe ? '▾' : '▸'} Merkliste verwalten ({data.artikel.length})
            </button>
            {editListe && (
              <div style={{ marginTop: 8 }}>
                {data.artikel.map((a) => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 12.5 }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.name}
                      {a.url ? <span style={{ color: '#166534' }}> · 🔗</span> : null}
                      {a.asin ? <span style={{ color: '#16A34A' }}> · 🛒</span> : null}
                      {a.menge && a.menge > 1 ? <span style={{ color: '#8E8E93' }}> · {a.menge}×</span> : null}
                    </span>
                    <button onClick={() => patch({ artikel: data.artikel.filter((x) => x.id !== a.id) }, 'del' + a.id)}
                      style={{ border: 'none', background: 'none', color: '#B91C1C', fontSize: 12, cursor: 'pointer' }}>✕</button>
                  </div>
                ))}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                  <input value={neuArtikel.name} onChange={(e) => setNeuArtikel({ ...neuArtikel, name: e.target.value })} placeholder="Produkt (z. B. Spülmittel)" style={INPUT} />
                  <input value={neuArtikel.url} onChange={(e) => setNeuArtikel({ ...neuArtikel, url: e.target.value })} placeholder="Produkt-Link (dm/Amazon, optional)" style={INPUT} />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input value={neuArtikel.asin} onChange={(e) => setNeuArtikel({ ...neuArtikel, asin: e.target.value })} placeholder="Amazon-ASIN (optional)"
                      style={{ ...INPUT, flex: 1, minWidth: 0 }} />
                    <input value={neuArtikel.menge} onChange={(e) => setNeuArtikel({ ...neuArtikel, menge: e.target.value })} placeholder="Menge" inputMode="numeric"
                      style={{ ...INPUT, flex: '0 0 64px' }} />
                    <button onClick={() => {
                      const name = neuArtikel.name.trim()
                      if (!name) return
                      const eintrag: Artikel = {
                        id: Math.random().toString(36).slice(2, 10), name,
                        ...(neuArtikel.url.trim() ? { url: neuArtikel.url.trim() } : {}),
                        ...(neuArtikel.asin.trim() ? { asin: neuArtikel.asin.trim() } : {}),
                        ...(parseInt(neuArtikel.menge) > 1 ? { menge: parseInt(neuArtikel.menge) } : {}),
                      }
                      patch({ artikel: [...data.artikel, eintrag] }, 'add')
                      setNeuArtikel({ name: '', url: '', asin: '', menge: '1' })
                    }} style={{ border: 'none', borderRadius: 10, padding: '0 14px', background: NAVY, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>＋</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Admin: Adressen + optionale Chat-Gruppe */}
        {data?.admin && (
          <div style={CARD}>
            <button onClick={() => setEditAdr(!editAdr)}
              style={{ border: 'none', background: 'none', padding: 0, fontSize: 13, color: '#555', fontWeight: 700, cursor: 'pointer' }}>
              {editAdr ? '▾' : '▸'} Lieferadressen & Chat-Bonus
            </button>
            {editAdr && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                <p style={{ margin: 0, fontSize: 11.5, color: '#8A8578', lineHeight: 1.45 }}>
                  Adress-LABEL je Standort = so heißt der Eintrag im Amazon-/dm-Adressbuch (Paketbox!). Wird in Bestell-Ansagen genannt.
                </p>
                {data.standorte.map((s) => {
                  const adr = data.adressen[s]
                  return (
                    <input key={s} value={adrDraft[s] ?? adr?.label ?? ''} onChange={(e) => {
                      setAdrDraft((d) => ({ ...d, [s]: e.target.value }))
                    }} onBlur={() => {
                      const label = (adrDraft[s] ?? '').trim()
                      if (adrDraft[s] === undefined || label === (adr?.label ?? '')) return
                      patch({ adressen: { ...data.adressen, [s]: { ...(adr ?? {}), label } } }, 'adr' + s)
                        .then(() => setAdrDraft((d) => { const n = { ...d }; delete n[s]; return n }))
                    }}
                      placeholder={`${s}: Adress-Label (z. B. „TRIMOSA ${s} Paketbox")`}
                      style={INPUT} />
                  )
                })}
                <p style={{ margin: '4px 0 0', fontSize: 11.5, color: '#8A8578', lineHeight: 1.45 }}>
                  dm-Merklisten-Link (dm.de → Merkliste → Teilen) — erscheint als Bestell-Button.
                </p>
                <input defaultValue={data.merklisteUrl ?? ''} onBlur={(e) => {
                  const u = e.target.value.trim()
                  if (u !== (data.merklisteUrl ?? '')) patch({ merklisteUrl: u }, 'mlurl')
                }} placeholder="https://www.dm.de/… (geteilte Merkliste)" style={INPUT} />
                <p style={{ margin: '4px 0 0', fontSize: 11.5, color: '#8A8578', lineHeight: 1.45 }}>
                  Optional: Intern-Gruppe verknüpfen — dann liest die KI auch formlose Chat-/Sprachnachrichten als Meldung mit. {data.gruppeId ? '✓ verknüpft' : 'Nicht verknüpft.'}
                </p>
                {!gruppen && <button onClick={loadGruppen} style={{ alignSelf: 'flex-start', border: 'none', borderRadius: 999, padding: '6px 12px', fontSize: 12, fontWeight: 700, background: 'rgba(118,118,128,0.12)', color: '#333', cursor: 'pointer' }}>Gruppe wählen…</button>}
                {gruppen && gruppen.length === 0 && <span style={{ fontSize: 11.5, color: '#8A8578' }}>Keine Intern-Gruppen gefunden — erst im Intern-Tab anlegen.</span>}
                {gruppen && gruppen.length > 0 && (
                  <select value={data.gruppeId ?? ''} onChange={(e) => { if (e.target.value) patch({ gruppeId: e.target.value }, 'gruppe') }}
                    style={{ ...INPUT, background: '#fff' }}>
                    <option value="" disabled>Gruppe auswählen…</option>
                    {gruppen.map((g) => <option key={g.id} value={g.id}>{g.emoji} {g.name}</option>)}
                  </select>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(body, document.body)
}
