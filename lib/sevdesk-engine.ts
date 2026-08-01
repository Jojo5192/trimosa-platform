/**
 * 🧾 sevdesk-Rechnungs-ENGINE (§235) — server-only. Pendant zu lib/lexoffice:
 * tägliche Gast-Rechnungen (Cron 15:00 am Anreisetag), on-demand-Erstellung,
 * Empfänger-Flow (§159) und „auf Rechnung" (§201) — ab dem STICHTAG laufen
 * sie über sevdesk statt lexoffice.
 *
 * STICHTAGS-DOKTRIN: Buchungen mit Anreise VOR dem 02.08.2026 bleiben
 * komplett in der lexoffice-Welt (Gast-PDF, Empfänger-Neuausstellung) —
 * ihre sevdesk-Belege aus dem Jahres-Neuaufbau (§234) sind INTERNE Kopien
 * ohne Anschrift und gehen nie an Gäste (kein §14c-Doppelausweis). Ab dem
 * Stichtag ist sevdesk führend; lexoffice bekommt KEINE neuen Rechnungen.
 *
 * Unterschiede zu lexoffice: bezahlte Buchungen werden SOFORT gegen das
 * Kanal-Verrechnungskonto als bezahlt gebucht (bookAmount — schreibt NICHT
 * fest, §234-Empirie); „auf Rechnung" bleibt offen und wird später über den
 * Finom-Bankabgleich in sevdesk ausgeglichen. Nummern laufen in der
 * Neuaufbau-Serie weiter (RE02349 ff., invoiceNumberExists-Schutz §234).
 */
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  sevdeskConfigured, createPaidInvoice, invoiceNumberExists, cancelSevInvoice,
  updateSevInvoiceRecipient, clearingLabelFor, type SevInvoiceInput,
} from '@/lib/sevdesk'
import { sanitizeRecipient, type InvoiceRecipient } from '@/lib/lexoffice'

/** Ab dieser Anreise ist sevdesk das führende Rechnungssystem. */
export const SEV_ENGINE_STICHTAG = '2026-08-02'

function berlinToday(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 10)
}
function shiftDate(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}
function nights(checkIn: string, checkOut: string): number {
  return Math.max(1, Math.round(
    (new Date(checkOut + 'T00:00:00Z').getTime() - new Date(checkIn + 'T00:00:00Z').getTime()) / 86400_000,
  ))
}
function channelLabel(b: { channel?: string | null; source?: string | null }): string {
  const v = (b.channel ?? b.source ?? '').toLowerCase()
  if (/airbnb/.test(v)) return 'Airbnb'
  if (/fewo|homeaway|vrbo/.test(v)) return 'FeWo-direkt'
  if (/direct|direkt|website|trimosa/.test(v)) return 'die TRIMOSA-Website'
  if (/hometogo/.test(v)) return 'HomeToGo'
  if (/booking/.test(v)) return 'Booking.com'
  return 'den Buchungskanal'
}

const CODE_NAMES: Record<string, string> = {
  NL: 'Niederlande', BE: 'Belgien', LU: 'Luxemburg', FR: 'Frankreich', AT: 'Österreich',
  CH: 'Schweiz', GB: 'Vereinigtes Königreich', PL: 'Polen', IT: 'Italien', ES: 'Spanien',
  DK: 'Dänemark', SE: 'Schweden',
}
/** Einmal-Adresse als Text (Invoice.address, §235) — nur wenn mehr als der
 *  Name bekannt ist; sonst druckt sevdesk die Kontakt-Standardanschrift. */
function addressTextFor(rec: InvoiceRecipient): string | undefined {
  const lines = [rec.name]
  if (rec.supplement) lines.push(rec.supplement)
  if (rec.street) lines.push(rec.street)
  const zc = [rec.zip, rec.city].filter(Boolean).join(' ')
  if (zc) lines.push(zc)
  const cc = (rec.countryCode ?? 'DE').toUpperCase()
  if (cc !== 'DE') lines.push(CODE_NAMES[cc] ?? cc)
  return lines.length > 1 ? lines.join('\n') : undefined
}

interface BookingRow {
  id: string; status: string; source: string | null; payment_status: string | null
  check_in: string; check_out: string; guest_name: string | null; guest_id: string | null
  total_price: number | string | null; channel: string | null; listing_id: string | null
  adults: number | null; children: number | null; smoobu_reservation_id: number | null
}

interface SevRow {
  id: string; booking_id: string | null; sevdesk_id: string | null
  invoice_number: string | null; status: string; error: string | null; recipient?: unknown
}

