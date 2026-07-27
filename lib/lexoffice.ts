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
  total_price: number | string | null; channel: string | null; listing_id: string | null
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
  /** §160-Backfill: abweichendes Belegdatum (YYYY-MM-DD, z. B. Anreisetag
   *  vergangener Buchungen — Inhaber-Regel: Rechnungsdatum = Anreisedatum) */
  voucherDate?: string
  /** §201: „Auf Rechnung" — Rechnung mit Zahlungsziel statt „bereits
   *  bezahlt"; darf explizit auch VOR dem Anreisetag erstellt werden. */
  aufRechnung?: { zielTage: number }
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
  if (!opts.aufRechnung && b.source === 'trimosa' && b.payment_status !== 'paid') return { ok: false, skipped: 'unbezahlte Website-Buchung' }
  const today = berlinToday()
  if (!opts.aufRechnung && String(b.check_in) > today) return { ok: false, skipped: 'Anreisetag noch nicht erreicht' }
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
    voucherDate: `${opts.voucherDate ?? today}T12:00:00.000Z`,
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
    remark: opts.aufRechnung
      ? `Zahlung auf Rechnung — bitte überweise den Betrag innerhalb von ${opts.aufRechnung.zielTage} Werktagen nach Rechnungserhalt. Vielen Dank!`
      : `Bereits bezahlt über ${kanal}. Vielen Dank für deinen Aufenthalt!`,
    // §201: Zahlungsziel nur bei „auf Rechnung" (Werktage → Kalendertage +2)
    ...(opts.aufRechnung ? {
      paymentConditions: {
        paymentTermLabel: `Zahlbar innerhalb von ${opts.aufRechnung.zielTage} Werktagen nach Rechnungserhalt.`,
        paymentTermDuration: opts.aufRechnung.zielTage + 2,
      },
    } : {}),
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
export async function stornoInvoice(lexofficeId: string): Promise<{ ok: boolean; creditNoteId?: string; standalone?: boolean; note?: string; error?: string }> {
  const orig = await lexFetch(`/invoices/${lexofficeId}`)
  // 404: Der Beleg existiert nicht mehr (z. B. ein Entwurf, den jemand in der
  // lexoffice-UI gelöscht hat) — dann gibt es nichts zu stornieren, und die
  // Neu-Ausstellung darf trotzdem laufen.
  if (orig.status === 404) return { ok: true, note: 'Originalbeleg existiert nicht mehr (gelöscht) — kein Storno nötig.' }
  if (!orig.ok) return { ok: false, error: `Original nicht ladbar (HTTP ${orig.status})` }
  const inv = await orig.json().catch(() => null) as {
    address?: Record<string, unknown>
    lineItems?: { type?: string; name?: string; description?: string; quantity?: number; unitName?: string; unitPrice?: Record<string, unknown> }[]
    taxConditions?: { taxType?: string }
    voucherNumber?: string
    voucherStatus?: string
  } | null
  if (!inv) return { ok: false, error: 'Original nicht lesbar' }
  // Idempotent: schon storniert -> nichts zu tun.
  if (inv.voucherStatus === 'voided') return { ok: true, note: 'Original war bereits storniert.' }

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
  const taxType = inv.taxConditions?.taxType ?? 'gross'
  const lineItems = (inv.lineItems ?? [])
    .filter((li) => li.type !== 'text')
    .map((li) => {
      // unitPrice NICHT roh spiegeln: lexoffice liefert im GET net- UND
      // grossAmount; beim erneuten POST validiert es beide gegeneinander
      // und lehnt Cent-Rundungsdifferenzen mit 406 ab. Nur die zur taxType
      // passende Seite + Steuersatz senden.
      const up = (li.unitPrice ?? {}) as Record<string, unknown>
      return {
        type: 'custom',
        name: li.name ?? 'Position',
        ...(li.description ? { description: li.description } : {}),
        quantity: li.quantity ?? 1,
        unitName: li.unitName ?? 'Pauschale',
        unitPrice: {
          currency: up.currency ?? 'EUR',
          taxRatePercentage: up.taxRatePercentage ?? 7,
          ...(taxType === 'net'
            ? { netAmount: up.netAmount }
            : { grossAmount: up.grossAmount ?? up.netAmount }),
        },
      }
    })
  if (!lineItems.length) return { ok: false, error: 'Original ohne Positionen' }

  const payload = {
    voucherDate: `${berlinToday()}T12:00:00.000Z`,
    address,
    lineItems,
    totalPrice: { currency: 'EUR' },
    taxConditions: { taxType },
    remark: `Storno zu Rechnung ${inv.voucherNumber ?? lexofficeId} (Rechnungskorrektur).`,
  }
  const post = (query: string) => lexFetch(`/credit-notes?${query}`, {
    method: 'POST', body: JSON.stringify(payload),
  })
  let res = await post(`precedingSalesVoucherId=${lexofficeId}&finalize=true`)
  let standalone = false
  if (!res.ok && (res.status === 406 || res.status === 400)) {
    // Ist die Originalrechnung bereits bezahlt/verrechnet (Bankabgleich),
    // kann lexoffice sie nicht erneut über precedingSalesVoucherId
    // ausgleichen -> als EIGENSTAENDIGE Stornorechnung anlegen; der Bezug
    // steht im remark, die Verrechnung ist 1 Klick in lexoffice.
    const b1 = await res.text().catch(() => '')
    console.warn('[lexoffice] Storno mit preceding scheiterte (HTTP', res.status,
      '· Original-Status', inv.voucherStatus ?? '?', ') → Retry standalone:', b1.slice(0, 200))
    res = await post('finalize=true')
    standalone = true
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, error: `Storno HTTP ${res.status} (Original-Status: ${inv.voucherStatus ?? '?'}): ${body.slice(0, 300)}` }
  }
  const created = await res.json().catch(() => null) as { id?: string } | null
  console.log('[lexoffice] Storno erstellt für', inv.voucherNumber ?? lexofficeId, '→', created?.id, standalone ? '(standalone)' : '')
  return { ok: true, creditNoteId: created?.id, standalone }
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

