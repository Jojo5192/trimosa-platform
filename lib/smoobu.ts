/**
 * Smoobu API client — server-side only, uses SMOOBU_API_KEY from env
 */

const SMOOBU_BASE = 'https://login.smoobu.com/api'

// Global fallback API key (used if host has no own key stored)
const GLOBAL_API_KEY = process.env.SMOOBU_API_KEY ?? ''
// Global fallback channel ID
const GLOBAL_CHANNEL_ID = parseInt(process.env.SMOOBU_CHANNEL_ID ?? '1602674')

function smoobuHeaders(apiKey?: string) {
  return {
    'Api-Key': apiKey || GLOBAL_API_KEY,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
  }
}

/**
 * Reads recent reservations to collect all distinct channel instances for this account.
 * Smoobu channel IDs are account-specific (e.g. the host's own Airbnb connection ID),
 * NOT the global type IDs (Airbnb=74, Booking.com=14 etc.).
 */
export async function discoverAvailableChannels(
  apiKey: string,
): Promise<{ id: number; name: string }[]> {
  try {
    const res = await fetch(`${SMOOBU_BASE}/reservations?pageSize=25&page=1`, {
      headers: smoobuHeaders(apiKey),
    })
    if (!res.ok) return []
    const data = await res.json()
    const bookings: { channel?: { id: number; name: string } }[] = data.bookings ?? []
    // Deduplicate channels by id
    const seen = new Map<number, string>()
    for (const b of bookings) {
      if (b.channel?.id && !seen.has(b.channel.id)) {
        seen.set(b.channel.id, b.channel.name)
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }))
  } catch {
    return []
  }
}

/**
 * Validates a Smoobu API key by fetching apartments.
 * Returns { valid, apartments } so hosts can confirm which properties are linked.
 */
export async function validateSmoobuApiKey(apiKey: string): Promise<{
  valid: boolean
  apartments: { id: number; name: string }[]
}> {
  try {
    const res = await fetch(`${SMOOBU_BASE}/apartments`, {
      headers: smoobuHeaders(apiKey),
    })
    if (!res.ok) return { valid: false, apartments: [] }
    const data = await res.json()
    const apartments = (data.apartments ?? []).map((a: { id: number; name: string }) => ({
      id: a.id,
      name: a.name,
    }))
    return { valid: true, apartments }
  } catch {
    return { valid: false, apartments: [] }
  }
}

/* ── Types ─────────────────────────────────────────────────── */

export interface SmoobuDayRate {
  available: 0 | 1
  price: number
  min_length_of_stay: number
}

// { '2025-06-01': { available: 1, price: 120, min_length_of_stay: 2 }, ... }
export type SmoobuRateMap = Record<string, SmoobuDayRate>

export interface SmoobuReservation {
  id: number
  reference_id: string
  type: string
  arrivalDate: string
  departureDate: string
  firstName: string
  lastName: string
  email: string
  phone: string
  adults: number
  children: number
  price: number
  priceFormatted: string
  commission: number
  commissionFormatted: string
  channel: { id: number; name: string }
  apartment: { id: number; name: string }
}

/* ── Rates / Availability ───────────────────────────────────── */

/**
 * Fetches per-day rate + availability for an apartment.
 * Returns a flat map keyed by ISO date string.
 */
export async function getApartmentRates(
  smoobuApartmentId: string | number,
  from: string,   // YYYY-MM-DD
  to: string,     // YYYY-MM-DD
): Promise<SmoobuRateMap> {
  // Smoobu expects underscore date params: start_date / end_date
  const params = new URLSearchParams()
  params.append('apartments[]', String(smoobuApartmentId))
  params.append('start_date', from)
  params.append('end_date', to)
  const url = `${SMOOBU_BASE}/rates?${params.toString()}`

  const res = await fetch(url, {
    headers: smoobuHeaders(),
    next: { revalidate: 300 }, // 5-min cache
  })
  if (!res.ok) {
    const errText = await res.text()
    console.error('[Smoobu] getApartmentRates failed', res.status, errText)
    return {}
  }
  const data = await res.json()
  // Response structure: { data: { [apartmentId]: { [date]: { available, price, min_length_of_stay } } } }
  const apartmentData = data?.data?.[String(smoobuApartmentId)]
  return (apartmentData as SmoobuRateMap) ?? {}
}

