import { NextRequest, NextResponse } from 'next/server'
import { teamNutzer } from '@/lib/chat-access'
import { ladeBuchung, mappeUrl, verlaengerungAngebot, verlaengerungenVon } from '@/lib/zahlungen'

/**
 * 🌙 Verlängerungs-Angebot für das Team (Gäste-Chat, Zahllink-Blatt) — lib/zahlungen.ts.
 *  GET ?bookingId=…&naechte=2 → { angebot, link, schonVerlaengert }
 * `link` = Gästemappe mit vorgewählter Nächte-Zahl: dort prüft die App beim Klick Verfügbarkeit und Preis
 * NEU und startet die Stripe-Zahlung — der Link veraltet also nicht, falls der Gast erst später zahlt.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const me = await teamNutzer()
  if (!me) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })
  const bookingId = req.nextUrl.searchParams.get('bookingId') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return NextResponse.json({ error: 'bookingId fehlt' }, { status: 400 })
  const naechte = Number(req.nextUrl.searchParams.get('naechte') ?? 1)
  const [b, angebot, schon] = await Promise.all([ladeBuchung(bookingId), verlaengerungAngebot(bookingId, naechte), verlaengerungenVon(bookingId)])
  const basis = b ? mappeUrl(b) : null
  return NextResponse.json({
    angebot,
    link: angebot.ok && basis ? `${basis}?verlaengern=${angebot.naechte}#verlaengern` : null,
    schonVerlaengert: schon.map((e) => ({ von: e.von, bis: e.bis, preis: e.preis })),
  }, { headers: { 'Cache-Control': 'no-store' } })
}
