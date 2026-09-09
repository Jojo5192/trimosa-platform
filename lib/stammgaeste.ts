import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * ⭐ Stammgäste (Dominik, Chefsache 9.9.2026 — §290): Wer hat 2, 3 oder öfter bei uns gebucht?
 * Gäste werden über drei Schlüssel zusammengeführt (Union-Find, ein Gast kann alle drei tragen):
 *   u:<guest_id>   Website-Konto
 *   e:<mail>       echte E-Mail — Portal-Alias-Adressen (guest.booking.com, airbnb.com, …) sind je
 *                  Buchung anders und werden NICHT verwendet
 *   n:<name>       voller Name (mind. zwei Wörter, klein, Leerraum normalisiert) — reine Vornamen
 *                  (Airbnb liefert oft nur „Michael") matchen bewusst nie
 * Grenze: Airbnb-Gäste ohne Nachnamen/Mail sind nicht als Wiederkehrer erkennbar.
 * Der Index (alle bestätigten, bezahlten Buchungen) wird 10 Minuten im Prozess gecacht — Inbox,
 * Heute und Auto-Nachrichten fragen ihn je Request nur einmal.
 */

const ALIAS_DOMAINS = /@(guest\.booking\.com|guest\.airbnb\.com|airbnb\.com|messages\.homeaway\.com|homeaway\.com|vrbo\.com|fewo-direkt\.de|expediapartnercentral\.com|hometogo\.[a-z]+|reply\.[a-z.]+)$/i

export type StayBooking = {
  id: string; guest_name: string | null; guest_email: string | null; guest_id: string | null
  check_in: string; check_out: string; listing_id: string | null; channel: string | null; source: string | null
}
export type StayInfo = { stays: number; nr: number; group: string }
type Index = { byBooking: Map<string, StayInfo>; groups: Map<string, StayBooking[]>; at: number }

function normName(n: string | null): string | null {
  const s = (n ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (!s || s === 'gast' || s.split(' ').length < 2) return null
  return s
}
export function guestKeys(b: StayBooking): string[] {
  const keys: string[] = []
  if (b.guest_id) keys.push(`u:${b.guest_id}`)
  const e = (b.guest_email ?? '').toLowerCase().trim()
  if (e.includes('@') && !ALIAS_DOMAINS.test(e)) keys.push(`e:${e}`)
  const n = normName(b.guest_name)
  if (n) keys.push(`n:${n}`)
  return keys
}

class UnionFind {
  private parent = new Map<string, string>()
  find(k: string): string {
    const p = this.parent.get(k)
    if (p == null || p === k) return k
    const r = this.find(p)
    this.parent.set(k, r)
    return r
  }
  union(a: string, b: string) {
    const ra = this.find(a), rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

let cache: Index | null = null
const TTL_MS = 10 * 60_000

export async function loadStayIndex(fresh = false): Promise<Index> {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache
  const { data } = await supabaseAdmin
    .from('bookings')
    .select('id, guest_name, guest_email, guest_id, check_in, check_out, listing_id, channel, source, payment_status')
    .eq('status', 'confirmed')
    .order('check_in', { ascending: true })
    .limit(5000)
  const rows = ((data ?? []) as (StayBooking & { payment_status: string | null })[])
    .filter((b) => b.source !== 'trimosa' || b.payment_status === 'paid')
  const uf = new UnionFind()
  const keysOf = new Map<string, string[]>()
  for (const b of rows) {
    const ks = guestKeys(b)
    keysOf.set(b.id, ks)
    for (let i = 1; i < ks.length; i++) uf.union(ks[0], ks[i])
  }
  const groups = new Map<string, StayBooking[]>()
  for (const b of rows) {
    const ks = keysOf.get(b.id) ?? []
    if (!ks.length) continue
    const g = uf.find(ks[0])
    const arr = groups.get(g) ?? []
    arr.push(b)
    groups.set(g, arr)
  }
  const byBooking = new Map<string, StayInfo>()
  for (const [g, arr] of groups) {
    arr.sort((a, b) => a.check_in.localeCompare(b.check_in))
    arr.forEach((b, i) => byBooking.set(b.id, { stays: arr.length, nr: i + 1, group: g }))
  }
  cache = { byBooking, groups, at: Date.now() }
  return cache
}

/** Kurzform für Listen: { stays, nr } oder null, wenn der Gast nicht zuordenbar ist. */
export async function stayInfoFor(bookingIds: string[]): Promise<Map<string, StayInfo>> {
  const idx = await loadStayIndex()
  const out = new Map<string, StayInfo>()
  for (const id of bookingIds) { const s = idx.byBooking.get(id); if (s) out.set(id, s) }
  return out
}

function portalName(b: StayBooking): string {
  const c = (b.channel ?? '').trim()
  if (c && c.toLowerCase() !== 'direct') return c
  return b.source === 'trimosa' ? 'Website' : 'Smoobu'
}

export type Stammgast = {
  name: string; email: string | null; stays: number; first: string; last: string
  listings: string[]; portale: string[]; naechte: number
}
export type StammgaesteStatistik = {
  stand: string; gesamtGaeste: number; einmalig: number; zwei: number; drei: number; vierPlus: number
  wiederkehrer: number; quote: number; buchungen: number; gaeste: Stammgast[]
}

export async function stammgaesteStatistik(): Promise<StammgaesteStatistik> {
  const idx = await loadStayIndex()
  const { data: ls } = await supabaseAdmin.from('listings').select('id, title')
  const title = new Map(((ls ?? []) as { id: string; title: string }[]).map((l) => [l.id, l.title]))
  const needIds = new Set<string>()
  for (const arr of idx.groups.values()) for (const b of arr) if (!b.guest_name && b.guest_id) needIds.add(b.guest_id)
  const nameByGuest = new Map<string, string>()
  if (needIds.size) {
    const { data: gp } = await supabaseAdmin
      .from('profiles').select('id, display_name, guest_first_name, guest_last_name, company_name').in('id', [...needIds])
    for (const p of (gp ?? []) as { id: string; display_name: string | null; guest_first_name: string | null; guest_last_name: string | null; company_name: string | null }[]) {
      const n = (p.display_name ?? '').trim() || [p.guest_first_name, p.guest_last_name].filter(Boolean).join(' ').trim() || (p.company_name ?? '').trim()
      if (n) nameByGuest.set(p.id, n)
    }
  }
  let einmalig = 0, zwei = 0, drei = 0, vierPlus = 0, buchungen = 0
  const gaeste: Stammgast[] = []
  for (const arr of idx.groups.values()) {
    buchungen += arr.length
    const n = arr.length
    if (n === 1) { einmalig++; continue }
    if (n === 2) zwei++; else if (n === 3) drei++; else vierPlus++
    const lastB = arr[arr.length - 1]
    const name = lastB.guest_name || (lastB.guest_id ? nameByGuest.get(lastB.guest_id) : null) || arr.map((b) => b.guest_name).find(Boolean) || 'Gast'
    const email = arr.map((b) => (b.guest_email ?? '').toLowerCase().trim()).find((e) => e.includes('@') && !ALIAS_DOMAINS.test(e)) ?? null
    const naechte = arr.reduce((s, b) => s + Math.max(0, Math.round((Date.parse(b.check_out) - Date.parse(b.check_in)) / 86400_000)), 0)
    gaeste.push({
      name, email, stays: n, first: arr[0].check_in, last: lastB.check_in, naechte,
      listings: [...new Set(arr.map((b) => title.get(b.listing_id ?? '') ?? '').filter(Boolean))],
      portale: [...new Set(arr.map(portalName))],
    })
  }
  gaeste.sort((a, b) => b.stays - a.stays || b.last.localeCompare(a.last))
  const gesamt = idx.groups.size
  const wiederkehrer = zwei + drei + vierPlus
  return {
    stand: new Date().toISOString(), gesamtGaeste: gesamt, einmalig, zwei, drei, vierPlus, wiederkehrer,
    quote: gesamt ? Math.round((wiederkehrer / gesamt) * 1000) / 10 : 0, buchungen, gaeste,
  }
}
