'use client'

/**
 * 🧾 §266c: Rechnung in der Gästemappe — Download-Button (token-geschützter
 * PDF-Link) + aufklappbares Formular „Rechnungsempfänger anpassen" (Name,
 * Firma/Zusatz, Anschrift; vorbefüllt mit dem aktuell aufgelösten
 * Empfänger). Vor der Erstellung wird der Wunsch gespeichert, danach die
 * bestehende Rechnung direkt aktualisiert. Labels kommen übersetzt vom
 * Server (Mappe-Sprache). Alt-Buchungen (lexoffice) zeigen nur den Download.
 */
import { useState, type CSSProperties } from 'react'

export interface MappeInvoiceLabels {
  navLabel: string
  titleReady: string
  titleUpcoming: string
  hintReady: string
  hintUpcoming: string
  download: string
  editRecipient: string
  name: string
  supplement: string
  street: string
  zip: string
  city: string
  country: string
  save: string
  savedStored: string
  savedUpdated: string
  legacyHint: string
}

export interface MappeInvoiceRecipient {
  name: string; supplement?: string; street?: string; zip?: string; city?: string; countryCode?: string
}

const input: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10,
  border: '1px solid #E2DCCC', background: '#fff', fontSize: 16, // 16px = iOS-Zoom-Regel
  color: '#2A2620', outline: 'none',
}
const label: CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 700, color: '#8A8065', margin: '10px 0 4px' }

export default function MappeInvoice({ token, labels, status, invoiceNumber, initial, canEdit }: {
  token: string
  labels: MappeInvoiceLabels
  /** 'bereit' = PDF existiert · 'kommt' = wird am Anreisetag erstellt */
  status: 'bereit' | 'kommt'
  invoiceNumber: string | null
  initial: MappeInvoiceRecipient | null
  /** false = Alt-Buchung (lexoffice) — nur Download, kein Formular */
  canEdit: boolean
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(initial?.name ?? '')
  const [supplement, setSupplement] = useState(initial?.supplement ?? '')
  const [street, setStreet] = useState(initial?.street ?? '')
  const [zip, setZip] = useState(initial?.zip ?? '')
  const [city, setCity] = useState(initial?.city ?? '')
  const [country, setCountry] = useState(initial?.countryCode ?? 'DE')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!name.trim() || busy) return
    setBusy(true); setError(null); setDone(null)
    try {
      const r = await fetch('/api/mappe/rechnung', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          recipient: { name, supplement, street, zip, city, countryCode: country },
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `Fehler ${r.status}`)
      setDone(j.aktualisiert ? labels.savedUpdated : labels.savedStored)
      setOpen(false)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  const ready = status === 'bereit'
  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: '18px 18px 16px', boxShadow: '0 1px 4px rgba(35,28,10,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 20 }}>🧾</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 800, color: '#2A2620' }}>
            {ready ? labels.titleReady : labels.titleUpcoming}
            {ready && invoiceNumber && <span style={{ fontWeight: 600, color: '#8A8065' }}> · {invoiceNumber}</span>}
          </div>
        </div>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 13, color: '#6B6350', lineHeight: 1.55 }}>
        {ready ? labels.hintReady : labels.hintUpcoming}
      </p>

      {ready && (
        <a
          href={`/api/rechnung/${token}`} target="_blank" rel="noreferrer"
          style={{
            display: 'block', textAlign: 'center', marginTop: 12, padding: '12px 16px', borderRadius: 12,
            background: 'var(--gold, #AE8D2D)', color: '#fff', fontSize: 14.5, fontWeight: 800, textDecoration: 'none',
          }}
        >📄 {labels.download}</a>
      )}

      {done && (
        <div style={{ marginTop: 12, padding: '10px 13px', borderRadius: 10, background: '#F0FDF4', color: '#166534', fontSize: 13, lineHeight: 1.5 }}>
          ✓ {done}
        </div>
      )}
      {error && (
        <div style={{ marginTop: 12, padding: '10px 13px', borderRadius: 10, background: '#FEF2F2', color: '#B91C1C', fontSize: 13, lineHeight: 1.5 }}>
          ⚠️ {error}
        </div>
      )}

      {canEdit ? (
        !open ? (
          <button
            onClick={() => { setOpen(true); setDone(null) }}
            style={{
              display: 'block', width: '100%', marginTop: 10, padding: '11px 14px', borderRadius: 12,
              border: '1px solid #E2DCCC', background: '#FAF8F2', color: '#6B6350',
              fontSize: 13.5, fontWeight: 700, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
            }}
          >✏️ {labels.editRecipient}</button>
        ) : (
          <div style={{ marginTop: 12, padding: '14px 14px 16px', borderRadius: 12, background: '#FAF8F2', border: '1px solid #EFE9D8' }}>
            <label style={label}>{labels.name} *</label>
            <input style={input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="organization" />
            <label style={label}>{labels.supplement}</label>
            <input style={input} value={supplement} onChange={(e) => setSupplement(e.target.value)} />
            <label style={label}>{labels.street}</label>
            <input style={input} value={street} onChange={(e) => setStreet(e.target.value)} autoComplete="street-address" />
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: '0 0 32%' }}>
                <label style={label}>{labels.zip}</label>
                <input style={input} value={zip} onChange={(e) => setZip(e.target.value)} inputMode="text" autoComplete="postal-code" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label style={label}>{labels.city}</label>
                <input style={input} value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" />
              </div>
            </div>
            <label style={label}>{labels.country}</label>
            <select style={{ ...input, appearance: 'none' as const }} value={country} onChange={(e) => setCountry(e.target.value)}>
              {/* §266c-Review: unbekannten Profil-Code (z. B. US) mitrendern,
                  sonst zeigt der kontrollierte Select eine leere Auswahl */}
              {[...new Set(['DE', 'NL', 'BE', 'LU', 'FR', 'AT', 'CH', 'GB', 'PL', 'IT', 'ES', 'DK', 'SE', country])].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button
                onClick={() => setOpen(false)}
                style={{ flex: '0 0 auto', padding: '11px 16px', borderRadius: 12, border: '1px solid #E2DCCC', background: '#fff', color: '#8A8065', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}
              >✕</button>
              <button
                onClick={save}
                disabled={!name.trim() || busy}
                style={{
                  flex: 1, padding: '11px 16px', borderRadius: 12, border: 'none',
                  background: !name.trim() || busy ? '#D8CFB8' : 'var(--gold, #AE8D2D)',
                  color: '#fff', fontSize: 14, fontWeight: 800, cursor: !name.trim() || busy ? 'default' : 'pointer',
                }}
              >{busy ? '…' : labels.save}</button>
            </div>
          </div>
        )
      ) : (
        <p style={{ margin: '10px 0 0', fontSize: 12, color: '#B0A793', lineHeight: 1.5 }}>{labels.legacyHint}</p>
      )}
    </div>
  )
}
