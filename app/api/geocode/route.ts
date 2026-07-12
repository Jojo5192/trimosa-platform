import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

/**
 * Server-side geocoding proxy for the listing editor's map pin.
 * Turns a free-text address into coordinates via OpenStreetMap Nominatim.
 * Proxied server-side so we can set a compliant User-Agent (Nominatim policy)
 * and avoid CORS. Auth-gated so it can't be abused as an open geocoder.
 */
export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const q = request.nextUrl.searchParams.get('q')?.trim()
  if (!q || q.length < 3) {
    return NextResponse.json({ error: 'Adresse zu kurz' }, { status: 400 })
  }

  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', q)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '1')
  url.searchParams.set('countrycodes', 'de,lu,be')
  url.searchParams.set('addressdetails', '0')

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'TRIMOSA-Platform/1.0 (mail@trimosa.de)',
        'Accept-Language': 'de',
      },
      // Nominatim results are stable; let the platform cache briefly.
      next: { revalidate: 3600 },
    })
    if (!res.ok) return NextResponse.json({ error: 'Geocoding fehlgeschlagen' }, { status: 502 })
    const results = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>
    if (!results.length) return NextResponse.json({ found: false })
    const { lat, lon, display_name } = results[0]
    return NextResponse.json({
      found: true,
      lat: Number(lat),
      lon: Number(lon),
      label: display_name,
    })
  } catch {
    return NextResponse.json({ error: 'Geocoding fehlgeschlagen' }, { status: 502 })
  }
}
