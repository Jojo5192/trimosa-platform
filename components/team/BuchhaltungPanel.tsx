'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

/**
 * 💶 BUCHHALTUNG (§239): Vollbild-Bereich im Mehr-Tab (NUR Admins/
 * Gastgeber) — sevdesk komplett aus der App bedienen:
 *  📥 Inbox     — unsichere Belege aus dem Mail-Scan (Gesellschaft wählen)
 *  🧾 Belege    — sevdesk-Entwürfe/offene Belege: Kostenstelle, KI-Kategorie,
 *                 Verbuchen + direkt mit Bank-Zahlung verknüpfen
 *  💳 Zahlungen — offene Bank-Transaktionen: Geldtransit, kein-Beleg-nötig
 * Overlay via createPortal (§83); Portal-Root trägt team-shell (§100).
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

const eur = (n: number) => n.toFixed(2).replace('.', ',') + ' €'
const fmtD = (iso: string | null) => {
  if (!iso) return null
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}
/** Betrag aus der Beleg-Beschreibung fischen („… · 111,99 €") */
const betragAusText = (s: string | null): number | null => {
  const m = (s ?? '').match(/(\d{1,3}(?:\.\d{3})*,\d{2}|\d+\.\d{2})\s*€/)
  if (!m) return null
  return Math.round(parseFloat(m[1].replace(/\./g, '').replace(',', '.')) * 100) / 100
}

const CARD: CSSProperties = {
  background: '#fff', borderRadius: 14, padding: '14px 14px 12px', marginBottom: 12,
  boxShadow: '0 0 0 0.5px rgba(60,60,67,0.1)',
}
const SELECT: CSSProperties = {
  fontSize: 16, padding: '8px 10px', borderRadius: 9,
  border: '0.5px solid rgba(60,60,67,0.25)', background: '#fff', color: '#1A1814',
  minWidth: 0, maxWidth: '100%',
}
const BTN_GOLD: CSSProperties = {
  fontSize: 14, fontWeight: 700, color: '#fff', background: '#B0912B',
  border: 'none', borderRadius: 9, padding: '10px 12px', cursor: 'pointer',
}

