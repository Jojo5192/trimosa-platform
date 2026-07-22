import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * 🔑 Türschloss-Abstraktion (Gästemappe Phase 2, §132).
 *
 * Provider heute: Nuki (Web API, Bearer-Token aus NUKI_API_TOKEN — Smart
 * Hosting läuft bereits, damit ToS-konform). tedee (River Retreat) folgt
 * als eigener Adapter, sobald der Personal Access Key vorliegt — die
 * locks-Konfiguration trägt das provider-Feld schon.
 *
 * Nuki-Code-Regeln: 6-stellig, NUR Ziffern 1–9 (keine 0), darf nicht mit
 * „12" beginnen, einmalig pro Schloss. Zeiten in UTC.
 * PIN-Name = „TRIMOSA <Buchungs-Kurz-ID>" — datensparsam, kein Gastname.
 */

export interface LockRef { provider: 'nuki' | 'tedee'; id: string; label: string }

const NUKI_BASE = 'https://api.nuki.io'

function nukiToken(): string | null {
  return process.env.NUKI_API_TOKEN ?? null
}

async function nukiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = nukiToken()
  if (!token) throw new Error('NUKI_API_TOKEN fehlt (Vercel-Env).')
  return fetch(`${NUKI_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  })
}

export function nukiConfigured(): boolean {
  return !!nukiToken()
}

/** Alle Schlösser des Nuki-Kontos (für die Zuordnung in der Admin-Karte). */
export async function listNukiLocks(): Promise<{ id: string; name: string }[]> {
  const res = await nukiFetch('/smartlock')
  if (!res.ok) throw new Error(`Nuki /smartlock HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const list = await res.json() as { smartlockId: number; name?: string }[]
  return (list ?? []).map((l) => ({ id: String(l.smartlockId), name: l.name ?? `Schloss ${l.smartlockId}` }))
}

/** 6-stelliger Code nach Nuki-Regeln (Ziffern 1–9, nicht „12…"-Start) —
 *  erfüllt nebenbei auch die tedee-Regeln (5–8 Stellen, ≥3 verschiedene). */
export function generateDoorCode(): string {
  for (let i = 0; i < 50; i++) {
    let code = ''
    for (let d = 0; d < 6; d++) code += String(1 + Math.floor(Math.random() * 9))
    if (code.startsWith('12')) continue
    if (new Set(code.split('')).size < 3) continue
    return code
  }
  return '345679' // praktisch unerreichbar — deterministischer Fallback
}

