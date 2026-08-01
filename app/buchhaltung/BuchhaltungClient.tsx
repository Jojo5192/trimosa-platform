'use client'

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { haptic, SkeletonRows } from '@/components/team/ux'

/**
 * 💶 BUCHHALTUNG v2 (§242) — Vollbild-Oberfläche (nur Admins), iOS-Look:
 * Inset-Grouped-Listen, Segmented Control, Beleg-VIEWER (PDF), Werkbank mit
 * ✨-Steuer-Vorschlag, automatischem Zahlungs-Vorschlag und interner
 * Wohnungs-Zuordnung (App-Auswertung — sevdesk-KSt bleibt Standort, §240).
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
interface Zuordnung { modus: 'allgemein' | 'standort' | 'wohnung' | 'split'; standort?: string; listingIds?: string[]; anteile?: number[] }
interface KiVorschlag {
  accountDatevId: number; kategorie: string; nr: string; taxRate: number
  betrag: number | null; begruendung: string; steuerHinweis: string
  anlagegut: boolean; nutzungsdauer: number | null
}

const eur = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const fmtD = (iso: string | null) => {
  if (!iso) return null
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}
const betragAusText = (s: string | null): number | null => {
  const m = (s ?? '').match(/(\d{1,3}(?:\.\d{3})*,\d{2}|\d+\.\d{2})\s*€/)
  if (!m) return null
  // Deutsch „1.234,56" vs. Punkt-Dezimal „55.00" — Punkte nur strippen,
  // wenn ein Komma da ist (sonst wurde 55.00 → 5500!)
  const raw = m[1].includes(',') ? m[1].replace(/\./g, '').replace(',', '.') : m[1]
  return Math.round(parseFloat(raw) * 100) / 100
}

const NAVY = '#12222E'
const GOLD = '#B0912B'
const GOLDL = '#E3C878'
const INK = '#1A1814'
const SUB = 'rgba(60,60,67,0.6)'
const HAIRLINE = 'rgba(60,60,67,0.29)'
const GROUP_BG = '#F2F2F7'
const RED = '#D70015'
const GREEN = '#248A3D'

const CARD: CSSProperties = { background: '#fff', borderRadius: 16, overflow: 'hidden' }
const SELECT: CSSProperties = {
  fontSize: 16, padding: '10px 12px', borderRadius: 11, width: '100%',
  border: `0.5px solid ${HAIRLINE}`, background: '#fff', color: INK,
  minWidth: 0, maxWidth: '100%',
}
const LABEL: CSSProperties = {
  fontSize: 12, fontWeight: 600, letterSpacing: 0.6, color: SUB,
  textTransform: 'uppercase' as const, margin: '0 4px 6px',
}
const BTN: CSSProperties = {
  fontSize: 16, fontWeight: 600, borderRadius: 12, padding: '13px 16px',
  border: 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
}

/** iOS-Switch (Muster ⚙️-Tab) */
function IosSwitch({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button onClick={() => { haptic(); onChange() }} aria-checked={on} role="switch" style={{
      width: 51, height: 31, borderRadius: 999, border: 'none', cursor: 'pointer',
      background: on ? '#34C759' : 'rgba(120,120,128,0.16)', position: 'relative',
      transition: 'background .18s', flexShrink: 0, WebkitTapHighlightColor: 'transparent',
    }}>
      <span style={{
        position: 'absolute', top: 2, left: on ? 22 : 2, width: 27, height: 27,
        borderRadius: '50%', background: '#fff', transition: 'left .18s',
        boxShadow: '0 2px 6px rgba(0,0,0,0.22)',
      }} />
    </button>
  )
}