export default function BuchhaltungPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'inbox' | 'belege' | 'zahlungen'>('belege')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const [inbox, setInbox] = useState<InboxBeleg[]>([])
  const [inboxKst, setInboxKst] = useState<Record<string, string>>({})
  const [vouchers, setVouchers] = useState<Voucher[]>([])
  const [openTx, setOpenTx] = useState<Tx[]>([])
  const [kategorien, setKategorien] = useState<Kategorie[]>([])
  const [kostenstellen, setKostenstellen] = useState<string[]>(['Allgemein'])
  const [clearingLabels, setClearingLabels] = useState<string[]>([])

  // Verbuchen-Formular je Beleg
  const [form, setForm] = useState<Record<string, { kat: string; tax: string; betrag: string; kst: string; txId: string; hint?: string }>>({})
  const [transit, setTransit] = useState<Record<string, string>>({})
  const [txDays, setTxDays] = useState(45)

  const load = async (days = txDays) => {
    setLoading(true)
    try {
      const [bu, be] = await Promise.all([
        fetch(`/api/buchhaltung?days=${days}`, { cache: 'no-store' }).then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
        fetch('/api/belege', { cache: 'no-store' }).then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
      ])
      if (!bu.ok) throw new Error(bu.j.error ?? 'Buchhaltung nicht ladbar')
      setVouchers(bu.j.vouchers ?? [])
      setOpenTx(bu.j.openTx ?? [])
      setKategorien(bu.j.kategorien ?? [])
      setKostenstellen(bu.j.kostenstellen ?? ['Allgemein'])
      setClearingLabels(bu.j.clearingLabels ?? [])
      if (be.ok) setInbox(be.j.belege ?? [])
      setErr('')
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const fOf = (v: Voucher) => form[v.id] ?? {
    kat: '', tax: '19',
    betrag: v.sumGross && v.sumGross > 0 ? String(v.sumGross) : (betragAusText(v.description) != null ? String(betragAusText(v.description)) : ''),
    kst: v.costCentreName ?? 'Allgemein', txId: '',
  }
  const setF = (id: string, patch: Partial<{ kat: string; tax: string; betrag: string; kst: string; txId: string; hint: string }>) =>
    setForm((p) => ({ ...p, [id]: { ...(p[id] ?? fOf(vouchers.find((v) => v.id === id)!)), ...patch } }))

  const post = async (body: Record<string, unknown>) => {
    const r = await fetch('/api/buchhaltung', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const j = await r.json()
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
    return j
  }

  const kiVorschlag = async (v: Voucher) => {
    setBusy(v.id); setErr('')
    try {
      const j = await post({ action: 'ki-vorschlag', voucherId: v.id })
      setF(v.id, {
        kat: String(j.accountDatevId), tax: String(j.taxRate),
        ...(j.betrag ? { betrag: String(j.betrag) } : {}),
        hint: `✨ ${j.kategorie} (${j.nr})${j.begruendung ? ` — ${j.begruendung}` : ''}`,
      })
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)) } finally { setBusy(null) }
  }

  const verbuchen = async (v: Voucher) => {
    const f = fOf(v)
    if (!f.kat) { setErr('Bitte erst eine Kategorie wählen (oder ✨ KI-Vorschlag).'); return }
    const betrag = parseFloat(f.betrag.replace(',', '.'))
    if (!Number.isFinite(betrag) || betrag <= 0) { setErr('Bitte einen Brutto-Betrag eingeben.'); return }
    const tx = openTx.find((t) => t.id === f.txId)
    setBusy(v.id); setErr('')
    try {
      await post({
        action: 'verbuchen', voucherId: v.id, accountDatevId: Number(f.kat),
        taxRate: Number(f.tax), amountGross: betrag, kostenstelle: f.kst,
        ...(tx ? { txId: tx.id, txAccountId: tx.bankAccountId, txDate: tx.datum } : {}),
      })
      await load()
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)) } finally { setBusy(null) }
  }

  const inboxDecide = async (id: string, ziel: 'sevdesk' | 'andere' | 'verworfen') => {
    setBusy(id); setErr('')
    try {
      const r = await fetch('/api/belege', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ziel, ...(ziel === 'sevdesk' ? { kostenstelle: inboxKst[id] ?? 'Allgemein' } : {}) }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      setInbox((p) => p.filter((b) => b.id !== id))
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
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)) } finally { setBusy(null) }
  }

  const ignorieren = async (t: Tx) => {
    setBusy(t.id); setErr('')
    try {
      await post({ action: 'tx-ignorieren', txId: t.id })
      setOpenTx((p) => p.filter((x) => x.id !== t.id))
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)) } finally { setBusy(null) }
  }

  const drafts = vouchers.filter((v) => v.status === 50)
  const offene = vouchers.filter((v) => v.status === 100)
  const matchingTx = (betrag: string) => {
    const n = parseFloat((betrag || '').replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) return openTx.filter((t) => t.betrag < 0)
    return openTx.filter((t) => t.betrag < 0).sort((a, b2) =>
      Math.abs(Math.abs(a.betrag) - n) - Math.abs(Math.abs(b2.betrag) - n))
  }

  const TABS: { key: typeof tab; label: string; n: number }[] = [
    { key: 'inbox', label: '📥 Inbox', n: inbox.length },
    { key: 'belege', label: '🧾 Belege', n: vouchers.length },
    { key: 'zahlungen', label: '💳 Zahlungen', n: openTx.length },
  ]

  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="team-shell" style={{
      position: 'fixed', inset: 0, zIndex: 90, background: '#F2F2F7',
      display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top)',
    }}>
      <div style={{
        padding: '12px 16px 0', background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(14px)',
        boxShadow: 'inset 0 -0.5px 0 rgba(60,60,67,0.15)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 17, color: '#B0912B', cursor: 'pointer', padding: '4px 6px 4px 0', fontWeight: 600 }}>‹ Zurück</button>
          <div style={{ flex: 1, fontSize: 17, fontWeight: 700, color: '#1A1814' }}>💶 Buchhaltung</div>
          <button onClick={load} style={{ background: 'none', border: 'none', fontSize: 17, cursor: 'pointer', color: '#8A8578' }}>↻</button>
        </div>
        <div style={{ display: 'flex', gap: 6, padding: '10px 0' }}>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              flex: 1, fontSize: 13.5, fontWeight: 700, padding: '8px 4px', borderRadius: 9,
              border: 'none', cursor: 'pointer',
              background: tab === t.key ? '#1A1814' : 'rgba(120,120,128,0.12)',
              color: tab === t.key ? '#fff' : '#1A1814',
            }}>{t.label}{t.n ? ` · ${t.n}` : ''}</button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '14px 14px calc(20px + env(safe-area-inset-bottom))' }}>
        {err && (
          <div style={{ background: '#FEE2E2', color: '#B91C1C', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, marginBottom: 12 }}>
            {err} <button onClick={() => setErr('')} style={{ background: 'none', border: 'none', color: '#B91C1C', fontWeight: 700, cursor: 'pointer' }}>✕</button>
          </div>
        )}
        {loading && <div style={{ textAlign: 'center', color: '#8A8578', padding: 30 }}>Laden…</div>}

        {/* ── 📥 INBOX ─────────────────────────────────────────────────── */}
        {!loading && tab === 'inbox' && (
          <>
            <div style={{ fontSize: 12.5, color: '#8A8578', margin: '0 2px 12px', lineHeight: 1.45 }}>
              Belege aus den Postfächern, die nicht eindeutig zuzuordnen waren — Gesellschaft wählen.
            </div>
            {!inbox.length && <div style={{ textAlign: 'center', color: '#8A8578', padding: '40px 20px' }}>🎉 Keine offenen Zuordnungen.</div>}
            {inbox.map((b) => (
              <div key={b.id} style={CARD}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 15.5, fontWeight: 700, color: '#1A1814', flex: 1, minWidth: 140 }}>{b.lieferant ?? 'Unbekannt'}</div>
                  {b.betrag != null && <div style={{ fontSize: 15.5, fontWeight: 700 }}>{eur(b.betrag)}</div>}
                </div>
                <div style={{ fontSize: 12.5, color: '#8A8578', marginTop: 3 }}>
                  {[fmtD(b.datum), b.belegnummer ? `Nr. ${b.belegnummer}` : null, b.mailbox].filter(Boolean).join(' · ')}
                </div>
                {b.subject && <div style={{ fontSize: 13, color: '#6B675E', marginTop: 5 }}>{b.subject}</div>}
                {b.kiHinweis && <div style={{ fontSize: 12.5, color: '#8A8578', fontStyle: 'italic', marginTop: 4 }}>{b.kiHinweis}</div>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {b.links.map((l) => (
                    <a key={l.url} href={l.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 600, color: '#B0912B', textDecoration: 'none', background: '#FBF7EC', borderRadius: 8, padding: '6px 10px' }}>📄 {l.name.slice(0, 40)} ↗</a>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 11, flexWrap: 'wrap' }}>
                  <select value={inboxKst[b.id] ?? 'Allgemein'} onChange={(e) => setInboxKst((p) => ({ ...p, [b.id]: e.target.value }))} style={{ ...SELECT, flex: '1 1 150px' }}>
                    {kostenstellen.map((k) => <option key={k} value={k}>{k === 'Allgemein' ? 'Kostenstelle: Allgemein' : k}</option>)}
                  </select>
                  <button onClick={() => inboxDecide(b.id, 'sevdesk')} disabled={busy === b.id} style={{ ...BTN_GOLD, flex: '1 1 130px' }}>{busy === b.id ? '⏳ …' : '→ sevdesk (A&H)'}</button>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button onClick={() => inboxDecide(b.id, 'andere')} disabled={busy === b.id} style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: '#3B5BDB', background: '#EEF2FF', border: 'none', borderRadius: 9, padding: '9px 10px', cursor: 'pointer' }}>Andere Gesellschaft</button>
                  <button onClick={() => inboxDecide(b.id, 'verworfen')} disabled={busy === b.id} style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: '#B91C1C', background: '#FEF2F2', border: 'none', borderRadius: 9, padding: '9px 10px', cursor: 'pointer' }}>Kein Beleg</button>
                </div>
              </div>
            ))}
          </>
        )}

        {/* ── 🧾 BELEGE (sevdesk) ──────────────────────────────────────── */}
        {!loading && tab === 'belege' && (
          <>
            <div style={{ fontSize: 12.5, color: '#8A8578', margin: '0 2px 12px', lineHeight: 1.45 }}>
              Belege in sevdesk (A&H). Kategorie + Betrag prüfen (✨ schlägt vor), Kostenstelle wählen,
              optional die passende Bank-Abbuchung verknüpfen — „Verbuchen" erledigt alles.
            </div>
            {!vouchers.length && <div style={{ textAlign: 'center', color: '#8A8578', padding: '40px 20px' }}>🎉 Keine offenen Belege in sevdesk.</div>}
            {[...drafts, ...offene].map((v) => {
              const f = fOf(v)
              const cands = matchingTx(f.betrag).slice(0, 6)
              return (
                <div key={v.id} style={CARD}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 15.5, fontWeight: 700, color: '#1A1814', flex: 1, minWidth: 140 }}>{v.supplierName ?? 'Unbekannt'}</div>
                    <span style={{
                      fontSize: 11.5, fontWeight: 700, borderRadius: 6, padding: '3px 7px',
                      background: v.status === 50 ? '#EEF2FF' : '#FEF9C3',
                      color: v.status === 50 ? '#3B5BDB' : '#A16207',
                    }}>{v.status === 50 ? 'Entwurf' : 'Offen'}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: '#8A8578', marginTop: 3 }}>{fmtD(v.voucherDate) ?? '—'}{v.costCentreName ? ` · KSt ${v.costCentreName}` : ''}</div>
                  {v.description && <div style={{ fontSize: 13, color: '#6B675E', marginTop: 5, lineHeight: 1.4 }}>{v.description.slice(0, 160)}</div>}
                  {f.hint && <div style={{ fontSize: 12.5, color: '#8A6D1F', background: '#FBF7EC', borderRadius: 8, padding: '7px 9px', marginTop: 8 }}>{f.hint}</div>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <select value={f.kat} onChange={(e) => setF(v.id, { kat: e.target.value })} style={{ ...SELECT, flex: '2 1 200px' }}>
                      <option value="">Kategorie wählen…</option>
                      {kategorien.map((k) => <option key={k.id} value={String(k.id)}>{k.name} ({k.nr})</option>)}
                    </select>
                    <button onClick={() => kiVorschlag(v)} disabled={busy === v.id} style={{ fontSize: 14, fontWeight: 700, color: '#B0912B', background: '#FBF7EC', border: 'none', borderRadius: 9, padding: '8px 12px', cursor: 'pointer', flex: '0 0 auto' }}>{busy === v.id ? '⏳' : '✨ KI'}</button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <input inputMode="decimal" placeholder="Betrag brutto €" value={f.betrag}
                      onChange={(e) => setF(v.id, { betrag: e.target.value })}
                      style={{ ...SELECT, flex: '1 1 110px' }} />
                    <select value={f.tax} onChange={(e) => setF(v.id, { tax: e.target.value })} style={{ ...SELECT, flex: '0 1 110px' }}>
                      <option value="19">19 % USt</option>
                      <option value="7">7 % USt</option>
                      <option value="0">0 % USt</option>
                    </select>
                    <select value={f.kst} onChange={(e) => setF(v.id, { kst: e.target.value })} style={{ ...SELECT, flex: '1 1 140px' }}>
                      {kostenstellen.map((k) => <option key={k} value={k}>{k === 'Allgemein' ? 'KSt: Allgemein' : k}</option>)}
                    </select>
                  </div>
                  <select value={f.txId} onChange={(e) => setF(v.id, { txId: e.target.value })} style={{ ...SELECT, width: '100%', marginTop: 8 }}>
                    <option value="">Ohne Zahlungs-Verknüpfung (bleibt offen)</option>
                    {cands.map((t) => (
                      <option key={t.id} value={t.id}>
                        {`Zahlung ${fmtD(t.datum)} · ${eur(Math.abs(t.betrag))} · ${t.von || t.zweck}`.slice(0, 70)}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => verbuchen(v)} disabled={busy === v.id} style={{ ...BTN_GOLD, width: '100%', marginTop: 10 }}>
                    {busy === v.id ? '⏳ …' : f.txId ? '✓ Verbuchen + Zahlung zuordnen' : '✓ Verbuchen'}
                  </button>
                </div>
              )
            })}
          </>
        )}

        {/* ── 💳 ZAHLUNGEN ─────────────────────────────────────────────── */}
        {!loading && tab === 'zahlungen' && (
          <>
            <div style={{ fontSize: 12.5, color: '#8A8578', margin: '0 2px 10px', lineHeight: 1.45 }}>
              Offene Bank-Transaktionen. Abbuchungen ohne Beleg: Beleg kommt per
              Mail-Scan oder Foto — die Verknüpfung passiert beim Verbuchen im Belege-Reiter.
            </div>
            <div style={{ display: 'flex', gap: 8, margin: '0 2px 14px', flexWrap: 'wrap' }}>
              {[45, 90, 180, 365].map((n) => (
                <button key={n} onClick={() => { setTxDays(n); load(n) }} style={{
                  fontSize: 13, fontWeight: 600, padding: '6px 12px', borderRadius: 999,
                  border: '0.5px solid rgba(60,60,67,0.25)', cursor: 'pointer',
                  background: txDays === n ? '#1A1814' : '#fff',
                  color: txDays === n ? '#fff' : '#1A1814',
                }}>{n === 365 ? 'Jahr' : `${n} Tage`}</button>
              ))}
            </div>
            {!openTx.length && <div style={{ textAlign: 'center', color: '#8A8578', padding: '40px 20px' }}>🎉 Keine offenen Zahlungen.</div>}
            {openTx.map((t) => (
              <div key={t.id} style={CARD}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1A1814', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.von || '—'}</div>
                  <div style={{ fontSize: 15.5, fontWeight: 700, color: t.betrag < 0 ? '#B91C1C' : '#16A34A' }}>{t.betrag < 0 ? '−' : '+'}{eur(Math.abs(t.betrag))}</div>
                </div>
                <div style={{ fontSize: 12.5, color: '#8A8578', marginTop: 3 }}>{fmtD(t.datum)} · {t.bankkonto}</div>
                {t.zweck && <div style={{ fontSize: 13, color: '#6B675E', marginTop: 4 }}>{t.zweck}</div>}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                  {t.betrag > 0 && (
                    <>
                      <select value={transit[t.id] ?? t.vorschlag ?? ''} onChange={(e) => setTransit((p) => ({ ...p, [t.id]: e.target.value }))} style={{ ...SELECT, flex: '1 1 170px' }}>
                        <option value="">Verrechnungskonto…</option>
                        {clearingLabels.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <button onClick={() => geldtransit(t)} disabled={busy === t.id} style={{ ...BTN_GOLD, flex: '0 0 auto' }}>{busy === t.id ? '⏳' : '↔ Geldtransit'}</button>
                    </>
                  )}
                  <button onClick={() => ignorieren(t)} disabled={busy === t.id} style={{ fontSize: 13.5, fontWeight: 600, color: '#6B675E', background: 'rgba(120,120,128,0.12)', border: 'none', borderRadius: 9, padding: '9px 12px', cursor: 'pointer', flex: '0 0 auto' }}>Kein Beleg nötig</button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