/**
 * Checks whether a specific date range is fully available.
 * Returns { available: boolean, totalPrice: number, nights: number }
 */
export async function checkAvailability(
  smoobuApartmentId: string | number,
  checkIn: string,   // YYYY-MM-DD
  checkOut: string,  // YYYY-MM-DD
): Promise<{ available: boolean; totalPrice: number; nights: number; minStayViolation: boolean }> {
  const rates = await getApartmentRates(smoobuApartmentId, checkIn, checkOut)
  const dates = eachDayBetween(checkIn, checkOut) // exclusive of checkout day
  const nights = dates.length

  if (nights === 0) return { available: false, totalPrice: 0, nights: 0, minStayViolation: false }

  let totalPrice = 0
  let allAvailable = true
  let minStayViolation = false

  for (const date of dates) {
    const rate = rates[date]
    if (!rate || rate.available === 0) {
      allAvailable = false
      break
    }
    if (rate.min_length_of_stay > nights) {
      minStayViolation = true
    }
    totalPrice += rate.price
  }

  return { available: allAvailable, totalPrice: Math.round(totalPrice), nights, minStayViolation }
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

/**
 * Flexible-date availability. Finds the free window of the SAME length whose
 * check-in is closest to the requested date, within ±flexDays (checked in the
 * order 0, −1, +1, −2, +2 …). Respects min_length_of_stay and never suggests a
 * window in the past. Returns the best window (with `shifted` = whether it
 * differs from the requested dates), or null if nothing in range is free.
 */
export async function findFlexibleStay(
  smoobuApartmentId: string | number,
  checkIn: string,
  checkOut: string,
  flexDays = 3,
): Promise<{ checkIn: string; checkOut: string; totalPrice: number; nights: number; shifted: boolean } | null> {
  const nights = eachDayBetween(checkIn, checkOut).length
  if (nights === 0) return null

  // One fetch over the whole widened window.
  const rates = await getApartmentRates(
    smoobuApartmentId,
    addDaysIso(checkIn, -flexDays),
    addDaysIso(checkOut, flexDays),
  )

  const offsets: number[] = [0]
  for (let d = 1; d <= flexDays; d++) offsets.push(-d, d)
  const today = new Date().toISOString().split('T')[0]

  for (const offset of offsets) {
    const ci = addDaysIso(checkIn, offset)
    if (ci < today) continue // never suggest a stay starting in the past
    const co = addDaysIso(ci, nights)
    let ok = true
    let price = 0
    for (const day of eachDayBetween(ci, co)) {
      const rate = rates[day]
      if (!rate || rate.available === 0 || rate.min_length_of_stay > nights) { ok = false; break }
      price += rate.price
    }
    if (ok) return { checkIn: ci, checkOut: co, totalPrice: Math.round(price), nights, shifted: offset !== 0 }
  }
  return null
}

/* ── Reservations ───────────────────────────────────────────── */

export interface CreateReservationInput {
  smoobuApartmentId: number
  arrivalDate: string   // YYYY-MM-DD
  departureDate: string // YYYY-MM-DD
  firstName: string
  lastName: string
  email: string
  phone?: string
  street?: string   // maps to profiles.guest_street
  postalCode?: string  // maps to profiles.guest_zip
  city?: string     // maps to profiles.guest_city
  country?: string  // maps to profiles.guest_country
  adults?: number
  children?: number
  price?: number
  notice?: string
  // Per-host credentials (override global env vars)
  apiKey?: string
  channelId?: number
}

/**
 * Creates a reservation in Smoobu.
 * Uses SMOOBU_CHANNEL_ID env var (defaults to 23 = FeWo-direkt).
 * Returns the Smoobu reservation ID on success.
 */
export async function createReservation(input: CreateReservationInput): Promise<number> {
  const usedChannelId = input.channelId ?? GLOBAL_CHANNEL_ID
  const usedApiKey = input.apiKey || GLOBAL_API_KEY
  console.log('[Smoobu] createReservation channelId:', usedChannelId, 'apartmentId:', input.smoobuApartmentId)
  const res = await fetch(`${SMOOBU_BASE}/reservations`, {
    method: 'POST',
    headers: smoobuHeaders(usedApiKey),
    body: JSON.stringify({
      channelId: usedChannelId,
      apartmentId: input.smoobuApartmentId,
      arrivalDate: input.arrivalDate,
      departureDate: input.departureDate,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone || '+4900000000',
      // Smoobu requires address as an object with street field
      address: {
        street: input.street || 'Nicht angegeben',
        postalCode: input.postalCode || '00000',
        city: input.city || 'Unbekannt',
      },
      country: input.country || 'DE',
      adults: input.adults ?? 1,
      children: input.children ?? 0,
      price: input.price,
      notice: input.notice ?? 'Direkte Buchung über TRIMOSA',
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Smoobu createReservation failed (${res.status}): ${JSON.stringify(err)}`)
  }

  const data = await res.json()
  return data.id as number
}

/**
 * Cancels / deletes a reservation in Smoobu.
 * Smoobu uses DELETE /reservations/{id} to remove a reservation
 * and free up the calendar block.
 */
export async function cancelReservation(smoobuReservationId: number): Promise<boolean> {
  const res = await fetch(`${SMOOBU_BASE}/reservations/${smoobuReservationId}`, {
    method: 'DELETE',
    headers: smoobuHeaders(),
  })
  if (!res.ok) {
    const err = await res.text()
    console.error('[Smoobu] cancelReservation failed', res.status, err)
    return false
  }
  return true
}

/* ── Messages ───────────────────────────────────────────────── */

export interface SmoobuMessage {
  id: number
  type: string
  message: string
  date: string   // ISO timestamp
  sender: string
  subject: string
}

/**
 * Erkennt Smoobu-AUTOMATIK-/System-Protokolle (Schloss-Ereignisse etc.) am
 * Betreff — diese sind KEINE Gast-Konversation und dürfen NICHT als Gast-
 * Nachricht in den Chat wandern (§143: „Access granted for booking N",
 * „Automation for booking N was scheduled"). Bewusst eng gefasst: nur diese
 * eindeutigen System-Betreffs, echte Nachrichten (auch Bestätigungs-Mails)
 * bleiben unberührt. Der Betreff ist ein System-Feld und immer englisch.
 */
export function isSmoobuSystemMessage(subject: string | null | undefined): boolean {
  const s = String(subject ?? '').trim().toLowerCase()
  if (!s) return false
  return s.startsWith('automation for booking')
    || /^access (granted|revoked) for booking/.test(s)
}

/**
 * Lists Smoobu reservations (arrival-date window, paginated) — used by the
 * chat-knowledge backfill to walk through the message history of past years.
 * Returns a defensive, normalised shape; hasMore signals further pages.
 */
export async function listReservations(
  fromIso: string,
  toIso: string,
  page: number,
  pageSize = 25,
  apiKey?: string,
): Promise<{ reservations: { id: number; apartmentId: number | null; arrival: string | null; departure: string | null; guestName: string | null; channelName: string | null; price: number | null; adults: number | null; children: number | null; cancelled: boolean; blocked: boolean }[]; hasMore: boolean }> {
  const params = new URLSearchParams({
    from: fromIso,
    to: toIso,
    page: String(page),
    pageSize: String(pageSize),
    showCancellation: 'true',
  })
  const res = await fetch(`${SMOOBU_BASE}/reservations?${params}`, {
    headers: smoobuHeaders(apiKey),
    cache: 'no-store',
  })
  if (!res.ok) {
    console.error('[Smoobu] listReservations failed', res.status)
    return { reservations: [], hasMore: false }
  }
  const data = await res.json()
  const rows: unknown[] = Array.isArray(data?.bookings) ? data.bookings
    : Array.isArray(data?.result) ? data.result
    : Array.isArray(data) ? data
    : []
  const pageCount = Number(data?.page_count ?? data?.pageCount ?? 0)
  const reservations = rows.map((r) => {
    const obj = r as Record<string, unknown>
    const apartment = obj.apartment as Record<string, unknown> | undefined
    const channel = obj.channel as Record<string, unknown> | undefined
    return {
      id: Number(obj.id),
      apartmentId: apartment?.id != null ? Number(apartment.id) : null,
      arrival: typeof obj.arrival === 'string' ? obj.arrival : null,
      departure: typeof obj.departure === 'string' ? obj.departure : null,
      guestName: typeof obj['guest-name'] === 'string' ? (obj['guest-name'] as string) : null,
      channelName: typeof channel?.name === 'string' ? (channel.name as string) : null,
      price: typeof obj.price === 'number' ? obj.price : null,
      adults: typeof obj.adults === 'number' ? obj.adults : null,
      children: typeof obj.children === 'number' ? obj.children : null,
      cancelled: String(obj.type ?? '').toLowerCase().includes('cancel'),
      blocked: obj['is-blocked-booking'] === true,
    }
  }).filter((r) => Number.isFinite(r.id))
  return { reservations, hasMore: pageCount > page }
}

/**
 * Fetches all messages for a Smoobu reservation.
 * Pass apiKey to use the host's own Smoobu account credentials.
 */
export async function getReservationMessages(
  smoobuReservationId: number,
  apiKey?: string,
): Promise<SmoobuMessage[]> {
  // §152: onlyRelatedToGuest=false ist PFLICHT — ohne den Parameter liefert
  // Smoobu (Default-Änderung ~23.07.2026) NUR noch Gast-Nachrichten; die
  // komplette Host-Seite (auch über Airbnb/Booking gesendete Team-Antworten
  // und Smoobu-Willkommens-Mails) fehlte sonst. Außerdem ist der Endpoint
  // PAGINIERT (page/page_count) — alle Seiten holen, nicht nur die erste.
  const msgs: unknown[] = []
  let page = 1
  for (let guard = 0; guard < 30; guard++) {
    const res = await fetch(
      `${SMOOBU_BASE}/reservations/${smoobuReservationId}/messages?onlyRelatedToGuest=false&page=${page}`,
      { headers: smoobuHeaders(apiKey), cache: 'no-store' },
    )
    if (!res.ok) {
      console.error('[Smoobu] getReservationMessages failed', res.status, smoobuReservationId, 'page', page)
      break
    }
    const data = await res.json()
    if (guard === 0) console.log('[Smoobu] getReservationMessages raw keys:', JSON.stringify(Object.keys(data ?? {})))

    // Smoobu may return { messages: [...] }, { data: [...] }, or a direct array
    let pageMsgs: unknown[]
    if (Array.isArray(data)) {
      pageMsgs = data
    } else if (Array.isArray(data?.messages)) {
      pageMsgs = data.messages
    } else if (Array.isArray(data?.data)) {
      pageMsgs = data.data
    } else {
      console.warn('[Smoobu] getReservationMessages: unexpected response shape', JSON.stringify(data).slice(0, 200))
      pageMsgs = []
    }
    msgs.push(...pageMsgs)
    const pageCount = Number((data as { page_count?: unknown } | null)?.page_count ?? 1)
    if (!pageMsgs.length || !Number.isFinite(pageCount) || page >= pageCount) break
    page++
  }

  // Log first message to diagnose field format in production
  if (msgs.length > 0) {
    console.log('[Smoobu] First message sample:', JSON.stringify(msgs[0]))
  }

  // Normalise field names
  return msgs.map((m) => {
    const obj = m as Record<string, unknown>
    // Helper: parse Smoobu date → correct UTC ISO string.
    // Smoobu sends timestamps in German local time (CET/CEST) WITHOUT timezone suffix.
    // Without correction Node.js treats them as UTC → stored 1-2 h too late.
    // Fix: if no timezone indicator found, append the correct German offset.
    function parseSmoobuDate(raw: unknown): string {
      if (!raw) return ''
      let s = String(raw).trim()
      // Already has timezone info (Z, +HH:MM, -HH:MM) → parse as-is
      if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s)) {
        const d = new Date(s)
        return isNaN(d.getTime()) ? '' : d.toISOString()
      }
      // No timezone → Smoobu local time. Determine CET (+01:00) vs CEST (+02:00) by month.
      s = s.replace(' ', 'T') // normalise "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SS"
      const monthMatch = s.match(/^(\d{4})-(\d{2})/)
      const month = monthMatch ? parseInt(monthMatch[2]) : 6
      // CEST: end of March → end of October (months 4–10 inclusive is a safe approximation)
      const offset = (month >= 4 && month <= 10) ? '+02:00' : '+01:00'
      const d = new Date(s + offset)
      return isNaN(d.getTime()) ? '' : d.toISOString()
    }
    // Smoobu uses `type` as a message-category code (1 = text, 2 = ???), NOT as sender type.
    // The actual sender is in `senderType` ("owner"/"guest") or `direction` ("outgoing"/"incoming").
    // Prefer senderType > direction > type as fallback only.
    const rawType = String(
      obj.senderType ?? obj.direction ??
      (obj.type != null && obj.type !== '' ? String(obj.type) : '')
    )
    return {
      id: (obj.id ?? obj.messageId) as number,
      type: rawType,
      message: String(obj.message ?? obj.body ?? obj.text ?? obj.messageBody ?? ''),
      date: parseSmoobuDate(obj.date ?? obj.created_at ?? obj.createdAt),
      sender: String(obj.sender ?? obj.senderName ?? ''),
      subject: String(obj.subject ?? ''),
    }
  })
}

/**
 * Sends a message to a guest via Smoobu (host → guest direction).
 * Pass apiKey to use the host's own Smoobu account credentials.
 */
export async function sendMessageToGuest(
  smoobuReservationId: number,
  message: string,
  apiKey?: string,
): Promise<number | null> {
  const res = await fetch(
    `${SMOOBU_BASE}/reservations/${smoobuReservationId}/messages/send-message-to-guest`,
    {
      method: 'POST',
      headers: smoobuHeaders(apiKey),
      body: JSON.stringify({ subject: 'Nachricht von Trimosa', messageBody: message }),
    },
  )
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('[Smoobu] sendMessageToGuest failed', res.status, errText)
    return null
  }
  const data = await res.json().catch(() => null)
  const smoobuMsgId = (data?.id ?? data?.messageId ?? null) as number | null
  console.log('[Smoobu] sendMessageToGuest ok, smoobuMsgId:', smoobuMsgId)
  return smoobuMsgId
}

/**
 * Forwards a guest message to Smoobu (guest → host direction).
 * This makes the guest's Trimosa message visible in Smoobu's message thread.
 * Pass apiKey to use the host's own Smoobu account credentials.
 */
export async function sendMessageToHost(
  smoobuReservationId: number,
  message: string,
  guestName: string,
  apiKey?: string,
): Promise<number | null> {
  const res = await fetch(
    `${SMOOBU_BASE}/reservations/${smoobuReservationId}/messages/send-message-to-host`,
    {
      method: 'POST',
      headers: smoobuHeaders(apiKey),
      body: JSON.stringify({
        subject: `Nachricht von Gast (${guestName}) via Trimosa`,
        messageBody: message,
      }),
    },
  )
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('[Smoobu] sendMessageToHost failed', res.status, errText)
    return null
  }
  const data = await res.json().catch(() => null)
  const smoobuMsgId = (data?.id ?? data?.messageId ?? null) as number | null
  console.log('[Smoobu] sendMessageToHost ok, smoobuMsgId:', smoobuMsgId)
  return smoobuMsgId
}

/**
 * Bestehende Reservierung in Smoobu ERGÄNZEN (§127 Mail-Anreicherung):
 * PUT /api/reservations/{id} mit den übergebenen Feldern (z. B. price,
 * adults, children, phone) — Smoobu übernimmt nur die mitgeschickten Felder.
 * Rückgabe: null bei Erfolg, sonst Fehlertext.
 */
export async function updateReservation(
  reservationId: number,
  fields: Record<string, unknown>,
  apiKey?: string,
): Promise<string | null> {
  const res = await fetch(`${SMOOBU_BASE}/reservations/${reservationId}`, {
    method: 'PUT',
    headers: smoobuHeaders(apiKey),
    body: JSON.stringify(fields),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error('[Smoobu] updateReservation failed:', res.status, detail.slice(0, 200))
    return `HTTP ${res.status}: ${detail.slice(0, 150)}`
  }
  return null
}

/* ── Helpers ────────────────────────────────────────────────── */

/** Returns all calendar days from startDate (inclusive) to endDate (exclusive, = checkout day). */
export function eachDayBetween(startIso: string, endIso: string): string[] {
  const days: string[] = []
  const current = new Date(startIso + 'T00:00:00')
  const end = new Date(endIso + 'T00:00:00')
  while (current < end) {
    days.push(current.toISOString().split('T')[0])
    current.setDate(current.getDate() + 1)
  }
  return days
}