async function getSevRow(bookingId: string): Promise<SevRow | null> {
  const { data } = await supabaseAdmin
    .from('sevdesk_invoices').select('*').eq('booking_id', bookingId).maybeSingle()
  return (data as SevRow | null) ?? null
}

/** Zeile schreiben — select-then-insert/update (§46: nie upsert auf Indizes,
 *  die es zur Deploy-Zeit evtl. noch nicht gibt). */
async function writeSevRow(bookingId: string, smoobuId: number | null, patch: Record<string, unknown>): Promise<void> {
  const existing = await getSevRow(bookingId)
  if (existing) {
    await supabaseAdmin.from('sevdesk_invoices')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', existing.id)
  } else {
    await supabaseAdmin.from('sevdesk_invoices').insert({
      booking_id: bookingId, smoobu_reservation_id: smoobuId,
      ...patch, updated_at: new Date().toISOString(),
    })
  }
}

export async function saveSevRecipient(bookingId: string, recipient: InvoiceRecipient): Promise<void> {
  const { data: b } = await supabaseAdmin
    .from('bookings').select('smoobu_reservation_id').eq('id', bookingId).maybeSingle()
  await writeSevRow(bookingId, (b?.smoobu_reservation_id as number | null) ?? null, { recipient })
}

/** §159: Empfänger — sevdesk-Override > lexoffice-Alt-Override > Website-
 *  Profil (inkl. Firma + Anschrift) > Gast-Name. */
async function resolveSevRecipient(b: BookingRow, row: SevRow | null): Promise<InvoiceRecipient> {
  const stored = sanitizeRecipient(row?.recipient)
  if (stored) return stored
  const { data: legacy } = await supabaseAdmin
    .from('lexoffice_invoices').select('recipient').eq('booking_id', b.id).maybeSingle()
  const legacyRec = sanitizeRecipient((legacy as { recipient?: unknown } | null)?.recipient)
  if (legacyRec) return legacyRec

  if (b.guest_id) {
    const { data: p } = await supabaseAdmin
      .from('profiles')
      .select('account_type, guest_first_name, guest_last_name, company_name, guest_street, guest_zip, guest_city, guest_country, display_name')
      .eq('id', b.guest_id).maybeSingle()
    if (p) {
      const isBiz = p.account_type === 'business' && p.company_name
      const person = [p.guest_first_name, p.guest_last_name].filter(Boolean).join(' ').trim()
      const name = (isBiz ? String(p.company_name) : person) || String(p.display_name ?? '').trim()
      if (name) {
        return sanitizeRecipient({
          name,
          supplement: isBiz && person ? person : undefined,
          street: p.guest_street, zip: p.guest_zip, city: p.guest_city, country: p.guest_country,
        }) ?? { name }
      }
    }
  }
  return { name: (b.guest_name ?? '').trim() || 'Gast', countryCode: 'DE' }
}

/** Nächste freie Nummer der RE0xxxx-Serie (Fortsetzung des Neuaufbaus §234):
 *  DB-Maximum + Live-Prüfung gegen sevdesk (Duplikate biegt sevdesk sonst
 *  STILL auf Auto-Nummern um — Rik-Bos-Lektion). */
async function nextFreeInvoiceNumber(): Promise<string> {
  let maxSeq = 2348 // Neuaufbau-Endstand als Untergrenze
  for (let off = 0; ; off += 1000) {
    const { data } = await supabaseAdmin
      .from('sevdesk_invoices').select('invoice_number').range(off, off + 999)
    for (const r of data ?? []) {
      const m = /^RE0(\d{4,})$/.exec(String(r.invoice_number ?? ''))
      if (m) maxSeq = Math.max(maxSeq, Number(m[1]))
    }
    if (!data || data.length < 1000) break
  }
  let seq = maxSeq + 1
  while (await invoiceNumberExists(`RE0${seq}`)) seq++
  return `RE0${seq}`
}

export interface SevCreateResult {
  ok: boolean; sevdeskId?: string; number?: string | null; skipped?: string; error?: string
}

/**
 * Rechnung für EINE Buchung erstellen (idempotent über sevdesk_invoices).
 * Guards: confirmed · Anreise ab Stichtag · Anreisetag erreicht (außer
 * aufRechnung) · Betrag > 0 · Website nur bezahlt · keine lexoffice-Rechnung.
 * Bezahlte Kanäle werden sofort gegen das Verrechnungskonto gebucht.
 */
