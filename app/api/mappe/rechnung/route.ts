import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkRateLimit } from '@/lib/rate-limit'
import { sanitizeRecipient } from '@/lib/lexoffice'
import { SEV_ENGINE_STICHTAG, reissueSevInvoice, saveSevRecipient } from '@/lib/sevdesk-engine'
import { sendPushToTeam } from '@/lib/push'

/**
 * 🧾 §266c: Rechnungsempfänger aus der GÄSTEMAPPE — token-basiert wie der
 * Mappe-Chat (§136). Der Gast kann den Empfänger (z. B. Firmenanschrift)
 * selbst festlegen:
 *  - VOR der Rechnungs-Erstellung → gespeichert, der 15:00-Lauf nutzt ihn
 *  - Rechnung existiert → DIREKTES Update auf der bestehenden Rechnung
 *    (gleiche Nummer, §235-Mechanik; FESTGESCHRIEBEN → nur speichern +
 *    Team-Push — Storno passiert NIE aus Gast-Hand, §266c-Review)
 * Nur die sevdesk-Welt (Anreise ab Stichtag) — Alt-Buchungen (lexoffice,
 * gekündigt/Archiv) bekommen in der Mappe kein Formular.
 * Team-Transparenz: jeder Gast-Änderung folgt ein 💶-Push an die Admins.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const { token, recipient: rawRecipient } = await req.json().catch(() => ({}))
  if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/i.test(token)) {
    return NextResponse.json({ error: 'Nicht gefunden.' }, { status: 404 })
  }
  // Rate-Limit je Token UND je IP (Missbrauchs-Deckel; das Direkt-Update
  // erzeugt keine Storno-Ketten, aber sevdesk-Calls kosten trotzdem)
  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim()
  const okToken = await checkRateLimit(`mappe-rechnung:${token.slice(0, 12)}`, 6, 86400)
  const okIp = await checkRateLimit(`mappe-rechnung-ip:${ip}`, 20, 3600)
  if (!okToken || !okIp) return NextResponse.json({ error: 'Zu viele Änderungen — bitte später erneut versuchen.' }, { status: 429 })

  const recipient = sanitizeRecipient(rawRecipient)
  if (!recipient) return NextResponse.json({ error: 'Bitte mindestens einen Namen angeben.' }, { status: 400 })

  const { data: b } = await supabaseAdmin
    .from('bookings')
    .select('id, status, check_in, check_out, guest_name, listings(title)')
    .eq('portal_token', token).maybeSingle()
  if (!b || b.status === 'cancelled') return NextResponse.json({ error: 'Nicht gefunden.' }, { status: 404 })
  if (String(b.check_in) < SEV_ENGINE_STICHTAG) {
    return NextResponse.json({ error: 'Für diese Buchung bitte kurz über den Chat melden.' }, { status: 400 })
  }
  // §266c-Review: Zeitfenster wie der Mappe-Chat (30 Tage nach Abreise) —
  // Mappe-Links laufen nie ab; alte Links sollen keine Rechnungs-Änderungen
  // mehr auslösen können (danach übernimmt das Team).
  const grenze = new Date(String(b.check_out) + 'T00:00:00Z')
  grenze.setUTCDate(grenze.getUTCDate() + 30)
  if (Date.now() > grenze.getTime()) {
    return NextResponse.json({ error: 'Der Änderungs-Zeitraum ist vorbei — bitte kurz über den Chat oder per E-Mail melden.' }, { status: 400 })
  }
  // §243ac-Randfall (Manuela-Marc-Klasse): sev-Welt-Buchung mit LEGACY-
  // lexoffice-Rechnung — Änderungen dort nur übers Team (lexoffice-Archiv)
  const { data: legacy } = await supabaseAdmin
    .from('lexoffice_invoices').select('lexoffice_id').eq('booking_id', b.id).maybeSingle()
  if (legacy?.lexoffice_id) {
    return NextResponse.json({ error: 'Für diese Rechnung bitte kurz über den Chat melden — wir passen sie für dich an.' }, { status: 400 })
  }

  const listing = (Array.isArray(b.listings) ? b.listings[0] : b.listings) as { title?: string } | null
  const wohnung = listing?.title ?? 'Wohnung'
  const gast = (b.guest_name as string | null) ?? 'Gast'

  const { data: inv } = await supabaseAdmin
    .from('sevdesk_invoices').select('sevdesk_id, invoice_number').eq('booking_id', b.id).maybeSingle()

  if (inv?.sevdesk_id) {
    // Rechnung existiert → direkt aktualisieren (der Gast-Download-Link
    // liefert sofort die neue Fassung). §266c-Review: noAutoStorno —
    // FESTGESCHRIEBENE Belege werden NIE aus Gast-Hand storniert; der
    // Wunsch geht dann ans Team.
    const r = await reissueSevInvoice(String(b.id), recipient, { noAutoStorno: true })
    if (!r.ok && r.enshrined) {
      // Wunsch ist gespeichert (reissue macht saveSevRecipient vor dem
      // Update) — Team entscheidet über Storno + Neu-Ausstellung
      await sendPushToTeam(
        '🧾 Empfänger-Wunsch auf FESTGESCHRIEBENER Rechnung',
        `${gast} · ${wohnung} → „${recipient.name}" (${inv.invoice_number ?? '—'}) — bitte manuell prüfen (Storno + Neu nur bewusst).`,
        '/buchhaltung', { buchhaltung: true },
      ).catch(() => {})
      return NextResponse.json({ ok: true, gespeichert: true })
    }
    if (!r.ok) {
      console.error('[mappe-rechnung] Update fehlgeschlagen:', r.error)
      // Wunsch trotzdem sichern + Team informieren — der Gast bekommt eine
      // ehrliche Antwort statt eines stillen Fehlschlags
      await saveSevRecipient(String(b.id), recipient).catch(() => {})
      await sendPushToTeam(
        '🧾 Empfänger-Wunsch (Rechnung) — bitte prüfen',
        `${gast} · ${wohnung}: „${recipient.name}" — automatische Änderung schlug fehl (${(r.error ?? '').slice(0, 100)}).`,
        '/buchhaltung', { buchhaltung: true },
      ).catch(() => {})
      return NextResponse.json({ error: 'Die Änderung hat gerade nicht geklappt — das Team wurde informiert und kümmert sich.' }, { status: 502 })
    }
    await sendPushToTeam(
      '🧾 Gast hat Rechnungsempfänger geändert',
      `${gast} · ${wohnung} → „${recipient.name}"${r.updated ? ` (Rechnung ${r.number ?? ''} direkt aktualisiert)` : r.oldNumber ? ` (${r.oldNumber} storniert → neu ${r.number ?? ''})` : ''}`,
      '/buchhaltung', { buchhaltung: true },
    ).catch(() => {})
    return NextResponse.json({ ok: true, aktualisiert: true, number: r.number ?? inv.invoice_number ?? null })
  }

  // Noch keine Rechnung → Empfänger speichern (fließt in die Erstellung ein)
  try {
    await saveSevRecipient(String(b.id), recipient)
  } catch (e) {
    console.error('[mappe-rechnung] speichern fehlgeschlagen:', e)
    return NextResponse.json({ error: 'Das Speichern hat gerade nicht geklappt — bitte später erneut versuchen oder kurz über den Chat melden.' }, { status: 502 })
  }
  await sendPushToTeam(
    '🧾 Gast hat Rechnungsempfänger festgelegt',
    `${gast} · ${wohnung} → „${recipient.name}" — wird bei der Rechnungs-Erstellung verwendet.`,
    '/buchhaltung', { buchhaltung: true },
  ).catch(() => {})
  return NextResponse.json({ ok: true, gespeichert: true })
}