/** EINEN Keypad-Code auf mehrere Nuki-Schlösser legen (ein API-Call). */
export async function setNukiCode(
  smartlockIds: number[], name: string, code: string, fromIso: string, untilIso: string,
): Promise<void> {
  const res = await nukiFetch('/smartlock/auth', {
    method: 'PUT',
    body: JSON.stringify({
      name,
      type: 13, // keypad code
      code: Number(code),
      smartlockIds,
      allowedFromDate: fromIso,
      allowedUntilDate: untilIso,
    }),
  })
  if (!res.ok && res.status !== 202 && res.status !== 204) {
    throw new Error(`Nuki auth-PUT HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
}

/** Abgelaufene TRIMOSA-Codes eines Schlosses löschen (200er-Auth-Limit). */
export async function cleanupNukiAuths(smartlockId: number): Promise<number> {
  const res = await nukiFetch(`/smartlock/${smartlockId}/auth`)
  if (!res.ok) return 0
  const auths = await res.json() as { id: string; type?: number; name?: string; allowedUntilDate?: string }[]
  const cutoff = new Date(Date.now() - 2 * 86400_000).toISOString()
  let removed = 0
  for (const a of auths ?? []) {
    if (a.type !== 13 || !a.name?.startsWith('TRIMOSA ') || !a.allowedUntilDate) continue
    if (a.allowedUntilDate >= cutoff) continue
    const del = await nukiFetch(`/smartlock/${smartlockId}/auth/${a.id}`, { method: 'DELETE' })
    if (del.ok || del.status === 204) removed++
  }
  return removed
}

/* ── 👤 Personen-Codes (§141): EIN Dauercode je Team-Mitglied/Dienstleister ── */

export interface StaffCode {
  /** 6-stelliger Keypad-Code — ein Code je Person, auf allen freigegebenen Wohnungen gleich */
  code: string
  /** Wohnungen, deren Nuki-Schlösser den Code tragen */
  listingIds: string[]
  /** Auth-Name bei Nuki (Match-Anker beim Entziehen) — trägt den Vornamen fürs Öffnungs-Protokoll */
  label: string
}

export async function getStaffCodes(): Promise<Record<string, StaffCode>> {
  try {
    const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', 'staff_door_codes').maybeSingle()
    return (data?.value as Record<string, StaffCode> | null) ?? {}
  } catch { return {} }
}

async function saveStaffCodes(codes: Record<string, StaffCode>): Promise<void> {
  const { error } = await supabaseAdmin.from('app_settings').upsert(
    { key: 'staff_door_codes', value: codes }, { onConflict: 'key' },
  )
  if (error) throw new Error(error.message)
}

/** Nuki-Schloss-IDs der Wohnungen (dedupe — die Sirzenich-Haustür hängt an dreien). */
async function nukiLockIdsFor(listingIds: string[]): Promise<number[]> {
  if (!listingIds.length) return []
  const { data } = await supabaseAdmin.from('listings').select('id, locks').in('id', listingIds)
  const ids = new Set<number>()
  for (const l of data ?? []) {
    for (const lock of ((l.locks as LockRef[] | null) ?? [])) {
      if (lock.provider === 'nuki') ids.add(Number(lock.id))
    }
  }
  return [...ids]
}

/** DAUER-Code (ohne Zeitfenster) auf mehrere Schlösser legen — ein API-Call. */
async function setNukiPermanentCode(smartlockIds: number[], name: string, code: string): Promise<void> {
  const res = await nukiFetch('/smartlock/auth', {
    method: 'PUT',
    body: JSON.stringify({ name, type: 13, code: Number(code), smartlockIds }),
  })
  if (!res.ok && res.status !== 202 && res.status !== 204) {
    throw new Error(`Nuki auth-PUT HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
}

/** Alle Keypad-Auths mit exakt diesem Namen von den Schlössern entfernen. */
async function removeNukiAuthsByName(smartlockIds: number[], label: string): Promise<void> {
  for (const id of smartlockIds) {
    const res = await nukiFetch(`/smartlock/${id}/auth`)
    if (!res.ok) continue
    const auths = await res.json() as { id: string; type?: number; name?: string }[]
    for (const a of auths ?? []) {
      if (a.type === 13 && a.name === label) {
        await nukiFetch(`/smartlock/${id}/auth/${a.id}`, { method: 'DELETE' })
      }
    }
  }
}

/**
 * Personen-Code anlegen/ändern/entziehen: EIN fester Keypad-Code je Person,
 * gültig auf den Nuki-Schlössern der freigegebenen Wohnungen (inkl. der
 * zugehörigen Haustür, weil die in listings.locks mit hängt). Der Auth-Name
 * trägt den Vornamen → im Nuki-Protokoll steht, WER wann WO geöffnet hat.
 * Leere Wohnungs-Auswahl = Code komplett entziehen. Der Code selbst bleibt
 * bei Änderungen stabil (die Person muss sich nichts Neues merken).
 */
export async function syncStaffCode(personId: string, firstName: string, listingIds: string[]): Promise<StaffCode | null> {
  const codes = await getStaffCodes()
  const old = codes[personId] ?? null
  const label = old?.label ?? `TRIMOSA-Team ${firstName} ${personId.slice(0, 4)}`
  const code = old?.code ?? generateDoorCode()

  // Sauberer Reset: Code von allen bisher UND künftig betroffenen Schlössern
  // nehmen, dann (falls Auswahl bleibt) frisch auf die Ziel-Schlösser legen
  const affected = await nukiLockIdsFor([...new Set([...(old?.listingIds ?? []), ...listingIds])])
  await removeNukiAuthsByName(affected, label)

  const target = await nukiLockIdsFor(listingIds)
  if (target.length) await setNukiPermanentCode(target, label, code)

  if (listingIds.length) codes[personId] = { code, listingIds, label }
  else delete codes[personId]
  await saveStaffCodes(codes)
  return listingIds.length ? codes[personId] : null
}

export interface LockSettings {
  /** Tage vor Anreise, ab denen der Code in der Gästemappe erscheint */
  revealDays: number
  /** Code gültig ab dieser Stunde (lokal) am ANREISETAG — 0 = Mitternacht */
  validFromHour: number
  /** Code gültig bis zu dieser Stunde (lokal) am ABREISETAG — 24 = Mitternacht */
  validUntilHour: number
}

export async function getLockSettings(): Promise<LockSettings> {
  const def: LockSettings = { revealDays: 3, validFromHour: 0, validUntilHour: 24 }
  try {
    const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', 'lock_settings').maybeSingle()
    const v = (data?.value as Partial<LockSettings> | null) ?? {}
    return {
      revealDays: typeof v.revealDays === 'number' && v.revealDays >= 0 && v.revealDays <= 30 ? v.revealDays : def.revealDays,
      validFromHour: typeof v.validFromHour === 'number' && v.validFromHour >= 0 && v.validFromHour <= 23 ? v.validFromHour : def.validFromHour,
      validUntilHour: typeof v.validUntilHour === 'number' && v.validUntilHour >= 1 && v.validUntilHour <= 24 ? v.validUntilHour : def.validUntilHour,
    }
  } catch { return def }
}

/** Wie viele Tage vor Anreise der Code in der Gästemappe erscheint. */
export async function getRevealDays(): Promise<number> {
  return (await getLockSettings()).revealDays
}

/**
 * Stellt sicher, dass die Buchung einen Türcode hat und dieser auf allen
 * Nuki-Schlössern der Wohnung liegt. Idempotent: existiert bookings.door_code
 * bereits, passiert nichts. Guards: bestätigt + bezahlt (externe Buchungen
 * haben kein payment_status — die zählen als bezahlt).
 * Gültigkeit: Vorabend 20:00 UTC bis Abreisetag 22:00 UTC — tolerant um
 * Mitternachts-/Zeitzonen-Ränder, Check-out ist ohnehin 10:00.
 */
export async function ensureDoorCode(bookingId: string): Promise<string | null> {
  const { data: b } = await supabaseAdmin
    .from('bookings')
    .select('id, status, payment_status, source, check_in, check_out, door_code, listing_id, listings(locks)')
    .eq('id', bookingId)
    .maybeSingle()
  // Stille Ausstiege LOGGEN — ein Gast ohne Code vor der Tür ist zu teuer
  // für eine stumme Diagnose (§41-Lektion)
  const skip = (reason: string) => { console.log('[locks] skip:', reason, bookingId.slice(0, 8)); return null }
  if (!b) return skip('buchung fehlt')
  if (b.door_code) return b.door_code
  if (b.status !== 'confirmed') return skip(`status=${b.status}`)
  // Bezahl-Guard NUR für Website-Direktbuchungen (unbezahlte Stripe-/
  // Geister-Buchungen bekommen keinen Code). Portal-Buchungen (Airbnb/
  // Booking/FeWo) zahlen übers Portal oder vor Ort — deren payment_status
  // ('unpaid'/null) ist für den Zugang irrelevant (§132-Diagnose: Artur).
  if (b.source === 'trimosa' && b.payment_status !== 'paid') return skip(`unbezahlte Direktbuchung (payment=${b.payment_status})`)
  if (!b.check_in || !b.check_out) return skip('kein zeitraum')

  const listing = (Array.isArray(b.listings) ? b.listings[0] : b.listings) as { locks?: LockRef[] } | null
  const nukiIds = ((listing?.locks ?? []) as LockRef[])
    .filter((l) => l.provider === 'nuki')
    .map((l) => Number(l.id))
    .filter(Number.isFinite)
  if (!nukiIds.length) return skip('keine nuki-schlösser')
  if (!nukiConfigured()) return skip('kein NUKI_API_TOKEN')

  const code = generateDoorCode()
  // Gültigkeitsfenster aus den Admin-Einstellungen (lokale Stunden am
  // An-/Abreisetag; −2h ≈ UTC-Umrechnung für Europe/Berlin — im Winter
  // öffnet der Code eine Stunde früher, was bewusst tolerant ist)
  const s = await getLockSettings()
  const from = new Date(new Date(b.check_in + 'T00:00:00.000Z').getTime() + (s.validFromHour - 2) * 3600_000).toISOString()
  const until = new Date(new Date(b.check_out + 'T00:00:00.000Z').getTime() + (s.validUntilHour - 2) * 3600_000).toISOString()
  await setNukiCode(nukiIds, `TRIMOSA ${b.id.slice(0, 8)}`, code, from, until)
  await supabaseAdmin.from('bookings').update({ door_code: code }).eq('id', b.id)
  console.log('[locks] Code gesetzt:', { booking: b.id, locks: nukiIds.length })
  return code
}

/**
 * Cron-Kern: Codes für alle Anreisen der nächsten 7 Tage anlegen +
 * abgelaufene Codes aufräumen. Fehler werden gesammelt und als EIN
 * Team-Push gemeldet (der Gast steht sonst ohne Code vor der Tür).
 */
export async function ensureUpcomingDoorCodes(): Promise<{ created: number; skipped: number; cleaned: number; errors: string[] }> {
  const today = new Date().toISOString().slice(0, 10)
  const horizon = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10)
  const { data: rows } = await supabaseAdmin
    .from('bookings')
    .select('id, guest_name, check_in, listings(title, locks)')
    .eq('status', 'confirmed')
    .is('door_code', null)
    .gte('check_in', today)
    .lte('check_in', horizon)
    .limit(100)

  let created = 0, skipped = 0
  const errors: string[] = []
  const usedLocks = new Set<number>()
  for (const r of rows ?? []) {
    const listing = (Array.isArray(r.listings) ? r.listings[0] : r.listings) as { title?: string; locks?: LockRef[] } | null
    const nukiIds = ((listing?.locks ?? []) as LockRef[]).filter((l) => l.provider === 'nuki').map((l) => Number(l.id))
    if (!nukiIds.length) { skipped++; continue }
    try {
      const code = await ensureDoorCode(r.id)
      if (code) { created++; nukiIds.forEach((id) => usedLocks.add(id)) }
      else skipped++
    } catch (err) {
      errors.push(`${listing?.title ?? '?'} · Anreise ${r.check_in}: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`)
    }
  }

  let cleaned = 0
  for (const id of usedLocks) {
    try { cleaned += await cleanupNukiAuths(id) } catch { /* best effort */ }
  }

  if (errors.length) {
    try {
      const { sendPushToTeam } = await import('@/lib/push')
      await sendPushToTeam('⚠️ Türcode konnte nicht angelegt werden', errors[0] + (errors.length > 1 ? ` (+${errors.length - 1} weitere)` : ''), '/team?tab=aufgaben')
    } catch { /* best effort */ }
    console.error('[locks] Fehler:', errors)
  }
  return { created, skipped, cleaned, errors }
}