export async function createSevInvoiceForBooking(bookingId: string, opts: {
  recipient?: InvoiceRecipient
  /** Neu-Ausstellung nach Storno — bestehende sevdesk_id ignorieren */
  force?: boolean
  /** §201 „auf Rechnung": Zahlungsziel, darf auch VOR der Anreise laufen */
  aufRechnung?: { zielTage: number }
} = {}): Promise<SevCreateResult> {
  if (!sevdeskConfigured()) return { ok: false, error: 'SEVDESK_API_TOKEN fehlt' }

  const row = await getSevRow(bookingId)
  if (row?.sevdesk_id && !opts.force) {
    return { ok: true, sevdeskId: row.sevdesk_id, number: row.invoice_number, skipped: 'existiert bereits' }
  }
  if (opts.recipient) await saveSevRecipient(bookingId, opts.recipient)

  const { data: bRaw } = await supabaseAdmin
    .from('bookings')
    .select('id, status, source, payment_status, check_in, check_out, guest_name, guest_id, total_price, channel, listing_id, adults, children, smoobu_reservation_id')
    .eq('id', bookingId).maybeSingle()
  const b = bRaw as BookingRow | null
  if (!b) return { ok: false, error: 'Buchung nicht gefunden' }
  if (b.status !== 'confirmed') return { ok: false, skipped: `status=${b.status}` }
  if (String(b.check_in) < SEV_ENGINE_STICHTAG) return { ok: false, skipped: 'vor Stichtag — lexoffice-Bestand (§235)' }
  if (!opts.aufRechnung && b.source === 'trimosa' && b.payment_status !== 'paid') return { ok: false, skipped: 'unbezahlte Website-Buchung' }
  const today = berlinToday()
  if (!opts.aufRechnung && String(b.check_in) > today) return { ok: false, skipped: 'Anreisetag noch nicht erreicht' }
  const amount = Math.round(Number(b.total_price) * 100) / 100
  if (!Number.isFinite(amount) || amount <= 0) {
    await writeSevRow(bookingId, b.smoobu_reservation_id, { status: 'fehler', error: 'kein Betrag (total_price fehlt)' })
    return { ok: false, error: 'kein Betrag (total_price fehlt)' }
  }
  // Defensive: hat die Buchung schon eine lexoffice-Rechnung (Alt-Welt),
  // entsteht hier NIE eine zweite (Doppelausweis-Schutz)
  const { data: lex } = await supabaseAdmin
    .from('lexoffice_invoices').select('lexoffice_id, voucher_number').eq('booking_id', bookingId).maybeSingle()
  if (lex?.lexoffice_id) return { ok: false, skipped: `lexoffice-Rechnung existiert (${lex.voucher_number ?? '—'})` }
  // Defensive: Neuaufbau-Zeile derselben Smoobu-Reservierung (sollte ab
  // Stichtag nie greifen — der Neuaufbau endete am 01.08.)
  if (!row && b.smoobu_reservation_id != null) {
    const { data: dup } = await supabaseAdmin
      .from('sevdesk_invoices').select('sevdesk_id, invoice_number')
      .eq('smoobu_reservation_id', b.smoobu_reservation_id).maybeSingle()
    if (dup?.sevdesk_id) return { ok: true, sevdeskId: dup.sevdesk_id, number: dup.invoice_number, skipped: 'existiert bereits (Reservierung)' }
  }

  const { data: l } = b.listing_id
    ? await supabaseAdmin.from('listings').select('title, location_group').eq('id', b.listing_id).maybeSingle()
    : { data: null }
  const lRow = l as { title?: string; location_group?: string | null } | null
  const listingTitle = lRow?.title ?? 'Ferienwohnung'
  // §240-Doktrin: Kostenstelle in sevdesk = STANDORT (location_group); nur
  // Einzelstandort-Wohnungen ohne Gruppe (River) nutzen den Wohnungsnamen.
  // Wohnungsgenaue Aufteilung macht die App in der Auswertung.
  const kstName = lRow?.location_group || listingTitle
  const kanal = channelLabel(b)
  const n = nights(b.check_in, b.check_out)
  const persons = (b.adults ?? 1) + (b.children ?? 0)
  const rec = opts.recipient ?? await resolveSevRecipient(b, row)

  // Nummer: gescheiterter Vorlauf darf seine Nummer behalten, wenn sie in
  // sevdesk noch frei ist; nach force (Storno) IMMER frisch — die alte
  // Nummer gehört jetzt der stornierten Rechnung.
  let num = !opts.force && row?.invoice_number && !row.sevdesk_id ? row.invoice_number : null
  if (num && await invoiceNumberExists(num)) num = null
  if (!num) num = await nextFreeInvoiceNumber()

  // sevdesk_id wird geleert: nach force (Storno) darf ein Fehlschlag der
  // Neu-Ausstellung NIE auf die stornierte Rechnung zurückzeigen — der
  // Retry legt dann sauber neu an statt „existiert bereits" zu melden
  await writeSevRow(bookingId, b.smoobu_reservation_id, {
    invoice_number: num, amount, status: 'angelegt', error: null, sevdesk_id: null,
  })

  const inp: SevInvoiceInput = {
    invoiceNumber: num,
    // Inhaber-Regel §160: Belegdatum = Anreisetag; „auf Rechnung" vor der
    // Anreise entsteht heute
    invoiceDate: opts.aufRechnung && String(b.check_in) > today ? today : String(b.check_in),
    contactName: rec.name,
    apartmentTitle: kstName,
    clearingLabel: clearingLabelFor(`${b.channel ?? ''} ${b.source ?? ''}`),
    amountGross: amount,
    positionName: `Übernachtung ${listingTitle}`.slice(0, 255),
    positionText: `Aufenthalt ${fmtDate(b.check_in)}–${fmtDate(b.check_out)} (${n} ${n === 1 ? 'Nacht' : 'Nächte'}, ${persons} ${persons === 1 ? 'Person' : 'Personen'}), gebucht über ${kanal}.`,
    addressText: addressTextFor(rec),
    footText: opts.aufRechnung
      ? `Zahlung auf Rechnung — bitte überweise den Betrag innerhalb von ${opts.aufRechnung.zielTage} Werktagen nach Rechnungserhalt. Vielen Dank!`
      : `Bereits bezahlt über ${kanal}. Vielen Dank für deinen Aufenthalt!`,
    ...(opts.aufRechnung ? { timeToPay: opts.aufRechnung.zielTage + 2 } : {}),
    deliveryDate: String(b.check_in),
    deliveryDateUntil: String(b.check_out),
  }

  try {
    // „auf Rechnung" bleibt OFFEN (Finom-Bankabgleich in sevdesk gleicht
    // später aus); alles andere ist bereits bezahlt → sofort buchen
    const result = await createPaidInvoice(inp, { book: !opts.aufRechnung })
    await writeSevRow(bookingId, b.smoobu_reservation_id, {
      sevdesk_id: result.sevdeskId, invoice_number: result.number,
      status: opts.aufRechnung ? 'erstellt' : 'gebucht', error: null,
    })
    console.log('[sevdesk-engine] Rechnung erstellt:', result.number, '→', rec.name, amount, '€', opts.aufRechnung ? '(auf Rechnung, offen)' : '(bezahlt gebucht)')
    return { ok: true, sevdeskId: result.sevdeskId, number: result.number }
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e).slice(0, 400)
    console.error('[sevdesk-engine] create failed:', bookingId.slice(0, 8), msg)
    await writeSevRow(bookingId, b.smoobu_reservation_id, { status: 'fehler', error: msg })
    return { ok: false, error: msg }
  }
}

