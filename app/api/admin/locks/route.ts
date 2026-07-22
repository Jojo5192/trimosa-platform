import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { listNukiLocks, nukiConfigured, listTedeeLocks, tedeeConfigured, getLockSettings, getStaffCodes, syncStaffCode, validateDoorCode, type LockRef } from '@/lib/locks'

/**
 * 🔑 Admin: Türschloss-Zuordnung je Wohnung + Service-PINs + Einstellungen.
 *  GET   → nuki (Schloss-Liste live, wenn Token da), listings (mit locks),
 *          servicePins (app_settings), revealDays
 *  PATCH → { listingId, locks: LockRef[] }
 *        | { listingId, servicePin: string }   (leer = entfernen)
 *        | { settings: { revealDays } }
 */
export const dynamic = 'force-dynamic'
// Personen-Code-Sync macht je Schloss mehrere Nuki-Calls (§141)
export const maxDuration = 60

async function requireAdmin() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabaseAdmin.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  return me?.is_admin ? user : null
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  const [{ data: listings, error: lErr }, { data: pinRow }, settings, staffCodes, { data: teamProfiles }] = await Promise.all([
    supabaseAdmin.from('listings').select('id, title, locks').eq('is_active', true).order('title'),
    supabaseAdmin.from('app_settings').select('value').eq('key', 'service_pins').maybeSingle(),
    getLockSettings(),
    getStaffCodes(),
    // Personen-Codes (§141): alle Team-Rollen zur Auswahl
    supabaseAdmin.from('profiles')
      .select('id, display_name, is_admin, is_host, is_staff, is_provider')
      .or('is_admin.eq.true,is_host.eq.true,is_staff.eq.true,is_provider.eq.true')
      .order('display_name'),
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

  // tedee (River Retreat, §142) — fail-soft wie Nuki
  let tedee: { id: string; name: string }[] | null = null
  let tedeeError: string | null = null
  if (tedeeConfigured()) {
    try { tedee = await listTedeeLocks() } catch (err) { tedeeError = err instanceof Error ? err.message : String(err) }
  } else {
    tedeeError = 'TEDEE_API_KEY fehlt (Vercel-Env) — Personal Access Key im tedee-Portal (Scope Device.ReadWrite) erstellen.'
  }

  return NextResponse.json({
    listings: listings ?? [],
    nuki,
    nukiError,
    tedee,
    tedeeError,
    servicePins: (pinRow?.value as Record<string, string> | null) ?? {},
    staffCodes,
    people: (teamProfiles ?? []).map((p) => ({
      id: p.id,
      name: (p.display_name ?? '').trim() || 'Ohne Namen',
      role: p.is_provider && !p.is_staff && !p.is_host && !p.is_admin ? 'Dienstleister'
        : p.is_staff && !p.is_host && !p.is_admin ? 'Mitarbeiter' : 'Gastgeber/Admin',
    })),
    revealDays: settings.revealDays,
    validFromHour: settings.validFromHour,
    validUntilHour: settings.validUntilHour,
  })
}

/** POST { action: 'diagnose', bookingId } — zeigt Guard-Felder + das
 *  konkrete Ergebnis von ensureDoorCode (inkl. Nuki-Fehlertext) als JSON.
 *  POST { action: 'auth-audit' } — listet je Nuki-Schloss die TRIMOSA-
 *  Keypad-Codes (Name + Gültigkeit) + Gesamtzahl der Auths (200er-Limit!).
 *  Diagnose-Werkzeuge, weil die stillen skip-Pfade sonst nur im Log stehen. */
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const body = await req.json()

  if (body.action === 'auth-audit') {
    const { auditNukiAuths } = await import('@/lib/locks')
    try {
      return NextResponse.json(await auditNukiAuths())
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
    }
  }

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
    // Bestehende Werte laden und nur die mitgeschickten Felder ändern
    const cur = await getLockSettings()
    const num = (v: unknown, min: number, max: number, fallback: number) => {
      const n = Number(v)
      return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback
    }
    const next = {
      revealDays: 'revealDays' in body.settings ? num(body.settings.revealDays, 0, 30, cur.revealDays) : cur.revealDays,
      validFromHour: 'validFromHour' in body.settings ? num(body.settings.validFromHour, 0, 23, cur.validFromHour) : cur.validFromHour,
      validUntilHour: 'validUntilHour' in body.settings ? num(body.settings.validUntilHour, 1, 24, cur.validUntilHour) : cur.validUntilHour,
    }
    const { error } = await supabaseAdmin.from('app_settings').upsert(
      { key: 'lock_settings', value: next }, { onConflict: 'key' },
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, settings: next })
  }

  // 👤 Personen-Code (§141): { staffCode: { personId, listingIds } } —
  // leere listingIds = Code komplett entziehen. Der Sync legt/entfernt die
  // Dauercodes direkt auf den Nuki-Schlössern der gewählten Wohnungen.
  if (body.staffCode && typeof body.staffCode === 'object') {
    const personId = String(body.staffCode.personId ?? '')
    const listingIds = Array.isArray(body.staffCode.listingIds)
      ? body.staffCode.listingIds.map(String).slice(0, 50) : []
    if (!personId) return NextResponse.json({ error: 'personId fehlt.' }, { status: 400 })
    // Optionaler WUNSCH-Code (§142-Nachtrag) — validiert gegen die Regeln
    // beider Provider; leer/fehlend = bestehenden behalten bzw. generieren
    const desiredCode = String(body.staffCode.code ?? '').trim() || undefined
    if (desiredCode) {
      const codeErr = validateDoorCode(desiredCode)
      if (codeErr) return NextResponse.json({ error: codeErr }, { status: 400 })
    }
    const { data: prof } = await supabaseAdmin.from('profiles').select('display_name').eq('id', personId).maybeSingle()
    if (!prof) return NextResponse.json({ error: 'Person nicht gefunden.' }, { status: 404 })
    const firstName = (prof.display_name ?? '').trim().split(/\s+/)[0] || 'Team'
    try {
      const result = await syncStaffCode(personId, firstName, listingIds, desiredCode)
      return NextResponse.json({ ok: true, staffCode: result })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
    }
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
