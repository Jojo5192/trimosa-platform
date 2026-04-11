import { NextResponse } from 'next/server'

export async function GET() {
  const apiKey = process.env.SMOOBU_API_KEY
  const results: Record<string, unknown> = {}

  // 1. Fetch one existing reservation to see full structure including address fields
  try {
    const res = await fetch('https://login.smoobu.com/api/reservations?pageSize=1&page=1', {
      headers: { 'Api-Key': apiKey ?? '', 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    })
    const data = await res.json().catch(() => ({}))
    // Show the FULL structure of the first booking
    results.fullBookingStructure = data.bookings?.[0] ?? data
  } catch (err) {
    results.error = String(err)
  }

  return NextResponse.json(results)
}
