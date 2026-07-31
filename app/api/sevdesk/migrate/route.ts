import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { listReservations } from '@/lib/smoobu'
import { sevdeskConfigured, createPaidInvoice, finishAndBook, clearingLabelFor, invoiceNumberExists, type SevInvoiceInput } from '@/lib/sevdesk'

/**
 * 🧾 §234 JAHRES-NEUAUFBAU: Alle Smoobu-Reservierungen mit Anreise in 2026
 * (bis heute) werden als frische sevdesk-Rechnungen angelegt — cent-genau
 * aus Smoobu, Kostenstelle je Wohnung, bezahlt gegen das Kanal-
 * Verrechnungskonto, GoBD-festgeschrieben. Nummern: RE02001 ff.
 * chronologisch nach Anreise (bewusster Sprung — kollisionsfrei zur
 * weiterlaufenden lexoffice-Serie ≤ RE01xxx; HANDOFF §234).
 *
 * POST { dryRun?: true, limit?: 20, from?: '2026-01-01' } — admin-only.
 * dryRun (Default) zeigt, was passieren würde; scharf arbeitet `limit`
 * Stück chronologisch ab (idempotent über sevdesk_invoices; Zeilen mit
 * status 'fehler'/'angelegt' werden wiederaufgenommen statt doppelt
 * angelegt — resume via finishAndBook).
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

const START_NUMBER = 2001
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function requireAdmin(): Promise<boolean> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data: me } = await supabaseAdmin.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  return !!me?.is_admin
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${Number(d)}.${Number(m)}.${y}`
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  if (!sevdeskConfigured()) {
    return NextResponse.json({ error: 'SEVDESK_API_TOKEN fehlt (Vercel-Env + Redeploy).' }, { status: 503 })
  }
  const b = await req.json().catch(() => ({}))
  const dryRun = b.dryRun !== false
  // Phase 2 (Inhaber-Vorgabe „nicht direkt festschreiben"): book=true bucht
  // bereits ERSTELLTE (offene) Rechnungen als bezahlt — DAS schreibt fest!
  const book = b.book === true
  const limit = Math.min(Math.max(Number(b.limit) || 20, 1), 60)
  const from = typeof b.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.from) ? b.from : '2026-01-01'
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date())

  try {
    // Wohnungs-Zuordnung: Smoobu-Apartment-ID → Titel + listing_id
    const { data: lRows } = await supabaseAdmin
      .from('listings').select('id, title, smoobu_id').not('smoobu_id', 'is', null)
    const apts = new Map((lRows ?? []).map((l) => [Number(l.smoobu_id), { id: String(l.id), title: String(l.title) }]))

    // Alle Reservierungen des Jahres aus SMOOBU (die Quelle der Wahrheit)
    const all: Awaited<ReturnType<typeof listReservations>>['reservations'] = []
    for (let page = 1; page <= 20; page++) {
      const { reservations, hasMore } = await listReservations(from, today, page, 100)
      all.push(...reservations)
      if (!hasMore) break
    }
    const relevant = all
      .filter((r) => !r.cancelled && !r.blocked
        && r.arrival && r.arrival >= from && r.arrival <= today
        && (r.price ?? 0) > 0
        && r.apartmentId != null && apts.has(r.apartmentId))
      .sort((a, b2) => (a.arrival! < b2.arrival! ? -1 : a.arrival! > b2.arrival! ? 1 : a.id - b2.id))

    // Idempotenz: bereits verarbeitete / hängengebliebene Zeilen laden
    const rows: { smoobu_reservation_id: number; sevdesk_id: string | null; invoice_number: string | null; status: string }[] = []
    for (let off = 0; ; off += 1000) {
      const { data, error } = await supabaseAdmin
        .from('sevdesk_invoices')
        .select('smoobu_reservation_id, sevdesk_id, invoice_number, status')
        .range(off, off + 999)
      if (error) {
        return NextResponse.json({ error: `Migration 20260801_sevdesk.sql fehlt noch? ${error.message}` }, { status: 500 })
      }
      rows.push(...(data ?? []) as typeof rows)
      if (!data || data.length < 1000) break
    }
    const byId = new Map(rows.map((r) => [Number(r.smoobu_reservation_id), r]))
    // Anlege-Phase überspringt alles, was schon erstellt/gebucht ist;
    // Buch-Phase nimmt genau die ERSTELLTEN (offenen) mit sevdesk_id
    const done = new Set(rows
      .filter((r) => r.status === 'erstellt' || r.status === 'gebucht')
      .map((r) => Number(r.smoobu_reservation_id)))
    const gebucht = rows.filter((r) => r.status === 'gebucht').length

    const queue = book
      ? relevant.filter((r) => {
          const row = byId.get(r.id)
          return !!row?.sevdesk_id && (row.status === 'erstellt' || row.status === 'fehler')
        })
      : relevant.filter((r) => !done.has(r.id))
    const kanaele: Record<string, number> = {}
    let summe = 0
    for (const r of relevant) {
      const k = clearingLabelFor(r.channelName)
      kanaele[k] = (kanaele[k] ?? 0) + 1
      summe += r.price ?? 0
    }

    if (dryRun) {
      return NextResponse.json({
        dryRun: true, phase: book ? 'buchen' : 'anlegen', from,
        gesamt: relevant.length, schonErstellt: done.size - gebucht, schonGebucht: gebucht,
        offen: queue.length, summeBrutto: Math.round(summe * 100) / 100, kanaele,
        naechsteNummer: `RE0${START_NUMBER + done.size}`,
        vorschau: queue.slice(0, 5).map((r) => ({
          smoobuId: r.id, gast: r.guestName, wohnung: apts.get(r.apartmentId!)?.title,
          anreise: r.arrival, abreise: r.departure, preis: r.price, kanal: r.channelName,
        })),
      }, NO_STORE)
    }

    // Scharf: chronologisch abarbeiten, Nummern fortlaufend ab RE02001
    let nextSeq = START_NUMBER
    for (const r of rows) {
      const m = /^RE0(\d{4,})$/.exec(r.invoice_number ?? '')
      if (m) nextSeq = Math.max(nextSeq, Number(m[1]) + 1)
    }

    const report = { erstellt: 0, wiederaufgenommen: 0, fehler: [] as { smoobuId: number; gast: string | null; error: string }[] }
    for (const r of queue.slice(0, limit)) {
      const apt = apts.get(r.apartmentId!)!
      const nights = Math.max(1, Math.round((Date.parse(r.departure ?? r.arrival!) - Date.parse(r.arrival!)) / 86400_000))
      const persons = (r.adults ?? 0) + (r.children ?? 0)
      const prior = byId.get(r.id)
      // Nummern-Vergabe mit DUPLIKAT-SCHUTZ (§234 Rik-Bos-Fall): sevdesk
      // vergibt bei belegter Nummer still eine Auto-Nummer — deshalb wird
      // jede Kandidaten-Nummer vor der Vergabe live geprüft. Die Nummer
      // gilt ab Zuweisung als VERBRAUCHT (nextSeq++ sofort, nicht erst
      // bei Erfolg — sonst Doppelvergabe nach Zwischenfehlern).
      let num = prior?.invoice_number ?? null
      if (!book && !prior?.sevdesk_id) {
        if (num && await invoiceNumberExists(num)) num = null
        if (!num) {
          while (await invoiceNumberExists(`RE0${nextSeq}`)) nextSeq++
          num = `RE0${nextSeq}`
          nextSeq++
        }
      }
      const inp: SevInvoiceInput = {
        invoiceNumber: num ?? `RE0${nextSeq}`,
        invoiceDate: r.arrival!,
        contactName: (r.guestName ?? '').trim() || 'Gast',
        apartmentTitle: apt.title,
        clearingLabel: clearingLabelFor(r.channelName),
        amountGross: Math.round((r.price ?? 0) * 100) / 100,
        positionName: `Übernachtung ${apt.title}`,
        positionText: `Aufenthalt ${fmtDate(r.arrival!)}–${fmtDate(r.departure ?? r.arrival!)} (${nights} ${nights === 1 ? 'Nacht' : 'Nächte'}${persons ? `, ${persons} ${persons === 1 ? 'Person' : 'Personen'}` : ''}), gebucht über ${r.channelName ?? 'Direkt'}. Neuaufbau aus Smoobu (Systemumstellung 08/2026).`,
      }
      // Buchungs-Verknüpfung (falls die Reservierung in unserer DB liegt)
      const { data: bk } = await supabaseAdmin
        .from('bookings').select('id').eq('smoobu_reservation_id', r.id).maybeSingle()
      try {
        let result: { sevdeskId: string; number: string }
        if (book) {
          // Phase 2: bestehende OFFENE Rechnung als bezahlt buchen (schreibt fest)
          result = await finishAndBook(prior!.sevdesk_id!, inp, { book: true })
          report.wiederaufgenommen++
        } else if (prior?.sevdesk_id) {
          // Hängengeblieben (angelegt/fehler MIT sevdesk_id) → nur fortsetzen,
          // NIE eine zweite Rechnung anlegen
          result = await finishAndBook(prior.sevdesk_id, inp)
          report.wiederaufgenommen++
        } else {
          await supabaseAdmin.from('sevdesk_invoices').upsert({
            smoobu_reservation_id: r.id, booking_id: bk?.id ?? null,
            invoice_number: inp.invoiceNumber, amount: inp.amountGross,
            status: 'angelegt', error: null, updated_at: new Date().toISOString(),
          }, { onConflict: 'smoobu_reservation_id' })
          result = await createPaidInvoice(inp)
          report.erstellt++
        }
        await supabaseAdmin.from('sevdesk_invoices').update({
          sevdesk_id: result.sevdeskId, invoice_number: result.number,
          status: book ? 'gebucht' : 'erstellt', error: null, updated_at: new Date().toISOString(),
        }).eq('smoobu_reservation_id', r.id)
      } catch (e) {
        const msg = String(e instanceof Error ? e.message : e).slice(0, 400)
        report.fehler.push({ smoobuId: r.id, gast: r.guestName, error: msg })
        await supabaseAdmin.from('sevdesk_invoices').upsert({
          smoobu_reservation_id: r.id, booking_id: bk?.id ?? null,
          invoice_number: inp.invoiceNumber, amount: inp.amountGross,
          status: 'fehler', error: msg, updated_at: new Date().toISOString(),
        }, { onConflict: 'smoobu_reservation_id' })
        // Beim allerersten Fehler abbrechen — Kalibrierung vor Massenlauf (§127)
        if (report.erstellt + report.wiederaufgenommen === 0) break
      }
      await sleep(400)
    }

    const verbleibend = queue.length - report.erstellt - report.wiederaufgenommen
    return NextResponse.json({ dryRun: false, ...report, verbleibend }, NO_STORE)
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e).slice(0, 400) }, { status: 500 })
  }
}
