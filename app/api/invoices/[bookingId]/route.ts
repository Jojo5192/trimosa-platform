import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createInvoiceForBooking, saveRecipient, sanitizeRecipient, stornoInvoice } from '@/lib/lexoffice'
import {
  SEV_ENGINE_STICHTAG, createSevInvoiceForBooking, reissueSevInvoice, saveSevRecipient,
} from '@/lib/sevdesk-engine'

/**
 * 🧾 Rechnungs-Status je Buchung (Team, §158) — Basis für die 🧾-Aktion in
 * Chat + Offen:
 *  GET  → { status: 'bereit'|'zu_frueh'|'keine'|'fehler', url?, voucherNumber?, checkIn }
 *  POST → Rechnung JETZT erstellen (frühestens ab Anreisetag) → { url }
 * Die Gast-URL ist der token-geschützte PDF-Download (/api/rechnung/<token>).
 *
 * §235 STICHTAGS-WEICHE: Anreisen ab 02.08.2026 laufen über die
 * sevdesk-Engine, ältere Buchungen bleiben in der lexoffice-Welt
 * (Gast-PDF + Empfänger-Neuausstellung dort — kein System-Mix je Buchung).
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

async function requireTeam() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host, is_staff').eq('id', user.id).maybeSingle()
  return (me?.is_admin || me?.is_host || me?.is_staff) ? user : null
}

function berlinToday(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 10)
}

type InvoiceState = {
  status: 'bereit' | 'zu_frueh' | 'keine' | 'fehler'
  url: string | null
  voucherNumber?: string | null
  error?: string | null
  checkIn: string
  engine: 'sevdesk' | 'lexoffice'
}

async function loadState(bookingId: string): Promise<InvoiceState | null> {
  const { data: b } = await supabaseAdmin
    .from('bookings').select('id, check_in, portal_token, status').eq('id', bookingId).maybeSingle()
  if (!b) return null
  const url = b.portal_token ? `/api/rechnung/${b.portal_token}` : null
  const isSev = String(b.check_in) >= SEV_ENGINE_STICHTAG
  const engine = isSev ? 'sevdesk' as const : 'lexoffice' as const

  if (isSev) {
    const { data: inv } = await supabaseAdmin
      .from('sevdesk_invoices').select('sevdesk_id, invoice_number, status, error').eq('booking_id', bookingId).maybeSingle()
    if (inv?.sevdesk_id) return { status: 'bereit', url, voucherNumber: inv.invoice_number, checkIn: b.check_in, engine }
    if (String(b.check_in) > berlinToday()) return { status: 'zu_frueh', url: null, checkIn: b.check_in, engine }
    if (inv?.status === 'fehler') return { status: 'fehler', url: null, error: inv.error, checkIn: b.check_in, engine }
    return { status: 'keine', url: null, checkIn: b.check_in, engine }
  }

  const { data: inv } = await supabaseAdmin
    .from('lexoffice_invoices').select('lexoffice_id, voucher_number, status, error').eq('booking_id', bookingId).maybeSingle()
  if (inv?.lexoffice_id) return { status: 'bereit', url, voucherNumber: inv.voucher_number, checkIn: b.check_in, engine }
  if (String(b.check_in) > berlinToday()) return { status: 'zu_frueh', url: null, checkIn: b.check_in, engine }
  if (inv?.status === 'fehler') return { status: 'fehler', url: null, error: inv.error, checkIn: b.check_in, engine }
  return { status: 'keine', url: null, checkIn: b.check_in, engine }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params
  if (!(await requireTeam())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const state = await loadState(bookingId)
  if (!state) return NextResponse.json({ error: 'Buchung nicht gefunden.' }, { status: 404 })
  return NextResponse.json(state, NO_STORE)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params
  if (!(await requireTeam())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const state = await loadState(bookingId)
  if (!state) return NextResponse.json({ error: 'Buchung nicht gefunden.' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const recipient = sanitizeRecipient(body.recipient)

  /* ── §235: NEUE Welt (Anreise ab Stichtag) → sevdesk-Engine ─────────── */
  if (state.engine === 'sevdesk') {
    // §201: „Auf Rechnung" — mit Zahlungsziel, explizit auch VOR Anreise;
    // bleibt in sevdesk OFFEN und wird über den Finom-Bankabgleich beglichen
    if (body.aufRechnung === true) {
      const zielTage = Math.min(Math.max(Number(body.zielTage) || 5, 1), 30)
      const r = await createSevInvoiceForBooking(bookingId, { ...(recipient ? { recipient } : {}), aufRechnung: { zielTage } })
      if (!r.ok) return NextResponse.json({ error: r.error ?? r.skipped ?? 'Erstellung fehlgeschlagen.' }, { status: 500 })
      return NextResponse.json({
        ...(await loadState(bookingId)),
        hinweis: `Auf Rechnung erstellt (${r.number ?? '—'}) — Zahlungsziel ${zielTage} Werktage; wird beim Zahlungseingang automatisch über den Bankabgleich ausgeglichen.`,
      }, NO_STORE)
    }

    if (recipient) {
      if (state.status === 'bereit') {
        // §235-Nachtrag: Empfänger wird DIREKT auf der Rechnung geändert
        // (gleiche Nummer); nur festgeschriebene Belege laufen über
        // Auto-Storno + Neu-Ausstellung
        const r = await reissueSevInvoice(bookingId, recipient)
        if (!r.ok) return NextResponse.json({ error: r.error ?? 'Empfänger-Änderung fehlgeschlagen.' }, { status: 500 })
        return NextResponse.json({
          ...(await loadState(bookingId)),
          hinweis: r.updated
            ? `Empfänger direkt auf Rechnung ${r.number ?? '—'} geändert — gleiche Rechnungsnummer, der Gast-Link zeigt sofort die neue Fassung.`
            : r.oldNumber
              ? `Rechnung ${r.oldNumber} war festgeschrieben → automatisch storniert${r.stornoNote ? ` (${r.stornoNote})` : ''} · neu ausgestellt als ${r.number ?? '—'}.`
              : `Neu ausgestellt (${r.number ?? '—'}).`,
        }, NO_STORE)
      }
      await saveSevRecipient(bookingId, recipient)
      if (state.status === 'zu_frueh') {
        return NextResponse.json({
          ...state, gespeichert: true,
          hinweis: 'Empfänger gespeichert — die Rechnung wird am Anreisetag automatisch mit diesen Daten erstellt.',
        }, NO_STORE)
      }
      const r = await createSevInvoiceForBooking(bookingId, { recipient })
      if (!r.ok && !r.skipped) return NextResponse.json({ error: r.error ?? 'Erstellung fehlgeschlagen.' }, { status: 500 })
      return NextResponse.json({ ...(await loadState(bookingId)), gespeichert: true }, NO_STORE)
    }

    if (state.status === 'bereit') return NextResponse.json(state, NO_STORE)
    if (state.status === 'zu_frueh') {
      return NextResponse.json({
        error: `Rechnungen entstehen erst am Anreisetag (${state.checkIn}) — vorher den Hinweis-Text senden.`,
      }, { status: 400 })
    }
    const r = await createSevInvoiceForBooking(bookingId)
    if (!r.ok && !r.skipped) return NextResponse.json({ error: r.error ?? 'Erstellung fehlgeschlagen.' }, { status: 500 })
    return NextResponse.json(await loadState(bookingId), NO_STORE)
  }

  /* ── ALT-Welt (Anreise vor Stichtag) → lexoffice, unverändert ───────── */

  // §201: „Auf Rechnung" — mit Zahlungsziel, explizit auch VOR Anreise
  if (body.aufRechnung === true) {
    const zielTage = Math.min(Math.max(Number(body.zielTage) || 5, 1), 30)
    const r = await createInvoiceForBooking(bookingId, { ...(recipient ? { recipient } : {}), aufRechnung: { zielTage } })
    if (!r.ok) return NextResponse.json({ error: r.error ?? r.skipped ?? 'Erstellung fehlgeschlagen.' }, { status: 500 })
    return NextResponse.json({
      ...(await loadState(bookingId)),
      hinweis: `Auf Rechnung erstellt (${r.voucherNumber ?? '—'}) — Zahlungsziel ${zielTage} Werktage.`,
    }, NO_STORE)
  }

  // §159: Empfänger mitgeschickt (vom Gast im Chat/bei Buchung) →
  // speichern; existiert schon eine Rechnung → NEU ausstellen; vor
  // Anreisetag → nur speichern, der 15:00-Lauf nutzt die Daten dann.
  if (recipient) {
    if (state.status === 'bereit') {
      // §159-Nachtrag: Storno passiert AUTOMATISCH (Inhaber-Vorgabe) —
      // erst die alte Rechnung per Stornorechnung ausgleichen, DANN neu
      // ausstellen. Scheitert der Storno, wird abgebrochen (sonst stünden
      // zwei offene Rechnungen für dieselbe Buchung in der Buchhaltung).
      const oldNr = state.voucherNumber ?? null
      let stornoHint = ''
      const { data: row } = await supabaseAdmin
        .from('lexoffice_invoices').select('lexoffice_id').eq('booking_id', bookingId).maybeSingle()
      if (row?.lexoffice_id) {
        const st = await stornoInvoice(row.lexoffice_id)
        if (!st.ok) {
          return NextResponse.json({ error: `Storno der alten Rechnung fehlgeschlagen: ${st.error}` }, { status: 500 })
        }
        if (st.standalone) stornoHint = ' ⚠️ Die alte Rechnung war schon bezahlt/verrechnet — die Stornorechnung bitte einmal in lexoffice mit ihr verrechnen.'
        else if (st.note) stornoHint = ` (${st.note})`
      }
      const r = await createInvoiceForBooking(bookingId, { recipient, force: true })
      if (!r.ok) {
        return NextResponse.json({
          error: `Alte Rechnung ${oldNr ?? ''} wurde storniert, aber die NEUE Ausstellung schlug fehl: ${r.error ?? '—'} — bitte erneut versuchen.`,
        }, { status: 500 })
      }
      const fresh = await loadState(bookingId)
      return NextResponse.json({
        ...fresh,
        hinweis: (oldNr
          ? `Alte Rechnung ${oldNr} automatisch storniert · neu ausgestellt als ${r.voucherNumber ?? '—'}.`
          : `Neu ausgestellt (${r.voucherNumber ?? '—'}).`) + stornoHint,
      }, NO_STORE)
    }
    await saveRecipient(bookingId, recipient)
    if (state.status === 'zu_frueh') {
      return NextResponse.json({
        ...state, gespeichert: true,
        hinweis: 'Empfänger gespeichert — die Rechnung wird am Anreisetag automatisch mit diesen Daten erstellt.',
      }, NO_STORE)
    }
    const r = await createInvoiceForBooking(bookingId, { recipient })
    if (!r.ok && !r.skipped) return NextResponse.json({ error: r.error ?? 'Erstellung fehlgeschlagen.' }, { status: 500 })
    return NextResponse.json({ ...(await loadState(bookingId)), gespeichert: true }, NO_STORE)
  }

  if (state.status === 'bereit') return NextResponse.json(state, NO_STORE)
  if (state.status === 'zu_frueh') {
    return NextResponse.json({
      error: `Rechnungen entstehen erst am Anreisetag (${state.checkIn}) — vorher den Hinweis-Text senden.`,
    }, { status: 400 })
  }
  const r = await createInvoiceForBooking(bookingId)
  if (!r.ok && !r.skipped) return NextResponse.json({ error: r.error ?? 'Erstellung fehlgeschlagen.' }, { status: 500 })
  const fresh = await loadState(bookingId)
  return NextResponse.json(fresh, NO_STORE)
}
