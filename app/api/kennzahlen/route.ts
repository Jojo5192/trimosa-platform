import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTaskAuth } from '@/lib/tasks'

/**
 * 📈 Kennzahlen + Ausblick fürs Belegungs-Tab (Pascal-Prompt 8.9., Punkt 5 —
 * Baustein ⑤). NUR Admins/Gastgeber (getTaskAuth-Rolle „admin", wie die
 * Buchungspreise im Kalender §139) — alle anderen bekommen 403, damit die
 * Karte im Client gar nicht erst erscheint. ?probe=1 = reiner Rechte-Check.
 *
 * GET ?monat=YYYY-MM → { summen, wohnungen, ausblick }
 *   - Netto = Buchungspreis ÷ 1,07 (Beherbergung 7 % USt).
 *   - Buchungen zählen ANTEILIG nach Nächten im Monat (Nacht = jedes Datum
 *     von check_in bis vor check_out); nur bestätigte, bei Direkt bezahlte
 *     Aufenthalte mit Preis > 0 (Eigenbelegung/Sperren fallen raus).
 *   - Auslastung = belegte Nächte ÷ (aktive Wohnungen × Tage im Monat).
 *   - Ausblick = die nächsten 6 Monate ab HEUTE (unabhängig vom gewählten
 *     Monat): gebuchter Netto-Umsatz, Vorjahresmonat, Ziel = VJ + 5 % oder
 *     ein manueller Wert aus app_settings.kennzahlen_ziele.
 * PUT { monat, ziel|null } → Ziel-Override setzen/löschen.
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

/** Umsatzsteuer auf Beherbergung (§ 12 Abs. 2 Nr. 11 UStG). */
const UST_PCT = 7
/** Ziel = Vorjahresmonat + 5 % (Pascal). */
const ZIEL_AUFSCHLAG_PCT = 5
const ZIELE_KEY = 'kennzahlen_ziele'
const AUSBLICK_MONATE = 6
const DE_MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

type BookingRow = {
  id: string; listing_id: string | null; check_in: string; check_out: string
  total_price: number | string | null; source: string | null; payment_status: string | null
}
type Bucket = { umsatz: number; naechte: number; buchungen: Set<string>; je: Map<string, { umsatz: number; naechte: number }> }

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/

