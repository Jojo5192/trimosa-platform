/**
 * 🧾 Lexoffice-/Lexware-Office-Anbindung (§158) — server-only.
 *
 * Gateway ist seit Mai 2025 api.lexware.io (das alte api.lexoffice.io ist
 * tot). Env: LEXOFFICE_API_KEY. Rate-Limit 2 req/s — unser Volumen ist winzig.
 *
 * Regeln (Inhaber, 23.7.):
 *  - Rechnung um 15:00 am ANREISETAG (Cron), on-demand frühestens ab Anreisetag
 *  - für ALLE Kanäle (auch Portale), Beträge BRUTTO inkl. 7 % USt
 *  - Empfänger „so gut wie möglich" (meist nur Gast-Name, ohne Anschrift) —
 *    versendet wird i. d. R. nicht; auf Anfrage wird der Empfänger im Chat
 *    geklärt und die Rechnung in der lexoffice-UI angepasst (API kann
 *    Rechnungen nicht ändern; vor der Festschreibung ist die UI frei)
 *  - „als bezahlt markieren" gibt die API nicht her (payments read-only) —
 *    die Rechnung trägt stattdessen Zahlweg-Vermerk in remark/Positionstext
 */
import { supabaseAdmin } from '@/lib/supabase-admin'

const LEX_BASE = 'https://api.lexware.io/v1'

export function lexofficeConfigured(): boolean {
  return !!process.env.LEXOFFICE_API_KEY
}

