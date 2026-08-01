'use client'

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'

/**
 * 💶 BUCHHALTUNG v2 (§242) — Vollbild-Oberfläche (nur Admins):
 * Master-Detail: Liste links, rechts Beleg-VIEWER (PDF) + Verbuchen-Werkbank
 * mit ✨-Steuer-Vorschlag (Kategorie, Steuersatz, GWG/AfA), automatischem
 * Zahlungs-Verknüpfungs-VORSCHLAG und interner Wohnungs-Zuordnung (nur
 * App-Auswertung — sevdesk-Kostenstelle bleibt der Standort, §240).
 */

interface InboxBeleg {
  id: string; mailbox: string | null; subject: string | null
  lieferant: string | null; betrag: number | null; datum: string | null
  belegnummer: string | null; kiHinweis: string | null
  links: { name: string; url: string }[]
}
interface Voucher {
  id: string; status: number; supplierName: string | null; description: string | null
  voucherDate: string | null; sumGross: number | null; costCentreName: string | null
}
interface Tx {
  id: string; bankAccountId: string; bankkonto: string; datum: string
  betrag: number; von: string; zweck: string; vorschlag: string | null
}
interface Kategorie { id: number; nr: string; name: string }
interface Wohnung { id: string; title: string; group: string | null }
interface ViewerInfo { links: { name: string; url: string }[]; zuordnung: Zuordnung | null; rowId: string }
interface Zuordnung { modus: 'allgemein' | 'standort' | 'wohnung' | 'split'; standort?: string; listingIds?: string[] }
interface KiVorschlag {
  accountDatevId: number; kategorie: string; nr: string; taxRate: number
  betrag: number | null; begruendung: string; steuerHinweis: string
  anlagegut: boolean; nutzungsdauer: number | null
}

const eur = (n: number) => n.toFixed(2).replace('.', ',') + ' €'
const fmtD = (iso: string | null) => {
  if (!iso) return null
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}
const betragAusText = (s: string | null): number | null => {
  const m = (s ?? '').match(/(\d{1,3}(?:\.\d{3})*,\d{2}|\d+\.\d{2})\s*€/)
  if (!m) return null
  // Deutsch „1.234,56" (Punkte = Tausender) vs. Punkt-Dezimal „55.00" —
  // Punkte nur strippen, wenn ein Komma da ist (sonst wurde 55.00 → 5500!)
  const raw = m[1].includes(',') ? m[1].replace(/\./g, '').replace(',', '.') : m[1]
  return Math.round(parseFloat(raw) * 100) / 100
}

const NAVY = '#12222E'
const GOLD = '#B0912B'
const INK = '#1A1814'
const MUTED = '#8A8578'
const HAIR = '0 0 0 0.5px rgba(60,60,67,0.12)'
const CARD: CSSProperties = { background: '#fff', borderRadius: 14, boxShadow: HAIR }
const SELECT: CSSProperties = {
  fontSize: 15, padding: '9px 10px', borderRadius: 10, width: '100%',
  border: '0.5px solid rgba(60,60,67,0.28)', background: '#fff', color: INK,
  minWidth: 0, maxWidth: '100%',
}
const LABEL: CSSProperties = { fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, color: MUTED, textTransform: 'uppercase' as const, marginBottom: 5 }
const BTN: CSSProperties = {
  fontSize: 14.5, fontWeight: 700, borderRadius: 10, padding: '11px 14px',
  border: 'none', cursor: 'pointer',
}

function Chip({ active, onClick, children, tone = 'dark' }: { active: boolean; onClick: () => void; children: ReactNode; tone?: 'dark' | 'gold' }) {
  return (
    <button onClick={onClick} style={{
      fontSize: 13, fontWeight: 600, padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
      border: '0.5px solid rgba(60,60,67,0.22)', whiteSpace: 'nowrap',
      background: active ? (tone === 'gold' ? GOLD : INK) : '#fff',
      color: active ? '#fff' : INK,
    }}>{children}</button>
  )
}

