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

function isMonotoneSequence(c: string): boolean {
  let up = true, down = true
  for (let i = 1; i < c.length; i++) {
    if (Number(c[i]) !== Number(c[i - 1]) + 1) up = false
    if (Number(c[i]) !== Number(c[i - 1]) - 1) down = false
  }
  return up || down
}

/** Prüft einen WUNSCH-Code gegen die Regeln BEIDER Provider —
 *  Fehlertext (deutsch) oder null wenn gültig. */
export function validateDoorCode(code: string): string | null {
  if (!/^[1-9]{6}$/.test(code)) return 'Code: genau 6 Ziffern, nur 1–9 (keine 0 — Nuki-Keypads haben keine 0-Logik).'
  if (code.startsWith('12')) return 'Code darf nicht mit „12" beginnen (Nuki-Regel).'
  if (new Set(code.split('')).size < 3) return 'Code braucht mindestens 3 verschiedene Ziffern.'
  if (isMonotoneSequence(code)) return 'Code darf keine auf-/absteigende Folge sein (z. B. 345678).'
  return null
}

/** 6-stelliger Code nach Nuki-Regeln (Ziffern 1–9, nicht „12…"-Start) —
 *  erfüllt auch die tedee-Regeln (5–8 Stellen, ≥3 verschiedene, keine
 *  streng auf-/absteigende Sequenz wie 345678). */
export function generateDoorCode(): string {
  for (let i = 0; i < 50; i++) {
    let code = ''
    for (let d = 0; d < 6; d++) code += String(1 + Math.floor(Math.random() * 9))
    if (validateDoorCode(code)) continue
    return code
  }
  return '345679' // praktisch unerreichbar — deterministischer Fallback
}

