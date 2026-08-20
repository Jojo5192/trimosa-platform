'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { haptic, SkeletonRows } from '@/components/team/ux'
import DocScanner from '@/components/DocScanner'
import BbCard from './BbCard'

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
  /** §243ad: Team-Einreichung — Ort-Wunsch + Notiz des Einreichers */
  eingereichtOrt?: string | null
  eingereichtNotiz?: string | null
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
// §243: Formular-Zustand „Ohne Beleg buchen" je Abbuchung
interface EigenForm { typ: '' | 'miete' | 'kredit' | 'privat' | 'sonstiges'; empfaenger: string; zweck: string; taxRate: string; zins: string; kat: string; kst: string; zuordnung: Zuordnung | null }
interface KiVorschlag {
  accountDatevId: number; kategorie: string; nr: string; taxRate: number
  betrag: number | null; begruendung: string; steuerHinweis: string
  anlagegut: boolean; nutzungsdauer: number | null
  /** §243h: echtes Rechnungsdatum aus dem Beleg (korrigiert Scan-Datum) */
  datum?: string | null
  /** v4: Rechnungswährung — bei ≠ EUR wird der Bank-EUR-Betrag gebucht (§243u) */
  waehrung?: string | null
  kst?: string; zuordnung?: Zuordnung | null; gelernt?: boolean
}

const eur = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const fmtD = (iso: string | null) => {
  if (!iso) return null
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}
/** Nächster Eintrag der sichtbaren Liste (bzw. der vorherige am Ende). */
const nachfolgerIn = (liste: { id: string }[], id: string): string | null => {
  const i = liste.findIndex((r) => r.id === id)
  if (i < 0) return null
  return liste[i + 1]?.id ?? liste[i - 1]?.id ?? null
}

/* Beim Wechsel zum nächsten Beleg nach oben — sonst steht man weiter unten
 * am alten Scroll-Punkt und sieht Lieferant, ✨-Vorschlag und Betrag des
 * neuen Belegs gar nicht. */
