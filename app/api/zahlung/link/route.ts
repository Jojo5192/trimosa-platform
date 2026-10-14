import { NextRequest, NextResponse } from 'next/server'
import { teamNutzer } from '@/lib/chat-access'
import { erstelleZahllink, listeZahllinks } from '@/lib/zahlungen'

// Explizites Zeitlimit (Server-Prüfung 9.10.): Stripe-Preis + Zahllink
export const maxDuration = 30

/**
 * 💶 Zahllink für Extras aus dem Gäste-Chat (Pascal 5.10.2026) — lib/zahlungen.ts.
 *  GET  ?bookingId=…                          → { links } (offen/bezahlt) der Buchung
 *  POST { bookingId, betrag, zweck, text? }   → { link } — Stripe Payment Link, einmal bezahlbar
 * Admin, Gastgeber und Mitarbeiter (Vanessa) dürfen Links erstellen; Dienstleister nicht.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const me = await teamNutzer()
  if (!me) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })
  const bookingId = req.nextUrl.searchParams.get('bookingId') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return NextResponse.json({ error: 'bookingId fehlt' }, { status: 400 })
  return NextResponse.json({ links: await listeZahllinks(bookingId) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const me = await teamNutzer()
  if (!me) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })
  const body = await req.json().catch(() => ({})) as { bookingId?: unknown; betrag?: unknown; zweck?: unknown; text?: unknown }
  const bookingId = typeof body.bookingId === 'string' ? body.bookingId : ''
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return NextResponse.json({ error: 'bookingId fehlt' }, { status: 400 })
  const betrag = Number(String(body.betrag ?? '').replace(',', '.'))
  if (!Number.isFinite(betrag)) return NextResponse.json({ error: 'Betrag fehlt' }, { status: 400 })
  try {
    const link = await erstelleZahllink({
      bookingId, betrag,
      zweck: typeof body.zweck === 'string' ? body.zweck : 'Zusatzleistung',
      text: typeof body.text === 'string' ? body.text : null,
      von: me.vorname,
    })
    return NextResponse.json({ link })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[zahlung/link]', msg)
    // Stripe-Fehler nicht roh an die Oberfläche
    const klar = /Betrag|storniert|nicht gefunden/.test(msg) ? msg : 'Der Zahllink konnte nicht erstellt werden — bitte erneut versuchen.'
    return NextResponse.json({ error: klar }, { status: 400 })
  }
}
