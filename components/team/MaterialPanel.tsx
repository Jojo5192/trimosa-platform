'use client'

/**
 * 🛒 §266f/§267b/§267d Material-Bereich (Mehr-Tab → MATERIAL) —
 * Merkliste-first im dm-Look: Standort wählen → Kategorie filtern →
 * Produkt-Kachel „＋ Nachbestellen" antippen — fertig (EIN Button,
 * Inhaber-Entscheid 14.8.: kein knapp/leer mehr). Feedback dreifach:
 * Kachel springt OPTIMISTISCH auf grünes „✓ Auf der Liste", Toast unten,
 * Haptik. Für Sortiment-Fremdes das ✨-Freitext-Feld (KI-Vorschlag,
 * Melder bestätigt selbst). Bestell-Ansage kommt als Push; Links stehen
 * hier. Admins pflegen Merkliste (Kategorie/Link/ASIN) + Adress-Labels.
 * Vollbild-Portal (§83-Muster: nie fixed im Touch-Scroller).
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { haptic } from '@/components/team/ux'

const NAVY = '#12222E'
const GRUEN = '#16A34A'
const KATEGORIEN = ['🧽 Putzen', '🧺 Wäsche', '🍽 Küche', '🧻 Papier & Müll', '🧤 Handschuhe', '🧴 Pflege']

interface Artikel { id: string; name: string; kategorie?: string; url?: string; bild?: string; asin?: string; menge?: number }
interface Bedarf {
  id: string; standort: string; artikelId?: string; name: string
  status: 'offen' | 'bestellt' | 'aufgefuellt'
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
interface Vorschlag { name: string; artikelId?: string; hinweis?: string }

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
  const [kat, setKat] = useState<string>('')
  const [suche, setSuche] = useState('')
  const [frei, setFrei] = useState('')
  const [freiBusy, setFreiBusy] = useState(false)
  const [vorschlag, setVorschlag] = useState<Vorschlag | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [editListe, setEditListe] = useState(false)
  const [editAdr, setEditAdr] = useState(false)
  const [neuArtikel, setNeuArtikel] = useState({ name: '', kategorie: '', url: '', asin: '', menge: '1' })
  // Optimistisch gemeldete Artikel (name|standort) — Kachel springt sofort auf ✓
  const [pending, setPending] = useState<Set<string>>(new Set())
  // Adress-Entwürfe lokal — load() darf getippte Zeichen nie überschreiben
  const [adrDraft, setAdrDraft] = useState<Record<string, string>>({})
  const [gruppen, setGruppen] = useState<{ id: string; name: string; emoji: string }[] | null>(null)
  // PATCHes serialisieren (onBlur-Adresse + onClick-Liste dürfen sich
  // nicht gegenseitig per Read-Modify-Write überschreiben)
  const patchQueue = useRef<Promise<void>>(Promise.resolve())
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    try { const s = localStorage.getItem('material-standort'); if (s) setOrt(s) } catch {}
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current) }
  }, [])
  function pickOrt(s: string) {
    setOrt(s)
    try { localStorage.setItem('material-standort', s) } catch {}
  }

  function showToast(msg: string, ok = true) {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ msg, ok })
    toastTimer.current = setTimeout(() => setToast(null), 2400)
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
        showToast('Fehler: ' + String(e instanceof Error ? e.message : e), false)
      } finally {
        setBusy(null)
      }
    })
    patchQueue.current = job
    return job
  }

  /** Ist der Artikel am Standort schon offen gemeldet (Server ODER optimistisch)? */
  function istGemeldet(name: string): boolean {
    if (!ort) return false
    if (pending.has(`${name.toLowerCase()}|${ort}`)) return true
    return !!data?.bedarf.some((b) => b.status === 'offen' && b.standort === ort && b.name.toLowerCase() === name.toLowerCase())
  }

  function melden(name: string, key: string) {
    if (!ort) { showToast('Bitte oben zuerst den Standort wählen.', false); return }
    if (istGemeldet(name)) { haptic(); showToast(`${name} steht schon auf der Liste (${ort}).`); return }
    haptic()
    // OPTIMISTISCH: Kachel springt sofort auf ✓, Toast bestätigt
    setPending((p) => new Set(p).add(`${name.toLowerCase()}|${ort}`))
    showToast(`✓ ${name} notiert (${ort})`)
    patch({ melden: { standort: ort, name } }, key).then(() => {
      setPending((p) => { const n = new Set(p); n.delete(`${name.toLowerCase()}|${ort}`); return n })
    })
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
      showToast('Fehler: ' + String(e instanceof Error ? e.message : e), false)
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

  /** Bedarfs-Block eines Standorts (Offen + Bestellt + Bestell-Links) */
  function bedarfBlock(s: string) {
    if (!data) return null
    const offen = data.bedarf.filter((b) => b.standort === s && b.status === 'offen')
    const bestellt = data.bedarf.filter((b) => b.standort === s && b.status === 'bestellt')
    if (!offen.length && !bestellt.length) return null
    const adr = data.adressen[s]
    return (
      <div key={s} style={CARD}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 15.5, fontWeight: 800, color: '#111' }}>🛒 Bestell-Liste {s}</span>
          <span style={{ fontSize: 11, color: '#8E8E93', whiteSpace: 'nowrap' }}>{adr ? `📦 ${adr.label}` : ''}</span>
        </div>
        {offen.map((b) => {
          const a = artikelFor(b)
          return (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.1)' }}>
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
              <button className="mat-tap" onClick={() => { haptic(); patch({ bedarfId: b.id, status: 'bestellt' }, b.id); showToast(`📦 ${b.name} als bestellt markiert`) }} disabled={busy === b.id}
                style={{ border: 'none', borderRadius: 999, padding: '6px 11px', fontSize: 11.5, fontWeight: 700, background: NAVY, color: '#fff', cursor: 'pointer' }}>Bestellt</button>
              <button className="mat-tap" onClick={() => { haptic(); patch({ bedarfId: b.id, status: 'entfernt' }, b.id) }} disabled={busy === b.id}
                style={{ border: 'none', borderRadius: 999, padding: '6px 9px', fontSize: 11.5, background: 'rgba(118,118,128,0.12)', color: '#666', cursor: 'pointer' }}>✕</button>
            </div>
          )
        })}
        {bestellt.map((b) => (
          <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.1)', opacity: 0.75 }}>
            <span style={{ fontSize: 13 }}>📦</span>
            <div style={{ flex: 1, minWidth: 0, fontSize: 14, color: '#1A1814' }}>{b.name} <span style={{ fontSize: 11, color: '#A9A499' }}>· bestellt</span></div>
            <button className="mat-tap" onClick={() => { haptic(); patch({ bedarfId: b.id, status: 'aufgefuellt' }, b.id); showToast(`✓ ${b.name} aufgefüllt`) }} disabled={busy === b.id}
              style={{ border: 'none', borderRadius: 999, padding: '6px 11px', fontSize: 11.5, fontWeight: 700, background: '#E8F5EC', color: '#166534', cursor: 'pointer' }}>✓ Aufgefüllt</button>
          </div>
        ))}
        {offen.length > 0 && data.merklisteUrl && (
          <a className="mat-tap" href={data.merklisteUrl} target="_blank" rel="noreferrer" onClick={() => haptic()}
            style={{ display: 'block', textAlign: 'center', marginTop: 10, padding: '11px 14px', borderRadius: 12, background: 'var(--gold, #AE8D2D)', color: '#fff', fontSize: 13.5, fontWeight: 800, textDecoration: 'none' }}>
            🧺 dm-Merkliste öffnen{adr ? ` — Adresse „${adr.label}" wählen!` : ''}
          </a>
        )}
        {offen.length > 0 && data.links[s] && (
          <a className="mat-tap" href={data.links[s]!} target="_blank" rel="noreferrer" onClick={() => haptic()}
            style={{ display: 'block', textAlign: 'center', marginTop: 8, padding: '11px 14px', borderRadius: 12, background: NAVY, color: '#fff', fontSize: 13.5, fontWeight: 800, textDecoration: 'none' }}>
            🛒 Amazon-Warenkorb öffnen{adr ? ` — Adresse „${adr.label}" wählen!` : ''}
          </a>
        )}
      </div>
    )
  }

  const kategorienMitArtikeln = KATEGORIEN.filter((k) => data?.artikel.some((a) => a.kategorie === k))
  const hatUnkategorisierte = !!data?.artikel.some((a) => !a.kategorie || !KATEGORIEN.includes(a.kategorie))
  const gefiltert = (data?.artikel ?? []).filter((a) => {
    if (suche.trim()) return a.name.toLowerCase().includes(suche.trim().toLowerCase())
    if (!kat) return true
    if (kat === '📦 Sonstiges') return !a.kategorie || !KATEGORIEN.includes(a.kategorie)
    return a.kategorie === kat
  })

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
          <button key={s} className="mat-tap" onClick={() => { haptic(); pickOrt(ort === s ? '' : s) }}
            style={{
              border: 'none', borderRadius: 999, padding: '7px 14px', fontSize: 13, fontWeight: 700,
              whiteSpace: 'nowrap', cursor: 'pointer',
              background: ort === s ? NAVY : '#fff', color: ort === s ? '#fff' : '#333',
              boxShadow: ort === s ? 'none' : 'inset 0 0 0 0.5px rgba(60,60,67,0.2)',
            }}>{ort === s ? '📍 ' : ''}{s}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '0 14px', paddingBottom: 'max(20px, env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && (
          <div style={{ ...CARD, background: '#FEF2F2', color: '#B91C1C', fontSize: 13 }}>
            ⚠️ {error} <button onClick={load} style={{ border: 'none', background: 'none', color: '#B91C1C', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}>Erneut</button>
          </div>
        )}
        {!data && !error && <div style={{ ...CARD, color: '#999', fontSize: 13 }}>Laden…</div>}

        {/* Bestell-Listen (aktiver Standort oder alle) */}
        {data && (ort ? [bedarfBlock(ort)] : data.standorte.map((s) => bedarfBlock(s)))}

        {/* Merkliste */}
        {data && (
          <div style={CARD}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 15.5, fontWeight: 800, color: '#111' }}>🧺 Merkliste</span>
              <span style={{ fontSize: 11, color: '#8E8E93' }}>{data.artikel.length} Produkte</span>
            </div>
            {!ort && <p style={{ margin: '8px 0 0', fontSize: 12.5, fontWeight: 600, color: '#92400E' }}>👆 Oben den Standort wählen — dann Produkt antippen zum Nachbestellen.</p>}
            <input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Suchen…"
              style={{ ...INPUT, width: '100%', boxSizing: 'border-box', marginTop: 8 }} />
            {/* Kategorie-Chips */}
            {!suche.trim() && (kategorienMitArtikeln.length > 0 || hatUnkategorisierte) && (
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch', margin: '8px -16px 0', padding: '0 16px' }}>
                {['', ...kategorienMitArtikeln, ...(hatUnkategorisierte && kategorienMitArtikeln.length ? ['📦 Sonstiges'] : [])].map((k) => (
                  <button key={k || 'alle'} className="mat-tap" onClick={() => { haptic(); setKat(kat === k ? '' : k) }}
                    style={{
                      border: 'none', borderRadius: 999, padding: '6px 12px', fontSize: 12, fontWeight: 700,
                      whiteSpace: 'nowrap', cursor: 'pointer',
                      background: kat === k ? NAVY : 'rgba(118,118,128,0.1)', color: kat === k ? '#fff' : '#444',
                    }}>{k || 'Alle'}</button>
                ))}
              </div>
            )}
            {data.artikel.length === 0 && <p style={{ margin: '8px 0 2px', fontSize: 12, color: '#A9A499' }}>Merkliste ist leer — unten pflegen (Admin).</p>}
            {data.artikel.length > 0 && gefiltert.length === 0 && <p style={{ margin: '8px 0 2px', fontSize: 12, color: '#A9A499' }}>Nichts gefunden.</p>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, marginTop: 10 }}>
              {gefiltert.map((a) => {
                const gemeldet = istGemeldet(a.name)
                return (
                  <div key={a.id} className={gemeldet ? 'mat-pop' : undefined} style={{
                    display: 'flex', flexDirection: 'column', gap: 6, borderRadius: 12, padding: '8px 10px 10px',
                    background: '#fff',
                    boxShadow: gemeldet ? `inset 0 0 0 1.5px ${GRUEN}` : 'inset 0 0 0 0.5px rgba(60,60,67,0.15)',
                  }}>
                    {a.bild && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.bild} alt="" loading="lazy"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        style={{ width: '100%', height: 78, objectFit: 'contain' }} />
                    )}
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: '#1A1814', lineHeight: 1.25, minHeight: 31 }}>{a.name}</span>
                    <button className="mat-tap" onClick={() => melden(a.name, 'm' + a.id)} disabled={busy === 'm' + a.id}
                      style={{
                        border: 'none', borderRadius: 999, padding: '8px 0', fontSize: 12, fontWeight: 800,
                        cursor: 'pointer', opacity: ort || gemeldet ? 1 : 0.45,
                        background: gemeldet ? '#E8F5EC' : NAVY, color: gemeldet ? '#166534' : '#fff',
                      }}>
                      {gemeldet ? '✓ Auf der Liste' : '＋ Nachbestellen'}
                    </button>
                  </div>
                )
              })}
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
              <button className="mat-tap" onClick={analysieren} disabled={freiBusy || frei.trim().length < 3}
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
                  <button className="mat-tap" onClick={() => { melden(vorschlag.name, 'v1'); setVorschlag(null); setFrei('') }} disabled={!ort}
                    style={{ flex: 1, border: 'none', borderRadius: 999, padding: '9px 0', fontSize: 12.5, fontWeight: 800, background: NAVY, color: '#fff', cursor: 'pointer', opacity: ort ? 1 : 0.45 }}>＋ Nachbestellen</button>
                  <button className="mat-tap" onClick={() => setVorschlag(null)}
                    style={{ border: 'none', borderRadius: 999, padding: '9px 12px', fontSize: 12, background: 'rgba(118,118,128,0.12)', color: '#666', cursor: 'pointer' }}>✕</button>
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
                    <select value={a.kategorie && KATEGORIEN.includes(a.kategorie) ? a.kategorie : ''}
                      onChange={(e) => {
                        const artikel = data.artikel.map((x) => x.id === a.id ? { ...x, kategorie: e.target.value || undefined } : x)
                        patch({ artikel }, 'kat' + a.id)
                      }}
                      style={{ borderRadius: 8, border: '0.5px solid rgba(60,60,67,0.25)', padding: '4px 6px', fontSize: 12, maxWidth: 130, background: '#fff' }}>
                      <option value="">— Kategorie</option>
                      {KATEGORIEN.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                    <button onClick={() => patch({ artikel: data.artikel.filter((x) => x.id !== a.id) }, 'del' + a.id)}
                      style={{ border: 'none', background: 'none', color: '#B91C1C', fontSize: 12, cursor: 'pointer' }}>✕</button>
                  </div>
                ))}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                  <input value={neuArtikel.name} onChange={(e) => setNeuArtikel({ ...neuArtikel, name: e.target.value })} placeholder="Produkt (z. B. Spülmittel)" style={INPUT} />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select value={neuArtikel.kategorie} onChange={(e) => setNeuArtikel({ ...neuArtikel, kategorie: e.target.value })}
                      style={{ ...INPUT, flex: 1, minWidth: 0, background: '#fff' }}>
                      <option value="">— Kategorie (optional)</option>
                      {KATEGORIEN.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                    <input value={neuArtikel.menge} onChange={(e) => setNeuArtikel({ ...neuArtikel, menge: e.target.value })} placeholder="Menge" inputMode="numeric"
                      style={{ ...INPUT, flex: '0 0 64px' }} />
                  </div>
                  <input value={neuArtikel.url} onChange={(e) => setNeuArtikel({ ...neuArtikel, url: e.target.value })} placeholder="Produkt-Link (dm/Amazon, optional)" style={INPUT} />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input value={neuArtikel.asin} onChange={(e) => setNeuArtikel({ ...neuArtikel, asin: e.target.value })} placeholder="Amazon-ASIN (optional)"
                      style={{ ...INPUT, flex: 1, minWidth: 0 }} />
                    <button className="mat-tap" onClick={() => {
                      const name = neuArtikel.name.trim()
                      if (!name) return
                      const eintrag: Artikel = {
                        id: Math.random().toString(36).slice(2, 10), name,
                        ...(neuArtikel.kategorie ? { kategorie: neuArtikel.kategorie } : {}),
                        ...(neuArtikel.url.trim() ? { url: neuArtikel.url.trim() } : {}),
                        ...(neuArtikel.asin.trim() ? { asin: neuArtikel.asin.trim() } : {}),
                        ...(parseInt(neuArtikel.menge) > 1 ? { menge: parseInt(neuArtikel.menge) } : {}),
                      }
                      patch({ artikel: [...data.artikel, eintrag] }, 'add')
                      setNeuArtikel({ name: '', kategorie: '', url: '', asin: '', menge: '1' })
                      showToast(`✓ ${name} zur Merkliste hinzugefügt`)
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

      {/* Toast (pointerEvents none — verdeckt nie einen Button, §263-Lektion) */}
      {toast && (
        <div style={{
          position: 'fixed', left: '50%', bottom: 'calc(max(20px, env(safe-area-inset-bottom)) + 12px)',
          transform: 'translateX(-50%)', zIndex: 95, pointerEvents: 'none',
          background: toast.ok ? NAVY : '#B91C1C', color: '#fff',
          borderRadius: 999, padding: '10px 18px', fontSize: 13, fontWeight: 700,
          boxShadow: '0 6px 24px rgba(0,0,0,0.25)', maxWidth: 'calc(100vw - 40px)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          animation: 'mat-toast-in 0.22s ease',
        }}>{toast.msg}</div>
      )}
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(body, document.body)
}
