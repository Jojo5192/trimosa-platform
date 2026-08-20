'use client'

import { useState } from 'react'

/**
 * 🏢 §271 BuchhaltungsButler-Karte (TRIMOSA Immobilien UG) — aufklappbar im
 * Belege-Bereich von /buchhaltung: Sync-Zähler, Warteschlange/Prüfliste,
 * „Jetzt abgleichen" und der einmalige Setup-Lauf (Kostenstelle + Sachkonto
 * live aus BB wählen). Lädt erst beim Aufklappen (lazy).
 */

const CARD: React.CSSProperties = {
  background: '#fff', borderRadius: 18, padding: '14px 16px',
  boxShadow: '0 1px 2px rgba(0,0,0,0.05)', border: '0.5px solid rgba(60,60,67,0.12)',
}
const BTN: React.CSSProperties = {
  border: 'none', borderRadius: 12, padding: '11px 14px', fontSize: 15,
  fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}
const SEL: React.CSSProperties = {
  width: '100%', fontSize: 16, padding: '10px 12px', borderRadius: 12,
  border: '0.5px solid rgba(60,60,67,0.25)', background: '#fff', fontFamily: 'inherit',
}

interface BbBeleg {
  id: string; lieferant: string | null; betrag: number | null; datum: string | null
  subject: string | null; status: string | null; detail: string | null
}
interface BbState {
  configured: boolean
  settings: { kostenstelleCode: string; sachkonto: string; zeitraumAb: string; tolTage: number } | null
  zaehler: Record<string, number>
  belege: BbBeleg[]
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  gebucht: { label: '✓ gebucht', color: '#248A3D' },
  zugeordnet: { label: '◐ zugeordnet', color: '#B8860B' },
  wartet: { label: '⏳ wartet auf Zahlung', color: '#8E8E93' },
  pruefen: { label: '⚠️ prüfen', color: '#D70015' },
  fehler: { label: '✕ Fehler', color: '#D70015' },
}