async function fetchVoucherlist(fromDate: string, voucherType = 'invoice'): Promise<{ vouchers: LexVoucher[]; error?: string }> {
  // ⚠️ voucherStatus ist PFLICHT und je Belegart unterschiedlich (lexoffice-
  // Doku): Rechnungen kennen kein „paidoff", Gutschriften kein „overdue" —
  // ein gemeinsamer Filter warf 400, der alte („draft,open,paid,voided")
  // ließ VERRECHNETE Gutschriften („paidoff" = in der UI „ausbezahlt")
  // komplett verschwinden, wodurch das Audit jedes Storno-Paar für eine
  // Doppel-Fakturierung hielt.
  const STATUS_FILTER = voucherType.includes('creditnote')
    ? 'draft,open,paidoff,voided'
    : 'draft,open,paid,voided'
  const vouchers: LexVoucher[] = []
  let withDateFilter = true
  for (let page = 0; page < 40; page++) {
    const base = `/voucherlist?voucherType=${voucherType}&voucherStatus=${STATUS_FILTER}&size=250&page=${page}&sort=voucherDate,DESC`
    const url = withDateFilter ? `${base}&voucherDateFrom=${fromDate}` : base
    let res = await lexFetch(url)
    if (!res.ok && withDateFilter && page === 0) {
      // Datums-Filter wird evtl. nicht unterstützt → ohne erneut
      withDateFilter = false
      res = await lexFetch(base)
    }
    if (res.status === 429) {
      // Rate-Limit (2 req/s) — kurz warten und dieselbe Seite erneut holen
      await new Promise((ok) => setTimeout(ok, 1500))
      res = await lexFetch(url)
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
    await new Promise((ok) => setTimeout(ok, 550)) // Rate-Limit schonen
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
  nurEntwurf: { gast: string; wohnung: string; checkIn: string; betrag: number | null; beleg: string; bookingId: string; voucherId: string }[]
  fehlt: { gast: string; wohnung: string; checkIn: string; betrag: number | null; kanal: string; bookingId: string }[]
  keinBetrag: { gast: string; wohnung: string; checkIn: string; kanal: string }[]
  nichtZugeordneteBelege?: { beleg: string; kontakt: string; betrag: number; datum: string; status: string; id: string }[]
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
      && v.voucherStatus !== 'voided' // §222: ohne Statusfilter kommen jetzt auch stornierte Belege mit
      && contactBase(v.contactName) === norm(gast)
      && (Math.abs(v.totalAmount - amount) < 1.5 || v.contactName.includes(checkInTag)))
    candidates.sort((a, c) =>
      Math.abs(new Date(a.voucherDate).getTime() - new Date(b.check_in).getTime())
      - Math.abs(new Date(c.voucherDate).getTime() - new Date(b.check_in).getTime()))
    const hit = candidates[0]
    if (hit) {
      used.add(hit.id)
      if (hit.voucherStatus === 'draft') {
        report.nurEntwurf.push({ gast, wohnung: lt, checkIn: b.check_in, betrag: amount, beleg: hit.voucherNumber, bookingId: b.id, voucherId: hit.id })
      } else {
        report.ok.finalisiert++
        report.finalisiertListe.push({ gast, checkIn: b.check_in, betrag: amount, beleg: hit.voucherNumber })
      }
    } else {
      report.fehlt.push({ gast, wohnung: lt, checkIn: b.check_in, betrag: amount, kanal, bookingId: b.id })
    }
  }
  // Gegenrichtung: Belege ohne zugeordnete Buchung (Diagnose)
  report.nichtZugeordneteBelege = vouchers
    .filter((v) => !used.has(v.id))
    .slice(0, 60)
    .map((v) => ({ beleg: v.voucherNumber, kontakt: v.contactName.slice(0, 70), betrag: v.totalAmount, datum: v.voucherDate, status: v.voucherStatus, id: v.id }))
  return report
}