function todayBerlin(): string {
  try { return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' }) } catch { return new Date().toISOString().slice(0, 10) }
}
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
function labelOf(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${DE_MONTHS[m - 1] ?? ym} ${y}`
}
function round2(n: number): number { return Math.round(n * 100) / 100 }

/** Nächte je Monat: Map YYYY-MM → Anzahl. Deckel 400 Nächte gegen Datenmüll. */
function nightsByMonth(checkIn: string, checkOut: string): Map<string, number> {
  const out = new Map<string, number>()
  const a = Date.parse(checkIn + 'T00:00:00Z'), b = Date.parse(checkOut + 'T00:00:00Z')
  if (!Number.isFinite(a) || !Number.isFinite(b)) return out
  let n = 0
  for (let t = a; t < b && n < 400; t += 86400_000, n++) {
    const ym = new Date(t).toISOString().slice(0, 7)
    out.set(ym, (out.get(ym) ?? 0) + 1)
  }
  return out
}

async function loadZiele(): Promise<Record<string, number>> {
  try {
    const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', ZIELE_KEY).maybeSingle()
    const v = (data?.value ?? {}) as Record<string, unknown>
    return Object.fromEntries(Object.entries(v).filter(([k, n]) => YM_RE.test(k) && typeof n === 'number' && Number.isFinite(n) && n >= 0)) as Record<string, number>
  } catch { return {} }
}

export async function GET(req: NextRequest) {
  const auth = await getTaskAuth()
  if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Nur für Admins/Gastgeber.' }, { status: 403, ...NO_STORE })
  if (req.nextUrl.searchParams.get('probe') === '1') return NextResponse.json({ ok: true }, NO_STORE)

  const today = todayBerlin()
  const cur = today.slice(0, 7)
  const monatParam = req.nextUrl.searchParams.get('monat')
  const sel = monatParam && YM_RE.test(monatParam) ? monatParam : cur

  // Welche Monate gebraucht werden: gewählter Monat + Ausblick (ab heute) + deren Vorjahr
  const wanted = new Set<string>([sel])
  for (let i = 0; i < AUSBLICK_MONATE; i++) {
    const ym = shiftMonth(cur, i)
    wanted.add(ym); wanted.add(shiftMonth(ym, -12))
  }
  const sorted = [...wanted].sort()
  const rangeStart = `${sorted[0]}-01`
  const rangeEnd = `${shiftMonth(sorted[sorted.length - 1], 1)}-01` // exklusiv

  const [{ data: rows, error }, listingsRes, ziele] = await Promise.all([
    supabaseAdmin
      .from('bookings')
      .select('id, listing_id, check_in, check_out, total_price, source, payment_status')
      .eq('status', 'confirmed')
      .lt('check_in', rangeEnd)
      .gt('check_out', rangeStart)
      .limit(5000),
    supabaseAdmin.from('listings').select('id, title, is_active').order('title'),
    loadZiele(),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500, ...NO_STORE })
  const listings = (listingsRes.data ?? []) as { id: string; title: string; is_active: boolean | null }[]
  const activeCount = listings.filter((l) => l.is_active !== false).length

  const buckets = new Map<string, Bucket>()
  const bucket = (ym: string): Bucket => {
    let b = buckets.get(ym)
    if (!b) { b = { umsatz: 0, naechte: 0, buchungen: new Set(), je: new Map() }; buckets.set(ym, b) }
    return b
  }

  for (const r of (rows ?? []) as BookingRow[]) {
    if (r.source === 'trimosa' && r.payment_status !== 'paid') continue // Geister-Checkouts
    const price = Number(r.total_price ?? 0)
    if (!Number.isFinite(price) || price <= 0) continue // Eigenbelegung / Sperren ohne Preis
    const perMonth = nightsByMonth(r.check_in, r.check_out)
    let total = 0
    for (const n of perMonth.values()) total += n
    if (total <= 0) continue
    const nettoJeNacht = price / (1 + UST_PCT / 100) / total
    for (const [ym, n] of perMonth) {
      if (!wanted.has(ym)) continue
      const b = bucket(ym)
      b.umsatz += nettoJeNacht * n
      b.naechte += n
      b.buchungen.add(r.id)
      if (r.listing_id) {
        const j = b.je.get(r.listing_id) ?? { umsatz: 0, naechte: 0 }
        j.umsatz += nettoJeNacht * n; j.naechte += n
        b.je.set(r.listing_id, j)
      }
    }
  }

  // Summen + je Wohnung für den gewählten Monat
  const days = daysInMonth(sel)
  const bs = bucket(sel)
  const auslastung = activeCount > 0 ? (bs.naechte / (activeCount * days)) * 100 : 0
  const wohnungen = listings
    .filter((l) => l.is_active !== false || bs.je.has(l.id))
    .map((l) => {
      const j = bs.je.get(l.id) ?? { umsatz: 0, naechte: 0 }
      return { id: l.id, title: l.title, umsatz: round2(j.umsatz), naechte: j.naechte, auslastung: round2((j.naechte / days) * 100) }
    })
    .sort((a, b) => b.umsatz - a.umsatz || a.title.localeCompare(b.title, 'de'))

  // Ausblick ab heute
  const monate = Array.from({ length: AUSBLICK_MONATE }, (_, i) => {
    const ym = shiftMonth(cur, i)
    const umsatz = bucket(ym).umsatz
    const vj = bucket(shiftMonth(ym, -12)).umsatz
    const manuell = ziele[ym]
    const ziel = manuell != null ? manuell : vj > 0 ? vj * (1 + ZIEL_AUFSCHLAG_PCT / 100) : null
    return {
      monat: ym, label: labelOf(ym), umsatz: round2(umsatz), vj: round2(vj),
      ziel: ziel != null ? round2(ziel) : null, zielManuell: manuell != null, lead: i,
      anteil: ziel != null && ziel > 0 ? round2((umsatz / ziel) * 100) : null,
    }
  })

  return NextResponse.json({
    monat: sel,
    label: labelOf(sel),
    summen: {
      umsatz: round2(bs.umsatz),
      auslastung: round2(auslastung),
      oNacht: bs.naechte > 0 ? round2(bs.umsatz / bs.naechte) : null,
      naechte: bs.naechte,
      buchungen: bs.buchungen.size,
    },
    wohnungen,
    ausblick: { stand: today, monate },
    ust: UST_PCT,
    zielAufschlag: ZIEL_AUFSCHLAG_PCT,
  }, NO_STORE)
}

export async function PUT(req: NextRequest) {
  const auth = await getTaskAuth()
  if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Nur für Admins/Gastgeber.' }, { status: 403, ...NO_STORE })
  const body = await req.json().catch(() => ({})) as { monat?: unknown; ziel?: unknown }
  const monat = typeof body.monat === 'string' && YM_RE.test(body.monat) ? body.monat : null
  if (!monat) return NextResponse.json({ error: 'monat (YYYY-MM) fehlt.' }, { status: 400, ...NO_STORE })
  const ziel = body.ziel == null ? null : Number(body.ziel)
  if (ziel != null && (!Number.isFinite(ziel) || ziel < 0 || ziel > 10_000_000)) {
    return NextResponse.json({ error: 'ziel muss eine Zahl ≥ 0 sein (oder null).' }, { status: 400, ...NO_STORE })
  }
  const ziele = await loadZiele()
  if (ziel == null) delete ziele[monat]
  else ziele[monat] = Math.round(ziel)
  const { error } = await supabaseAdmin.from('app_settings').upsert({ key: ZIELE_KEY, value: ziele }, { onConflict: 'key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500, ...NO_STORE })
  return NextResponse.json({ ok: true, ziele }, NO_STORE)
}
