/**
 * Smoobu API client — server-side only, uses SMOOBU_API_KEY from env
 */

const SMOOBU_BASE = 'https://login.smoobu.com/api'
const API_KEY = process.env.SMOOBU_API_KEY!

function smoobuHeaders() {
  return {
    'Api-Key': API_KEY,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
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
  adults?: number
  children?: number
  price?: number
  notice?: string
}

/**
 * Creates a reservation in Smoobu (direct booking, channelId = -1).
 * Returns the Smoobu reservation ID on success.
 */
export async function createReservation(input: CreateReservationInput): Promise<number> {
  const res = await fetch(`${SMOOBU_BASE}/reservations`, {
    method: 'POST',
    headers: smoobuHeaders(),
    body: JSON.stringify({
      channelId: -1, // -1 = direct booking
      apartmentId: input.smoobuApartmentId,
      arrivalDate: input.arrivalDate,
      departureDate: input.departureDate,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone ?? '',
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
 */
export async function getReservationMessages(smoobuReservationId: number): Promise<SmoobuMessage[]> {
  const res = await fetch(`${SMOOBU_BASE}/reservations/${smoobuReservationId}/messages`, {
    headers: smoobuHeaders(),
    cache: 'no-store',
  })
  if (!res.ok) return []
  const data = await res.json()
  return (data?.messages ?? data ?? []) as SmoobuMessage[]
}

/**
 * Sends a message to a guest via Smoobu.
 */
export async function sendMessageToGuest(
  smoobuReservationId: number,
  message: string,
): Promise<boolean> {
  const res = await fetch(
    `${SMOOBU_BASE}/reservations/${smoobuReservationId}/messages/send-message-to-guest`,
    {
      method: 'POST',
      headers: smoobuHeaders(),
      body: JSON.stringify({ message }),
    },
  )
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