const nachObenScrollen = () => {
  if (typeof window === 'undefined') return
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

const KAT_RECENT_KEY = 'trimosa_buchhaltung_kat_recent'
const ladeRecentKats = (): string[] => {
  if (typeof window === 'undefined') return []
  try { const r = JSON.parse(localStorage.getItem(KAT_RECENT_KEY) ?? '[]'); return Array.isArray(r) ? r.filter((x) => typeof x === 'string').slice(0, 8) : [] } catch { return [] }
}

const ZAHL = String.raw`\d{1,3}(?:\.\d{3})*,\d{2}|\d+[.,]\d{2}`
const betragAusText = (s: string | null): number | null => {
  const t = s ?? ''
  /* Betrag steht mal hinter, mal vor dem Währungszeichen — und manche
   * Lieferanten schreiben „EUR" statt „€". WICHTIG: der LETZTE Treffer zählt.
   * Die Beschreibung hat die Form „Beleg (…): <Mail-Betreff> · <betrag> €" —
   * der autoritative Betrag wird angehängt, während im Betreff Datums- und
   * Kundennummern stehen („Zeitraum 01.06.-30.06 EUR" ergäbe sonst 30,06). */
  const letzter = (re: RegExp) => { const a = [...t.matchAll(re)]; return a.length ? a[a.length - 1] : null }
  const m =
    // 1. „…12,34 €" / „€ 12,34" — das Zeichen € ist eindeutig
    letzter(new RegExp(`(${ZAHL})\\s*€`, 'g')) ?? letzter(new RegExp(`€\\s*(${ZAHL})`, 'g'))
    // 2. sonst „EUR": zuerst NACHgestellte Zahl („EUR 99,00"), denn vor dem
    //    Wort stehen oft Kunden-/Belegnummern („Kd-Nr 12.34 EUR 99,00")
    ?? letzter(new RegExp(`EURO?\\b\\s*(${ZAHL})`, 'g'))
    ?? letzter(new RegExp(`(${ZAHL})\\s*EURO?\\b`, 'g'))
  if (!m) return null
  // Deutsch „1.234,56" vs. Punkt-Dezimal „55.00" — Punkte nur strippen,
  // wenn ein Komma da ist (sonst wurde 55.00 → 5500!)
  const raw = m[1].includes(',') ? m[1].replace(/\./g, '').replace(',', '.') : m[1]
  return Math.round(parseFloat(raw) * 100) / 100
}

const NAVY = '#12222E'
const GOLD = '#12222E' // §266e: Interaktions-Akzent = Navy (war Gold #B0912B)
const GOLDL = '#E3C878'
const INK = '#1A1814'
const SUB = 'rgba(60,60,67,0.6)'
const HAIRLINE = 'rgba(60,60,67,0.29)'
const GROUP_BG = '#F2F2F7'
const RED = '#D70015'
const GREEN = '#248A3D'

/* clip statt hidden: „hidden" macht das Element zum Scroll-Container und
 * killt damit jedes position:sticky darin (der Verbuchen-Knopf klebte nicht).
 * „clip" schneidet genauso ab, ohne Scroll-Container zu werden. */
const CARD: CSSProperties = { background: '#fff', borderRadius: 16, overflow: 'clip' }
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

/* Kategorie-Auswahl. Der sevdesk-Katalog hat >600 Einträge — als nacktes
 * Select ist das am iPhone eine endlose Walze. Deshalb: Suchfeld darüber und
 * die zuletzt benutzten Konten oben in einer eigenen Gruppe. */
function KategorieWahl({ value, onChange, kategorien, recent }: {
  value: string
  onChange: (v: string) => void
  kategorien: Kategorie[]
  recent: string[]
}) {
  const [q, setQ] = useState('')
  const such = q.trim().toLowerCase()
  const treffer = useMemo(
    () => (such ? kategorien.filter((k) => `${k.nr} ${k.name}`.toLowerCase().includes(such)) : kategorien),
    [such, kategorien],
  )
  const zuletzt = useMemo(
    () => recent.map((id) => kategorien.find((k) => String(k.id) === id)).filter((k): k is Kategorie => Boolean(k)),
    [recent, kategorien],
  )
  // Die gewählte Kategorie muss immer im Select stehen — auch wenn die Suche
  // sie gerade herausfiltert, sonst springt das Feld auf „— wählen —".
  const gewaehlt = kategorien.find((k) => String(k.id) === value)
  const fehltInTreffern = Boolean(gewaehlt && !treffer.some((k) => k.id === gewaehlt.id))
  const opt = (k: Kategorie) => <option key={k.id} value={String(k.id)}>{k.nr} · {k.name}</option>

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <input
        value={q} onChange={(e) => setQ(e.target.value)} inputMode="search"
        placeholder={`Konto suchen … (${kategorien.length})`}
        style={{ ...SELECT, padding: '9px 12px', background: '#F2F2F7' }}
      />
      <select value={value} onChange={(e) => onChange(e.target.value)} style={SELECT}>
        <option value="">— wählen —</option>
        {gewaehlt && fehltInTreffern && <optgroup label="Gewählt">{opt(gewaehlt)}</optgroup>}
        {!such && zuletzt.length > 0 && <optgroup label="Zuletzt verwendet">{zuletzt.map(opt)}</optgroup>}
        <optgroup label={such ? `${treffer.length} Treffer` : 'Alle Kategorien'}>{treffer.map(opt)}</optgroup>
      </select>
      {such && treffer.length === 0 && (
        <div style={{ fontSize: 12.5, color: SUB, margin: '0 4px' }}>Kein Konto gefunden — Suche leeren, um alle zu sehen.</div>
      )}
    </div>
  )
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
  // §243ad: Inbox + Belege sind EIN Reiter (Drei-Firmen-Entscheidung als
  // Status im Belege-Reiter); 'gebucht' lädt zusätzlich bezahlte Belege
  const [section, setSection] = useState<'belege' | 'zahlungen'>('belege')
  /* Drei Zustände statt zwei: „Zu erledigen" sind nur Belege, die WIRKLICH
   * eine Entscheidung brauchen (Inbox + Entwürfe). Fertig kategorisierte
   * Belege, die nur noch auf den Bankabgleich warten, sind kein To-do. */
  const [belegFilter, setBelegFilter] = useState<'todo' | 'bank' | 'gebucht'>('todo')
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
  // §243: „Ohne Beleg buchen" (Eigenbeleg) je Abbuchung
  const [eigen, setEigen] = useState<Record<string, EigenForm>>({})
  // v4: ⚡-Automatik über die liegengebliebenen Entwürfe
  // Zuletzt verwendete Kategorien — der Katalog hat >600 Einträge, aber im
  // Alltag wiederholen sich dieselben zehn.
  const [recentKats, setRecentKats] = useState<string[]>([])
  useEffect(() => { setRecentKats(ladeRecentKats()) }, [])
  const merkeKategorie = (id: string) => {
    if (!id) return
    setRecentKats((p) => {
      const next = [id, ...p.filter((x) => x !== id)].slice(0, 8)
      try { localStorage.setItem(KAT_RECENT_KEY, JSON.stringify(next)) } catch { /* Privatmodus */ }
      return next
    })
  }

  /* Race-Schutz für den stillen Nachlauf: Startet ein Refresh, BEVOR ein
   * Beleg gebucht wird, und antwortet er danach, brächte er den Beleg als
   * Entwurf zurück. Deshalb merken wir uns lokal erreichte Stände und
   * stülpen sie über die Server-Antwort, bis der Server nachgezogen hat. */
  const lokalGebucht = useRef<Record<string, { von: number; nach: number }>>({})
  const lokalErledigt = useRef<Set<string>>(new Set())

  // Erfolgsmeldungen verschwinden von selbst; Fehler bleiben stehen.
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 6000)
    return () => clearTimeout(t)
  }, [notice])

  const [bezahltGeladen, setBezahltGeladen] = useState(false)
  const [autoDetails, setAutoDetails] = useState<string[]>([])
  const [autoBusy, setAutoBusy] = useState(false)
  const [autoErgebnis, setAutoErgebnis] = useState('')

  // Hydration-sicher: erst nach Mount messen (SSR kennt kein window)
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 900)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const load = async (days = txDays, mitBezahlten = belegFilter === 'gebucht', still = false) => {
    if (!still) setLoading(true)
    try {
      const [bu, be] = await Promise.all([
        fetch(`/api/buchhaltung?days=${days}${mitBezahlten ? '&bezahlt=1' : ''}`, { cache: 'no-store' }).then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
        fetch('/api/belege', { cache: 'no-store' }).then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
      ])
      if (!bu.ok) throw new Error(bu.j.error ?? 'Buchhaltung nicht ladbar')
      if (mitBezahlten) setBezahltGeladen(true)
      const lok = lokalGebucht.current
      const serverVouchers = (bu.j.vouchers ?? []) as Voucher[]
      const gesehen = new Set(serverVouchers.map((v) => v.id))
      // Belege, die der Server gar nicht mehr liefert (z. B. bezahlt und damit
      // außerhalb des todo-Fensters), haben ihr Ziel erreicht → Merker weg.
      for (const id of Object.keys(lok)) if (!gesehen.has(id)) delete lok[id]
      setVouchers(serverVouchers.map((v) => {
        const m = lok[v.id]
        if (!m) return v
        // Sobald der Server IRGENDETWAS anderes als den Ausgangszustand
        // liefert, hat er nachgezogen — auch wenn es 750 (teilbezahlt) statt
        // der erwarteten 1000 ist. Ein „größer"-Vergleich würde dort ewig
        // kleben und den Beleg dauerhaft falsch anzeigen.
        if (v.status !== m.von) { delete lok[v.id]; return v }
        return { ...v, status: m.nach }
      }))
      setViewer(bu.j.viewer ?? {})
      setOpenTx(bu.j.openTx ?? [])
      setKategorien(bu.j.kategorien ?? [])
      setKostenstellen(bu.j.kostenstellen ?? ['Allgemein'])
      setClearingLabels(bu.j.clearingLabels ?? [])
      setWohnungen(bu.j.wohnungen ?? [])
      // §243ad: VORAB gespeicherte KI-Analysen — Belege öffnen instant
      // (laufende/erledigte Client-States gewinnen über den Server-Cache)
      const ka = (bu.j.kiAnalysen ?? {}) as Record<string, KiVorschlag>
      setKi((p) => {
        const next = { ...p }
        for (const [id, a] of Object.entries(ka)) if (!next[id] && a?.accountDatevId) next[id] = a
        return next
      })
      if (be.ok) {
        // Gleicher Race-Schutz für die Inbox: eine gerade entschiedene Zeile
        // darf ein langsamer Refresh nicht zurückbringen.
        const erledigt = lokalErledigt.current
        const liste = (be.j.belege ?? []) as InboxBeleg[]
        const ids = new Set(liste.map((x) => x.id))
        for (const id of erledigt) if (!ids.has(id)) erledigt.delete(id)
        setInbox(liste.filter((x) => !erledigt.has(x.id)))
      }
      setErr('')
    } catch (e) {
      // Ein stiller Nachlauf darf den Arbeitsfluss nie mit einer roten
      // Fehlermeldung unterbrechen — der lokale Stand bleibt gültig.
      if (!still) setErr(String(e instanceof Error ? e.message : e))
    } finally {
      if (!still) setLoading(false)
    }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /* v4 Batch 3: Nach dem Buchen wird die Liste NICHT mehr neu geladen (das
   * kostet mehrere Sekunden sevdesk-Calls und reißt die Auswahl weg) — der
   * Client pflegt den Stand lokal und holt sich den Server-Stand im Hinter-
   * grund nach. Sichtbar wird das nur, wenn wirklich etwas abweicht.
   * Entprellt, weil sevdesk nur 2 Requests/s verträgt und ein Refresh
   * dutzende Calls auslöst — beim zügigen Abarbeiten liefe man sonst ins
   * Rate-Limit. Der Lauf startet erst, wenn 8 s lang nichts mehr passiert. */
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Der Timer feuert verzögert — er muss den DANN gültigen Filter lesen,
  // sonst wirft er z. B. gerade nachgeladene bezahlte Belege wieder weg.
  const sichtRef = useRef({ days: txDays, gebucht: belegFilter === 'gebucht' })
  useEffect(() => { sichtRef.current = { days: txDays, gebucht: belegFilter === 'gebucht' } }, [txDays, belegFilter])
  const stillerRefresh = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null
      void load(sichtRef.current.days, sichtRef.current.gebucht, true)
    }, 8000)
  }
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current) }, [])

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
  const alleExaktenMatches = (betrag: number | null) =>
    betrag ? openTx.filter((t) => t.betrag < 0 && Math.abs(Math.abs(t.betrag) - betrag) < 0.01) : []
  const exaktesMatch = (betrag: number | null) => alleExaktenMatches(betrag)[0] ?? null

  const fOf = (v: Voucher) => form[v.id] ?? {
    kat: '', tax: '19',
    betrag: v.sumGross && v.sumGross > 0 ? String(v.sumGross) : (betragAusText(v.description) != null ? String(betragAusText(v.description)) : ''),
    kst: v.costCentreName ?? 'Allgemein',
    txId: '', anlagegut: false,
    zuordnung: (viewer[v.id]?.zuordnung ?? null),
  }
  const setF = (id: string, patch: Partial<ReturnType<typeof fOf>>) =>
    setForm((p) => ({ ...p, [id]: { ...(p[id] ?? fOf(vouchers.find((v) => v.id === id)!)), ...patch } }))

  // ✨ KI-Vorschlag beim Öffnen eines Belegs — §243ad: liegt die Analyse
  // schon als Server-Vorab-Cache vor (kiAnalysen aus dem GET), wird nur noch
  // das Formular vorbefüllt, kein API-Call mehr (Beleg öffnet instant)
  useEffect(() => {
    if (section !== 'belege' || !selId) return
    const v = vouchers.find((x) => x.id === selId)
    if (!v) return
    const uebernehmen = (j: KiVorschlag) => {
      // Nur bei EINDEUTIGEM Betrags-Treffer vorbelegen — bei mehreren gleich
      // hohen Abbuchungen wäre die Auswahl Zufall (Nuki 3× 69 €).
      const kandidaten = alleExaktenMatches(j.betrag ?? betragAusText(v.description))
      const match = kandidaten.length === 1 ? kandidaten[0] : null
      setF(selId, {
        kat: String(j.accountDatevId), tax: String(j.taxRate),
        ...(j.betrag ? { betrag: String(j.betrag) } : {}),
        ...(j.anlagegut ? { anlagegut: true } : {}),
        ...(match ? { txId: match.id } : {}),
        // §242b: Gelerntes übernimmt auch KSt + interne Zuordnung
        ...(typeof j.kst === 'string' && j.kst ? { kst: j.kst } : {}),
        ...(j.zuordnung ? { zuordnung: j.zuordnung } : {}),
      })
    }
    const vorhanden = ki[selId]
    if (vorhanden && typeof vorhanden === 'object') {
      if (!form[selId]) uebernehmen(vorhanden)
      return
    }
    if (vorhanden) return // 'laedt' | 'fehler'
    setKi((p) => ({ ...p, [selId]: 'laedt' }))
    post({ action: 'ki-vorschlag', voucherId: selId }).then((j) => {
      setKi((p) => ({ ...p, [selId]: j as KiVorschlag }))
      uebernehmen(j as KiVorschlag)
    }).catch(() => setKi((p) => ({ ...p, [selId]: 'fehler' })))
  }, [section, selId]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Fließband: Während ein Beleg bearbeitet wird, analysiert Claude im
   * Hintergrund schon den nächsten. Ohne das wartet man bei jedem neuen
   * Lieferanten bis zu 20 s auf den Vorschlag. Nur EINER im Voraus — die
   * Analyse wird server-seitig gecacht, ist also nie verschwendet. */
  useEffect(() => {
    if (section !== 'belege' || belegFilter !== 'todo' || !selId) return
    const aktuell = ki[selId]
    if (!aktuell || typeof aktuell !== 'object') return // erst laden lassen
    const naechsteId = nachfolgerIn(rows, selId)
    if (!naechsteId || ki[naechsteId]) return
    if (!vouchers.some((v) => v.id === naechsteId && v.status < 100)) return
    setKi((p) => ({ ...p, [naechsteId]: 'laedt' }))
    post({ action: 'ki-vorschlag', voucherId: naechsteId })
      .then((j) => setKi((p) => ({ ...p, [naechsteId]: j as KiVorschlag })))
      // Scheitert der VORLAUF, darf das den Beleg nicht verbrennen: Eintrag
      // wieder entfernen, damit das Öffnen einen echten zweiten Versuch macht.
      .catch(() => setKi((p) => { const n = { ...p }; delete n[naechsteId]; return n }))
  }, [section, belegFilter, selId, ki]) // eslint-disable-line react-hooks/exhaustive-deps

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
        // §243h: echtes Rechnungsdatum (aus der KI-Analyse) korrigiert das
        // Scan-Datum der Mail-Belege — UStVA-Periode!
        ...((() => { const k = ki[v.id]; return k && typeof k === 'object' && k.datum ? { belegDatum: k.datum } : {} })()),
        /* Der Picker zeigt „Allgemein" als aktiv an, wenn nichts gesetzt ist —
         * gespeichert wurde bisher aber NICHTS. Der Default muss allerdings
         * aus der Kostenstelle folgen: „allgemein" verteilt in der Auswertung
         * auf ALLE Wohnungen und würde eine gesetzte Standort-KSt still
         * aushebeln (lib/auswertung prüft modus VOR der Kostenstelle). */
        zuordnung: f.zuordnung ?? (f.kst && f.kst !== 'Allgemein'
          ? { modus: 'standort' as const, standort: f.kst }
          : { modus: 'allgemein' as const }),
        ...(tx ? { txId: tx.id, txAccountId: tx.bankAccountId, txDate: tx.datum } : {}),
      })
      haptic()
      merkeKategorie(f.kat)
      /* Statt „alles neu laden" (mehrere Sekunden sevdesk) den Stand lokal
       * fortschreiben: der Beleg verlässt die To-do-Liste, eine verknüpfte
       * Abbuchung verschwindet aus den offenen Zahlungen — und der nächste
       * offene Beleg ist sofort da. Der Server-Stand kommt still hinterher. */
      const naechster = nachfolgerIn(rows, v.id)
      const neuerStatus = res.verknuepft ? 1000 : 100
      lokalGebucht.current[v.id] = { von: v.status, nach: neuerStatus }
      setVouchers((p) => p.map((x) => x.id === v.id
        ? { ...x, status: neuerStatus, sumGross: betrag, costCentreName: f.kst }
        : x))
      if (tx && res.verknuepft) setOpenTx((p) => p.filter((x) => x.id !== tx.id))
      const rest = Math.max(0, nTodo - (v.status < 100 ? 1 : 0))
      const kern = res.hinweis
        ? `✓ ${v.supplierName ?? 'Beleg'}: ${res.hinweis}`
        : `✓ ${v.supplierName ?? 'Beleg'} verbucht${res.verknuepft ? ' + Zahlung verknüpft' : ' — wartet auf den Bankabgleich'}${f.anlagegut ? ' · als Anlagegut markiert' : ''}`
      setNotice(rest === 0 ? `${kern} · 🎉 alles erledigt` : `${kern} · noch ${rest} zu erledigen`)
      setSelId(isMobile ? null : naechster)
      nachObenScrollen()
      void stillerRefresh()
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)) } finally { setBusy(null) }
  }

  const inboxDecide = async (b: InboxBeleg, ziel: 'sevdesk' | 'andere' | 'verworfen', bulk = false, firma?: 'ug' | 'gbr') => {
    if (bulk && !confirm(`Alle offenen Belege von „${b.lieferant}“ übernehmen?`)) return
    setBusy(bulk ? 'bulk-' + b.lieferant : b.id); setErr('')
    try {
      const r = await fetch('/api/belege', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(bulk ? { bulkLieferant: b.lieferant } : { id: b.id }), ziel,
          ...(firma ? { firma } : {}),
          ...(ziel === 'sevdesk' ? { kostenstelle: inboxKst[b.id] ?? 'Allgemein' } : {}),
          ...(ziel === 'sevdesk' && inboxZuo[b.id] ? { zuordnung: inboxZuo[b.id] } : {}),
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      haptic()
      const naechster = bulk ? null : nachfolgerIn(rows, b.id)
      for (const x of inbox) {
        if (bulk ? x.lieferant === b.lieferant : x.id === b.id) lokalErledigt.current.add(x.id)
      }
      setInbox((p) => bulk ? p.filter((x) => x.lieferant !== b.lieferant) : p.filter((x) => x.id !== b.id))
      setSelId(bulk || isMobile ? null : naechster)
      nachObenScrollen()
      // §243ad: nach der Einzel-Übernahme läuft die Voll-Automatik mit —
      // Ergebnis („✅ automatisch verbucht" vs. „🧾 zur Prüfung") anzeigen
      if (!bulk && j.autoText) setNotice((j.auto ? '✅ ' : '🧾 ') + (b.lieferant ?? 'Beleg') + ': ' + j.autoText)
      // §271: UG-Beleg → BuchhaltungsButler-Sync-Ergebnis direkt anzeigen
      if (!bulk && j.bb) setNotice('🏢 ' + (b.lieferant ?? 'Beleg') + ' → BuchhaltungsButler · ' + j.bb)
      // Bei „→ sevdesk" entsteht ein neuer Beleg, den nur der Server kennt —
      // der kommt still nach, ohne den Arbeitsfluss zu unterbrechen.
      if (ziel === 'sevdesk') void stillerRefresh()
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)) } finally { setBusy(null) }
  }

  // §243ad: 🗑 sevdesk-Beleg löschen (voucher-delete: bezahlt → Zahlung wird
  // vorher gelöst; Entwurf/offen → direkt weg)
  const belegLoeschen = async (v: Voucher) => {
    const warn = v.status === 1000
      ? `„${v.supplierName ?? 'Beleg'}" ist BEZAHLT — die verknüpfte Zahlung wird gelöst und der Beleg gelöscht. Sicher?`
      : `„${v.supplierName ?? 'Beleg'}" endgültig aus sevdesk löschen?`
    if (!confirm(warn)) return
    setBusy(v.id); setErr('')
    try {
      await post({ action: 'voucher-delete', voucherId: v.id, confirm: 'DELETE' })
      haptic()
      setVouchers((p) => p.filter((x) => x.id !== v.id))
      setSelId(null)
      setNotice(`🗑 ${v.supplierName ?? 'Beleg'} gelöscht.`)
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

  const eigenOf = (t: Tx): EigenForm => eigen[t.id] ?? { typ: '', empfaenger: t.von || '', zweck: '', taxRate: '0', zins: '', kat: '', kst: 'Allgemein', zuordnung: null }
  const setEigenF = (id: string, t: Tx, patch: Partial<EigenForm>) =>
    setEigen((p) => ({ ...p, [id]: { ...eigenOf(t), ...p[id], ...patch } }))

  // §243g/§243ad: 📸 Beleg-Upload → sevdesk + Voll-Automatik.
  // KEIN capture-Attribut mehr — iOS zeigt so die native Auswahl
  // „Fotomediathek / Foto aufnehmen / Dateien" (inkl. Dokumente-Scanner).
  // Mehrere Fotos in EINER Auswahl = EIN mehrseitiger Beleg → Client-PDF.
  const [fotoBusy, setFotoBusy] = useState(false)
  const [fotoErgebnis, setFotoErgebnis] = useState('')
  // §256: Fotos laufen erst durch den Dokumentenscanner (Zuschnitt/Aufhellung)
  const [scanBilder, setScanBilder] = useState<File[] | null>(null)
  const scanPdfs = useRef<File[]>([])
  const bildZuJpeg = async (file: File): Promise<Uint8Array> => {
    // Scanner-Seiten sind schon JPEG ≤2000px — nicht erneut encodieren
    if (file.type === 'image/jpeg' && /^beleg-scan-/.test(file.name)) return new Uint8Array(await file.arrayBuffer())
    const bmp = await createImageBitmap(file)
    const s = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bmp.width * s))
    canvas.height = Math.max(1, Math.round(bmp.height * s))
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob: Blob = await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error('Bild-Konvertierung fehlgeschlagen'))), 'image/jpeg', 0.88))
    return new Uint8Array(await blob.arrayBuffer())
  }
  const uploadEinzeln = async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    const r = await fetch('/api/buchhaltung/upload', { method: 'POST', body: fd })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
    return j as { auto?: boolean; lieferant?: string; text?: string }
  }
  const fotoUpload = async (list: File[]) => {
    if (!list.length) return
    setFotoBusy(true); setFotoErgebnis(''); setErr('')
    try {
      const pdfs = list.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
      const bilder = list.filter((f) => !pdfs.includes(f))
      const uploads: File[] = [...pdfs]
      if (bilder.length === 1) uploads.push(bilder[0])
      else if (bilder.length > 1) {
        const { PDFDocument } = await import('pdf-lib')
        const doc = await PDFDocument.create()
        for (const b of bilder) {
          const jpg = await doc.embedJpg(await bildZuJpeg(b))
          const page = doc.addPage([jpg.width, jpg.height])
          page.drawImage(jpg, { x: 0, y: 0, width: jpg.width, height: jpg.height })
        }
        const bytes = await doc.save()
        uploads.push(new File([bytes as unknown as BlobPart], `scan-${bilder.length}-seiten.pdf`, { type: 'application/pdf' }))
      }
      let letztes: { auto?: boolean; lieferant?: string; text?: string } = {}
      for (const f of uploads) letztes = await uploadEinzeln(f)
      haptic()
      const prefix = uploads.length > 1 ? `${uploads.length} Belege · zuletzt ` : ''
      setFotoErgebnis(prefix + (letztes.auto ? '✅ ' : '🧾 ') + (letztes.lieferant ?? 'Beleg') + ' — ' + (letztes.text ?? 'angelegt'))
      await load()
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)) } finally { setFotoBusy(false) }
  }

  const eigenbelegBuchen = async (t: Tx) => {
    const f = eigenOf(t)
    setBusy(t.id); setErr('')
    try {
      const j = await post({
        action: 'eigenbeleg', typ: f.typ,
        betrag: Math.abs(t.betrag),
        empfaenger: f.empfaenger.trim(), zweck: f.zweck.trim(),
        txId: t.id, txAccountId: t.bankAccountId, txDate: t.datum,
        ...(t.betrag > 0 ? { richtung: 'eingang' } : {}),
        ...(f.typ === 'miete' ? { taxRate: Number(f.taxRate) } : {}),
        ...(f.typ === 'kredit' ? { zinsAnteil: Number(String(f.zins).replace(',', '.')) } : {}),
        ...(f.typ === 'sonstiges' ? { accountDatevId: Number(f.kat), taxRate: Number(f.taxRate) } : {}),
        ...(f.kst && f.kst !== 'Allgemein' ? { kostenstelle: f.kst } : {}),
        ...(f.zuordnung ? { zuordnung: f.zuordnung } : {}),
      }) as { hinweis?: string }
      haptic()
      setOpenTx((p) => p.filter((x) => x.id !== t.id))
      setSelId(null)
      // Ein „hinweis" heißt: gebucht, aber die Zahlung hing quer (z. B. die
      // Bank-Automatik war schneller) — das ist kein Fehler, also grün.
      if (f.typ === 'sonstiges' && f.kat) merkeKategorie(f.kat)
      setNotice(j?.hinweis ? `✓ Eigenbeleg gebucht — ${j.hinweis}` : `✓ Eigenbeleg gebucht · ${f.empfaenger.trim() || 'ohne Empfänger'}`)
      void stillerRefresh()
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)) } finally { setBusy(null) }
  }

  const gefilterteTx = useMemo(() => openTx.filter((t) =>
    txRichtung === 'alle' ? true : txRichtung === 'eingang' ? t.betrag > 0 : t.betrag < 0), [openTx, txRichtung])

  interface Row { id: string; titel: string; sub: string; betrag: string | null; farbe: string; avatar: ReactNode; tags?: string[] }
  const rows: Row[] = useMemo(() => {
    // §243ad: EIN Belege-Reiter — Inbox-Zeilen (Gesellschaft entscheiden)
    // stehen gekennzeichnet VOR den sevdesk-Belegen; „Gebucht" zeigt St1000
    if (section === 'belege') {
      const inboxRows: Row[] = belegFilter !== 'todo' ? [] : inbox.map((b) => ({
        id: b.id, titel: b.lieferant ?? '?',
        sub: `⚠️ Zuordnung offen · ${fmtD(b.datum) ?? '—'}${b.eingereichtOrt ? ` · 👤 ${b.eingereichtOrt}` : ''} · ${(b.subject ?? '').slice(0, 36)}`,
        betrag: b.betrag != null ? eur(b.betrag) : null, farbe: INK,
        avatar: <Avatar name={b.lieferant ?? '?'} />,
      }))
      const vRows: Row[] = vouchers
        .filter((v) => belegFilter === 'gebucht' ? v.status === 1000
          : belegFilter === 'bank' ? (v.status >= 100 && v.status < 1000)
          : v.status < 100)
        .map((v) => {
          const k = ki[v.id]
          const kiObj = k && typeof k === 'object' ? k : null
          // Betrag: sevdesk → aus der Beschreibung → aus der KI-Analyse.
          // Ohne den dritten Schritt bleiben Entwurfs-Zeilen ohne jede Zahl.
          const betrag = v.sumGross && v.sumGross > 0 ? v.sumGross : (betragAusText(v.description) ?? kiObj?.betrag ?? null)
          const marke = v.status === 1000 ? '✓ Gebucht · ' : v.status >= 100 ? '🏦 Wartet auf Bank · ' : ''
          // Signale, damit man den durchwinkbaren Beleg von der Denkarbeit
          // unterscheidet, ohne ihn zu öffnen.
          const tags: string[] = []
          if (v.status < 100) {
            if (kiObj?.accountDatevId) tags.push('✨')
            if (betrag != null && alleExaktenMatches(betrag).length === 1) tags.push('💳')
          }
          return {
            id: v.id, titel: v.supplierName ?? '?',
            sub: `${marke}${fmtD(v.voucherDate) ?? '—'} · ${(v.description ?? '').replace(/^(Beleg|Provisionsrechnung) \((automatisch aus E-Mail|aus Beleg-Inbox)\): /, '').slice(0, 48)}`,
            betrag: betrag != null ? eur(betrag) : null, farbe: INK,
            avatar: <Avatar name={v.supplierName ?? '?'} />,
            tags,
          }
        })
      return [...inboxRows, ...vRows]
    }
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
    // ki + openTx gehören in die Abhängigkeiten: sie speisen die Signal-Chips
  }, [section, belegFilter, inbox, vouchers, gefilterteTx, ki, openTx]) // eslint-disable-line react-hooks/exhaustive-deps

  const sel = {
    inbox: inbox.find((b) => b.id === selId) ?? null,
    voucher: vouchers.find((v) => v.id === selId) ?? null,
    tx: gefilterteTx.find((t) => t.id === selId) ?? null,
  }
  const detailOffen = Boolean(selId && (sel.inbox || sel.voucher || sel.tx))

  /* Die Erfolgsmeldung erscheint dort, wo der Blick beim Buchen ist: als
   * schwebender Toast unten. Vorher hing sie oben über der Seite — beim
   * Abarbeiten stand man unten am Button und sah sie schlicht nie. */
  const Banner = ({ text, tone, onClose }: { text: string; tone: 'rot' | 'gruen'; onClose: () => void }) => {
    const rot = tone === 'rot'
    return (
      <div style={{
        position: 'fixed', left: 0, right: 0, zIndex: rot ? 41 : 40,
        // Über der sticky Aktionsleiste (Verbuchen + Überspringen ≈ 108 px),
        // sonst verdeckt der Toast genau den Knopf, der als Nächstes kommt.
        // Der Fehler-Toast sitzt noch eine Etage höher — er darf nie unter
        // einer 6 s stehenden Erfolgsmeldung verschwinden.
        bottom: `calc(${rot ? 196 : 124}px + env(safe-area-inset-bottom))`,
        padding: '0 16px', pointerEvents: 'none',
      }}>
        <div style={{
          maxWidth: 620, margin: '0 auto',
          // Erfolg blockiert keine Klicks (verschwindet ohnehin von selbst),
          // nur der Fehler-Toast ist bedienbar (✕).
          pointerEvents: rot ? 'auto' : 'none',
          background: rot ? '#FFEBE9' : '#E9F8EE', color: rot ? RED : GREEN,
          borderRadius: 14, padding: '12px 15px', fontSize: 14, display: 'flex', gap: 10, alignItems: 'center',
          boxShadow: '0 8px 28px rgba(0,0,0,0.18)', border: `0.5px solid ${rot ? '#F5C6C2' : '#BDE5CB'}`,
        }}>
          <span style={{ flex: 1 }}>{text}</span>
          {rot && <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 700, fontSize: 15 }}>✕</button>}
        </div>
      </div>
    )
  }

  // ── Detail-Inhalte ──
  const renderDetail = () => {
    if (section === 'belege' && sel.inbox) {
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
            {(b.eingereichtOrt || b.eingereichtNotiz) && (
              <div style={{ fontSize: 13.5, color: '#1D4ED8', background: 'rgba(10,132,255,0.08)', borderRadius: 12, padding: '10px 13px', lineHeight: 1.45 }}>
                👤 Vom Team eingereicht{b.eingereichtOrt ? ` · ${b.eingereichtOrt}` : ''}{b.eingereichtNotiz ? ` — „${b.eingereichtNotiz}"` : ''}
              </div>
            )}
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
                <button onClick={() => inboxDecide(b, 'andere', false, 'ug')} disabled={busy === b.id} style={{ ...BTN, flex: 1, background: 'rgba(10,132,255,0.12)', color: '#0A84FF' }}>🏢 Immobilien UG → BB</button>
                <button onClick={() => inboxDecide(b, 'andere', false, 'gbr')} disabled={busy === b.id} style={{ ...BTN, flex: 1, background: 'rgba(10,132,255,0.06)', color: '#5A6B7A' }}>GbR (Archiv)</button>
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
      const mehrfachMatch = alleExaktenMatches(Number.isFinite(betragNum) ? betragNum : null)
      const match = mehrfachMatch[0] ?? null
      // Zum Überspringen nur der ECHTE Nachfolger — nachfolgerIn fällt sonst
      // auf den Vorgänger zurück und man tippt zwischen zwei Belegen hin und her.
      const idx = rows.findIndex((r) => r.id === v.id)
      const naechsterOffenerId = belegFilter === 'todo' ? (rows[idx + 1]?.id ?? null) : null
      return (
        <div style={{ display: 'grid', gap: 14 }}>
          <PdfViewer links={viewer[v.id]?.links?.length
            ? viewer[v.id].links
            : [{ name: 'Beleg ansehen (aus sevdesk)', url: '/api/buchhaltung/beleg-pdf?voucherId=' + v.id }]} />
          <div style={{ ...CARD, padding: 18, display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Avatar name={v.supplierName ?? '?'} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 19, fontWeight: 700, color: INK, letterSpacing: -0.3 }}>{v.supplierName ?? '?'}</div>
                <div style={{ fontSize: 13, color: SUB, marginTop: 1 }}>{fmtD(v.voucherDate) ?? 'ohne Datum'} · {v.status === 50 ? 'Entwurf' : v.status === 750 ? 'teilbezahlt' : v.status === 1000 ? '✓ gebucht & bezahlt' : '🏦 kategorisiert — wartet auf den Bankabgleich'}</div>
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
                {k.waehrung && k.waehrung !== 'EUR' && (
                  <div style={{ fontSize: 13, color: '#92400E', lineHeight: 1.45, background: '#FEF3C7', borderRadius: 8, padding: '7px 9px' }}>
                    ⚠️ {k.waehrung}-Rechnung — wähle unten die passende Bank-Abbuchung, gebucht wird deren EUR-Betrag (nie der {k.waehrung}-Betrag).
                  </div>
                )}
                {k.steuerHinweis && <div style={{ fontSize: 13, color: '#5C4D18', lineHeight: 1.45, borderTop: '0.5px solid #E6D9AE', paddingTop: 7 }}>💡 {k.steuerHinweis}</div>}
                {k.anlagegut && <div style={{ fontSize: 13, fontWeight: 700, color: '#9A3412' }}>🏗 Anlagegut — Abschreibung über {k.nutzungsdauer ?? '?'} Jahre. Der Schalter unten ist gesetzt; die Nutzungsdauer bestätigst du einmal in sevdesk.</div>}
              </div>
            )}

            <div style={{ display: 'grid', gap: 13, gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))', alignItems: 'end' }}>
              <div>
                <div style={LABEL}>Kategorie</div>
                <KategorieWahl key={v.id} value={f.kat} onChange={(x) => setF(v.id, { kat: x })} kategorien={kategorien} recent={recentKats} />
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
              {/* Bei wiederkehrenden Beträgen (3× Nuki 69 €) ist „passt exakt"
                  eine Falle — dann muss der Mensch die richtige auswählen. */}
              {mehrfachMatch.length > 1 ? (
                <div style={{ fontSize: 13, fontWeight: 700, color: '#92400E', background: '#FEF3C7', borderRadius: 9, padding: '7px 9px', margin: '0 0 7px' }}>
                  ⚠️ {mehrfachMatch.length} Abbuchungen über {eur(mehrfachMatch[0].betrag)} passen — bitte die richtige auswählen ({mehrfachMatch.map((t) => fmtD(t.datum)).join(' · ')}).
                </div>
              ) : match && f.txId === match.id && (
                <div style={{ fontSize: 13, fontWeight: 700, color: GREEN, margin: '0 4px 6px' }}>✓ Vorschlag: Abbuchung {eur(match.betrag)} vom {fmtD(match.datum)} passt exakt</div>
              )}
              <select value={f.txId} onChange={(e) => {
                const txId = e.target.value
                const t = openTx.find((x) => x.id === txId)
                // v4: leeres Betragsfeld bzw. Fremdwährungs-Rechnung → der
                // Bank-EUR-Betrag der gewählten Zahlung IST der Buchungsbetrag
                const kiV = ki[v.id]
                const fremd = typeof kiV === 'object' && !!kiV.waehrung && kiV.waehrung !== 'EUR'
                const leer = !parseFloat(f.betrag.replace(',', '.'))
                setF(v.id, { txId, ...(t && (fremd || leer) ? { betrag: String(Math.abs(t.betrag)) } : {}) })
              }} style={SELECT}>
                <option value="">— keine · später über den Bankabgleich —</option>
                {txKandidaten(Number.isFinite(betragNum) ? betragNum : null).map((t) => (
                  <option key={t.id} value={t.id}>{fmtD(t.datum)} · {eur(t.betrag)} · {(t.von || t.zweck).slice(0, 40)}</option>
                ))}
              </select>
            </div>

            <ZuordnungPicker value={f.zuordnung} onChange={(z) => setF(v.id, { zuordnung: z })} wohnungen={wohnungen} />

            {/* Der Verbuchen-Knopf klebt am unteren Rand — beim Abarbeiten
                liegen sonst ~900 px Scrollstrecke zwischen Prüfen und Buchen. */}
            <div style={{
              position: 'sticky', bottom: 0, zIndex: 5, display: 'grid', gap: 9,
              background: 'linear-gradient(to top, #fff 62%, rgba(255,255,255,0))',
              padding: '12px 0 calc(4px + env(safe-area-inset-bottom))', margin: '-4px -2px 0',
            }}>
              <button onClick={() => verbuchen(v)} disabled={busy === v.id} style={{ ...BTN, background: GOLD, color: '#fff', fontSize: 16.5 }}>
                {busy === v.id ? '⏳ Verbuche…' : v.status >= 100 ? 'Erneut buchen (Zahlung wird neu verknüpft)' : `Verbuchen${f.txId ? ' + Zahlung zuordnen' : ''}`}
              </button>
              {naechsterOffenerId && (
                <button onClick={() => { haptic(); setSelId(naechsterOffenerId); nachObenScrollen() }} disabled={busy === v.id}
                  style={{ ...BTN, background: '#F2F2F7', color: INK, fontSize: 15 }}>
                  Überspringen → nächster Beleg
                </button>
              )}
            </div>
            <button onClick={() => belegLoeschen(v)} disabled={busy === v.id}
              style={{ ...BTN, background: 'rgba(215,0,21,0.08)', color: RED }}>
              🗑 Beleg löschen{v.status === 1000 ? ' (löst die Zahlung)' : ''}
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
          {(() => {
            // §243g: WARUM ist diese Zahlung unzugeordnet? — Heuristik-Hinweis
            const portal = /booking|airbnb|expedia|hometogo|vrbo|fewo|homeaway/i.test(t.von)
            const wiederkehrend = openTx.filter(x => Math.abs(Math.abs(x.betrag) - Math.abs(t.betrag)) < 0.005).length >= 3
            const intern = /trimosa|steuerr/i.test(t.von)
            const hinweis = t.betrag < 0 && portal
              ? '📦 Vermutlich SAMMEL-Lastschrift des Portals — die Einzel-Belege sind in sevdesk; die Aufteilung auf mehrere Belege macht der sevdesk-Bankabgleich (Splitten).'
              : intern
              ? '🔄 Vermutlich Übertrag zwischen euren eigenen Konten — „Kein Beleg nötig" oder in sevdesk als Umbuchung.'
              : wiederkehrend
              ? '🔁 Wiederkehrender Betrag — Miete, Kreditrate oder Abo ohne Mail-Rechnung? → unten „Ohne Beleg buchen" oder 📸 Beleg im Belege-Reiter hochladen.'
              : null
            return hinweis ? (
              <div style={{ fontSize: 13, color: SUB, background: GROUP_BG, borderRadius: 12, padding: '10px 13px', lineHeight: 1.45 }}>{hinweis}</div>
            ) : null
          })()}
          {t.betrag !== 0 && (() => {
            const istEingang = t.betrag > 0
            const f = eigenOf(t)
            const zinsNum = Number(String(f.zins).replace(',', '.'))
            const tilgung = Number.isFinite(zinsNum) ? Math.round((Math.abs(t.betrag) - zinsNum) * 100) / 100 : null
            const bereit = f.empfaenger.trim() && f.zweck.trim()
              && (f.typ !== 'kredit' || (Number.isFinite(zinsNum) && zinsNum >= 0 && zinsNum <= Math.abs(t.betrag)))
              && (f.typ !== 'sonstiges' || f.kat)
              && (!istEingang || f.typ === 'privat' || f.typ === 'sonstiges')
            // §243o: bei EINGAENGEN nur Privateinlage / Sonstiges (Erstattung)
            const typen = istEingang
              ? ([['privat', '👤 Privateinlage'], ['sonstiges', '📦 Erstattung / Sonstiges']] as const)
              : ([['miete', '🏠 Miete/Pacht'], ['kredit', '🏦 Kreditrate'], ['privat', '👤 Privat'], ['sonstiges', '📦 Sonstiges']] as const)
            return (
              <div style={{ display: 'grid', gap: 12 }}>
                <div>
                  <div style={LABEL}>{istEingang ? '📘 Eingang ohne Beleg buchen — Eigenbeleg wird automatisch erstellt' : '📘 Ohne Beleg buchen — Eigenbeleg wird automatisch erstellt'}</div>
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                    {typen.map(([k, lbl]) => (
                      <button key={k} onClick={() => { haptic(); setEigenF(t.id, t, { typ: f.typ === k ? '' : k }) }} style={{
                        fontSize: 13.5, fontWeight: 600, padding: '7px 12px', borderRadius: 999, cursor: 'pointer',
                        border: f.typ === k ? `1.5px solid ${GOLD}` : `0.5px solid ${HAIRLINE}`,
                        background: f.typ === k ? 'rgba(18,34,46,0.08)' : '#fff', color: f.typ === k ? GOLD : INK,
                        WebkitTapHighlightColor: 'transparent',
                      }}>{lbl}</button>
                    ))}
                  </div>
                </div>
                {f.typ && (
                  <div style={{ display: 'grid', gap: 12 }}>
                    <div>
                      <div style={LABEL}>{istEingang ? 'Zahlender / Absender' : 'Zahlungsempfänger'}</div>
                      <input value={f.empfaenger} onChange={(e) => setEigenF(t.id, t, { empfaenger: e.target.value })} placeholder={istEingang ? 'z. B. TRIMOSA Immobilien UG' : 'z. B. Vermieter / Bank'} style={SELECT} />
                    </div>
                    <div>
                      <div style={LABEL}>Zweck</div>
                      <input value={f.zweck} onChange={(e) => setEigenF(t.id, t, { zweck: e.target.value })} placeholder={f.typ === 'miete' ? 'z. B. Miete August 2026, Objekt …' : f.typ === 'kredit' ? 'z. B. Darlehensrate August, Volksbank …' : 'Wofür war die Zahlung?'} style={SELECT} />
                    </div>
                    {f.typ === 'miete' && (
                      <div>
                        <div style={LABEL}>Umsatzsteuer im Mietvertrag</div>
                        <select value={f.taxRate} onChange={(e) => setEigenF(t.id, t, { taxRate: e.target.value })} style={SELECT}>
                          <option value="0">ohne USt-Ausweis (üblich bei privaten Vermietern)</option>
                          <option value="19">19 % ausgewiesen (Option nach §9 UStG)</option>
                        </select>
                      </div>
                    )}
                    {f.typ === 'kredit' && (
                      <div>
                        <div style={LABEL}>Zinsanteil der Rate (aus dem Tilgungsplan)</div>
                        <input value={f.zins} onChange={(e) => setEigenF(t.id, t, { zins: e.target.value })} placeholder="z. B. 210,50" inputMode="decimal" style={SELECT} />
                        {Number.isFinite(zinsNum) && f.zins !== '' && tilgung != null && tilgung >= 0 && (
                          <div style={{ fontSize: 12.5, color: SUB, margin: '6px 4px 0', lineHeight: 1.4 }}>
                            Zins {eur(zinsNum)} (absetzbar) · Tilgung {eur(tilgung)} (neutral — nie Betriebsausgabe)
                          </div>
                        )}
                      </div>
                    )}
                    {f.typ === 'sonstiges' && (
                      <>
                        <div>
                          <div style={LABEL}>Kategorie</div>
                          <KategorieWahl value={f.kat} onChange={(x) => setEigenF(t.id, t, { kat: x })} kategorien={kategorien} recent={recentKats} />
                        </div>
                        <div>
                          <div style={LABEL}>Steuersatz</div>
                          <select value={f.taxRate} onChange={(e) => setEigenF(t.id, t, { taxRate: e.target.value })} style={SELECT}>
                            <option value="0">0 %</option><option value="7">7 %</option><option value="19">19 %</option>
                          </select>
                        </div>
                      </>
                    )}
                    {f.typ !== 'privat' && (
                      <div>
                        <div style={LABEL}>sevdesk-Kostenstelle</div>
                        <select value={f.kst} onChange={(e) => setEigenF(t.id, t, { kst: e.target.value })} style={SELECT}>
                          {kostenstellen.map((kk) => <option key={kk} value={kk}>{kk}</option>)}
                        </select>
                      </div>
                    )}
                    {f.typ !== 'privat' && (
                      <ZuordnungPicker value={f.zuordnung} onChange={(z) => setEigenF(t.id, t, { zuordnung: z })} wohnungen={wohnungen} />
                    )}
                    <button onClick={() => eigenbelegBuchen(t)} disabled={busy === t.id || !bereit} style={{ ...BTN, background: bereit ? GOLD : 'rgba(118,118,128,0.16)', color: bereit ? '#fff' : SUB }}>
                      {busy === t.id ? '⏳ Erstelle Eigenbeleg…' : '📘 Eigenbeleg erstellen & buchen'}
                    </button>
                  </div>
                )}
              </div>
            )
          })()}
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
          <button onClick={() => ignorieren(t)} disabled={busy === t.id} style={{ ...BTN, background: 'rgba(118,118,128,0.12)', color: INK }}>Kein Beleg nötig · wird in sevdesk als privat markiert</button>
        </div>
      )
    }

    return (
      <div style={{ textAlign: 'center', color: SUB, padding: '90px 24px', fontSize: 15, lineHeight: 1.6 }}>
        {section === 'belege' && <>🧾<br />Beleg auswählen — ✨ hat Kategorie, Steuer & Zahlung schon vorbereitet.</>}
        {section === 'zahlungen' && <>💳<br />Zahlung auswählen.</>}
      </div>
    )
  }

  // Der Zähler zeigt nur echte To-dos — Belege im Bankabgleich verlangen
  // nichts von uns und blähten die Zahl früher unnötig auf.
  const nTodo = inbox.length + vouchers.filter((v) => v.status < 100).length
  const nBank = vouchers.filter((v) => v.status >= 100 && v.status < 1000).length
  const SEG: [typeof section, string, number][] = [
    ['belege', '🧾 Belege', nTodo],
    ['zahlungen', '💳 Zahlungen', openTx.length],
  ]

  return (
    <div style={{ minHeight: '100dvh', background: GROUP_BG, display: 'flex', flexDirection: 'column', WebkitFontSmoothing: 'antialiased', overflowX: 'clip' }}>
      {/* ── Kopf ── */}
      <header style={{ background: NAVY, color: '#fff', padding: 'max(12px, env(safe-area-inset-top)) 16px 12px', position: 'sticky', top: 0, zIndex: 20 }}>
        {/* §243af: iOS-Navigation-Muster — kleine Aktions-Zeile oben, Large
            Title darunter (die alte Ein-Zeilen-Variante lief mobil über) */}
        <div style={{ maxWidth: 1240, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, whiteSpace: 'nowrap' }}>
            <div style={{ fontSize: 10.5, color: GOLDL, letterSpacing: 2.4, fontWeight: 700 }}>TRIMOSA</div>
            <div style={{ flex: 1 }} />
            <button onClick={() => { haptic(); load() }} title="Aktualisieren" style={{ background: 'none', border: 'none', color: '#fff', fontSize: 17, cursor: 'pointer', padding: '2px 4px' }}>↻</button>
            <a href="/team" style={{ fontSize: 13.5, color: GOLDL, fontWeight: 600, textDecoration: 'none' }}>Team-App ›</a>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
            <div style={{ fontSize: 25, fontWeight: 800, letterSpacing: -0.5, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Buchhaltung</div>
            <a href="/buchhaltung/auswertung" style={{
              fontSize: 13.5, color: '#fff', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap',
              background: 'rgba(227,200,120,0.22)', borderRadius: 999, padding: '6px 13px', flexShrink: 0,
            }}>📊 Auswertung</a>
          </div>
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
        <div style={{ display: (isMobile && detailOffen) ? 'none' : 'block', minWidth: 0 }}>
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
          {section === 'belege' && (
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', margin: '2px 2px 12px' }}>
              <Chip active={belegFilter === 'todo'} onClick={() => { setBelegFilter('todo'); setSelId(null) }}>
                {nTodo ? `Zu erledigen · ${nTodo}` : 'Zu erledigen'}
              </Chip>
              <Chip active={belegFilter === 'bank'} onClick={() => { setBelegFilter('bank'); setSelId(null) }}>
                {nBank ? `🏦 Wartet auf Bank · ${nBank}` : '🏦 Wartet auf Bank'}
              </Chip>
              <Chip active={belegFilter === 'gebucht'} onClick={() => {
                setBelegFilter('gebucht'); setSelId(null)
                // §243ad: bezahlte Belege on-demand nachladen (GET ?bezahlt=1).
                // Der Merker MUSS ein eigener State sein — aus den Daten
                // abgeleitet („gibt es schon einen 1000er?") wäre er nach der
                // ersten optimistischen Buchung fälschlich true und der
                // Reiter bliebe leer.
                if (!bezahltGeladen) load(txDays, true)
              }}>✓ Gebucht</Chip>
              {belegFilter === 'todo' && vouchers.filter((v) => v.status === 50).length > 0 && (
                <button
                  disabled={autoBusy}
                  onClick={async () => {
                    setAutoBusy(true); setAutoErgebnis(''); setAutoDetails([]); setErr('')
                    try {
                      const j = await post({ action: 'auto-batch', limit: 15 })
                      setAutoErgebnis(`⚡ ${j.auto} automatisch verbucht · ${j.brauchenDich} brauchen dich${j.uebrig > 0 ? ` · ${j.uebrig} übrig (nochmal tippen)` : ''}`)
                      // Der Server sagt je liegengebliebenem Beleg WARUM —
                      // das ist die Arbeitsliste für die nächsten Minuten.
                      setAutoDetails(Array.isArray(j.details) ? (j.details as string[]) : [])
                      await load()
                    } catch (e) {
                      setErr(String(e instanceof Error ? e.message : e))
                    } finally { setAutoBusy(false) }
                  }}
                  style={{
                    border: 'none', borderRadius: 999, padding: '7px 13px', fontSize: 13, fontWeight: 600,
                    background: autoBusy ? '#E5E5EA' : '#12222E', color: autoBusy ? '#8E8E93' : '#E3C878',
                    cursor: autoBusy ? 'wait' : 'pointer', WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  {autoBusy ? '⏳ Automatik läuft…' : `⚡ Automatik (${vouchers.filter((v) => v.status === 50).length})`}
                </button>
              )}
              {autoErgebnis && <span style={{ flexBasis: '100%', fontSize: 12.5, color: '#166534', padding: '2px 4px' }}>{autoErgebnis}</span>}
              {belegFilter === 'bank' && (
                <span style={{ flexBasis: '100%', fontSize: 12.5, color: SUB, padding: '2px 4px' }}>
                  Diese Belege sind fertig kategorisiert — sie warten nur darauf, dass sevdesk die Zahlung zuordnet. Hier ist nichts zu tun.
                </span>
              )}
              {autoDetails.length > 0 && (
                <div style={{ flexBasis: '100%', fontSize: 12.5, color: SUB, lineHeight: 1.5, padding: '2px 4px' }}>
                  {autoDetails.slice(0, 8).map((d, i) => <div key={i}>· {d}</div>)}
                  {autoDetails.length > 8 && <div>· … und {autoDetails.length - 8} weitere</div>}
                </div>
              )}
            </div>
          )}
          {section === 'belege' && belegFilter === 'todo' && (
            <div style={{ marginBottom: 12 }}><BbCard /></div>
          )}
          {section === 'belege' && belegFilter === 'todo' && (
            <label style={{
              ...CARD, display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px',
              marginBottom: 12, cursor: fotoBusy ? 'wait' : 'pointer', WebkitTapHighlightColor: 'transparent',
            }}>
              <span style={{
                width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 19, background: 'rgba(176,145,43,0.14)',
              }}>📸</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: INK }}>
                  {fotoBusy ? '⏳ Claude liest den Beleg…' : 'Beleg hochladen — Foto, Scan oder Datei'}
                </span>
                <span style={{ display: 'block', fontSize: 12.5, color: SUB, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {fotoErgebnis || 'Fotos werden automatisch zugeschnitten · mehrere Fotos = ein Beleg · KI verbucht'}
                </span>
              </span>
              <input type="file" accept="image/*,application/pdf" multiple disabled={fotoBusy}
                style={{ display: 'none' }}
                onChange={(e) => {
                  const fs = Array.from(e.target.files ?? []); e.target.value = ''
                  if (!fs.length) return
                  // §256: Bilder → Dokumentenscanner, PDFs direkt hochladen
                  const pdfs = fs.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
                  const bilder = fs.filter((f) => !pdfs.includes(f))
                  if (bilder.length) { scanPdfs.current = pdfs; setScanBilder(bilder) }
                  else fotoUpload(pdfs)
                }} />
            </label>
          )}
          {scanBilder && (
            <DocScanner files={scanBilder}
              onCancel={() => setScanBilder(null)}
              onDone={(jpegs) => { setScanBilder(null); fotoUpload([...scanPdfs.current, ...jpegs]) }} />
          )}
          {loading && <div style={CARD}><SkeletonRows kind="chat" count={7} /></div>}
          {!loading && !rows.length && (
            <div style={{ ...CARD, padding: '36px 24px', textAlign: 'center', color: SUB, fontSize: 15 }}>
              {section !== 'belege' ? 'Keine offenen Zahlungen im Zeitraum.'
                : belegFilter === 'bank' ? 'Nichts wartet auf den Bankabgleich.'
                : belegFilter === 'gebucht' ? 'Noch keine gebuchten Belege im geladenen Zeitraum.'
                : '🎉 Hier ist alles erledigt.'}
            </div>
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
                    <span style={{ display: 'block', fontSize: 13, color: SUB, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.tags && item.tags.length > 0 && (
                        <span title="✨ Vorschlag liegt bereit · 💳 Zahlung passt exakt">{item.tags.join('')} </span>
                      )}{item.sub}
                    </span>
                  </span>
                  {item.betrag && <span style={{ fontSize: 15.5, fontWeight: 600, color: item.farbe, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', letterSpacing: -0.2 }}>{item.betrag}</span>}
                  <span style={{ color: '#C7C7CC', fontSize: 16, flexShrink: 0 }}>›</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail */}
        <div style={{ display: (isMobile && !detailOffen) ? 'none' : 'block', minWidth: 0 }}>
          {isMobile && detailOffen && (
            <button onClick={() => { haptic(); setSelId(null) }} style={{ background: 'none', border: 'none', color: GOLD, fontWeight: 600, fontSize: 16, cursor: 'pointer', padding: '0 0 12px', WebkitTapHighlightColor: 'transparent' }}>‹ Zurück</button>
          )}
          {renderDetail()}
        </div>
      </main>
    </div>
  )
}
