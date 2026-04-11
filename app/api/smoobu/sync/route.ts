import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

const SMOOBU_BASE = 'https://login.smoobu.com/api'

// POST /api/smoobu/sync
// Importiert nur NEUE Smoobu-Apartments als Listings. Bestehende werden nie verändert.
export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 })
  }

  // API Key immer aus der profiles-Tabelle lesen — niemals aus env oder user_metadata
  const { data: hostProfile } = await supabaseAdmin
    .from('profiles')
    .select('smoobu_api_key')
    .eq('id', user.id)
    .maybeSingle()

  const apiKey = hostProfile?.smoobu_api_key
  if (!apiKey) {
    return NextResponse.json({ error: 'Kein Smoobu API Key hinterlegt. Bitte zuerst Smoobu unter Einstellungen verbinden.' }, { status: 400 })
  }

  // Apartments von Smoobu laden
  let res: Response
  try {
    res = await fetch(`${SMOOBU_BASE}/apartments`, {
      headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
    })
  } catch (fetchErr) {
    return NextResponse.json({ error: 'Smoobu API nicht erreichbar.', details: String(fetchErr) }, { status: 502 })
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ error: 'Ungültiger Smoobu API Key. Bitte prüfe den Key in Smoobu unter Einstellungen → API.', smoobuStatus: res.status }, { status: 401 })
    }
    return NextResponse.json({ error: `Smoobu API Fehler (Status ${res.status})`, details: errBody }, { status: 502 })
  }

  let data: Record<string, unknown>
  try {
    data = await res.json()
  } catch {
    return NextResponse.json({ error: 'Ungültige Antwort von Smoobu' }, { status: 502 })
  }

  // Smoobu kann apartments direkt oder unter _embedded.apartments zurückgeben
  let apartments: SmoobuApartment[] = []
  if (Array.isArray(data.apartments)) {
    apartments = data.apartments
  } else if (data._embedded && Array.isArray((data._embedded as Record<string, unknown>).apartments)) {
    apartments = (data._embedded as Record<string, unknown>).apartments as SmoobuApartment[]
  } else if (Array.isArray(data)) {
    apartments = data as unknown as SmoobuApartment[]
  }

  if (apartments.length === 0) {
    return NextResponse.json({
      message: 'Keine Apartments in deinem Smoobu-Konto gefunden.',
      imported: 0,
      debug: { keys: Object.keys(data) },
    })
  }

  let imported = 0
  let skipped = 0
  const errors: string[] = []

  for (const apt of apartments) {
    try {
      const smoobuTitle = apt.name || apt.name_detail || `Smoobu #${apt.id}`
      const smoobuGuests = apt.maxGuests ?? apt.max_guests ?? 2
      const smoobuBedrooms = apt.rooms?.bedrooms ?? apt.bedrooms ?? 1
      const smoobuId = String(apt.id)

      // Prüfen ob Listing mit dieser smoobu_id schon existiert
      const { data: existingById } = await supabase
        .from('listings')
        .select('id')
        .eq('smoobu_id', smoobuId)
        .eq('host_id', user.id)
        .maybeSingle()

      if (existingById) {
        // Bereits verknüpft — nichts ändern
        skipped++
        continue
      }

      // Auch nach Titel suchen (Listings die manuell erstellt wurden, noch ohne smoobu_id)
      const { data: existingByTitle } = await supabase
        .from('listings')
        .select('id, smoobu_id')
        .eq('title', smoobuTitle)
        .eq('host_id', user.id)
        .maybeSingle()

      if (existingByTitle) {
        // Listing existiert bereits (manuell erstellt) — nur smoobu_id verknüpfen, alles andere unangetastet lassen
        if (!existingByTitle.smoobu_id) {
          await supabase.from('listings').update({ smoobu_id: smoobuId }).eq('id', existingByTitle.id)
        }
        skipped++
        continue
      }

      // Neues Listing: minimalen Stub anlegen — Host füllt Rest im Editor aus
      const smoobuLocation = [apt.location?.city, apt.location?.country].filter(Boolean).join(', ') || ''
      const { error: insertError } = await supabase.from('listings').insert({
        host_id: user.id,
        smoobu_id: smoobuId,
        title: smoobuTitle,
        description: '',
        location: smoobuLocation,
        price_per_night: 0,
        max_guests: smoobuGuests,
        bedrooms: smoobuBedrooms,
        images: [],
        is_active: false, // Host muss erst Texte/Fotos ergänzen und dann aktivieren
      })

      if (insertError) {
        errors.push(`Fehler bei "${smoobuTitle}": ${insertError.message}`)
      } else {
        imported++
      }
    } catch (err) {
      errors.push(`Fehler bei Apartment ${apt.id}: ${String(err)}`)
    }
  }

  const msg = imported > 0
    ? `${imported} neue Wohnung${imported > 1 ? 'en' : ''} importiert${skipped > 0 ? `, ${skipped} bereits vorhandene übersprungen` : ''}`
    : skipped > 0
    ? `Alle ${skipped} Wohnungen sind bereits vorhanden — nichts geändert`
    : 'Keine Apartments gefunden'

  return NextResponse.json({
    message: msg + (errors.length > 0 ? ` (${errors.length} Fehler)` : ''),
    imported,
    skipped,
    total: apartments.length,
    errors: errors.length > 0 ? errors : undefined,
    note: imported > 0 ? 'Neue Inserate wurden als inaktiv angelegt. Bitte Texte, Fotos und Ort ergänzen und dann aktivieren.' : undefined,
  })
}

// Buchung an Smoobu pushen
export async function PUT(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 })
  }

  const { data: hostProfile } = await supabaseAdmin
    .from('profiles')
    .select('smoobu_api_key')
    .eq('id', user.id)
    .maybeSingle()

  const apiKey = hostProfile?.smoobu_api_key
  if (!apiKey) {
    return NextResponse.json({ error: 'Kein Smoobu API Key hinterlegt.' }, { status: 400 })
  }

  const { bookingId } = await request.json()

  const { data: booking } = await supabase
    .from('bookings')
    .select('*, listings(smoobu_id, title)')
    .eq('id', bookingId)
    .single()

  if (!booking) {
    return NextResponse.json({ error: 'Buchung nicht gefunden' }, { status: 404 })
  }

  const listing = booking.listings as unknown as { smoobu_id: string | null; title: string }

  if (!listing?.smoobu_id) {
    return NextResponse.json({ error: 'Kein Smoobu-Apartment verknüpft' }, { status: 400 })
  }

  const res = await fetch(`${SMOOBU_BASE}/reservations`, {
    method: 'POST',
    headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    body: JSON.stringify({
      apartmentId: parseInt(listing.smoobu_id),
      arrivalDate: booking.check_in,
      departureDate: booking.check_out,
      channelId: -1,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return NextResponse.json({ error: 'Smoobu Fehler', details: err }, { status: res.status })
  }

  const result = await res.json()
  return NextResponse.json({ ok: true, smoobu_reservation_id: result.id })
}

interface SmoobuApartment {
  id: number
  name?: string
  name_detail?: string
  maxGuests?: number
  max_guests?: number
  bedrooms?: number
  rooms?: { bedrooms?: number }
  location?: { city?: string; street?: string; country?: string }
}
