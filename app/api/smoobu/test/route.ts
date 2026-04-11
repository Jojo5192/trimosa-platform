import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * GET /api/smoobu/test
 * Diagnostic endpoint — tests the Smoobu API connection and lists apartments.
 * Remove this in production!
 */
export async function GET() {
  const apiKey = process.env.SMOOBU_API_KEY
  const results: Record<string, unknown> = {
    apiKeySet: !!apiKey,
    apiKeyPrefix: apiKey ? apiKey.substring(0, 8) + '...' : null,
  }

  // 1. Test API connection by fetching apartments
  try {
    const res = await fetch('https://login.smoobu.com/api/apartments', {
      headers: {
        'Api-Key': apiKey ?? '',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
    })
    const data = await res.json()
    results.apartmentsStatus = res.status
    results.apartments = res.ok
      ? (data.apartments ?? data).map?.((a: { id: number; name: string }) => ({ id: a.id, name: a.name })) ?? data
      : data
  } catch (err) {
    results.apartmentsError = String(err)
  }

  // 2. Check what smoobu_ids are stored in our listings
  const { data: listings } = await supabaseAdmin
    .from('listings')
    .select('id, title, smoobu_id')
    .not('smoobu_id', 'is', null)
  results.listingsWithSmoobuId = listings?.map(l => ({
    id: l.id,
    title: l.title,
    smoobu_id: l.smoobu_id,
    smoobu_id_type: typeof l.smoobu_id,
    parsedInt: parseInt(l.smoobu_id),
    isValidNumber: !isNaN(parseInt(l.smoobu_id)),
  }))

  // 3. Fetch available channels
  try {
    const res = await fetch('https://login.smoobu.com/api/channels', {
      headers: {
        'Api-Key': apiKey ?? '',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
    })
    const data = await res.json().catch(() => ({}))
    results.channelsStatus = res.status
    results.channels = data
  } catch (err) {
    results.channelsError = String(err)
  }

  return NextResponse.json(results, { status: 200 })
}