/** EINEN Keypad-Code auf mehrere Nuki-Schlösser legen (ein API-Call).
 *  ⚠️ Nuki verwirft allowedFromDate/UntilDate STILL, wenn allowedWeekDays
 *  (+ allowedFromTime/UntilTime) fehlen — empirisch per window-test bewiesen
 *  (§142). weekDays 127 = alle Wochentage, fromTime/untilTime 0 = ganztags
 *  (= keine tägliche Uhrzeit-Beschränkung, nur der DATUMS-Rahmen zählt).
 *  remoteAllowed ist laut Swagger Pflichtfeld. */
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
      remoteAllowed: false,
      allowedFromDate: fromIso,
      allowedUntilDate: untilIso,
      allowedWeekDays: 127,
      allowedFromTime: 0,
      allowedUntilTime: 0,
    }),
  })
  if (!res.ok && res.status !== 202 && res.status !== 204) {
    throw new Error(`Nuki auth-PUT HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
}

/* ── tedee-Adapter (§142, River Retreat) ──────────────────────────────
 * Cloud-API api.tedee.com v37, Auth „PersonalKey <PAK>" (Personal Access
 * Key aus dem tedee-Portal, Scope Device.ReadWrite). PIN-Regeln: 5–8
 * Ziffern 0–9, ≥3 verschiedene, keine monotone Sequenz. PINs MIT endDate
 * räumt tedee nach Ablauf SELBST ab (kein Cleanup nötig). 406 = „pin
 * already exists", 409 = Gerät beschäftigt, 428 = Schloss offline. */

function tedeeToken(): string | null {
  return process.env.TEDEE_API_KEY ?? null
}

export function tedeeConfigured(): boolean {
  return !!tedeeToken()
}

async function tedeeFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = tedeeToken()
  if (!token) throw new Error('TEDEE_API_KEY fehlt (Vercel-Env).')
  return fetch(`https://api.tedee.com${path}`, {
    ...init,
    headers: {
      Authorization: `PersonalKey ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  })
}

/** tedee wickelt Antworten in { result, success } — defensiv auspacken. */
function tedeeResult<T>(json: unknown): T {
  const j = json as { result?: T } | T
  return (j && typeof j === 'object' && 'result' in (j as object) ? (j as { result: T }).result : j as T)
}

/** Alle tedee-Schlösser des Kontos (für die Zuordnung in der Admin-Karte). */
export async function listTedeeLocks(): Promise<{ id: string; name: string }[]> {
  const res = await tedeeFetch('/api/v37/my/lock')
  if (!res.ok) throw new Error(`tedee /my/lock HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const list = tedeeResult<{ id: number; name?: string }[]>(await res.json())
  return (list ?? []).map((l) => ({ id: String(l.id), name: l.name ?? `tedee ${l.id}` }))
}

async function listTedeePins(lockId: number): Promise<{ id: number; alias?: string }[]> {
  const res = await tedeeFetch(`/api/v37/my/lock/${lockId}/pin`)
  if (!res.ok) return []
  // Antwort: { result: { listVersion, pins: [...] } } — defensiv auch nacktes Array
  const r = tedeeResult<{ pins?: { id: number; alias?: string }[] } | { id: number; alias?: string }[]>(await res.json())
  if (Array.isArray(r)) return r
  return r?.pins ?? []
}

async function hasTedeePin(lockId: number, alias: string): Promise<boolean> {
  return (await listTedeePins(lockId)).some((p) => p.alias === alias)
}

/** PIN anlegen — ohne start/end = Dauercode; mit endDate räumt tedee selbst ab. */
async function setTedeePin(lockId: number, alias: string, pin: string, startIso?: string, endIso?: string): Promise<void> {
  const res = await tedeeFetch(`/api/v37/my/lock/${lockId}/pin`, {
    method: 'POST',
    body: JSON.stringify({
      alias, pin,
      ...(startIso ? { startDate: startIso } : {}),
      ...(endIso ? { endDate: endIso } : {}),
    }),
  })
  if (!res.ok && res.status !== 201 && res.status !== 204) {
    // 406 = „pin already exists" — für die Aufrufer als eigener Text erkennbar
    throw new Error(`tedee pin-POST HTTP ${res.status}${res.status === 406 ? ' (exists already)' : ''}: ${(await res.text()).slice(0, 300)}`)
  }
}

async function removeTedeePinsByAlias(lockId: number, alias: string): Promise<void> {
  for (const p of await listTedeePins(lockId)) {
    if (p.alias === alias) {
      await tedeeFetch(`/api/v37/my/lock/${lockId}/pin/${p.id}`, { method: 'DELETE' })
    }
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

/** Schloss-IDs der Wohnungen je Provider (dedupe — die Sirzenich-Haustür hängt an dreien). */
async function lockIdsFor(listingIds: string[]): Promise<{ nuki: number[]; tedee: number[] }> {
  if (!listingIds.length) return { nuki: [], tedee: [] }
  const { data } = await supabaseAdmin.from('listings').select('id, locks').in('id', listingIds)
  const nuki = new Set<number>()
  const tedee = new Set<number>()
  for (const l of data ?? []) {
    for (const lock of ((l.locks as LockRef[] | null) ?? [])) {
      if (lock.provider === 'nuki') nuki.add(Number(lock.id))
      if (lock.provider === 'tedee') tedee.add(Number(lock.id))
    }
  }
  return { nuki: [...nuki], tedee: [...tedee] }
}

/** DAUER-Code (ohne Zeitfenster) auf mehrere Schlösser legen — ein API-Call. */
async function setNukiPermanentCode(smartlockIds: number[], name: string, code: string): Promise<void> {
  const res = await nukiFetch('/smartlock/auth', {
    method: 'PUT',
    body: JSON.stringify({ name, type: 13, code: Number(code), smartlockIds, remoteAllowed: false }),
  })
  if (!res.ok && res.status !== 202 && res.status !== 204) {
    throw new Error(`Nuki auth-PUT HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
}

/** Nuki KÜRZT Auth-Namen auf 20 Zeichen („TRIMOSA-Team Johannes 9f9c" →
 *  „TRIMOSA-Team Johanne") — Vergleiche müssen die gekürzte Form mitprüfen,
 *  sonst findet der Sync die eigenen Auths nie (§142-Nachtrag). */
function labelMatches(name: string | undefined, label: string): boolean {
  return name === label || name === label.slice(0, 20)
}

/** Alle Keypad-Auths mit diesem Namen von den Schlössern entfernen. */
async function removeNukiAuthsByName(smartlockIds: number[], label: string): Promise<void> {
  for (const id of smartlockIds) {
    const res = await nukiFetch(`/smartlock/${id}/auth`)
    if (!res.ok) continue
    const auths = await res.json() as { id: string; type?: number; name?: string }[]
    for (const a of auths ?? []) {
      if (a.type === 13 && labelMatches(a.name, label)) {
        await nukiFetch(`/smartlock/${id}/auth/${a.id}`, { method: 'DELETE' })
      }
    }
  }
}

/** Trägt das Schloss bereits unsere Auth mit diesem Namen? */
async function hasNukiAuth(smartlockId: number, label: string): Promise<boolean> {
  const res = await nukiFetch(`/smartlock/${smartlockId}/auth`)
  if (!res.ok) return false
  const auths = await res.json() as { type?: number; name?: string }[]
  return (auths ?? []).some((a) => a.type === 13 && labelMatches(a.name, label))
}

/** Diagnose (§142): EIN permanenter Team-Code-PUT auf EIN Schloss mit voller
 *  Response + Nachschau nach 8s — zeigt, ob Nuki die Anlage still verwirft. */
export async function debugTeamCodePut(smartlockId: number, label: string, code: string): Promise<{ putStatus: number; putBody: string; visibleAfter8s: boolean }> {
  const res = await nukiFetch('/smartlock/auth', {
    method: 'PUT',
    body: JSON.stringify({ name: label, type: 13, code: Number(code), smartlockIds: [smartlockId] }),
  })
  const putBody = (await res.text()).slice(0, 400)
  await new Promise((r) => setTimeout(r, 8000))
  return { putStatus: res.status, putBody, visibleAfter8s: await hasNukiAuth(smartlockId, label) }
}

/** Diagnose (§142): Probe-GAST-Codes MIT Zeitfenster in mehreren Payload-
 *  Varianten anlegen und nachprüfen, welche Variante das Fenster WIRKLICH
 *  speichert (Nuki verwirft allowedFromDate/Until beim Bulk-PUT still).
 *  Jede Probe wird wieder gelöscht; bricht beim ersten Treffer ab. */
export async function debugWindowTest(smartlockId: number): Promise<{
  variants: { name: string; putStatus: number; putBody: string; foundAfter8s: boolean; stored?: Record<string, unknown> }[]
  winner: string | null
}> {
  const from = new Date(Date.now() + 86400_000).toISOString()
  const until = new Date(Date.now() + 2 * 86400_000).toISOString()
  const noMillis = (iso: string) => iso.split('.')[0] + 'Z'
  const variants: { name: string; path: string; body: Record<string, unknown> }[] = [
    {
      // Einzel-Schloss-Endpoint statt Bulk — evtl. reicht nur der die Felder durch
      name: 'einzel-endpoint',
      path: `/smartlock/${smartlockId}/auth`,
      body: { name: 'TRIMOSA TEST-A', type: 13, code: Number(generateDoorCode()), remoteAllowed: false, allowedFromDate: from, allowedUntilDate: until },
    },
    {
      // Bulk + komplette Wochentags-/Tageszeit-Felder (wie die Nuki-App sie setzt?)
      name: 'bulk+weekdays',
      path: '/smartlock/auth',
      body: { name: 'TRIMOSA TEST-B', type: 13, code: Number(generateDoorCode()), smartlockIds: [smartlockId], remoteAllowed: false, allowedFromDate: from, allowedUntilDate: until, allowedWeekDays: 127, allowedFromTime: 0, allowedUntilTime: 0 },
    },
    {
      // Bulk, Datum ohne Millisekunden
      name: 'bulk-ohne-millis',
      path: '/smartlock/auth',
      body: { name: 'TRIMOSA TEST-C', type: 13, code: Number(generateDoorCode()), smartlockIds: [smartlockId], remoteAllowed: false, allowedFromDate: noMillis(from), allowedUntilDate: noMillis(until) },
    },
  ]
  const results: { name: string; putStatus: number; putBody: string; foundAfter8s: boolean; stored?: Record<string, unknown> }[] = []
  let winner: string | null = null
  for (const v of variants) {
    const res = await nukiFetch(v.path, { method: 'PUT', body: JSON.stringify(v.body) })
    const putBody = (await res.text()).slice(0, 300)
    await new Promise((r) => setTimeout(r, 8000))
    const listRes = await nukiFetch(`/smartlock/${smartlockId}/auth`)
    const auths = listRes.ok ? (await listRes.json() as { id: string; type?: number; name?: string; allowedFromDate?: string; allowedUntilDate?: string }[]) : []
    const found = auths.find((a) => a.type === 13 && labelMatches(a.name, String(v.body.name)))
    if (found) await nukiFetch(`/smartlock/${smartlockId}/auth/${found.id}`, { method: 'DELETE' })
    results.push({
      name: v.name, putStatus: res.status, putBody,
      foundAfter8s: !!found,
      stored: found ? { allowedFromDate: found.allowedFromDate, allowedUntilDate: found.allowedUntilDate } : undefined,
    })
    if (found?.allowedUntilDate) { winner = v.name; break }
  }
  return { variants: results, winner }
}

/**
 * Personen-Code anlegen/ändern/entziehen: EIN fester Keypad-Code je Person,
 * gültig auf den Nuki-Schlössern der freigegebenen Wohnungen (inkl. der
 * zugehörigen Haustür, weil die in listings.locks mit hängt). Der Auth-Name
 * trägt den Vornamen → im Nuki-Protokoll steht, WER wann WO geöffnet hat.
 * Leere Wohnungs-Auswahl = Code komplett entziehen. Der Code selbst bleibt
 * bei Änderungen stabil (die Person muss sich nichts Neues merken).
 *
 * DIFFERENZ-Logik statt Löschen-und-neu-Anlegen: Nuki verarbeitet Auth-Calls
 * asynchron — denselben Code sofort neu anzulegen racet mit dem Löschen und
 * wirft 409 „code exists already". Darum: unveränderte Schlösser bleiben
 * UNBERÜHRT, entfallende werden geräumt, nur wirklich fehlende bekommen den
 * Code (idempotent per hasNukiAuth-Check, einzeln — Fehler je Schloss benannt).
 */
export async function syncStaffCode(personId: string, firstName: string, listingIds: string[], desiredCode?: string): Promise<StaffCode | null> {
  const codes = await getStaffCodes()
  const old = codes[personId] ?? null
  const label = old?.label ?? `TRIMOSA-Team ${firstName} ${personId.slice(0, 4)}`
  const code = desiredCode || old?.code || generateDoorCode()
  // Wunsch-Code weicht vom bisherigen ab → ALLE alten Auths räumen und
  // überall frisch anlegen (der neue Code-WERT kollidiert nicht mit dem
  // alten, darum greift die Async-409-Falle hier nicht)
  const codeChanged = !!old && code !== old.code

  const oldIds = await lockIdsFor(old?.listingIds ?? [])
  const newIds = await lockIdsFor(listingIds)

  const nukiToClean = codeChanged ? [...new Set([...oldIds.nuki, ...newIds.nuki])] : oldIds.nuki.filter((id) => !newIds.nuki.includes(id))
  const tedeeToClean = codeChanged ? [...new Set([...oldIds.tedee, ...newIds.tedee])] : oldIds.tedee.filter((t) => !newIds.tedee.includes(t))
  await removeNukiAuthsByName(nukiToClean, label)
  for (const id of tedeeToClean) await removeTedeePinsByAlias(id, label)

  const problems: string[] = []
  for (const id of newIds.nuki) {
    try {
      // Bei Code-Wechsel keinen Skip — die alte Auth (alter Code) kann im
      // GET noch sichtbar sein, obwohl sie gerade gelöscht wird
      if (!codeChanged && await hasNukiAuth(id, label)) continue
      await setNukiPermanentCode([id], label, code)
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err)
      // 409 „exists already" = der Code liegt bereits auf dem Schloss —
      // Nukis Auth-GET zeigt frisch angelegte Codes erst verzögert an,
      // der erneute PUT kollidiert dann mit sich selbst. Ziel erreicht.
      if (/exists already/i.test(m)) continue
      problems.push(`Schloss ${id}: ${m.slice(0, 160)}`)
    }
  }
  for (const id of newIds.tedee) {
    try {
      if (!codeChanged && await hasTedeePin(id, label)) continue
      await setTedeePin(id, label, code) // ohne Zeitfenster = Dauercode
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err)
      if (/exists already/i.test(m)) continue // tedee 406 = PIN liegt schon drauf
      problems.push(`tedee ${id}: ${m.slice(0, 160)}`)
    }
  }

  // Wunschzustand immer speichern — ein erneutes Speichern heilt Teilfehler
  // (idempotent); die Fehlermeldung benennt die betroffenen Schlösser
  if (listingIds.length) codes[personId] = { code, listingIds, label }
  else delete codes[personId]
  await saveStaffCodes(codes)
  if (problems.length) throw new Error(`Code auf ${problems.length} Schloss/Schlössern nicht gesetzt — nochmal „Zugriff aktualisieren" versuchen. ${problems.join(' · ')}`)
  return listingIds.length ? codes[personId] : null
}

/** Diagnose (§142-Nachtrag): je Nuki-Schloss die TRIMOSA-Keypad-Auths
 *  (Team-Codes + Gäste-Codes) + Gesamtzahl (200er-Auth-Limit sichtbar). */
export async function auditNukiAuths(): Promise<{
  locks: { id: string; name: string; totalAuths: number; keypadAuths: number; trimosaTeam: string[]; trimosaGuest: number; guestUnbounded: string[]; pending: string[] }[]
}> {
  const all = await listNukiLocks()
  const locks = []
  for (const l of all) {
    const res = await nukiFetch(`/smartlock/${l.id}/auth`)
    if (!res.ok) {
      locks.push({ id: l.id, name: l.name, totalAuths: -1, keypadAuths: -1, trimosaTeam: [`GET HTTP ${res.status}`], trimosaGuest: 0, guestUnbounded: [], pending: [] })
      continue
    }
    const auths = await res.json() as { type?: number; name?: string; enabled?: boolean; creationState?: number; allowedUntilDate?: string }[]
    const keypad = (auths ?? []).filter((a) => a.type === 13)
    const guest = keypad.filter((a) => a.name?.startsWith('TRIMOSA ') && !a.name?.startsWith('TRIMOSA-Team'))
    locks.push({
      id: l.id,
      name: l.name,
      totalAuths: (auths ?? []).length,
      keypadAuths: keypad.length,
      trimosaTeam: keypad.filter((a) => a.name?.startsWith('TRIMOSA-Team')).map((a) => `${a.name}${a.enabled === false ? ' (disabled)' : ''}${a.creationState ? ` (state ${a.creationState})` : ''}`),
      trimosaGuest: guest.length,
      // Gäste-Codes OHNE Zeitfenster (Alt-Anlagen ohne remoteAllowed, §142) —
      // gelten unbegrenzt und würden nie gelöscht; verify zieht Fenster nach
      guestUnbounded: guest.filter((a) => !a.allowedUntilDate).map((a) => a.name ?? '?'),
      // creationState ≠ 0 = Anlage noch nicht aufs Schloss propagiert
      pending: keypad.filter((a) => a.creationState).map((a) => a.name ?? '?'),
    })
  }
  return { locks }
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
  const allLocks = (listing?.locks ?? []) as LockRef[]
  const nukiIds = allLocks.filter((l) => l.provider === 'nuki').map((l) => Number(l.id)).filter(Number.isFinite)
  const tedeeIds = allLocks.filter((l) => l.provider === 'tedee').map((l) => Number(l.id)).filter(Number.isFinite)
  if (!nukiIds.length && !tedeeIds.length) return skip('keine schlösser zugeordnet')
  if (nukiIds.length && !nukiConfigured()) return skip('kein NUKI_API_TOKEN')
  if (tedeeIds.length && !tedeeConfigured()) return skip('kein TEDEE_API_KEY')

  const code = generateDoorCode()
  // Gültigkeitsfenster aus den Admin-Einstellungen (lokale Stunden am
  // An-/Abreisetag; −2h ≈ UTC-Umrechnung für Europe/Berlin — im Winter
  // öffnet der Code eine Stunde früher, was bewusst tolerant ist)
  const s = await getLockSettings()
  const from = new Date(new Date(b.check_in + 'T00:00:00.000Z').getTime() + (s.validFromHour - 2) * 3600_000).toISOString()
  const until = new Date(new Date(b.check_out + 'T00:00:00.000Z').getTime() + (s.validUntilHour - 2) * 3600_000).toISOString()
  const alias = `TRIMOSA ${b.id.slice(0, 8)}`
  if (nukiIds.length) await setNukiCode(nukiIds, alias, code, from, until)
  // tedee: PINs mit endDate räumt tedee nach Ablauf selbst ab
  for (const id of tedeeIds) await setTedeePin(id, alias, code, from, until)
  await supabaseAdmin.from('bookings').update({ door_code: code }).eq('id', b.id)
  console.log('[locks] Code gesetzt:', { booking: b.id, nuki: nukiIds.length, tedee: tedeeIds.length })
  return code
}

/**
 * 🩺 Selbstheilung (§142-Nachtrag): Prüft für anstehende Buchungen MIT
 * gespeichertem door_code, ob der Code WIRKLICH auf den Schlössern liegt —
 * Nuki verwirft Anlagen bei offline-Bridge still (PUT 204, Auth erscheint
 * nie), die App merkt das sonst nicht. Fehlende Codes werden mit dem
 * ORIGINAL-Zeitfenster nachgelegt. Läuft im täglichen Cron + auf Abruf.
 */
export async function verifyGuestCodes(daysAhead = 7): Promise<{ checked: number; healed: number; ok: number; rotated: number; orphansRemoved: number; stillMissing: string[] }> {
  const today = new Date().toISOString().slice(0, 10)
  const horizon = new Date(Date.now() + daysAhead * 86400_000).toISOString().slice(0, 10)
  const { data: rows } = await supabaseAdmin
    .from('bookings')
    .select('id, door_code, check_in, check_out, listings(title, locks)')
    .eq('status', 'confirmed')
    .not('door_code', 'is', null)
    .lte('check_in', horizon)
    .gte('check_out', today)
    .limit(60)

  const s = await getLockSettings()
  // Auth-Listen je Schloss nur einmal laden (mehrere Buchungen teilen Schlösser)
  const authCache = new Map<number, { id: string; type?: number; name?: string; allowedUntilDate?: string }[]>()
  const authsOf = async (id: number) => {
    if (!authCache.has(id)) {
      const res = await nukiFetch(`/smartlock/${id}/auth`)
      authCache.set(id, res.ok ? (await res.json() as { id: string; type?: number; name?: string; allowedUntilDate?: string }[]) : [])
    }
    return authCache.get(id)!
  }
  const pinCache = new Map<number, { id: number; alias?: string }[]>()
  const pinsOf = async (id: number) => {
    if (!pinCache.has(id)) pinCache.set(id, await listTedeePins(id))
    return pinCache.get(id)!
  }

  let checked = 0, healed = 0, ok = 0, rotated = 0
  const stillMissing: string[] = []
  for (const r of rows ?? []) {
    const listing = (Array.isArray(r.listings) ? r.listings[0] : r.listings) as { title?: string; locks?: LockRef[] } | null
    const locks = (listing?.locks ?? []) as LockRef[]
    if (!locks.length) continue
    checked++
    const alias = `TRIMOSA ${r.id.slice(0, 8)}`
    const from = new Date(new Date(r.check_in + 'T00:00:00.000Z').getTime() + (s.validFromHour - 2) * 3600_000).toISOString()
    const until = new Date(new Date(r.check_out + 'T00:00:00.000Z').getTime() + (s.validUntilHour - 2) * 3600_000).toISOString()

    // Zustand je Schloss sammeln: fehlend / ok / vorhanden-OHNE-Zeitfenster
    const nukiLocks = locks.filter((l) => l.provider === 'nuki').map((l) => Number(l.id)).filter(Number.isFinite)
    const tedeeLocks = locks.filter((l) => l.provider === 'tedee').map((l) => Number(l.id)).filter(Number.isFinite)
    let unbounded = false
    const foundOn = new Map<number, { id: string; allowedUntilDate?: string }>()
    for (const lockId of nukiLocks) {
      const found = (await authsOf(lockId)).find((a) => a.type === 13 && labelMatches(a.name, alias))
      if (found) {
        foundOn.set(lockId, found)
        if (!found.allowedUntilDate) unbounded = true
      }
    }

    try {
      if (unbounded) {
        // 🔄 ROTATION statt Update: Nuki verarbeitet Auth-Updates unzuverlässig
        // (§142 — 2xx, aber Fenster kommt nie an). Neuer Code MIT Fenster
        // (neuer Wert = keine 409-Falle), alte Auths runter, door_code neu.
        // Gefahrlos: die Mappe-Codes sind noch nicht an Gäste kommuniziert
        // (Testbetrieb, Smoobu vergibt die produktiven Codes).
        const newCode = generateDoorCode()
        for (const [lockId, found] of foundOn) {
          await nukiFetch(`/smartlock/${lockId}/auth/${found.id}`, { method: 'DELETE' })
        }
        if (nukiLocks.length) await setNukiCode(nukiLocks, alias, newCode, from, until)
        for (const id of tedeeLocks) {
          await removeTedeePinsByAlias(id, alias)
          await setTedeePin(id, alias, newCode, from, until)
        }
        await supabaseAdmin.from('bookings').update({ door_code: newCode }).eq('id', r.id)
        rotated++
        console.log('[locks] verify: Code ROTIERT (Fenster fehlte)', { booking: r.id.slice(0, 8), listing: listing?.title })
        continue
      }

      // Kein Rotations-Fall: nur wirklich Fehlendes mit dem BESTEHENDEN Code nachlegen
      let missing = 0, fixed = 0
      for (const lockId of nukiLocks) {
        if (foundOn.has(lockId)) continue
        missing++
        try {
          await setNukiCode([lockId], alias, r.door_code as string, from, until)
          fixed++
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err)
          if (/exists already/i.test(m)) { fixed++; continue }
          console.error('[locks] verify:', listing?.title, lockId, m.slice(0, 120))
        }
      }
      for (const lockId of tedeeLocks) {
        if ((await pinsOf(lockId)).some((p) => p.alias === alias)) continue
        missing++
        try {
          await setTedeePin(lockId, alias, r.door_code as string, from, until)
          fixed++
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err)
          if (/exists already/i.test(m)) { fixed++; continue }
          console.error('[locks] verify: tedee', listing?.title, lockId, m.slice(0, 120))
        }
      }
      if (missing === 0) ok++
      else if (fixed >= missing) { healed++; console.log('[locks] verify: Code nachgelegt', { booking: r.id.slice(0, 8), listing: listing?.title, locks: fixed }) }
      else stillMissing.push(`${listing?.title ?? '?'} · Anreise ${r.check_in}`)
    } catch (err) {
      console.error('[locks] verify booking failed:', r.id.slice(0, 8), err instanceof Error ? err.message.slice(0, 160) : String(err))
      stillMissing.push(`${listing?.title ?? '?'} · Anreise ${r.check_in}`)
    }
  }
  // 🧹 Waisen-Sweep: unbegrenzte Gäste-Auths OHNE aktive Buchung löschen —
  // Alt-Anlagen ohne Zeitfenster (§142), deren Aufenthalt vorbei ist; der
  // reguläre Cleanup filtert auf allowedUntilDate und sieht sie nie
  let orphansRemoved = 0
  try {
    const [{ data: allListings }, { data: activeRows }] = await Promise.all([
      supabaseAdmin.from('listings').select('locks').not('locks', 'is', null),
      supabaseAdmin.from('bookings').select('id').not('door_code', 'is', null).gte('check_out', today).limit(500),
    ])
    const activeAliases = new Set((activeRows ?? []).map((b) => `TRIMOSA ${String(b.id).slice(0, 8)}`))
    const lockIds = new Set<number>()
    for (const l of allListings ?? []) {
      for (const lock of ((l.locks as LockRef[] | null) ?? [])) {
        if (lock.provider === 'nuki') lockIds.add(Number(lock.id))
      }
    }
    for (const lockId of lockIds) {
      for (const a of await authsOf(lockId)) {
        if (a.type !== 13 || a.allowedUntilDate) continue
        const n = a.name ?? ''
        // nur Gäste-Codes („TRIMOSA <hex8>", nie von Nuki gekürzt) — Team-Codes
        // („TRIMOSA-Team …") sind absichtlich unbegrenzt
        if (!/^TRIMOSA [0-9a-f]{8}$/.test(n)) continue
        if (activeAliases.has(n)) continue
        await nukiFetch(`/smartlock/${lockId}/auth/${a.id}`, { method: 'DELETE' })
        orphansRemoved++
      }
    }
    if (orphansRemoved) console.log('[locks] verify: verwaiste unbegrenzte Gäste-Codes gelöscht:', orphansRemoved)
  } catch (err) { console.error('[locks] orphan sweep:', err) }

  if (rotated) console.log('[locks] verify: rotierte Codes:', rotated)
  return { checked, healed, ok, rotated, orphansRemoved, stillMissing }
}

/**
 * Cron-Kern: Codes für alle Anreisen der nächsten 7 Tage anlegen +
 * abgelaufene Codes aufräumen. Fehler werden gesammelt und als EIN
 * Team-Push gemeldet (der Gast steht sonst ohne Code vor der Tür).
 */
export async function ensureUpcomingDoorCodes(): Promise<{ created: number; skipped: number; cleaned: number; errors: string[] }> {
  const today = new Date().toISOString().slice(0, 10)
  const horizon = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10)
  // LAUFENDE Aufenthalte einschließen (check_out >= heute statt check_in >=
  // heute) — Buchungen, die während einer Störung anreisten, bekamen sonst
  // NIE einen Code (§142-Fall Jose: Backfill-Buchung, Anreise vor dem Cron)
  const { data: rows } = await supabaseAdmin
    .from('bookings')
    .select('id, guest_name, check_in, listings(title, locks)')
    .eq('status', 'confirmed')
    .is('door_code', null)
    .gte('check_out', today)
    .lte('check_in', horizon)
    .limit(100)

  let created = 0, skipped = 0
  const errors: string[] = []
  const usedLocks = new Set<number>()
  for (const r of rows ?? []) {
    const listing = (Array.isArray(r.listings) ? r.listings[0] : r.listings) as { title?: string; locks?: LockRef[] } | null
    const locks = (listing?.locks ?? []) as LockRef[]
    const nukiIds = locks.filter((l) => l.provider === 'nuki').map((l) => Number(l.id))
    if (!locks.length) { skipped++; continue }
    try {
      const code = await ensureDoorCode(r.id)
      // Cleanup betrifft nur Nuki — tedee räumt PINs mit endDate selbst ab
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

  // 🩺 Selbstheilung: still verworfene Anlagen (offline-Bridge) nachlegen
  try {
    const v = await verifyGuestCodes(7)
    if (v.healed || v.stillMissing.length) console.warn('[locks] verify:', v)
    if (v.stillMissing.length) errors.push(`Code fehlt weiter auf Schloss: ${v.stillMissing.join(' · ')}`)
  } catch (err) { console.error('[locks] verify failed:', err) }

  if (errors.length) {
    try {
      const { sendPushToTeam } = await import('@/lib/push')
      await sendPushToTeam('⚠️ Türcode konnte nicht angelegt werden', errors[0] + (errors.length > 1 ? ` (+${errors.length - 1} weitere)` : ''), '/team?tab=aufgaben')
    } catch { /* best effort */ }
    console.error('[locks] Fehler:', errors)
  }
  return { created, skipped, cleaned, errors }
}