export default function BbCard() {
  const [open, setOpen] = useState(false)
  const [st, setSt] = useState<BbState | null>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [setup, setSetup] = useState<{ kostenstellen: Record<string, unknown>[]; sachkonten: Record<string, unknown>[] } | null>(null)
  const [selKst, setSelKst] = useState('')
  const [selKonto, setSelKonto] = useState('')

  const load = async () => {
    setBusy('load')
    try {
      const r = await fetch('/api/bb', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      setSt(j)
    } catch (e) { setMsg('Laden: ' + String(e instanceof Error ? e.message : e)) } finally { setBusy('') }
  }

  const action = async (body: Record<string, unknown>, label: string) => {
    setBusy(label); setMsg('')
    try {
      const r = await fetch('/api/bb', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      return j
    } catch (e) { setMsg(String(e instanceof Error ? e.message : e)); return null } finally { setBusy('') }
  }

  const doSync = async () => {
    const j = await action({ action: 'sync' }, 'sync')
    if (j) {
      const rep = (j.report ?? []) as { status: string }[]
      const n: Record<string, number> = {}
      for (const r of rep) n[r.status] = (n[r.status] ?? 0) + 1
      setMsg(`Abgleich über ${j.txCount} Zahlungen: ` + (rep.length
        ? Object.entries(n).map(([k, v]) => `${v}× ${k}`).join(' · ')
        : 'keine offenen UG-Belege'))
      void load()
    }
  }

  const doSetup = async () => {
    const j = await action({ action: 'setup' }, 'setup')
    if (j) {
      setSetup({ kostenstellen: j.kostenstellen ?? [], sachkonten: j.sachkonten ?? [] })
      setSelKst(j.settings?.kostenstelleCode ?? '')
      setSelKonto(j.settings?.sachkonto ?? '')
    }
  }

  const saveSetup = async () => {
    const j = await action({ action: 'settings', kostenstelleCode: selKst, sachkonto: selKonto }, 'save')
    if (j) { setMsg('✓ Setup gespeichert — künftige Treffer werden direkt gebucht.'); setSetup(null); void load() }
  }

  const optLabel = (o: Record<string, unknown>) => {
    // Kalibriert 20.8.: Kostenstellen liefern {code, name}, Sachkonten
    // {postingaccount_number, name}
    const code = String(o.code ?? o.postingaccount_number ?? o.cost_location ?? o.postingaccount ?? o.number ?? o.id ?? '')
    const name = String(o.name ?? o.description ?? o.text ?? '')
    return { code, text: [code, name].filter(Boolean).join(' · ') }
  }

  return (
    <div style={CARD}>
      <button
        onClick={() => { setOpen((o) => !o); if (!open && !st) void load() }}
        style={{ ...BTN, width: '100%', textAlign: 'left', background: 'transparent', padding: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#12222E' }}>🏢 Immobilien UG · BuchhaltungsButler</span>
        <span style={{ marginLeft: 'auto', color: '#8E8E93' }}>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
          {busy === 'load' && <div style={{ color: '#8E8E93', fontSize: 14 }}>Lädt…</div>}
          {st && !st.configured && (
            <div style={{ fontSize: 13.5, color: '#7A6520', background: '#FBF6E9', borderRadius: 12, padding: '10px 13px', lineHeight: 1.5 }}>
              ⚠️ Zugangsdaten fehlen: In Vercel die Envs <b>BB_API_CLIENT</b>, <b>BB_API_SECRET</b>, <b>BB_API_KEY</b> setzen
              (BuchhaltungsButler → Einstellungen → Schnittstellen &amp; API-Zugang) + Redeploy.
            </div>
          )}
          {st && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Object.entries(st.zaehler).map(([k, v]) => (
                <span key={k} style={{ fontSize: 13, fontWeight: 600, color: STATUS_META[k]?.color ?? '#5A6B7A', background: 'rgba(60,60,67,0.06)', borderRadius: 999, padding: '5px 11px' }}>
                  {v}× {STATUS_META[k]?.label ?? k}
                </span>
              ))}
              {!st.belege.length && <span style={{ fontSize: 13.5, color: '#8E8E93' }}>Noch keine UG-Belege — Inbox-Entscheidung „🏢 Immobilien UG → BB" füllt diese Liste.</span>}
            </div>
          )}
          {st?.settings && !st.settings.sachkonto && st.configured && (
            <div style={{ fontSize: 13.5, color: '#7A6520', background: '#FBF6E9', borderRadius: 12, padding: '10px 13px' }}>
              🛠 Setup unvollständig — ohne Sachkonto werden Treffer nur zugeordnet, nicht gebucht.
              Die Kostenstelle liest die KI je Beleg aus dem Dokument (Fallback: Standard-Kostenstelle).
            </div>
          )}
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
            <button onClick={() => void doSync()} disabled={!!busy || !st?.configured} style={{ ...BTN, background: '#12222E', color: '#fff' }}>
              {busy === 'sync' ? '⏳ Gleiche ab…' : '↻ Jetzt mit Zahlungen abgleichen'}
            </button>
            <button onClick={() => void doSetup()} disabled={!!busy || !st?.configured} style={{ ...BTN, background: 'rgba(10,132,255,0.12)', color: '#0A84FF' }}>
              {busy === 'setup' ? '⏳ Lade Stammdaten…' : '🛠 Setup (Kostenstelle + Sachkonto)'}
            </button>
          </div>
          {setup && (
            <div style={{ display: 'grid', gap: 9, background: 'rgba(10,132,255,0.05)', borderRadius: 12, padding: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#5A6B7A', letterSpacing: 0.4 }}>STANDARD-KOSTENSTELLE (Fallback)</div>
              <div style={{ fontSize: 12.5, color: '#5A6B7A', lineHeight: 1.4 }}>
                Die KI liest die richtige Kostenstelle je Beleg aus dem Dokument (nur aus den in BB
                vorhandenen) — dieser Fallback greift, wenn der Beleg kein Objekt verrät (z. B. Baumarkt-Bons).
              </div>
              <select value={selKst} onChange={(e) => setSelKst(e.target.value)} style={SEL}>
                <option value="">— kein Fallback —</option>
                {setup.kostenstellen.map((o, i) => { const l = optLabel(o); return <option key={i} value={l.code}>{l.text}</option> })}
              </select>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#5A6B7A', letterSpacing: 0.4 }}>STANDARD-SACHKONTO (Sanierungskosten)</div>
              <select value={selKonto} onChange={(e) => setSelKonto(e.target.value)} style={SEL}>
                <option value="">— wählen —</option>
                {setup.sachkonten.map((o, i) => { const l = optLabel(o); return <option key={i} value={l.code}>{l.text}</option> })}
              </select>
              <button onClick={() => void saveSetup()} disabled={!selKonto || !!busy} style={{ ...BTN, background: '#12222E', color: '#fff' }}>
                {busy === 'save' ? '⏳ Speichere…' : '💾 Übernehmen'}
              </button>
            </div>
          )}
          {msg && <div style={{ fontSize: 13.5, color: '#12222E', background: 'rgba(60,60,67,0.06)', borderRadius: 12, padding: '10px 13px', lineHeight: 1.45 }}>{msg}</div>}
          {!!st?.belege.length && (
            <div style={{ display: 'grid', gap: 6 }}>
              {st.belege.slice(0, 30).map((b) => (
                <div key={b.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13.5, borderTop: '0.5px solid rgba(60,60,67,0.1)', paddingTop: 6 }}>
                  <span style={{ fontWeight: 600, color: '#12222E' }}>{b.lieferant ?? '—'}</span>
                  <span style={{ color: '#8E8E93' }}>{b.datum ?? ''}</span>
                  <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{b.betrag != null ? b.betrag.toFixed(2) + ' €' : ''}</span>
                  <span style={{ color: STATUS_META[b.status ?? '']?.color ?? '#8E8E93', fontWeight: 600 }}>{STATUS_META[b.status ?? '']?.label ?? b.status}</span>
                </div>
              ))}
              {st.belege.length > 30 && <div style={{ fontSize: 12.5, color: '#8E8E93' }}>… und {st.belege.length - 30} weitere</div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