/** Interne Wohnungs-Zuordnung (App-Auswertung): Allgemein · Standort · Wohnung(en) */
function ZuordnungPicker({ value, onChange, wohnungen }: {
  value: Zuordnung | null
  onChange: (z: Zuordnung) => void
  wohnungen: Wohnung[]
}) {
  const groups = [...new Set(wohnungen.map((w) => w.group).filter(Boolean))] as string[]
  const z = value ?? { modus: 'allgemein' as const }
  const sel = new Set(z.listingIds ?? [])
  const toggleWohnung = (id: string) => {
    const next = new Set(sel)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    const ids = [...next]
    onChange(ids.length ? { modus: ids.length > 1 ? 'split' : 'wohnung', listingIds: ids } : { modus: 'allgemein' })
  }
  return (
    <div>
      <div style={LABEL}>Interne Zuordnung (Auswertung)</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        <Chip tone="gold" active={z.modus === 'allgemein'} onClick={() => onChange({ modus: 'allgemein' })}>Allgemein</Chip>
        {groups.map((g) => (
          <Chip key={g} tone="gold" active={z.modus === 'standort' && z.standort === g} onClick={() => onChange({ modus: 'standort', standort: g })}>📍 {g}</Chip>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {wohnungen.map((w) => (
          <Chip key={w.id} tone="gold" active={(z.modus === 'wohnung' || z.modus === 'split') && sel.has(w.id)} onClick={() => toggleWohnung(w.id)}>🏠 {w.title}</Chip>
        ))}
      </div>
      {z.modus === 'split' && (
        <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>
          Wird gleichmäßig auf {sel.size} Wohnungen aufgeteilt.
        </div>
      )}
    </div>
  )
}

function PdfViewer({ links }: { links: { name: string; url: string }[] }) {
  if (!links.length) {
    return (
      <div style={{ ...CARD, padding: 24, textAlign: 'center', color: MUTED, fontSize: 13.5 }}>
        📄 Keine PDF-Kopie in der App — der Beleg liegt in sevdesk.
        <div style={{ fontSize: 12, marginTop: 4 }}>Neue Belege aus dem Mail-Scan bringen ihre Kopie automatisch mit.</div>
      </div>
    )
  }
  return (
    <div style={{ ...CARD, overflow: 'hidden' }}>
      <iframe src={links[0].url} title={links[0].name} style={{ width: '100%', height: 'min(58vh, 620px)', border: 'none', display: 'block', background: '#525659' }} />
      <div style={{ display: 'flex', gap: 10, padding: '8px 12px', flexWrap: 'wrap' }}>
        {links.map((l) => (
          <a key={l.url} href={l.url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: GOLD, fontWeight: 600 }}>📄 {l.name} ↗</a>
        ))}
      </div>
    </div>
  )
}

export default function BuchhaltungClient() {
  const [section, setSection] = useState<'inbox' | 'belege' | 'zahlungen'>('belege')
  const [selId, setSelId] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  const [inbox, setInbox] = useState<InboxBeleg[]>([])
  const [vouchers, setVouchers] = useState<Voucher[]>([])
  const [viewer, setViewer] = useState<Record<string, ViewerInfo>>({})
  const [openTx, setOpenTx] = useState<Tx[]>([])
  const [kategorien, setKategorien] = useState<Kategorie[]>([])
  const [kostenstellen, setKostenstellen] = useState<string[]>(['Allgemein'])
  const [clearingLabels, setClearingLabels] = useState<string[]>([])
  const [wohnungen, setWohnungen] = useState<Wohnung[]>([])
  const [txDays, setTxDays] = useState(90)
  const [txRichtung, setTxRichtung] = useState<'alle' | 'eingang' | 'abbuchung'>('alle')

  // Verbuchen-Formular je Beleg + KI-Cache
  const [form, setForm] = useState<Record<string, { kat: string; tax: string; betrag: string; kst: string; txId: string; anlagegut: boolean; zuordnung: Zuordnung | null }>>({})
  const [ki, setKi] = useState<Record<string, KiVorschlag | 'laedt' | 'fehler'>>({})
  const [inboxKst, setInboxKst] = useState<Record<string, string>>({})
  const [inboxZuo, setInboxZuo] = useState<Record<string, Zuordnung | null>>({})
  const [transit, setTransit] = useState<Record<string, string>>({})

  // Hydration-sicher: erst nach Mount messen (SSR kennt kein window)
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 900)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const load = async (days = txDays) => {
    setLoading(true)
    try {
      const [bu, be] = await Promise.all([
        fetch(`/api/buchhaltung?days=${days}`, { cache: 'no-store' }).then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
        fetch('/api/belege', { cache: 'no-store' }).then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
      ])
      if (!bu.ok) throw new Error(bu.j.error ?? 'Buchhaltung nicht ladbar')
      setVouchers(bu.j.vouchers ?? [])
      setViewer(bu.j.viewer ?? {})
      setOpenTx(bu.j.openTx ?? [])
      setKategorien(bu.j.kategorien ?? [])
      setKostenstellen(bu.j.kostenstellen ?? ['Allgemein'])
      setClearingLabels(bu.j.clearingLabels ?? [])
      setWohnungen(bu.j.wohnungen ?? [])
      if (be.ok) setInbox(be.j.belege ?? [])
      setErr('')
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const post = async (body: Record<string, unknown>) => {
    const r = await fetch('/api/buchhaltung', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const j = await r.json()
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
    return j
  }

  // ── Zahlungs-Verknüpfungs-VORSCHLAG: offene Abbuchungen nach Betrags-Nähe ──
  const txKandidaten = (betrag: number | null) => {
    const debits = openTx.filter((t) => t.betrag < 0)
    if (!betrag) return debits.slice(0, 30)
    return [...debits].sort((a, b) =>
      Math.abs(Math.abs(a.betrag) - betrag) - Math.abs(Math.abs(b.betrag) - betrag)).slice(0, 30)
  }
  const exaktesMatch = (betrag: number | null) =>
    betrag ? openTx.find((t) => t.betrag < 0 && Math.abs(Math.abs(t.betrag) - betrag) < 0.01) ?? null : null

  const fOf = (v: Voucher) => form[v.id] ?? {
    kat: '', tax: '19',
    betrag: v.sumGross && v.sumGross > 0 ? String(v.sumGross) : (betragAusText(v.description) != null ? String(betragAusText(v.description)) : ''),
    kst: v.costCentreName ?? 'Allgemein',
    txId: '', anlagegut: false,
    zuordnung: (viewer[v.id]?.zuordnung ?? null),
  }
  const setF = (id: string, patch: Partial<ReturnType<typeof fOf>>) =>
    setForm((p) => ({ ...p, [id]: { ...(p[id] ?? fOf(vouchers.find((v) => v.id === id)!)), ...patch } }))

  // ✨ KI-Vorschlag automatisch beim Öffnen eines Belegs
  useEffect(() => {
    if (section !== 'belege' || !selId) return
    const v = vouchers.find((x) => x.id === selId)
    if (!v || ki[selId]) return
    setKi((p) => ({ ...p, [selId]: 'laedt' }))
    post({ action: 'ki-vorschlag', voucherId: selId }).then((j) => {
      setKi((p) => ({ ...p, [selId]: j as KiVorschlag }))
      const match = exaktesMatch(j.betrag ?? betragAusText(v.description))
      setF(selId, {
        kat: String(j.accountDatevId), tax: String(j.taxRate),
        ...(j.betrag ? { betrag: String(j.betrag) } : {}),
        ...(j.anlagegut ? { anlagegut: true } : {}),
        ...(match ? { txId: match.id } : {}),
      })
    }).catch(() => setKi((p) => ({ ...p, [selId]: 'fehler' })))
  }, [section, selId]) // eslint-disable-line react-hooks/exhaustive-deps

  const verbuchen = async (v: Voucher) => {
    const f = fOf(v)
    if (!f.kat) { setErr('Bitte eine Kategorie wählen (✨ schlägt vor).'); return }
    const betrag = parseFloat(f.betrag.replace(',', '.'))
    if (!Number.isFinite(betrag) || betrag <= 0) { setErr('Bitte einen Brutto-Betrag eingeben.'); return }
    const tx = openTx.find((t) => t.id === f.txId)
    setBusy(v.id); setErr('')
    try {
      const res = await post({
        action: 'verbuchen', voucherId: v.id, accountDatevId: Number(f.kat),
        taxRate: Number(f.tax), amountGross: betrag, kostenstelle: f.kst,
        anlagegut: f.anlagegut,
        ...(f.zuordnung ? { zuordnung: f.zuordnung } : {}),
        ...(tx ? { txId: tx.id, txAccountId: tx.bankAccountId, txDate: tx.datum } : {}),
      })
      setNotice(res.hinweis
        ? `✓ ${v.supplierName ?? 'Beleg'}: ${res.hinweis}`
        : `✓ ${v.supplierName ?? 'Beleg'} verbucht${res.verknuepft ? ' + Zahlung verknüpft' : ''}${f.anlagegut ? ' · als Anlagegut markiert' : ''}`)
      setSelId(null)
      await load()
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)) } finally { setBusy(null) }
  }

  const inboxDecide = async (b: InboxBeleg, ziel: 'sevdesk' | 'andere' | 'verworfen', bulk = false) => {
    if (bulk && !confirm(`Alle offenen Belege von „${b.lieferant}“ übernehmen?`)) return
    setBusy(bulk ? 'bulk-' + b.lieferant : b.id); setErr('')
    try {
      const r = await fetch('/api/belege', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(bulk ? { bulkLieferant: b.lieferant } : { id: b.id }), ziel,
          ...(ziel === 'sevdesk' ? { kostenstelle: inboxKst[b.id] ?? 'Allgemein' } : {}),
          ...(ziel === 'sevdesk' && inboxZuo[b.id] ? { zuordnung: inboxZuo[b.id] } : {}),
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      setInbox((p) => bulk ? p.filter((x) => x.lieferant !== b.lieferant) : p.filter((x) => x.id !== b.id))
      setSelId(null)
      if (ziel === 'sevdesk') await load()
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)) } finally { setBusy(null) }
  }

  const geldtransit = async (t: Tx) => {
    const label = transit[t.id] ?? t.vorschlag ?? ''
    if (!label) { setErr('Bitte ein Verrechnungskonto wählen.'); return }
    setBusy(t.id); setErr('')
    try {
      await post({ action: 'geldtransit', txId: t.id, clearingLabel: label })
      setOpenTx((p) => p.filter((x) => x.id !== t.id))
      setSelId(null)
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)) } finally { setBusy(null) }
  }
  const ignorieren = async (t: Tx) => {
    setBusy(t.id); setErr('')
    try {
      await post({ action: 'tx-ignorieren', txId: t.id })
      setOpenTx((p) => p.filter((x) => x.id !== t.id))
      setSelId(null)
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)) } finally { setBusy(null) }
  }

  const gefilterteTx = useMemo(() => openTx.filter((t) =>
    txRichtung === 'alle' ? true : txRichtung === 'eingang' ? t.betrag > 0 : t.betrag < 0), [openTx, txRichtung])

  const listeFuerSektion: { id: string; titel: string; sub: string; betrag: string | null; rot?: boolean }[] = useMemo(() => {
    if (section === 'inbox') return inbox.map((b) => ({
      id: b.id, titel: b.lieferant ?? '?', sub: `${fmtD(b.datum) ?? '—'} · ${(b.subject ?? '').slice(0, 44)}`,
      betrag: b.betrag != null ? eur(b.betrag) : null,
    }))
    if (section === 'belege') return vouchers.map((v) => ({
      id: v.id, titel: v.supplierName ?? '?', sub: `${fmtD(v.voucherDate) ?? '—'} · ${(v.description ?? '').replace(/^Beleg \(automatisch aus E-Mail\): /, '').slice(0, 44)}`,
      betrag: (v.sumGross && v.sumGross > 0 ? eur(v.sumGross) : (betragAusText(v.description) != null ? eur(betragAusText(v.description)!) : null)),
    }))
    return gefilterteTx.map((t) => ({
      id: t.id, titel: t.von || t.zweck.slice(0, 40) || '—', sub: `${fmtD(t.datum)} · ${t.bankkonto} · ${t.zweck.slice(0, 40)}`,
      betrag: eur(t.betrag), rot: t.betrag < 0,
    }))
  }, [section, inbox, vouchers, gefilterteTx])

  const sel = {
    inbox: inbox.find((b) => b.id === selId) ?? null,
    voucher: vouchers.find((v) => v.id === selId) ?? null,
    tx: gefilterteTx.find((t) => t.id === selId) ?? null,
  }
  const detailOffen = Boolean(selId && (sel.inbox || sel.voucher || sel.tx))

  // ── Detail-Inhalte ──
  const renderDetail = () => {
    if (section === 'inbox' && sel.inbox) {
      const b = sel.inbox
      const gleiche = inbox.filter((x) => x.lieferant === b.lieferant).length
      return (
        <div style={{ display: 'grid', gap: 14 }}>
          <PdfViewer links={b.links} />
          <div style={{ ...CARD, padding: 16, display: 'grid', gap: 14 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: INK }}>{b.lieferant ?? '?'} {b.betrag != null && <span style={{ color: GOLD }}>· {eur(b.betrag)}</span>}</div>
              <div style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>{fmtD(b.datum) ?? 'ohne Datum'}{b.belegnummer ? ` · Nr. ${b.belegnummer}` : ''} · aus {b.mailbox ?? 'Mail'}</div>
            </div>
            {b.kiHinweis && <div style={{ fontSize: 13, color: '#7A6520', background: '#FBF6E9', borderRadius: 10, padding: '9px 11px' }}>🤖 {b.kiHinweis}</div>}
            <div>
              <div style={LABEL}>sevdesk-Kostenstelle (Standort)</div>
              <select value={inboxKst[b.id] ?? 'Allgemein'} onChange={(e) => setInboxKst((p) => ({ ...p, [b.id]: e.target.value }))} style={SELECT}>
                {kostenstellen.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <ZuordnungPicker value={inboxZuo[b.id] ?? null} onChange={(z) => setInboxZuo((p) => ({ ...p, [b.id]: z }))} wohnungen={wohnungen} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => inboxDecide(b, 'sevdesk')} disabled={busy === b.id} style={{ ...BTN, flex: '2 1 180px', background: GOLD, color: '#fff' }}>{busy === b.id ? '⏳ …' : '→ sevdesk (A&H)'}</button>
              <button onClick={() => inboxDecide(b, 'andere')} disabled={busy === b.id} style={{ ...BTN, flex: 1, background: '#EEF2FF', color: '#3B5BDB' }}>Andere Gesellschaft</button>
              <button onClick={() => inboxDecide(b, 'verworfen')} disabled={busy === b.id} style={{ ...BTN, flex: 1, background: '#FEF2F2', color: '#B91C1C' }}>Kein Beleg</button>
            </div>
            {b.lieferant != null && gleiche > 2 && (
              <button onClick={() => inboxDecide(b, 'sevdesk', true)} disabled={busy === 'bulk-' + b.lieferant}
                style={{ ...BTN, background: '#F0FDF4', color: '#166534', border: '0.5px solid #BBF7D0' }}>
                {busy === 'bulk-' + b.lieferant ? '⏳ Sammel-Übernahme läuft…' : `⚡ Alle ${gleiche} von ${b.lieferant} → sevdesk (gleiche Einstellungen)`}
              </button>
            )}
          </div>
        </div>
      )
    }

    if (section === 'belege' && sel.voucher) {
      const v = sel.voucher
      const f = fOf(v)
      const k = ki[v.id]
      const betragNum = parseFloat(f.betrag.replace(',', '.'))
      const match = exaktesMatch(Number.isFinite(betragNum) ? betragNum : null)
      return (
        <div style={{ display: 'grid', gap: 14 }}>
          <PdfViewer links={viewer[v.id]?.links ?? []} />
          <div style={{ ...CARD, padding: 16, display: 'grid', gap: 14 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: INK }}>{v.supplierName ?? '?'}</div>
              <div style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>{fmtD(v.voucherDate) ?? 'ohne Datum'} · sevdesk-{v.status === 50 ? 'Entwurf' : 'Beleg (offen)'}</div>
            </div>

            {k === 'laedt' && <div style={{ fontSize: 13.5, color: MUTED }}>✨ Claude analysiert den Beleg…</div>}
            {k === 'fehler' && <div style={{ fontSize: 13.5, color: '#B91C1C' }}>✨ Vorschlag fehlgeschlagen — bitte manuell wählen.</div>}
            {k && k !== 'laedt' && k !== 'fehler' && (
              <div style={{ background: '#FBF6E9', border: '0.5px solid #E6D9AE', borderRadius: 12, padding: '11px 13px', display: 'grid', gap: 6 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: '#7A6520' }}>✨ Vorschlag: {k.kategorie} ({k.nr}) · {k.taxRate} % USt{k.betrag ? ` · ${eur(k.betrag)}` : ''}</div>
                {k.begruendung && <div style={{ fontSize: 12.5, color: '#7A6520' }}>{k.begruendung}</div>}
                {k.steuerHinweis && <div style={{ fontSize: 12.5, color: '#5C4D18', borderTop: '0.5px solid #E6D9AE', paddingTop: 6 }}>💡 Steuerlich: {k.steuerHinweis}</div>}
                {k.anlagegut && <div style={{ fontSize: 12.5, fontWeight: 700, color: '#9A3412' }}>🏗 Anlagegut — Abschreibung über {k.nutzungsdauer ?? '?'} Jahre (Häkchen unten ist gesetzt; Nutzungsdauer bestätigst du einmal in sevdesk).</div>}
              </div>
            )}

            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
              <div>
                <div style={LABEL}>Kategorie</div>
                <select value={f.kat} onChange={(e) => setF(v.id, { kat: e.target.value })} style={SELECT}>
                  <option value="">— wählen —</option>
                  {kategorien.map((kat) => <option key={kat.id} value={String(kat.id)}>{kat.nr} · {kat.name}</option>)}
                </select>
              </div>
              <div>
                <div style={LABEL}>Steuersatz</div>
                <select value={f.tax} onChange={(e) => setF(v.id, { tax: e.target.value })} style={SELECT}>
                  <option value="19">19 %</option><option value="7">7 %</option><option value="0">0 % (steuerfrei / §13b)</option>
                </select>
              </div>
              <div>
                <div style={LABEL}>Betrag (brutto)</div>
                <input value={f.betrag} onChange={(e) => setF(v.id, { betrag: e.target.value })} inputMode="decimal" placeholder="0,00" style={SELECT} />
              </div>
              <div>
                <div style={LABEL}>sevdesk-Kostenstelle</div>
                <select value={f.kst} onChange={(e) => setF(v.id, { kst: e.target.value })} style={SELECT}>
                  {kostenstellen.map((kk) => <option key={kk} value={kk}>{kk}</option>)}
                </select>
              </div>
            </div>

            <label style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 14, color: INK, cursor: 'pointer' }}>
              <input type="checkbox" checked={f.anlagegut} onChange={(e) => setF(v.id, { anlagegut: e.target.checked })} style={{ width: 18, height: 18 }} />
              🏗 Als Anlagegut buchen (Abschreibung — sevdesk legt es im Anlagenmodul an)
            </label>

            <div>
              <div style={LABEL}>Zahlung zuordnen</div>
              {match && f.txId === match.id && (
                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#166534', marginBottom: 5 }}>✓ Vorschlag: Abbuchung {eur(match.betrag)} vom {fmtD(match.datum)} passt exakt</div>
              )}
              <select value={f.txId} onChange={(e) => setF(v.id, { txId: e.target.value })} style={SELECT}>
                <option value="">— keine (später über den Bankabgleich) —</option>
                {txKandidaten(Number.isFinite(betragNum) ? betragNum : null).map((t) => (
                  <option key={t.id} value={t.id}>{fmtD(t.datum)} · {eur(t.betrag)} · {(t.von || t.zweck).slice(0, 40)}</option>
                ))}
              </select>
            </div>

            <ZuordnungPicker value={f.zuordnung} onChange={(z) => setF(v.id, { zuordnung: z })} wohnungen={wohnungen} />

            <button onClick={() => verbuchen(v)} disabled={busy === v.id} style={{ ...BTN, background: GOLD, color: '#fff', fontSize: 15.5, padding: '13px 16px' }}>
              {busy === v.id ? '⏳ Verbuche…' : `✓ Verbuchen${f.txId ? ' + Zahlung zuordnen' : ''}`}
            </button>
          </div>
        </div>
      )
    }

    if (section === 'zahlungen' && sel.tx) {
      const t = sel.tx
      return (
        <div style={{ ...CARD, padding: 16, display: 'grid', gap: 14 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: t.betrag < 0 ? '#B91C1C' : '#166534' }}>{eur(t.betrag)}</div>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: INK, marginTop: 2 }}>{t.von || '—'}</div>
            <div style={{ fontSize: 13, color: MUTED }}>{fmtD(t.datum)} · {t.bankkonto}</div>
            {t.zweck && <div style={{ fontSize: 13, color: INK, marginTop: 6 }}>{t.zweck}</div>}
          </div>
          {t.betrag < 0 && (
            <div style={{ fontSize: 13, color: MUTED, background: '#F7F5F0', borderRadius: 10, padding: '9px 11px' }}>
              Abbuchung ohne Beleg? Der Beleg kommt per Mail-Scan oder Foto — die Verknüpfung passiert beim Verbuchen im Belege-Bereich.
            </div>
          )}
          {t.betrag > 0 && (
            <div>
              <div style={LABEL}>Geldtransit (Portal-Auszahlung → Verrechnungskonto)</div>
              <select value={transit[t.id] ?? t.vorschlag ?? ''} onChange={(e) => setTransit((p) => ({ ...p, [t.id]: e.target.value }))} style={SELECT}>
                <option value="">— wählen —</option>
                {clearingLabels.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <button onClick={() => geldtransit(t)} disabled={busy === t.id} style={{ ...BTN, background: NAVY, color: '#fff', marginTop: 10, width: '100%' }}>
                {busy === t.id ? '⏳ …' : '↔ Als Geldtransit buchen'}
              </button>
            </div>
          )}
          <button onClick={() => ignorieren(t)} disabled={busy === t.id} style={{ ...BTN, background: '#F1F0EC', color: INK }}>Kein Beleg nötig (privat / intern)</button>
        </div>
      )
    }

    return (
      <div style={{ textAlign: 'center', color: MUTED, padding: '80px 20px', fontSize: 14.5 }}>
        {section === 'inbox' && '📥 Beleg links auswählen — Gesellschaft & Zuordnung entscheiden.'}
        {section === 'belege' && '🧾 Beleg links auswählen — ✨ schlägt Kategorie, Steuer & Zahlung automatisch vor.'}
        {section === 'zahlungen' && '💳 Zahlung links auswählen.'}
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#F1EFE9', display: 'flex', flexDirection: 'column' }}>
      {/* ── Kopfleiste ── */}
      <header style={{ background: NAVY, color: '#fff', padding: 'max(10px, env(safe-area-inset-top)) 16px 10px', position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, maxWidth: 1280, margin: '0 auto' }}>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: 0.3 }}>💶 Buchhaltung</div>
          <div style={{ fontSize: 11, color: '#E3C878', letterSpacing: 2, fontWeight: 700 }}>TRIMOSA</div>
          <div style={{ flex: 1 }} />
          <button onClick={() => load()} title="Aktualisieren" style={{ background: 'none', border: 'none', color: '#fff', fontSize: 17, cursor: 'pointer' }}>↻</button>
          <a href="/team" style={{ fontSize: 13, color: '#E3C878', fontWeight: 700, textDecoration: 'none' }}>← Team-App</a>
        </div>
        <div style={{ display: 'flex', gap: 8, maxWidth: 1280, margin: '10px auto 0', overflowX: 'auto' }}>
          {([['inbox', `📥 Inbox${inbox.length ? ` · ${inbox.length}` : ''}`], ['belege', `🧾 Belege${vouchers.length ? ` · ${vouchers.length}` : ''}`], ['zahlungen', `💳 Zahlungen${openTx.length ? ` · ${openTx.length}` : ''}`]] as const).map(([key, label]) => (
            <button key={key} onClick={() => { setSection(key); setSelId(null) }} style={{
              fontSize: 13.5, fontWeight: 700, padding: '7px 14px', borderRadius: 999, cursor: 'pointer',
              border: 'none', whiteSpace: 'nowrap',
              background: section === key ? '#fff' : 'rgba(255,255,255,0.12)',
              color: section === key ? NAVY : '#fff',
            }}>{label}</button>
          ))}
        </div>
      </header>

      {err && (
        <div style={{ maxWidth: 1280, margin: '10px auto 0', padding: '0 16px', width: '100%', boxSizing: 'border-box' }}>
          <div style={{ background: '#FEF2F2', color: '#B91C1C', borderRadius: 10, padding: '9px 12px', fontSize: 13.5, display: 'flex', gap: 10 }}>
            <span style={{ flex: 1 }}>{err}</span>
            <button onClick={() => setErr('')} style={{ background: 'none', border: 'none', color: '#B91C1C', cursor: 'pointer', fontWeight: 700 }}>✕</button>
          </div>
        </div>
      )}
      {notice && (
        <div style={{ maxWidth: 1280, margin: '10px auto 0', padding: '0 16px', width: '100%', boxSizing: 'border-box' }}>
          <div style={{ background: '#F0FDF4', color: '#166534', borderRadius: 10, padding: '9px 12px', fontSize: 13.5, display: 'flex', gap: 10 }}>
            <span style={{ flex: 1 }}>{notice}</span>
            <button onClick={() => setNotice('')} style={{ background: 'none', border: 'none', color: '#166534', cursor: 'pointer', fontWeight: 700 }}>✕</button>
          </div>
        </div>
      )}

      {/* ── Inhalt: Liste + Detail ── */}
      <main style={{ flex: 1, maxWidth: 1280, margin: '0 auto', width: '100%', boxSizing: 'border-box', padding: '14px 16px 40px', display: 'grid', gap: 16, gridTemplateColumns: isMobile ? '1fr' : '360px 1fr', alignItems: 'start' }}>
        {/* Liste */}
        <div style={{ display: (isMobile && detailOffen) ? 'none' : 'block' }}>
          {section === 'zahlungen' && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              <Chip active={txRichtung === 'alle'} onClick={() => setTxRichtung('alle')}>Alle</Chip>
              <Chip active={txRichtung === 'eingang'} onClick={() => setTxRichtung('eingang')}>Eingänge</Chip>
              <Chip active={txRichtung === 'abbuchung'} onClick={() => setTxRichtung('abbuchung')}>Abbuchungen</Chip>
              <span style={{ flexBasis: '100%' }} />
              {[45, 90, 180, 365].map((n) => (
                <Chip key={n} active={txDays === n} onClick={() => { setTxDays(n); load(n) }}>{n === 365 ? 'Jahr' : `${n} Tage`}</Chip>
              ))}
            </div>
          )}
          {loading && <div style={{ color: MUTED, fontSize: 13.5, padding: 20 }}>⏳ Lädt…</div>}
          {!loading && !listeFuerSektion.length && (
            <div style={{ ...CARD, padding: 24, textAlign: 'center', color: MUTED, fontSize: 14 }}>🎉 Hier ist alles erledigt.</div>
          )}
          <div style={{ display: 'grid', gap: 8 }}>
            {listeFuerSektion.map((item) => (
              <button key={item.id} onClick={() => setSelId(item.id)} style={{
                ...CARD, textAlign: 'left', padding: '11px 13px', cursor: 'pointer', border: 'none',
                outline: selId === item.id ? `2px solid ${GOLD}` : 'none',
              }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                  <div style={{ flex: 1, fontSize: 14.5, fontWeight: 700, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.titel}</div>
                  {item.betrag && <div style={{ fontSize: 14, fontWeight: 700, color: item.rot ? '#B91C1C' : (section === 'zahlungen' ? '#166534' : GOLD), whiteSpace: 'nowrap' }}>{item.betrag}</div>}
                </div>
                <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.sub}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Detail */}
        <div style={{ display: (isMobile && !detailOffen) ? 'none' : 'block' }}>
          {isMobile && detailOffen && (
            <button onClick={() => setSelId(null)} style={{ background: 'none', border: 'none', color: GOLD, fontWeight: 700, fontSize: 14.5, cursor: 'pointer', padding: '0 0 10px' }}>‹ Zurück zur Liste</button>
          )}
          {renderDetail()}
        </div>
      </main>
    </div>
  )
}