async function lexFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${LEX_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.LEXOFFICE_API_KEY}`,
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  })
}

function berlinToday(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 10)
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
  if (/direct|direkt|website|trimosa/.test(v)) return 'die TRIMOSA-Website'
  if (/fewo|homeaway|vrbo/.test(v)) return 'FeWo-direkt'
  if (/hometogo/.test(v)) return 'HomeToGo'
  if (/booking/.test(v)) return 'Booking.com'
  return 'den Buchungskanal'
}

interface BookingRow {
  id: string; status: string; source: string | null; payment_status: string | null
  check_in: string; check_out: string; guest_name: string | null; guest_id: string | null
  total_price: number | null; channel: string | null; listing_id: string | null
  adults: number | null; children: number | null
}

/** §159: Rechnungsempfänger — Override (Chat) > Website-Profil > Gast-Name. */
export interface InvoiceRecipient {
  name: string
  supplement?: string
  street?: string
  zip?: string
  city?: string
  countryCode?: string
}

const COUNTRY_CODES: Record<string, string> = {
  deutschland: 'DE', germany: 'DE', niederlande: 'NL', netherlands: 'NL', nederland: 'NL',
  belgien: 'BE', belgium: 'BE', belgie: 'BE', 'belgië': 'BE', luxemburg: 'LU', luxembourg: 'LU',
  frankreich: 'FR', france: 'FR', 'österreich': 'AT', oesterreich: 'AT', austria: 'AT',
  schweiz: 'CH', switzerland: 'CH', polen: 'PL', poland: 'PL', italien: 'IT', italy: 'IT',
  spanien: 'ES', spain: 'ES', 'dänemark': 'DK', denmark: 'DK', schweden: 'SE', sweden: 'SE',
  'vereinigtes königreich': 'GB', 'united kingdom': 'GB', england: 'GB',
}
function countryCodeFor(v: string | null | undefined): string {
  const s = (v ?? '').trim()
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase()
  return COUNTRY_CODES[s.toLowerCase()] ?? 'DE'
}

export function sanitizeRecipient(raw: unknown): InvoiceRecipient | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, 120) : ''
  if (!name) return null
  const opt = (k: string, max = 120) => (typeof r[k] === 'string' && (r[k] as string).trim() ? (r[k] as string).trim().slice(0, max) : undefined)
  return {
    name,
    supplement: opt('supplement'),
    street: opt('street'),
    zip: opt('zip', 12),
    city: opt('city'),
    countryCode: countryCodeFor(opt('countryCode', 40) ?? opt('country', 40)),
  }
}

/** Empfänger auflösen: gespeicherter Override → Website-Profil (inkl. Firma) → Gast-Name. */
async function resolveRecipient(b: BookingRow): Promise<InvoiceRecipient> {
  const { data: row } = await supabaseAdmin
    .from('lexoffice_invoices').select('recipient').eq('booking_id', b.id).maybeSingle()
  const stored = sanitizeRecipient((row as { recipient?: unknown } | null)?.recipient)
  if (stored) return stored

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

export async function saveRecipient(bookingId: string, recipient: InvoiceRecipient): Promise<void> {
  await upsertRow(bookingId, { recipient })
}

/**
 * Rechnung für EINE Buchung erstellen (idempotent über lexoffice_invoices).
 * Guards: confirmed · Anreisetag erreicht · Betrag > 0 · Website nur bezahlt.
 */
export async function createInvoiceForBooking(bookingId: string, opts: {
  /** §159: expliziter Empfänger (Neu-Ausstellung) — wird auch gespeichert */
  recipient?: InvoiceRecipient
  /** §159: bestehende Rechnung ignorieren und NEU ausstellen (die alte muss
   *  in der lexoffice-UI storniert/gelöscht werden — Hinweis im Aufrufer) */
  force?: boolean
} = {}): Promise<{
  ok: boolean; lexofficeId?: string; voucherNumber?: string | null; skipped?: string; error?: string
}> {
  if (!lexofficeConfigured()) return { ok: false, error: 'LEXOFFICE_API_KEY fehlt' }

  const { data: existing } = await supabaseAdmin
    .from('lexoffice_invoices').select('lexoffice_id, voucher_number').eq('booking_id', bookingId).maybeSingle()
  if (existing?.lexoffice_id && !opts.force) {
    return { ok: true, lexofficeId: existing.lexoffice_id, voucherNumber: existing.voucher_number, skipped: 'existiert bereits' }
  }
  if (opts.recipient) await saveRecipient(bookingId, opts.recipient)

  const { data: b } = await supabaseAdmin
    .from('bookings')
    .select('id, status, source, payment_status, check_in, check_out, guest_name, guest_id, total_price, channel, listing_id, adults, children')
    .eq('id', bookingId).maybeSingle() as { data: BookingRow | null }
  if (!b) return { ok: false, error: 'Buchung nicht gefunden' }
  if (b.status !== 'confirmed') return { ok: false, skipped: `status=${b.status}` }
  if (b.source === 'trimosa' && b.payment_status !== 'paid') return { ok: false, skipped: 'unbezahlte Website-Buchung' }
  const today = berlinToday()
  if (String(b.check_in) > today) return { ok: false, skipped: 'Anreisetag noch nicht erreicht' }
  const amount = Number(b.total_price)
  if (!Number.isFinite(amount) || amount <= 0) {
    await upsertRow(bookingId, { status: 'fehler', error: 'kein Betrag (total_price fehlt)' })
    return { ok: false, error: 'kein Betrag (total_price fehlt)' }
  }

  const { data: l } = b.listing_id
    ? await supabaseAdmin.from('listings').select('title').eq('id', b.listing_id).maybeSingle()
    : { data: null }
  const listingTitle = (l as { title?: string } | null)?.title ?? 'Ferienwohnung'
  const kanal = channelLabel(b)
  const n = nights(b.check_in, b.check_out)
  const persons = (b.adults ?? 1) + (b.children ?? 0)

  // §159: Empfänger — expliziter Wunsch > gespeicherter Override >
  // Website-Profil (inkl. Firma + Anschrift) > Gast-Name
  const rec = opts.recipient ?? await resolveRecipient(b)
  const address: Record<string, string> = { name: rec.name, countryCode: rec.countryCode ?? 'DE' }
  if (rec.supplement) address.supplement = rec.supplement
  if (rec.street) address.street = rec.street
  if (rec.zip) address.zip = rec.zip
  if (rec.city) address.city = rec.city

  const payload = {
    voucherDate: `${today}T12:00:00.000Z`,
    address,
    lineItems: [{
      type: 'custom',
      name: `Übernachtung ${listingTitle}`.slice(0, 255),
      description: `Aufenthalt ${fmtDate(b.check_in)}–${fmtDate(b.check_out)} (${n} ${n === 1 ? 'Nacht' : 'Nächte'}, ${persons} ${persons === 1 ? 'Person' : 'Personen'}), gebucht über ${kanal}.`,
      quantity: 1,
      unitName: 'Pauschale',
      unitPrice: { currency: 'EUR', grossAmount: Math.round(amount * 100) / 100, taxRatePercentage: 7 },
    }],
    totalPrice: { currency: 'EUR' },
    taxConditions: { taxType: 'gross' },
    shippingConditions: {
      shippingType: 'serviceperiod',
      shippingDate: `${b.check_in}T12:00:00.000Z`,
      shippingEndDate: `${b.check_out}T12:00:00.000Z`,
    },
    remark: `Bereits bezahlt über ${kanal}. Vielen Dank für deinen Aufenthalt!`,
  }

  const res = await lexFetch('/invoices?finalize=true', { method: 'POST', body: JSON.stringify(payload) })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const err = `lexoffice HTTP ${res.status}: ${body.slice(0, 300)}`
    console.error('[lexoffice] create failed:', bookingId.slice(0, 8), err)
    await upsertRow(bookingId, { status: 'fehler', error: err })
    return { ok: false, error: err }
  }
  const created = await res.json().catch(() => null) as { id?: string } | null
  if (!created?.id) {
    await upsertRow(bookingId, { status: 'fehler', error: 'Antwort ohne id' })
    return { ok: false, error: 'Antwort ohne id' }
  }

  // Belegnummer nachladen (best effort)
  let voucherNumber: string | null = null
  try {
    const inv = await lexFetch(`/invoices/${created.id}`).then((r) => (r.ok ? r.json() : null))
    voucherNumber = (inv as { voucherNumber?: string } | null)?.voucherNumber ?? null
  } catch { /* egal */ }

  await upsertRow(bookingId, {
    lexoffice_id: created.id, voucher_number: voucherNumber, amount,
    status: 'erstellt', error: null,
  })
  console.log('[lexoffice] Rechnung erstellt:', voucherNumber ?? created.id, '→', rec.name, amount, '€')
  return { ok: true, lexofficeId: created.id, voucherNumber }
}

async function upsertRow(bookingId: string, patch: Record<string, unknown>) {
  await supabaseAdmin.from('lexoffice_invoices').upsert(
    { booking_id: bookingId, ...patch, updated_at: new Date().toISOString() },
    { onConflict: 'booking_id' },
  )
}

/**
 * §159-Nachtrag: AUTOMATISCHE Stornorechnung (Inhaber: „Storno muss
 * definitiv selbstständig passieren"). POST /credit-notes mit
 * precedingSalesVoucherId + finalize=true — laut API-Doku wird die
 * Stornorechnung damit sofort verrechnet („paidoff") und gleicht die
 * Originalrechnung aus. Positionen/Adresse werden aus der Original-
 * rechnung gespiegelt.
 */
export async function stornoInvoice(lexofficeId: string): Promise<{ ok: boolean; creditNoteId?: string; error?: string }> {
  const orig = await lexFetch(`/invoices/${lexofficeId}`)
  if (!orig.ok) return { ok: false, error: `Original nicht ladbar (HTTP ${orig.status})` }
  const inv = await orig.json().catch(() => null) as {
    address?: Record<string, unknown>
    lineItems?: { type?: string; name?: string; description?: string; quantity?: number; unitName?: string; unitPrice?: Record<string, unknown> }[]
    taxConditions?: { taxType?: string }
    voucherNumber?: string
  } | null
  if (!inv) return { ok: false, error: 'Original nicht lesbar' }

  const a = inv.address ?? {}
  const address: Record<string, unknown> = a.contactId
    ? { contactId: a.contactId }
    : {
        name: a.name ?? 'Gast', countryCode: a.countryCode ?? 'DE',
        ...(a.supplement ? { supplement: a.supplement } : {}),
        ...(a.street ? { street: a.street } : {}),
        ...(a.zip ? { zip: a.zip } : {}),
        ...(a.city ? { city: a.city } : {}),
      }
  const lineItems = (inv.lineItems ?? [])
    .filter((li) => li.type !== 'text')
    .map((li) => ({
      type: 'custom',
      name: li.name ?? 'Position',
      ...(li.description ? { description: li.description } : {}),
      quantity: li.quantity ?? 1,
      unitName: li.unitName ?? 'Pauschale',
      unitPrice: li.unitPrice,
    }))
  if (!lineItems.length) return { ok: false, error: 'Original ohne Positionen' }

  const payload = {
    voucherDate: `${berlinToday()}T12:00:00.000Z`,
    address,
    lineItems,
    totalPrice: { currency: 'EUR' },
    taxConditions: { taxType: inv.taxConditions?.taxType ?? 'gross' },
    remark: `Storno zu Rechnung ${inv.voucherNumber ?? lexofficeId} (Rechnungskorrektur).`,
  }
  const res = await lexFetch(`/credit-notes?precedingSalesVoucherId=${lexofficeId}&finalize=true`, {
    method: 'POST', body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, error: `Storno HTTP ${res.status}: ${body.slice(0, 300)}` }
  }
  const created = await res.json().catch(() => null) as { id?: string } | null
  console.log('[lexoffice] Storno erstellt für', inv.voucherNumber ?? lexofficeId, '→', created?.id)
  return { ok: true, creditNoteId: created?.id }
}

/** PDF einer Rechnung als Buffer (render document → file download). */
export async function getInvoicePdf(lexofficeId: string): Promise<{ ok: boolean; pdf?: Buffer; error?: string }> {
  const doc = await lexFetch(`/invoices/${lexofficeId}/document`)
  if (!doc.ok) return { ok: false, error: `document HTTP ${doc.status}` }
  const { documentFileId } = await doc.json().catch(() => ({})) as { documentFileId?: string }
  if (!documentFileId) return { ok: false, error: 'kein documentFileId' }
  const file = await lexFetch(`/files/${documentFileId}`, { headers: { Accept: 'application/pdf' } })
  if (!file.ok) return { ok: false, error: `file HTTP ${file.status}` }
  return { ok: true, pdf: Buffer.from(await file.arrayBuffer()) }
}

/**
 * §160: Q2-Nachschau — Buchungen ab einem Stichtag gegen Lexoffice
 * abgleichen (NUR Liste, nichts erstellen). Matching je Buchung:
 * Engine-Zeile > Lexoffice-Beleg mit gleichem Gast-Namen + Betrag
 * (Entwurf/finalisiert getrennt ausgewiesen) > FEHLT.
 */
interface LexVoucher {
  id: string; voucherNumber: string; voucherStatus: string
  voucherDate: string; contactName: string; totalAmount: number
}

async function fetchVoucherlist(fromDate: string): Promise<{ vouchers: LexVoucher[]; error?: string }> {
  const vouchers: LexVoucher[] = []
  let withDateFilter = true
  for (let page = 0; page < 40; page++) {
    const base = `/voucherlist?voucherType=invoice&voucherStatus=draft,open,paid,voided&size=250&page=${page}&sort=voucherDate,DESC`
    const url = withDateFilter ? `${base}&voucherDateFrom=${fromDate}` : base
    let res = await lexFetch(url)
    if (!res.ok && withDateFilter && page === 0) {
      // Datums-Filter wird evtl. nicht unterstützt → ohne erneut
      withDateFilter = false
      res = await lexFetch(base)
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { vouchers, error: `voucherlist HTTP ${res.status}: ${body.slice(0, 200)}` }
    }
    const data = await res.json().catch(() => null) as { content?: unknown[]; last?: boolean; totalPages?: number } | null
    const items = (data?.content ?? []) as Record<string, unknown>[]
    for (const v of items) {
      vouchers.push({
        id: String(v.id ?? ''),
        voucherNumber: String(v.voucherNumber ?? ''),
        voucherStatus: String(v.voucherStatus ?? ''),
        voucherDate: String(v.voucherDate ?? '').slice(0, 10),
        contactName: String(v.contactName ?? ''),
        totalAmount: Number(v.totalAmount ?? NaN),
      })
    }
    // Ohne Datums-Filter: abbrechen, sobald die Seite älter als der Stichtag ist
    if (!withDateFilter && items.length && vouchers[vouchers.length - 1].voucherDate < fromDate) break
    const totalPages = Number(data?.totalPages ?? 1)
    if (data?.last === true || !items.length || page + 1 >= totalPages) break
  }
  return { vouchers }
}

export interface Q2CheckReport {
  zeitraum: { von: string; bis: string }
  buchungen: number
  belegeGeladen: number
  ok: { engine: number; finalisiert: number }
  finalisiertListe: { gast: string; checkIn: string; betrag: number | null; beleg: string }[]
  nurEntwurf: { gast: string; wohnung: string; checkIn: string; betrag: number | null; beleg: string }[]
  fehlt: { gast: string; wohnung: string; checkIn: string; betrag: number | null; kanal: string }[]
  keinBetrag: { gast: string; wohnung: string; checkIn: string; kanal: string }[]
  nichtZugeordneteBelege?: { beleg: string; kontakt: string; betrag: number; datum: string; status: string }[]
  fehlerlisteError?: string
}

export async function q2Check(from = '2026-04-01'): Promise<Q2CheckReport> {
  const today = berlinToday()
  const report: Q2CheckReport = {
    zeitraum: { von: from, bis: today }, buchungen: 0, belegeGeladen: 0,
    ok: { engine: 0, finalisiert: 0 }, finalisiertListe: [], nurEntwurf: [], fehlt: [], keinBetrag: [],
  }
  const { data: rows } = await supabaseAdmin
    .from('bookings')
    .select('id, guest_name, check_in, check_out, total_price, channel, source, status, listings(title)')
    .gte('check_in', from)
    .lte('check_in', today)
    .eq('status', 'confirmed')
    .order('check_in', { ascending: true })
    .limit(1000)
  const bookings = (rows ?? []) as (BookingRow & { listings?: { title?: string } | { title?: string }[] | null })[]
  report.buchungen = bookings.length
  if (!bookings.length) return report

  const engineDone = new Set<string>()
  const ids = bookings.map((b) => b.id)
  for (let i = 0; i < ids.length; i += 300) {
    const { data: done } = await supabaseAdmin
      .from('lexoffice_invoices').select('booking_id, lexoffice_id').in('booking_id', ids.slice(i, i + 300))
    for (const d of done ?? []) if (d.lexoffice_id) engineDone.add(d.booking_id)
  }

  const { vouchers, error } = await fetchVoucherlist(from)
  report.belegeGeladen = vouchers.length
  if (error) report.fehlerlisteError = error

  const used = new Set<string>()
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  // Zapier-Kontaktnamen sind lange Strings: „<Name> - Buchung Ferienwohnung
  // <Wohnung> | … (DD-MM-YYYY - DD-MM-YYYY)" — nur den Namens-Teil vergleichen
  const contactBase = (s: string) => norm(s.split(/\s+-\s+buchung/i)[0] ?? s)
  const ddmmyyyy = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split('-')
    return `${d}-${m}-${y}`
  }
  for (const b of bookings) {
    const gast = b.guest_name ?? 'Gast'
    const lt = (Array.isArray(b.listings) ? b.listings[0] : b.listings)?.title ?? '—'
    const kanal = channelLabel(b)
    if (engineDone.has(b.id)) { report.ok.engine++; continue }
    const amount = Number(b.total_price)
    if (!Number.isFinite(amount) || amount <= 0) {
      report.keinBetrag.push({ gast, wohnung: lt, checkIn: b.check_in, kanal })
      continue
    }
    // Beleg-Match: Namens-Teil identisch UND (Betrag ±1,50 € [Zapier ist
    // centgenau, unsere total_price teils gerundet] ODER der Kontaktname
    // enthält exakt den Anreise-Zeitraum der Buchung)
    const checkInTag = ddmmyyyy(b.check_in)
    const candidates = vouchers.filter((v) =>
      !used.has(v.id)
      && contactBase(v.contactName) === norm(gast)
      && (Math.abs(v.totalAmount - amount) < 1.5 || v.contactName.includes(checkInTag)))
    candidates.sort((a, c) =>
      Math.abs(new Date(a.voucherDate).getTime() - new Date(b.check_in).getTime())
      - Math.abs(new Date(c.voucherDate).getTime() - new Date(b.check_in).getTime()))
    const hit = candidates[0]
    if (hit) {
      used.add(hit.id)
      if (hit.voucherStatus === 'draft') {
        report.nurEntwurf.push({ gast, wohnung: lt, checkIn: b.check_in, betrag: amount, beleg: hit.voucherNumber })
      } else {
        report.ok.finalisiert++
        report.finalisiertListe.push({ gast, checkIn: b.check_in, betrag: amount, beleg: hit.voucherNumber })
      }
    } else {
      report.fehlt.push({ gast, wohnung: lt, checkIn: b.check_in, betrag: amount, kanal })
    }
  }
  // Gegenrichtung: Belege ohne zugeordnete Buchung (Diagnose)
  report.nichtZugeordneteBelege = vouchers
    .filter((v) => !used.has(v.id))
    .slice(0, 60)
    .map((v) => ({ beleg: v.voucherNumber, kontakt: v.contactName.slice(0, 70), betrag: v.totalAmount, datum: v.voucherDate, status: v.voucherStatus }))
  return report
}

export interface InvoiceRunReport {
  dryRun: boolean
  gefunden: number
  erstellt: number
  fehler: { gast: string; error: string }[]
  uebersprungen: { gast: string; grund: string }[]
  due: { gast: string; wohnung: string; betrag: number | null; kanal: string }[]
}

/** Tageslauf (Cron 15:00): Rechnungen für die HEUTIGEN Anreisen. */
export async function runInvoiceRun(opts: { dryRun?: boolean } = {}): Promise<InvoiceRunReport> {
  const dryRun = opts.dryRun === true
  const report: InvoiceRunReport = { dryRun, gefunden: 0, erstellt: 0, fehler: [], uebersprungen: [], due: [] }
  if (!lexofficeConfigured()) { report.fehler.push({ gast: '—', error: 'LEXOFFICE_API_KEY fehlt' }); return report }

  const today = berlinToday()
  const { data: rows } = await supabaseAdmin
    .from('bookings')
    .select('id, status, source, payment_status, check_in, check_out, guest_name, total_price, channel, listing_id, adults, children, listings(title)')
    .eq('check_in', today)
    .eq('status', 'confirmed')
    .limit(100)
  const bookings = (rows ?? []) as (BookingRow & { listings?: { title?: string } | { title?: string }[] | null })[]
  report.gefunden = bookings.length
  if (!bookings.length) return report

  const { data: done } = await supabaseAdmin
    .from('lexoffice_invoices').select('booking_id, lexoffice_id')
    .in('booking_id', bookings.map((b) => b.id))
  const doneSet = new Set((done ?? []).filter((d) => d.lexoffice_id).map((d) => d.booking_id))

  for (const b of bookings) {
    const gast = b.guest_name ?? 'Gast'
    if (doneSet.has(b.id)) { report.uebersprungen.push({ gast, grund: 'Rechnung existiert' }); continue }
    if (b.source === 'trimosa' && b.payment_status !== 'paid') { report.uebersprungen.push({ gast, grund: 'unbezahlt (Website)' }); continue }
    const lt = (Array.isArray(b.listings) ? b.listings[0] : b.listings)?.title ?? '—'
    if (dryRun) {
      report.due.push({ gast, wohnung: lt, betrag: b.total_price, kanal: channelLabel(b) })
      continue
    }
    const r = await createInvoiceForBooking(b.id)
    if (r.ok && !r.skipped) report.erstellt++
    else if (r.error) report.fehler.push({ gast, error: r.error })
    else if (r.skipped) report.uebersprungen.push({ gast, grund: r.skipped })
  }
  return report
}