/** Kontakte-Stil: getönte Initial-Kachel je Lieferant */
const TINTS = ['#5E5CE6', '#0A84FF', '#30B0C7', '#248A3D', '#FF9F0A', '#BF5AF2', '#FF6482', '#8E8E93']
function Avatar({ name }: { name: string }) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const tint = TINTS[h % TINTS.length]
  return (
    <span style={{
      width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: 'inline-flex',
      alignItems: 'center', justifyContent: 'center', fontSize: 17,
      fontWeight: 700, color: '#fff', background: tint,
    }}>{(name.trim()[0] ?? '?').toUpperCase()}</span>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={() => { haptic(); onClick() }} style={{
      fontSize: 14, fontWeight: 600, padding: '7px 13px', borderRadius: 999, cursor: 'pointer',
      border: 'none', whiteSpace: 'nowrap', WebkitTapHighlightColor: 'transparent',
      background: active ? INK : 'rgba(118,118,128,0.12)',
      color: active ? '#fff' : INK, transition: 'background .15s',
    }}>{children}</button>
  )
}
function GoldChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={() => { haptic(); onClick() }} style={{
      fontSize: 13.5, fontWeight: 600, padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
      border: active ? `1.5px solid ${GOLD}` : `0.5px solid ${HAIRLINE}`, whiteSpace: 'nowrap',
      background: active ? '#FBF6E9' : '#fff', color: active ? '#7A6520' : INK,
      WebkitTapHighlightColor: 'transparent',
    }}>{children}</button>
  )
}