/** §159/§235-Nachtrag: Empfänger ändern — DIREKT auf der bestehenden
 *  Rechnung (gleiche Nummer, sevdesk-Update + PDF-Neu-Render; geht solange
 *  nicht festgeschrieben — Inhaber-Doktrin). Nur bei festgeschriebenen
 *  Belegen bleibt der alte Weg: Auto-Storno + Neu-Ausstellung. */
export async function reissueSevInvoice(bookingId: string, recipient: InvoiceRecipient): Promise<
  SevCreateResult & { updated?: boolean; oldNumber?: string | null; stornoNote?: string }
> {
  const row = await getSevRow(bookingId)
  if (!row?.sevdesk_id) {
    const r = await createSevInvoiceForBooking(bookingId, { recipient })
    return { ...r }
  }
  await saveSevRecipient(bookingId, recipient)
  // Zahlungs-Sicherung nur für BEZAHLTE Rechnungen (row.status 'gebucht') —
  // „auf Rechnung" ('erstellt') bleibt bewusst offen bis zum Bankabgleich
  let rebook: { clearingLabel: string; date: string } | undefined
  if (row.status === 'gebucht') {
    const { data: bk } = await supabaseAdmin
      .from('bookings').select('check_in, channel, source').eq('id', bookingId).maybeSingle()
    if (bk) rebook = { clearingLabel: clearingLabelFor(`${bk.channel ?? ''} ${bk.source ?? ''}`), date: String(bk.check_in) }
  }
  const upd = await updateSevInvoiceRecipient(row.sevdesk_id, {
    contactName: recipient.name,
    addressText: addressTextFor(recipient) ?? recipient.name,
    ...(rebook ? { rebook } : {}),
  })
  if (upd.ok) {
    console.log('[sevdesk-engine] Empfänger direkt geändert:', row.invoice_number, '→', recipient.name)
    return { ok: true, sevdeskId: row.sevdesk_id, number: row.invoice_number, updated: true }
  }
  if (!upd.enshrined) {
    // API lehnt das Update ab (unerwartet) → NICHT automatisch stornieren,
    // der Fehler soll sichtbar werden statt still eine Storno-Kette zu bauen
    return { ok: false, error: `Empfänger-Update fehlgeschlagen: ${upd.error}`, oldNumber: row.invoice_number }
  }
  // Festgeschrieben (z. B. nach der UStVA) → GoBD-Weg: Storno + Neu
  const oldNumber = row.invoice_number
  const st = await cancelSevInvoice(row.sevdesk_id)
  if (!st.ok) return { ok: false, error: `Storno der alten Rechnung fehlgeschlagen: ${st.error}`, oldNumber }
  const r = await createSevInvoiceForBooking(bookingId, { recipient, force: true })
  if (!r.ok) {
    return {
      ...r, oldNumber,
      error: `Alte Rechnung ${oldNumber ?? ''} wurde storniert (${st.cancellationNumber ?? 'Stornorechnung'}), aber die NEUE Ausstellung schlug fehl: ${r.error ?? '—'} — bitte erneut versuchen.`,
    }
  }
  return { ...r, oldNumber, stornoNote: st.cancellationNumber ? `Stornorechnung ${st.cancellationNumber}` : undefined }
}