/**
 * §160-Nachtrag: Zahlungsweg-Report — welche der fakturierten Buchungen
 * kann der Inhaber im Bankabgleich bedenkenlos als bezahlt markieren, und
 * welche muss er PRÜFEN (Zahlung floss direkt an TRIMOSA, nicht übers
 * Portal)? Logik je Kanal: Website = Stripe-bezahlt (unbezahlte werden nie
 * fakturiert) · Airbnb/FeWo/HomeToGo = Portal zieht ein · Booking.com =
 * hängt vom Payments-Setup ab · Direktbuchung/unklar = individuell → prüfen.
 */
export interface Q2PaymentReport {
  zeitraum: { von: string; bis: string }
  gruppen: Record<string, { anzahl: number; summe: number }>
  pruefen: { gast: string; wohnung: string; checkIn: string; checkOut: string; betrag: number | null; kanal: string; beleg: string | null }[]
}

export async function q2PaymentReport(from = '2026-04-01'): Promise<Q2PaymentReport> {
  const today = berlinToday()
  const { data: rows } = await supabaseAdmin
    .from('bookings')
    .select('id, guest_name, check_in, check_out, total_price, channel, source, payment_status, listings(title)')
    .gte('check_in', from).lte('check_in', today).eq('status', 'confirmed')
    .order('check_in', { ascending: true }).limit(1000)
  const bookings = (rows ?? []) as (BookingRow & { listings?: { title?: string } | { title?: string }[] | null })[]

  // Belegnummern der Engine-Rechnungen dazu (welche RE-Nummer prüfen?)
  const belege = new Map<string, string>()
  const ids = bookings.map((b) => b.id)
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabaseAdmin
      .from('lexoffice_invoices').select('booking_id, voucher_number').in('booking_id', ids.slice(i, i + 300))
    for (const d of data ?? []) if (d.voucher_number) belege.set(d.booking_id, d.voucher_number)
  }

  const report: Q2PaymentReport = { zeitraum: { von: from, bis: today }, gruppen: {}, pruefen: [] }
  for (const b of bookings) {
    const v = `${b.channel ?? ''} ${b.source ?? ''}`.toLowerCase()
    let key: string
    let pruefen = false
    // Reihenfolge wichtig: „Direct booking" enthält „booking" (§140-Falle)
    if (b.source === 'trimosa') key = 'Website (Stripe — sicher bezahlt)'
    else if (/airbnb/.test(v)) key = 'Airbnb (Portal zieht ein)'
    else if (/fewo|homeaway|vrbo/.test(v)) key = 'FeWo-direkt (Portal)'
    else if (/hometogo/.test(v)) key = 'HomeToGo (Portal)'
    else if (/direct|direkt/.test(v)) { key = 'Direktbuchung — PRÜFEN'; pruefen = true }
    else if (/booking/.test(v)) key = 'Booking.com (je nach Payments-Setup)'
    else { key = 'Unbekannter Kanal — PRÜFEN'; pruefen = true }
    const g = report.gruppen[key] ?? (report.gruppen[key] = { anzahl: 0, summe: 0 })
    g.anzahl += 1
    g.summe = Math.round((g.summe + (Number(b.total_price) || 0)) * 100) / 100
    if (pruefen) {
      report.pruefen.push({
        gast: b.guest_name ?? 'Gast',
        wohnung: (Array.isArray(b.listings) ? b.listings[0] : b.listings)?.title ?? '—',
        checkIn: b.check_in, checkOut: b.check_out, betrag: Number(b.total_price) || null,
        kanal: b.channel ?? b.source ?? '—', beleg: belege.get(b.id) ?? null,
      })
    }
  }
  return report
}

