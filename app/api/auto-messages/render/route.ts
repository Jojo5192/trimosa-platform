import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolvePlaceholders, type MessageContext } from '@/lib/auto-messages'
import { ensureDoorCode, getLockSettings } from '@/lib/locks'
import { loadStayIndex } from '@/lib/stammgaeste'

/**
 * Paragraph 306 (Pascal 9.9. 21:25): eine Auto-Nachrichten-Vorlage fuer EINE Buchung ausfuellen und als Text
 * zurueckgeben - der Gaeste-Chat legt sie als Entwurf in den Composer (nie automatisch senden).
 * GET ?template=<auto_messages.id>&booking=<bookings.id>  ODER  &conv=<conversations.id>
 * Platzhalter-Kontext identisch zur Engine (lib/auto-messages-engine.ts), inkl. Tuercode-Anlage bei Bedarf.
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trimosa.de'

function fmtDate(iso: string): string {
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  return y && m && d ? `${d}.${m}.${y}` : String(iso)
}
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400_000)
}

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403, ...NO_STORE })
  const { data: me } = await supabaseAdmin.from('profiles').select('is_admin, is_host').eq('id', user.id).maybeSingle()
  if (!me?.is_admin && !me?.is_host) return NextResponse.json({ error: 'Nur für Admins/Gastgeber.' }, { status: 403, ...NO_STORE })

  const sp = req.nextUrl.searchParams
  const tid = sp.get('template') ?? ''
  let bookingId = sp.get('booking')
  const convId = sp.get('conv')
  if (!bookingId && convId) {
    const { data: c } = await supabaseAdmin.from('conversations').select('booking_id').eq('id', convId).maybeSingle()
    bookingId = (c?.booking_id as string | null) ?? null
  }
  if (!tid || !bookingId) return NextResponse.json({ error: 'Für diesen Chat gibt es keine Buchung — Vorlagen brauchen Buchungsdaten.' }, { status: 400, ...NO_STORE })

  const { data: t } = await supabaseAdmin.from('auto_messages').select('id, name, body').eq('id', tid).maybeSingle()
  if (!t) return NextResponse.json({ error: 'Vorlage nicht gefunden.' }, { status: 404, ...NO_STORE })
  const { data: b } = await supabaseAdmin
    .from('bookings')
    .select('id, listing_id, check_in, check_out, adults, children, guest_name, portal_token, door_code, listings(title, address, location, check_in_time, check_out_time, google_place_id)')
    .eq('id', bookingId).maybeSingle()
  if (!b) return NextResponse.json({ error: 'Buchung nicht gefunden.' }, { status: 404, ...NO_STORE })
  type L = { title?: string | null; address?: string | null; location?: string | null; check_in_time?: string | null; check_out_time?: string | null; google_place_id?: string | null }
  const listing = (Array.isArray(b.listings) ? b.listings[0] : b.listings) as L | null

  const body = String(t.body ?? '')
  let code = (b.door_code as string | null) ?? null
  if (body.includes('{tuercode}') && !code) code = await ensureDoorCode(b.id).catch(() => null)
  let earliest = 10
  try { earliest = Math.max((await getLockSettings()).validFromHour, 10) } catch { /* Default */ }
  const hour = Number(new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(11, 13))
  const stayIdx = await loadStayIndex().catch(() => null)
  const si = stayIdx?.byBooking.get(b.id)
  const gast = String(b.guest_name ?? 'Gast').trim()
  const ctx: MessageContext = {
    vorname: gast.split(/\s+/)[0] || 'Gast',
    name: gast,
    wohnung: listing?.title ?? 'deiner Ferienwohnung',
    anreise: fmtDate(b.check_in), abreise: fmtDate(b.check_out),
    naechte: String(dayDiff(b.check_in, b.check_out)),
    gaeste: String((b.adults ?? 1) + (b.children ?? 0)),
    checkin: listing?.check_in_time ?? '16:00', checkout: listing?.check_out_time ?? '10:00',
    tuercode: code ?? '',
    mappe: b.portal_token ? `${siteUrl}/mappe/${b.portal_token}` : '',
    adresse: listing?.address || listing?.location || '',
    google_bewertung: listing?.google_place_id ? `https://search.google.com/local/writereview?placeid=${listing.google_place_id}` : '',
    fruehester_checkin: hour >= earliest ? 'sofort' : `${String(earliest).padStart(2, '0')}:00 Uhr`,
    stammgast: (si?.stays ?? 1) >= 2 ? 'Schön, dass du wieder bei uns bist!' : '',
    aufenthalt_nr: String(si?.nr ?? 1),
  }
  const withLinks = body
    .split('{mappe_button}').join(ctx.mappe ? `\n${ctx.mappe}\n` : '')
    .split('{bewertung_button}').join(ctx.google_bewertung ? `\n${ctx.google_bewertung}\n` : '')
  const fehlt = [...withLinks.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => !(ctx as unknown as Record<string, string>)[k])
  const text = resolvePlaceholders(withLinks, ctx).replace(/\{\w+\}/g, '').replace(/\n{3,}/g, '\n\n').trim()
  return NextResponse.json({ name: t.name, text, fehlt }, NO_STORE)
}
