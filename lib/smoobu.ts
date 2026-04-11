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
}

/**
 * Fetches all messages for a Smoobu reservation.
 * Pass apiKey to use the host's own Smoobu account credentials.
 */
export async function getReservationMessages(
  smoobuReservationId: number,
  apiKey?: string,
): Promise<SmoobuMessage[]> {
  const res = await fetch(`${SMOOBU_BASE}/reservations/${smoobuReservationId}/messages`, {
    headers: smoobuHeaders(apiKey),
    cache: 'no-store',
  })
  if (!res.ok) {
    console.error('[Smoobu] getReservationMessages failed', res.status, smoobuReservationId)
    return []
  }
  const data = await res.json()
  // Log raw structure to help diagnose response format issues
  console.log('[Smoobu] getReservationMessages raw keys:', JSON.stringify(Object.keys(data ?? {})))

  // Smoobu may return { messages: [...] }, { data: [...] }, or a direct array
  let msgs: SmoobuMessage[]
  if (Array.isArray(data)) {
    msgs = data
  } else if (Array.isArray(data?.messages)) {
    msgs = data.messages
  } else if (Array.isArray(data?.data)) {
    msgs = data.data
  } else {
    console.warn('[Smoobu] getReservationMessages: unexpected response shape', JSON.stringify(data).slice(0, 200))
    msgs = []
  }

  // Normalise field names (Smoobu may use 'body' or 'text' instead of 'message')
  return msgs.map((m: Record<string, unknown>) => ({
    id: (m.id ?? m.messageId) as number,
    type: (m.type ?? m.senderType ?? '') as string,
    message: (m.message ?? m.body ?? m.text ?? m.messageBody ?? '') as string,
    date: (m.date ?? m.created_at ?? m.createdAt ?? '') as string,
    sender: (m.sender ?? m.senderName ?? '') as string,
  }))
}

/**
 * Sends a message to a guest via Smoobu.
 * Pass apiKey to use the host's own Smoobu account credentials.
 */
export async function sendMessageToGuest(
  smoobuReservationId: number,
  message: string,
  apiKey?: string,
): Promise<boolean> {
  const res = await fetch(
    `${SMOOBU_BASE}/reservations/${smoobuReservationId}/messages/send-message-to-guest`,
    {
      method: 'POST',
      headers: smoobuHeaders(apiKey),
      // Smoobu API requires 'messageBody' (not 'message') + optional 'subject'
      body: JSON.stringify({ subject: 'Nachricht von Trimosa', messageBody: message }),
    },
  )
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('[Smoobu] sendMessageToGuest failed', res.status, errText)
  }
  return res.ok
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