/** Interne Wohnungs-Zuordnung: Allgemein · Standort · Wohnung(en) */
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
    // Auswahl ändert sich → Gewichte zurück auf gleichmäßig
    onChange(ids.length ? { modus: ids.length > 1 ? 'split' : 'wohnung', listingIds: ids } : { modus: 'allgemein' })
  }
  const anteilVon = (i: number) => z.anteile?.[i] ?? Math.round(1000 / (z.listingIds?.length ?? 1)) / 10
  const setAnteil = (i: number, val: number) => {
    const n = z.listingIds?.length ?? 0
    const basis = z.listingIds?.map((_, idx) => z.anteile?.[idx] ?? Math.round(1000 / n) / 10) ?? []
    basis[i] = Math.max(0, Math.min(100, val))
    onChange({ ...z, modus: 'split', anteile: basis })
  }
  const anteilSumme = z.modus === 'split'
    ? (z.listingIds ?? []).reduce((acc, _, i) => acc + anteilVon(i), 0)
    : 100
  return (
    <div>
      <div style={LABEL}>Interne Zuordnung · Auswertung</div>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        <GoldChip active={z.modus === 'allgemein'} onClick={() => onChange({ modus: 'allgemein' })}>Allgemein</GoldChip>
        {groups.map((g) => (
          <GoldChip key={g} active={z.modus === 'standort' && z.standort === g} onClick={() => onChange({ modus: 'standort', standort: g })}>📍 {g}</GoldChip>
        ))}
        {wohnungen.map((w) => (
          <GoldChip key={w.id} active={(z.modus === 'wohnung' || z.modus === 'split') && sel.has(w.id)} onClick={() => toggleWohnung(w.id)}>{w.title}</GoldChip>
        ))}
      </div>
      {z.modus === 'split' && (
        <div style={{ marginTop: 9, display: 'grid', gap: 6 }}>
          {(z.listingIds ?? []).map((id, i) => {
            const w = wohnungen.find((x) => x.id === id)
            return (
              <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ flex: 1, fontSize: 13.5, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w?.title ?? '?'}</span>
                <input type="number" min={0} max={100} step={0.5} value={anteilVon(i)}
                  onChange={(e) => setAnteil(i, parseFloat(e.target.value) || 0)}
                  style={{ ...SELECT, width: 84, textAlign: 'right' as const, padding: '7px 9px' }} />
                <span style={{ fontSize: 13.5, color: SUB }}>%</span>
              </div>
            )
          })}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, margin: '2px 4px 0' }}>
            <span style={{ color: Math.abs(anteilSumme - 100) < 0.5 ? SUB : '#B45309', fontWeight: Math.abs(anteilSumme - 100) < 0.5 ? 400 : 700 }}>
              Summe {anteilSumme.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %{Math.abs(anteilSumme - 100) >= 0.5 ? ' — sollte 100 % sein' : ''}
            </span>
            {z.anteile && (
              <button onClick={() => onChange({ modus: 'split', listingIds: z.listingIds })} style={{ background: 'none', border: 'none', color: GOLD, fontWeight: 600, fontSize: 12.5, cursor: 'pointer', padding: 0 }}>Gleichmäßig</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function PdfViewer({ links }: { links: { name: string; url: string }[] }) {
  // Mobil/iOS rendert PDFs in iframes NICHT (leere graue Fläche) → dort
  // tippbare Datei-Karten; der System-Viewer im neuen Tab ist auf dem
  // iPhone ohnehin die beste PDF-Ansicht. (Nur nach Interaktion gerendert
  // — window ist hier immer verfügbar.)
  const mobil = typeof window !== 'undefined' && window.innerWidth < 900
  if (!links.length) {
    return (
      <div style={{ ...CARD, padding: '22px 20px', textAlign: 'center', color: SUB, fontSize: 13.5 }}>
        📄 Keine PDF-Kopie in der App — der Beleg liegt in sevdesk.
        <div style={{ fontSize: 12, marginTop: 4 }}>Neue Belege aus dem Mail-Scan bringen ihre Kopie automatisch mit.</div>
      </div>
    )
  }
  if (mobil) {
    return (
      <div style={CARD}>
        {links.map((l, i) => (
          <a key={l.url} href={l.url} target="_blank" rel="noreferrer" style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px',
            textDecoration: 'none', boxShadow: i < links.length - 1 ? `inset 0 -0.5px 0 ${HAIRLINE}` : 'none',
          }}>
            <span style={{
              width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 19,
              background: 'rgba(176,145,43,0.14)',
            }}>📄</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
              <span style={{ display: 'block', fontSize: 12.5, color: SUB, marginTop: 1 }}>Antippen zum Ansehen</span>
            </span>
            <span style={{ fontSize: 14, fontWeight: 700, color: GOLD }}>Öffnen ↗</span>
          </a>
        ))}
      </div>
    )
  }
  return (
    <div style={CARD}>
      <iframe src={links[0].url} title={links[0].name} style={{ width: '100%', height: 'min(56vh, 600px)', border: 'none', display: 'block', background: '#3A3A3C' }} />
      <div style={{ display: 'flex', gap: 12, padding: '10px 14px', flexWrap: 'wrap', boxShadow: `inset 0 0.5px 0 ${HAIRLINE}` }}>
        {links.map((l) => (
          <a key={l.url} href={l.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: GOLD, fontWeight: 600, textDecoration: 'none' }}>📄 {l.name} ↗</a>
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
        // §242b: Gelerntes übernimmt auch KSt + interne Zuordnung
        ...(typeof j.kst === 'string' && j.kst ? { kst: j.kst } : {}),
        ...(j.zuordnung ? { zuordnung: j.zuordnung } : {}),
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
        anlagegut: f.anlagegut, lieferant: v.supplierName,
        ...(f.zuordnung ? { zuordnung: f.zuordnung } : {}),
        ...(tx ? { txId: tx.id, txAccountId: tx.bankAccountId, txDate: tx.datum } : {}),
      })
      haptic()
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
      haptic()
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
      haptic()
      setOpenTx((p) => p.filter((x) => x.id !== t.id))
      setSelId(null)
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)) } finally { setBusy(null) }
  }
  const ignorieren = async (t: Tx) => {
    setBusy(t.id); setErr('')
    try {
      await post({ action: 'tx-ignorieren', txId: t.id })
      haptic()
      setOpenTx((p) => p.filter((x) => x.id !== t.id))
      setSelId(null)
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)) } finally { setBusy(null) }
  }

  const gefilterteTx = useMemo(() => openTx.filter((t) =>
    txRichtung === 'alle' ? true : txRichtung === 'eingang' ? t.betrag > 0 : t.betrag < 0), [openTx, txRichtung])

  interface Row { id: string; titel: string; sub: string; betrag: string | null; farbe: string; avatar: ReactNode }
  const rows: Row[] = useMemo(() => {
    if (section === 'inbox') return inbox.map((b) => ({
      id: b.id, titel: b.lieferant ?? '?',
      sub: `${fmtD(b.datum) ?? '—'} · ${(b.subject ?? '').slice(0, 48)}`,
      betrag: b.betrag != null ? eur(b.betrag) : null, farbe: INK,
      avatar: <Avatar name={b.lieferant ?? '?'} />,
    }))
    if (section === 'belege') return vouchers.map((v) => {
      const betrag = v.sumGross && v.sumGross > 0 ? v.sumGross : betragAusText(v.description)
      return {
        id: v.id, titel: v.supplierName ?? '?',
        sub: `${fmtD(v.voucherDate) ?? '—'} · ${(v.description ?? '').replace(/^(Beleg|Provisionsrechnung) \((automatisch aus E-Mail|aus Beleg-Inbox)\): /, '').slice(0, 48)}`,
        betrag: betrag != null ? eur(betrag) : null, farbe: INK,
        avatar: <Avatar name={v.supplierName ?? '?'} />,
      }
    })
    return gefilterteTx.map((t) => ({
      id: t.id, titel: t.von || t.zweck.slice(0, 40) || '—',
      sub: `${fmtD(t.datum)} · ${t.bankkonto}${t.zweck ? ' · ' + t.zweck.slice(0, 38) : ''}`,
      betrag: (t.betrag > 0 ? '+' : '') + eur(t.betrag), farbe: t.betrag < 0 ? INK : GREEN,
      avatar: (
        <span style={{
          width: 40, height: 40, borderRadius: '50%', flexShrink: 0, display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 700,
          background: t.betrag < 0 ? 'rgba(215,0,21,0.10)' : 'rgba(36,138,61,0.12)',
          color: t.betrag < 0 ? RED : GREEN,
        }}>{t.betrag < 0 ? '↑' : '↓'}</span>
      ),
    }))
  }, [section, inbox, vouchers, gefilterteTx])

  const sel = {
    inbox: inbox.find((b) => b.id === selId) ?? null,
    voucher: vouchers.find((v) => v.id === selId) ?? null,
    tx: gefilterteTx.find((t) => t.id === selId) ?? null,
  }
  const detailOffen = Boolean(selId && (sel.inbox || sel.voucher || sel.tx))

  const Banner = ({ text, tone, onClose }: { text: string; tone: 'rot' | 'gruen'; onClose: () => void }) => (
    <div style={{ maxWidth: 1240, margin: '12px auto 0', padding: '0 16px', width: '100%', boxSizing: 'border-box' }}>
      <div style={{
        background: tone === 'rot' ? '#FFEBE9' : '#E9F8EE', color: tone === 'rot' ? RED : GREEN,
        borderRadius: 12, padding: '11px 14px', fontSize: 14, display: 'flex', gap: 10, alignItems: 'center',
      }}>
        <span style={{ flex: 1 }}>{text}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 700, fontSize: 15 }}>✕</button>
      </div>
    </div>
  )

  // ── Detail-Inhalte ──
  const renderDetail = () => {
    if (section === 'inbox' && sel.inbox) {
      const b = sel.inbox
      const gleiche = inbox.filter((x) => x.lieferant === b.lieferant).length
      return (
        <div style={{ display: 'grid', gap: 14 }}>
          <PdfViewer links={b.links} />
          <div style={{ ...CARD, padding: 18, display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Avatar name={b.lieferant ?? '?'} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 19, fontWeight: 700, color: INK, letterSpacing: -0.3 }}>{b.lieferant ?? '?'}</div>
                <div style={{ fontSize: 13, color: SUB, marginTop: 1 }}>{fmtD(b.datum) ?? 'ohne Datum'}{b.belegnummer ? ` · Nr. ${b.belegnummer}` : ''} · {b.mailbox ?? 'Mail'}</div>
              </div>
              {b.betrag != null && <div style={{ marginLeft: 'auto', fontSize: 20, fontWeight: 700, color: INK, fontVariantNumeric: 'tabular-nums' }}>{eur(b.betrag)}</div>}
            </div>
            {b.kiHinweis && <div style={{ fontSize: 13.5, color: '#7A6520', background: '#FBF6E9', borderRadius: 12, padding: '10px 13px', lineHeight: 1.45 }}>🤖 {b.kiHinweis}</div>}
            <div>
              <div style={LABEL}>sevdesk-Kostenstelle · Standort</div>
              <select value={inboxKst[b.id] ?? 'Allgemein'} onChange={(e) => setInboxKst((p) => ({ ...p, [b.id]: e.target.value }))} style={SELECT}>
                {kostenstellen.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <ZuordnungPicker value={inboxZuo[b.id] ?? null} onChange={(z) => setInboxZuo((p) => ({ ...p, [b.id]: z }))} wohnungen={wohnungen} />
            <div style={{ display: 'grid', gap: 9 }}>
              <button onClick={() => inboxDecide(b, 'sevdesk')} disabled={busy === b.id} style={{ ...BTN, background: GOLD, color: '#fff' }}>{busy === b.id ? '⏳ Übernehme…' : '→ sevdesk (Apartments & Homes)'}</button>
              <div style={{ display: 'flex', gap: 9 }}>
                <button onClick={() => inboxDecide(b, 'andere')} disabled={busy === b.id} style={{ ...BTN, flex: 1, background: 'rgba(10,132,255,0.12)', color: '#0A84FF' }}>Andere Gesellschaft</button>
                <button onClick={() => inboxDecide(b, 'verworfen')} disabled={busy === b.id} style={{ ...BTN, flex: 1, background: 'rgba(215,0,21,0.08)', color: RED }}>Kein Beleg</button>
              </div>
              {b.lieferant != null && gleiche > 2 && (
                <button onClick={() => inboxDecide(b, 'sevdesk', true)} disabled={busy === 'bulk-' + b.lieferant}
                  style={{ ...BTN, background: 'rgba(36,138,61,0.10)', color: GREEN }}>
                  {busy === 'bulk-' + b.lieferant ? '⏳ Sammel-Übernahme läuft…' : `⚡ Alle ${gleiche} von ${b.lieferant} übernehmen`}
                </button>
              )}
            </div>
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
          <div style={{ ...CARD, padding: 18, display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Avatar name={v.supplierName ?? '?'} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 19, fontWeight: 700, color: INK, letterSpacing: -0.3 }}>{v.supplierName ?? '?'}</div>
                <div style={{ fontSize: 13, color: SUB, marginTop: 1 }}>{fmtD(v.voucherDate) ?? 'ohne Datum'} · {v.status === 50 ? 'Entwurf' : v.status === 750 ? 'teilbezahlt' : 'offen'}</div>
              </div>
            </div>

            {k === 'laedt' && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14, color: SUB }}>
                <span className="team-ptr-spin" style={{ display: 'inline-block' }}>⟳</span> Claude liest den Beleg (bei PDF bis ~20 s)…
              </div>
            )}
            {k === 'fehler' && <div style={{ fontSize: 14, color: RED }}>✨ Vorschlag fehlgeschlagen — bitte manuell wählen.</div>}
            {k && k !== 'laedt' && k !== 'fehler' && (
              <div style={{ background: '#FBF6E9', borderRadius: 14, padding: '12px 14px', display: 'grid', gap: 7 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#7A6520' }}>✨ {k.kategorie} ({k.nr}) · {k.taxRate} % USt{k.betrag ? ` · ${eur(k.betrag)}` : ''}</div>
                {k.begruendung && <div style={{ fontSize: 13, color: '#7A6520', lineHeight: 1.45 }}>{k.begruendung}</div>}
                {k.steuerHinweis && <div style={{ fontSize: 13, color: '#5C4D18', lineHeight: 1.45, borderTop: '0.5px solid #E6D9AE', paddingTop: 7 }}>💡 {k.steuerHinweis}</div>}
                {k.anlagegut && <div style={{ fontSize: 13, fontWeight: 700, color: '#9A3412' }}>🏗 Anlagegut — Abschreibung über {k.nutzungsdauer ?? '?'} Jahre. Der Schalter unten ist gesetzt; die Nutzungsdauer bestätigst du einmal in sevdesk.</div>}
              </div>
            )}

            <div style={{ display: 'grid', gap: 13, gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))' }}>
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
                  <option value="19">19 %</option><option value="7">7 %</option><option value="0">0 % · steuerfrei / §13b</option>
                </select>
              </div>
              <div>
                <div style={LABEL}>Betrag brutto</div>
                <input value={f.betrag} onChange={(e) => setF(v.id, { betrag: e.target.value })} inputMode="decimal" placeholder="0,00" style={SELECT} />
              </div>
              <div>
                <div style={LABEL}>sevdesk-Kostenstelle</div>
                <select value={f.kst} onChange={(e) => setF(v.id, { kst: e.target.value })} style={SELECT}>
                  {kostenstellen.map((kk) => <option key={kk} value={kk}>{kk}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15.5, fontWeight: 600, color: INK }}>🏗 Anlagegut</div>
                <div style={{ fontSize: 12.5, color: SUB }}>Abschreibung — sevdesk legt es im Anlagenmodul an</div>
              </div>
              <IosSwitch on={f.anlagegut} onChange={() => setF(v.id, { anlagegut: !f.anlagegut })} />
            </div>

            <div>
              <div style={LABEL}>Zahlung zuordnen</div>
              {match && f.txId === match.id && (
                <div style={{ fontSize: 13, fontWeight: 700, color: GREEN, margin: '0 4px 6px' }}>✓ Vorschlag: Abbuchung {eur(match.betrag)} vom {fmtD(match.datum)} passt exakt</div>
              )}
              <select value={f.txId} onChange={(e) => setF(v.id, { txId: e.target.value })} style={SELECT}>
                <option value="">— keine · später über den Bankabgleich —</option>
                {txKandidaten(Number.isFinite(betragNum) ? betragNum : null).map((t) => (
                  <option key={t.id} value={t.id}>{fmtD(t.datum)} · {eur(t.betrag)} · {(t.von || t.zweck).slice(0, 40)}</option>
                ))}
              </select>
            </div>

            <ZuordnungPicker value={f.zuordnung} onChange={(z) => setF(v.id, { zuordnung: z })} wohnungen={wohnungen} />

            <button onClick={() => verbuchen(v)} disabled={busy === v.id} style={{ ...BTN, background: GOLD, color: '#fff', fontSize: 16.5 }}>
              {busy === v.id ? '⏳ Verbuche…' : `Verbuchen${f.txId ? ' + Zahlung zuordnen' : ''}`}
            </button>
          </div>
        </div>
      )
    }

    if (section === 'zahlungen' && sel.tx) {
      const t = sel.tx
      return (
        <div style={{ ...CARD, padding: 18, display: 'grid', gap: 16 }}>
          <div style={{ textAlign: 'center', padding: '6px 0 2px' }}>
            <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.5, color: t.betrag < 0 ? INK : GREEN, fontVariantNumeric: 'tabular-nums' }}>{(t.betrag > 0 ? '+' : '') + eur(t.betrag)}</div>
            <div style={{ fontSize: 15.5, fontWeight: 600, color: INK, marginTop: 4 }}>{t.von || '—'}</div>
            <div style={{ fontSize: 13, color: SUB, marginTop: 2 }}>{fmtD(t.datum)} · {t.bankkonto}</div>
            {t.zweck && <div style={{ fontSize: 13.5, color: INK, marginTop: 8, lineHeight: 1.4 }}>{t.zweck}</div>}
          </div>
          {t.betrag < 0 && (
            <div style={{ fontSize: 13, color: SUB, background: GROUP_BG, borderRadius: 12, padding: '10px 13px', lineHeight: 1.45 }}>
              Abbuchung ohne Beleg? Der Beleg kommt per Mail-Scan oder Foto — die Verknüpfung passiert beim Verbuchen im Belege-Bereich.
            </div>
          )}
          {t.betrag > 0 && (
            <div>
              <div style={LABEL}>Geldtransit · Portal-Auszahlung → Verrechnungskonto</div>
              <select value={transit[t.id] ?? t.vorschlag ?? ''} onChange={(e) => setTransit((p) => ({ ...p, [t.id]: e.target.value }))} style={SELECT}>
                <option value="">— wählen —</option>
                {clearingLabels.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <button onClick={() => geldtransit(t)} disabled={busy === t.id} style={{ ...BTN, background: NAVY, color: '#fff', marginTop: 10, width: '100%' }}>
                {busy === t.id ? '⏳ …' : '↔ Als Geldtransit buchen'}
              </button>
            </div>
          )}
          <button onClick={() => ignorieren(t)} disabled={busy === t.id} style={{ ...BTN, background: 'rgba(118,118,128,0.12)', color: INK }}>Kein Beleg nötig · privat / intern</button>
        </div>
      )
    }

    return (
      <div style={{ textAlign: 'center', color: SUB, padding: '90px 24px', fontSize: 15, lineHeight: 1.6 }}>
        {section === 'inbox' && <>📥<br />Beleg auswählen — Gesellschaft & Zuordnung entscheiden.</>}
        {section === 'belege' && <>🧾<br />Beleg auswählen — ✨ schlägt Kategorie, Steuer & Zahlung automatisch vor.</>}
        {section === 'zahlungen' && <>💳<br />Zahlung auswählen.</>}
      </div>
    )
  }

  const SEG: [typeof section, string, number][] = [
    ['inbox', '📥 Inbox', inbox.length],
    ['belege', '🧾 Belege', vouchers.length],
    ['zahlungen', '💳 Zahlungen', openTx.length],
  ]

  return (
    <div style={{ minHeight: '100dvh', background: GROUP_BG, display: 'flex', flexDirection: 'column', WebkitFontSmoothing: 'antialiased', overflowX: 'hidden' }}>
      {/* ── Kopf ── */}
      <header style={{ background: NAVY, color: '#fff', padding: 'max(12px, env(safe-area-inset-top)) 16px 12px', position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, maxWidth: 1240, margin: '0 auto' }}>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.4 }}>Buchhaltung</div>
          <div style={{ fontSize: 10.5, color: GOLDL, letterSpacing: 2.4, fontWeight: 700 }}>TRIMOSA</div>
          <div style={{ flex: 1 }} />
          <button onClick={() => { haptic(); load() }} title="Aktualisieren" style={{ background: 'none', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', padding: 4 }}>↻</button>
          <a href="/team" style={{ fontSize: 14, color: GOLDL, fontWeight: 600, textDecoration: 'none' }}>Team-App</a>
        </div>
        {/* Segmented Control */}
        <div style={{ maxWidth: 1240, margin: '12px auto 0' }}>
          <div style={{ display: 'flex', background: 'rgba(118,118,128,0.28)', borderRadius: 10, padding: 2, gap: 2 }}>
            {SEG.map(([key, label, n]) => (
              <button key={key} onClick={() => { haptic(); setSection(key); setSelId(null) }} style={{
                flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, padding: '7px 4px', borderRadius: 8,
                border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden',
                textOverflow: 'ellipsis', transition: 'background .15s, color .15s',
                background: section === key ? '#fff' : 'transparent',
                color: section === key ? INK : 'rgba(255,255,255,0.92)',
                boxShadow: section === key ? '0 1px 4px rgba(0,0,0,0.18)' : 'none',
                WebkitTapHighlightColor: 'transparent',
              }}>{label}{n ? ` · ${n}` : ''}</button>
            ))}
          </div>
        </div>
      </header>

      {err && <Banner text={err} tone="rot" onClose={() => setErr('')} />}
      {notice && <Banner text={notice} tone="gruen" onClose={() => setNotice('')} />}

      {/* ── Inhalt: Liste + Detail ── */}
      <main style={{ flex: 1, maxWidth: 1240, margin: '0 auto', width: '100%', boxSizing: 'border-box', padding: '14px 16px calc(40px + env(safe-area-inset-bottom))', display: 'grid', gap: 18, gridTemplateColumns: isMobile ? '1fr' : '380px 1fr', alignItems: 'start' }}>
        {/* Liste */}
        <div style={{ display: (isMobile && detailOffen) ? 'none' : 'block' }}>
          {section === 'zahlungen' && (
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', margin: '2px 2px 12px' }}>
              <Chip active={txRichtung === 'alle'} onClick={() => setTxRichtung('alle')}>Alle</Chip>
              <Chip active={txRichtung === 'eingang'} onClick={() => setTxRichtung('eingang')}>↓ Eingänge</Chip>
              <Chip active={txRichtung === 'abbuchung'} onClick={() => setTxRichtung('abbuchung')}>↑ Abbuchungen</Chip>
              <span style={{ flexBasis: '100%', height: 2 }} />
              {[45, 90, 180, 365].map((n) => (
                <Chip key={n} active={txDays === n} onClick={() => { setTxDays(n); load(n) }}>{n === 365 ? 'Jahr' : `${n} Tage`}</Chip>
              ))}
            </div>
          )}
          {loading && <div style={CARD}><SkeletonRows kind="chat" count={7} /></div>}
          {!loading && !rows.length && (
            <div style={{ ...CARD, padding: '36px 24px', textAlign: 'center', color: SUB, fontSize: 15 }}>🎉 Hier ist alles erledigt.</div>
          )}
          {!loading && rows.length > 0 && (
            <div style={CARD}>
              {rows.map((item, i) => (
                <button key={item.id} onClick={() => { haptic(); setSelId(item.id) }} style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px',
                  background: selId === item.id ? 'rgba(176,145,43,0.10)' : '#fff',
                  border: 'none', cursor: 'pointer', textAlign: 'left',
                  boxShadow: i < rows.length - 1 ? `inset 0 -0.5px 0 ${HAIRLINE}` : 'none',
                  WebkitTapHighlightColor: 'transparent',
                }}>
                  {item.avatar}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15.5, fontWeight: 600, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: -0.2 }}>{item.titel}</span>
                    <span style={{ display: 'block', fontSize: 13, color: SUB, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.sub}</span>
                  </span>
                  {item.betrag && <span style={{ fontSize: 15.5, fontWeight: 600, color: item.farbe, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', letterSpacing: -0.2 }}>{item.betrag}</span>}
                  <span style={{ color: '#C7C7CC', fontSize: 16, flexShrink: 0 }}>›</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail */}
        <div style={{ display: (isMobile && !detailOffen) ? 'none' : 'block' }}>
          {isMobile && detailOffen && (
            <button onClick={() => { haptic(); setSelId(null) }} style={{ background: 'none', border: 'none', color: GOLD, fontWeight: 600, fontSize: 16, cursor: 'pointer', padding: '0 0 12px', WebkitTapHighlightColor: 'transparent' }}>‹ Zurück</button>
          )}
          {renderDetail()}
        </div>
      </main>
    </div>
  )
}
