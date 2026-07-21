import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { listNukiLocks, nukiConfigured, getRevealDays, type LockRef } from '@/lib/locks'

/**
 * 🔑 Admin: Türschloss-Zuordnung je Wohnung + Service-PINs + Einstellungen.
 *  GET   → nuki (Schloss-Liste live, wenn Token da), listings (mit locks),
 *          servicePins (app_settings), revealDays
 *  PATCH → { listingId, locks: LockRef[] }
 *        | { listingId, servicePin: string }   (leer = entfernen)
 *        | { settings: { revealDays } }
 */
export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabaseAdmin.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  return me?.is_admin ? user : null
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  const [{ data: listings, error: lErr }, { data: pinRow }, revealDays] = await Promise.all([
    supabaseAdmin.from('listings').select('id, title, locks').eq('is_active', true).order('title'),
    supabaseAdmin.from('app_settings').select('value').eq('key', 'service_pins').maybeSingle(),
    getRevealDays(),
  ])
  if (lErr) {
    return NextResponse.json({ error: 'Migration 20260720_door_codes.sql fehlt noch (listings.locks).' }, { status: 500 })
  }

  let nuki: { id: string; name: string }[] | null = null
  let nukiError: string | null = null
  if (nukiConfigured()) {
    try { nuki = await listNukiLocks() } catch (err) { nukiError = err instanceof Error ? err.message : String(err) }
  } else {
    nukiError = 'NUKI_API_TOKEN fehlt (Vercel-Env) — Token auf web.nuki.io generieren.'
  }

  return NextResponse.json({
    listings: listings ?? [],
    nuki,
    nukiError,
    servicePins: (pinRow?.value as Record<string, string> | null) ?? {},
    revealDays,
  })
}

/** POST { action: 'diagnose', bookingId } — zeigt Guard-Felder + das
 *  konkrete Ergebnis von ensureDoorCode (inkl. Nuki-Fehlertext) als JSON.
 *  Diagnose-Werkzeug, weil die stillen skip-Pfade sonst nur im Log stehen. */
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const body = await req.json()
  if (body.action !== 'diagnose' || !body.bookingId) {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }
  const { data: b } = await supabaseAdmin
    .from('bookings')
    .select('id, status, payment_status, check_in, check_out, door_code, guest_name, listings(title, locks)')
    .eq('id', String(body.bookingId))
    .maybeSingle()
  if (!b) return NextResponse.json({ error: 'Buchung nicht gefunden.' }, { status: 404 })
  const listing = (Array.isArray(b.listings) ? b.listings[0] : b.listings) as { title?: string; locks?: LockRef[] } | null
  let result: string | null = null
  let error: string | null = null
  try {
    const { ensureDoorCode } = await import('@/lib/locks')
    result = await ensureDoorCode(b.id)
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }
  return NextResponse.json({
    guest: b.guest_name, status: b.status, payment: b.payment_status,
    checkIn: b.check_in, checkOut: b.check_out,
    doorCodeVorher: b.door_code, locks: listing?.locks ?? [],
    nukiConfigured: nukiConfigured(),
    ergebnis: result, fehler: error,
  })
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const body = await req.json()

  if (body.settings) {
    const rd = Number(body.settings.revealDays)
    if (!Number.isFinite(rd) || rd < 0 || rd > 30) return NextResponse.json({ error: 'revealDays 0–30.' }, { status: 400 })
    const { error } = await supabaseAdmin.from('app_settings').upsert(
      { key: 'lock_settings', value: { revealDays: Math.round(rd) } }, { onConflict: 'key' },
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  const listingId = String(body.listingId ?? '')
  if (!listingId) return NextResponse.json({ error: 'listingId fehlt.' }, { status: 400 })

  if (Array.isArray(body.locks)) {
    const locks: LockRef[] = body.locks
      .filter((l: Record<string, unknown>) => (l.provider === 'nuki' || l.provider === 'tedee') && l.id)
      .map((l: Record<string, unknown>) => ({ provider: l.provider, id: String(l.id), label: String(l.label ?? '').slice(0, 80) }))
    const { error } = await supabaseAdmin.from('listings').update({ locks }).eq('id', listingId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, locks })
  }

  if ('servicePin' in body) {
    const pin = String(body.servicePin ?? '').trim()
    if (pin && !/^\d{4,8}$/.test(pin)) return NextResponse.json({ error: 'PIN: 4–8 Ziffern.' }, { status: 400 })
    const { data: row } = await supabaseAdmin.from('app_settings').select('value').eq('key', 'service_pins').maybeSingle()
    const pins = { ...((row?.value as Record<string, string> | null) ?? {}) }
    if (pin) pins[listingId] = pin
    else delete pins[listingId]
    const { error } = await supabaseAdmin.from('app_settings').upsert(
      { key: 'service_pins', value: pins }, { onConflict: 'key' },
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
}