export interface SevRunReport {
  dryRun: boolean
  gefunden: number
  erstellt: number
  fehler: { gast: string; error: string }[]
  uebersprungen: { gast: string; grund: string }[]
  due: { gast: string; wohnung: string; betrag: number | null; kanal: string }[]
}

/** Tageslauf (Cron 15:00): Rechnungen für die Anreisen von heute — und
 *  gestern (Nachzügler-Buchungen nach dem gestrigen Lauf; idempotent). */
export async function runSevInvoiceRun(opts: { dryRun?: boolean } = {}): Promise<SevRunReport> {
  const dryRun = opts.dryRun === true
  const report: SevRunReport = { dryRun, gefunden: 0, erstellt: 0, fehler: [], uebersprungen: [], due: [] }
  if (!sevdeskConfigured()) { report.fehler.push({ gast: '—', error: 'SEVDESK_API_TOKEN fehlt' }); return report }

  const today = berlinToday()
  const from = shiftDate(today, -1) < SEV_ENGINE_STICHTAG ? SEV_ENGINE_STICHTAG : shiftDate(today, -1)
  if (today < SEV_ENGINE_STICHTAG) return report // vor dem Stichtag macht der Cron nichts
  const { data: rows } = await supabaseAdmin
    .from('bookings')
    .select('id, guest_name, total_price, channel, source, payment_status, listings(title)')
    .gte('check_in', from)
    .lte('check_in', today)
    .eq('status', 'confirmed')
    .limit(100)
  const bookings = (rows ?? []) as {
    id: string; guest_name: string | null; total_price: number | string | null
    channel: string | null; source: string | null; payment_status: string | null
    listings?: { title?: string } | { title?: string }[] | null
  }[]
  report.gefunden = bookings.length
  if (!bookings.length) return report

  const { data: done } = await supabaseAdmin
    .from('sevdesk_invoices').select('booking_id, sevdesk_id')
    .in('booking_id', bookings.map((b) => b.id))
  const doneSet = new Set((done ?? []).filter((d) => d.sevdesk_id).map((d) => d.booking_id))

  for (const b of bookings) {
    const gast = b.guest_name ?? 'Gast'
    if (doneSet.has(b.id)) { report.uebersprungen.push({ gast, grund: 'Rechnung existiert' }); continue }
    if (b.source === 'trimosa' && b.payment_status !== 'paid') { report.uebersprungen.push({ gast, grund: 'unbezahlt (Website)' }); continue }
    const lt = (Array.isArray(b.listings) ? b.listings[0] : b.listings)?.title ?? '—'
    if (dryRun) {
      report.due.push({ gast, wohnung: lt, betrag: b.total_price == null ? null : Number(b.total_price), kanal: channelLabel(b) })
      continue
    }
    const r = await createSevInvoiceForBooking(b.id)
    if (r.ok && !r.skipped) report.erstellt++
    else if (r.error) report.fehler.push({ gast, error: r.error })
    else if (r.skipped) report.uebersprungen.push({ gast, grund: r.skipped })
    await new Promise((ok) => setTimeout(ok, 400))
  }
  return report
}