/** §160: Beleg (i. d. R. Zapier-ENTWURF) per API löschen — ob die Public API
 *  das überhaupt kann, entscheidet der erste echte Aufruf (deleteSupported). */
export async function deleteInvoice(lexofficeId: string): Promise<{ ok: boolean; status: number; error?: string }> {
  const res = await lexFetch(`/invoices/${lexofficeId}`, { method: 'DELETE' })
  if (res.ok) return { ok: true, status: res.status }
  const body = await res.text().catch(() => '')
  return { ok: false, status: res.status, error: `HTTP ${res.status}: ${body.slice(0, 200)}` }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface Q2BackfillReport {
  dryRun: boolean
  geplant: number
  verarbeitet: number
  entwurfGeloescht: number
  erstellt: number
  rest: number
  deleteSupported: boolean | null
  fehler: string[]
  vorschau?: { gast: string; checkIn: string; betrag: number | null; aktion: string }[]
}

/**
 * §160-Backfill nach Inhaber-Go: Zapier-Entwürfe LÖSCHEN und durch
 * finalisierte Engine-Rechnungen ersetzen + komplett fehlende nachschießen.
 * Rechnungsdatum = ANREISEDATUM (Inhaber-Regel). Idempotent: erstellte
 * Buchungen landen in lexoffice_invoices (ok.engine beim nächsten q2Check);
 * limit hält den Lauf unter dem 300s-Function-Limit → mehrfach aufrufen.
 * Kann die API Entwürfe NICHT löschen (404/405 beim ersten Versuch), werden
 * alle Entwurf-Fälle übersprungen (KEINE Duplikate) — dann löscht der
 * Inhaber händisch und ein erneuter Lauf behandelt sie als „fehlt".
 */
export async function q2Backfill(opts: { dryRun?: boolean; limit?: number; from?: string } = {}): Promise<Q2BackfillReport> {
  const dryRun = opts.dryRun !== false
  const limit = Math.min(Math.max(Number(opts.limit) || 40, 1), 60)
  const check = await q2Check(opts.from ?? '2026-04-01')
  const queue = [
    ...check.nurEntwurf.map((e) => ({ gast: e.gast, checkIn: e.checkIn, betrag: e.betrag, bookingId: e.bookingId, voucherId: e.voucherId as string | null, beleg: e.beleg as string | null })),
    ...check.fehlt.map((e) => ({ gast: e.gast, checkIn: e.checkIn, betrag: e.betrag, bookingId: e.bookingId, voucherId: null as string | null, beleg: null as string | null })),
  ].sort((a, c) => a.checkIn.localeCompare(c.checkIn))
  const report: Q2BackfillReport = {
    dryRun, geplant: queue.length, verarbeitet: 0, entwurfGeloescht: 0, erstellt: 0,
    rest: queue.length, deleteSupported: null, fehler: [],
  }
  if (dryRun) {
    report.vorschau = queue.slice(0, limit).map((q) => ({
      gast: q.gast, checkIn: q.checkIn, betrag: q.betrag,
      aktion: q.voucherId ? `Entwurf ${q.beleg} löschen + neu (Belegdatum ${q.checkIn})` : `neu erstellen (Belegdatum ${q.checkIn})`,
    }))
    return report
  }
  for (const item of queue) {
    if (report.verarbeitet >= limit) break
    if (item.voucherId) {
      if (report.deleteSupported === false) continue // Entwurf-Fälle ohne Lösch-API überspringen — nie Duplikate
      const del = await deleteInvoice(item.voucherId)
      await sleep(550)
      if (!del.ok) {
        if (report.deleteSupported === null && (del.status === 404 || del.status === 405 || del.status === 400)) {
          report.deleteSupported = false
          report.fehler.push(`Entwurf-Löschen per API nicht möglich (${del.error}) — Entwürfe bitte händisch löschen, danach Lauf wiederholen.`)
          continue
        }
        report.fehler.push(`${item.gast} (${item.checkIn}): Entwurf ${item.beleg} nicht löschbar — ${del.error}`)
        report.verarbeitet++
        continue
      }
      report.deleteSupported = true
      report.entwurfGeloescht++
    }
    // KEIN force: der Existenz-Guard in createInvoiceForBooking macht
    // Wiederholungs-Läufe idempotent (nach Teilfehlern kein Duplikat)
    const r = await createInvoiceForBooking(item.bookingId, { voucherDate: item.checkIn })
    await sleep(900)
    report.verarbeitet++
    if (r.ok) report.erstellt++
    else report.fehler.push(`${item.gast} (${item.checkIn}): ${r.error ?? r.skipped ?? 'unbekannt'}`)
  }
  report.rest = report.geplant - report.erstellt
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
export interface PriceFixReport {
  geprueft: number
  offenAbweichend: { gast: string; beleg: string | null; alt: number; neu: number; bookingId: string }[]
  bezahltAbweichend: { gast: string; beleg: string | null; alt: number; neu: number }[]
  storniert: number
  ohneAbweichung: number
  neuAusgestellt?: { gast: string; alt: string | null; neu: string | null; hinweis?: string }[]
  fehler?: { gast: string; error: string }[]
}

/**
 * §221: Rechnungen finden, deren Betrag nicht mehr zum (jetzt cent-genauen)
 * Buchungsbetrag passt — und auf Wunsch die NOCH OFFENEN neu ausstellen
 * (Storno + Neuausstellung mit Belegdatum = Anreisetag, Empfänger bleibt).
 * Bezahlte bleiben bewusst unangetastet (Inhaber-Entscheid).
 */
/** §221: Beleg-ID zu einer Rechnungsnummer finden (für lex-link, wenn eine
 *  Rechnung manuell in lexoffice erstellt wurde und die App sie nicht kennt). */
export async function findVoucherByNumber(voucherNumber: string): Promise<
  { ok: boolean; id?: string; number?: string; status?: string; total?: number; error?: string }
> {
  const { vouchers, error } = await fetchVoucherlist('2026-01-01')
  if (error) return { ok: false, error }
  const hit = vouchers.find((v) => (v.voucherNumber ?? '').toUpperCase() === voucherNumber.toUpperCase())
  if (!hit) return { ok: false, error: `Beleg ${voucherNumber} nicht gefunden` }
  return { ok: true, id: hit.id, number: hit.voucherNumber ?? undefined, status: hit.voucherStatus ?? undefined, total: hit.totalAmount ?? undefined }
}

export interface InvoiceAuditReport {
  zeitraum: string
  rechnungen: { anzahl: number; summe: number }
  gutschriften: { anzahl: number; summe: number }
  storniert: number
  entwuerfe: number
  nettoUmsatz: number
  verdaechtig: { kontakt: string; netto: number; belege: string[] }[]
  offeneGutschriften: { beleg: string; kontakt: string; betrag: number }[]
  hinweis: string
}

/**
 * §222: Bilanz-Prüfung nach den Storno-/Neuausstellungs-Runden — zählt jede
 * Buchung wirklich nur EINMAL? Holt Rechnungen UND Gutschriften aus
 * lexoffice, gruppiert nach Kontakt und rechnet netto (Rechnungen minus
 * Gutschriften; stornierte Belege zählen nirgends mit). Verdächtig ist ein
 * Kontakt, dessen Netto deutlich über seiner größten Einzelrechnung liegt —
 * das wäre eine doppelt fakturierte Buchung.
 */
export async function invoiceAudit(from = '2026-04-01'): Promise<InvoiceAuditReport> {
  const report: InvoiceAuditReport = {
    zeitraum: `ab ${from}`,
    rechnungen: { anzahl: 0, summe: 0 }, gutschriften: { anzahl: 0, summe: 0 },
    storniert: 0, entwuerfe: 0, nettoUmsatz: 0, verdaechtig: [], offeneGutschriften: [],
    hinweis: '',
  }
  if (!lexofficeConfigured()) { report.hinweis = 'LEXOFFICE_API_KEY fehlt'; return report }

  // ⚠️ NICHT parallel: lexoffice erlaubt 2 Requests/s — Promise.all warf 429
  // und der Gutschriften-Teil kam leer zurück (Audit wäre wertlos gewesen).
  const inv = await fetchVoucherlist(from, 'invoice')
  await new Promise((ok) => setTimeout(ok, 700))
  let cred = await fetchVoucherlist(from, 'creditnote')
  if (!cred.error && !cred.vouchers.length) {
    await new Promise((ok) => setTimeout(ok, 700))
    cred = await fetchVoucherlist(from, 'salescreditnote')
  }
  if (inv.error || cred.error) report.hinweis = [inv.error, cred.error].filter(Boolean).join(' · ')

  const key = (n: string) => n.toLowerCase().replace(/\s+/g, ' ').trim()
  type Item = { nr: string; typ: 'R' | 'G'; status: string; betrag: number; datum: string }
  const byContact = new Map<string, { name: string; items: Item[] }>()
  const add = (v: LexVoucher, typ: 'R' | 'G') => {
    if (v.voucherStatus === 'voided') { report.storniert++; return }
    if (v.voucherStatus === 'draft') { report.entwuerfe++; return }
    const betrag = Number.isFinite(v.totalAmount) ? v.totalAmount : 0
    if (typ === 'R') { report.rechnungen.anzahl++; report.rechnungen.summe += betrag }
    else {
      report.gutschriften.anzahl++; report.gutschriften.summe += betrag
      if (v.voucherStatus === 'open') report.offeneGutschriften.push({ beleg: v.voucherNumber, kontakt: v.contactName, betrag })
    }
    const k = key(v.contactName)
    if (!byContact.has(k)) byContact.set(k, { name: v.contactName, items: [] })
    byContact.get(k)!.items.push({ nr: v.voucherNumber, typ, status: v.voucherStatus, betrag, datum: v.voucherDate })
  }
  for (const v of inv.vouchers) add(v, 'R')
  for (const v of cred.vouchers) add(v, 'G')

  report.rechnungen.summe = Math.round(report.rechnungen.summe * 100) / 100
  report.gutschriften.summe = Math.round(report.gutschriften.summe * 100) / 100
  report.nettoUmsatz = Math.round((report.rechnungen.summe - report.gutschriften.summe) * 100) / 100

  for (const { name, items } of byContact.values()) {
    const rechnungen = items.filter((i) => i.typ === 'R')
    if (rechnungen.length < 2) continue // eine Rechnung = nie doppelt
    const netto = items.reduce((sum, i) => sum + (i.typ === 'R' ? i.betrag : -i.betrag), 0)
    const groesste = Math.max(...rechnungen.map((i) => i.betrag))
    // Mehr Netto als die größte Einzelrechnung + 1 ct ⇒ mindestens eine
    // Buchung wurde doppelt fakturiert (bei Gästen mit MEHREREN Aufenthalten
    // ist das legitim — darum steht die Belegliste dabei).
    if (netto > groesste + 0.01) {
      report.verdaechtig.push({
        kontakt: name, netto: Math.round(netto * 100) / 100,
        belege: items.map((i) => `${i.typ === 'R' ? '' : '−'}${i.nr} ${i.datum} ${i.betrag.toFixed(2)} (${i.status})`),
      })
    }
  }
  report.verdaechtig.sort((a, b) => b.netto - a.netto)
  return report
}

export async function priceFix(opts: { dryRun?: boolean; limit?: number } = {}): Promise<PriceFixReport> {
  const dryRun = opts.dryRun !== false
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 60)
  const report: PriceFixReport = { geprueft: 0, offenAbweichend: [], bezahltAbweichend: [], storniert: 0, ohneAbweichung: 0 }
  if (!lexofficeConfigured()) return report

  const { data: rows } = await supabaseAdmin
    .from('lexoffice_invoices')
    .select('booking_id, lexoffice_id, voucher_number, amount')
    .not('lexoffice_id', 'is', null)
  if (!rows?.length) return report

  const ids = rows.map((r) => r.booking_id as string)
  const prices = new Map<string, { price: number; gast: string; checkIn: string }>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data: bs } = await supabaseAdmin
      .from('bookings').select('id, total_price, guest_name, check_in').in('id', ids.slice(i, i + 200))
    for (const b of bs ?? []) {
      prices.set(b.id as string, {
        price: Number((b as { total_price?: unknown }).total_price ?? 0),
        gast: ((b as { guest_name?: string | null }).guest_name) ?? 'Gast',
        checkIn: String((b as { check_in?: string }).check_in ?? ''),
      })
    }
  }

  for (const r of rows) {
    const b = prices.get(r.booking_id as string)
    if (!b || !(b.price > 0)) continue
    report.geprueft++
    const alt = Number(r.amount ?? 0)
    if (Math.abs(alt - b.price) < 0.005) { report.ohneAbweichung++; continue }
    // Status der Rechnung in lexoffice holen (Rate-Limit 2/s)
    const res = await lexFetch(`/invoices/${r.lexoffice_id}`)
    await new Promise((ok) => setTimeout(ok, 550))
    if (!res.ok) continue
    const inv = await res.json().catch(() => null) as { voucherStatus?: string } | null
    const st = inv?.voucherStatus ?? '?'
    const eintrag = { gast: b.gast, beleg: (r.voucher_number as string | null) ?? null, alt, neu: b.price }
    if (st === 'voided') { report.storniert++; continue }
    if (st === 'paid') { report.bezahltAbweichend.push(eintrag); continue }
    report.offenAbweichend.push({ ...eintrag, bookingId: r.booking_id as string })
  }

  if (dryRun) return report
  report.neuAusgestellt = []
  report.fehler = []
  for (const k of report.offenAbweichend.slice(0, limit)) {
    const st = await stornoInvoice(
      (rows.find((r) => r.booking_id === k.bookingId)?.lexoffice_id as string),
    )
    if (!st.ok) { report.fehler.push({ gast: k.gast, error: `Storno: ${st.error ?? '?'}` }); continue }
    const ci = prices.get(k.bookingId)?.checkIn
    const neu = await createInvoiceForBooking(k.bookingId, { force: true, ...(ci ? { voucherDate: ci } : {}) })
    if (!neu.ok) { report.fehler.push({ gast: k.gast, error: neu.error ?? neu.skipped ?? '?' }); continue }
    report.neuAusgestellt.push({
      gast: k.gast, alt: k.beleg, neu: neu.voucherNumber ?? null,
      ...(st.standalone ? { hinweis: 'Storno eigenständig — in lexoffice verrechnen' } : {}),
    })
    await new Promise((ok) => setTimeout(ok, 900))
  }
  return report
}

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
      report.due.push({ gast, wohnung: lt, betrag: b.total_price == null ? null : Number(b.total_price), kanal: channelLabel(b) })
      continue
    }
    const r = await createInvoiceForBooking(b.id)
    if (r.ok && !r.skipped) report.erstellt++
    else if (r.error) report.fehler.push({ gast, error: r.error })
    else if (r.skipped) report.uebersprungen.push({ gast, grund: r.skipped })
  }
  return report
}
