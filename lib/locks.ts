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

export interface LockRef { provider: 'nuki' | 'tedee' | 'ttlock'; id: string; label: string }

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

/** 🔋 §265: Geräte-Gesundheit je Schloss — Batterie in %, Kritisch-Flags,
 *  Online-Status. Alle Felder DEFENSIV gelesen (die genauen Formen liefern
 *  die Provider-Antworten; fehlende Felder → null = „unbekannt"). */
export interface LockHealth {
  battery: number | null       // 0–100
  critical: boolean            // Hersteller-Flag „Batterie kritisch"
  keypadCritical: boolean      // Nuki: eigenes Keypad-Batterie-Flag
  online: boolean | null       // Cloud-Erreichbarkeit (null = nicht ermittelbar)
}
export type LockHealthMap = Record<string, LockHealth>  // Key `${provider}:${id}`

/** Alle Schlösser des Nuki-Kontos (für die Zuordnung in der Admin-Karte).
 *  §265: liefert zusätzlich Batterie/Online — additive optionale Felder,
 *  bestehende Aufrufer nutzen weiter nur id+name. */
export async function listNukiLocks(): Promise<{ id: string; name: string; battery?: number | null; critical?: boolean; keypadCritical?: boolean; online?: boolean | null }[]> {
  const res = await nukiFetch('/smartlock')
  if (!res.ok) throw new Error(`Nuki /smartlock HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const list = await res.json() as { smartlockId: number; name?: string; serverState?: number; state?: { batteryCharge?: number; batteryCritical?: boolean; keypadBatteryCritical?: boolean } }[]
  return (list ?? []).map((l) => ({
    id: String(l.smartlockId),
    name: l.name ?? `Schloss ${l.smartlockId}`,
    battery: typeof l.state?.batteryCharge === 'number' ? l.state.batteryCharge : null,
    critical: l.state?.batteryCritical === true,
    keypadCritical: l.state?.keypadBatteryCritical === true,
    // Nuki serverState: 0 = OK/online; alles andere = Verbindungsproblem
    online: typeof l.serverState === 'number' ? l.serverState === 0 : null,
  }))
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

/** Alle tedee-Schlösser des Kontos (für die Zuordnung in der Admin-Karte).
 *  §265: + Batterie/Online (defensiv — tedee trägt die Felder je nach
 *  API-Stand top-level oder unter lockProperties). */
export async function listTedeeLocks(): Promise<{ id: string; name: string; battery?: number | null; critical?: boolean; online?: boolean | null }[]> {
  const res = await tedeeFetch('/api/v37/my/lock')
  if (!res.ok) throw new Error(`tedee /my/lock HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const list = tedeeResult<{ id: number; name?: string; isConnected?: boolean; batteryLevel?: number; lockProperties?: { batteryLevel?: number; isCharging?: boolean; state?: number } }[]>(await res.json())
  return (list ?? []).map((l) => {
    const battery = typeof l.batteryLevel === 'number' ? l.batteryLevel
      : typeof l.lockProperties?.batteryLevel === 'number' ? l.lockProperties.batteryLevel : null
    return {
      id: String(l.id), name: l.name ?? `tedee ${l.id}`,
      battery,
      critical: battery !== null && battery <= 20,
      online: typeof l.isConnected === 'boolean' ? l.isConnected : null,
    }
  })
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

/* ── TTLock-Adapter (§250, Pilot C20-TB → Minden UG) ──────────────────
 * Cloud-API api.sciener.com v3 (euopen.ttlock.com-Doku). Auth: OAuth2
 * password-grant mit dem NORMALEN TTLock-App-Konto (Passwort als
 * MD5-lowercase — Env hält den Klartext, gehasht wird hier). Alle Calls
 * sind POST x-www-form-urlencoded mit clientId + accessToken + date (ms).
 * Fehler kommen als { errcode, errmsg } — errcode 0/fehlend = Erfolg.
 * Code-Anlage remote via Gateway G2: keyboardPwd/add mit addType 2
 * („only V4 locks" — Firmware-Frage am lebenden Schloss geklärt beim
 * Schreibtisch-Test). PIN-Regeln: 4–9 Ziffern; unsere 6-stelligen Codes
 * (generateDoorCode) passen. */

export function ttlockConfigured(): boolean {
  return !!(process.env.TTLOCK_CLIENT_ID && process.env.TTLOCK_CLIENT_SECRET
    && process.env.TTLOCK_USERNAME && process.env.TTLOCK_PASSWORD)
}

const TTLOCK_BASE = 'https://api.sciener.com'

type TTGlobal = typeof globalThis & { __ttlockTok?: { token: string; exp: number } }

async function ttlockToken(): Promise<string> {
  const g = globalThis as TTGlobal
  if (g.__ttlockTok && g.__ttlockTok.exp > Date.now()) return g.__ttlockTok.token
  const { createHash } = await import('crypto')
  const md5 = createHash('md5').update(process.env.TTLOCK_PASSWORD ?? '').digest('hex').toLowerCase()
  const res = await fetch(`${TTLOCK_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.TTLOCK_CLIENT_ID ?? '',
      client_secret: process.env.TTLOCK_CLIENT_SECRET ?? '',
      username: process.env.TTLOCK_USERNAME ?? '',
      password: md5,
    }),
    cache: 'no-store',
  })
  const j = await res.json().catch(() => ({})) as { access_token?: string; errcode?: number; errmsg?: string }
  if (!res.ok || !j.access_token) {
    throw new Error(`TTLock oauth2/token HTTP ${res.status}: ${j.errmsg ?? JSON.stringify(j).slice(0, 200)}`)
  }
  // Token gilt ~90 Tage — 24h-Cache reicht und schont den Token-Endpoint
  g.__ttlockTok = { token: j.access_token, exp: Date.now() + 24 * 3600_000 }
  return j.access_token
}

/** POST-Call mit Pflicht-Parametern; wirft bei errcode ≠ 0 mit errmsg. */
async function ttlockCall<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const token = await ttlockToken()
  const body = new URLSearchParams()
  body.set('clientId', process.env.TTLOCK_CLIENT_ID ?? '')
  body.set('accessToken', token)
  body.set('date', String(Date.now()))
  for (const [k, v] of Object.entries(params)) body.set(k, String(v))
  const res = await fetch(`${TTLOCK_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  })
  const j = await res.json().catch(() => ({})) as T & { errcode?: number; errmsg?: string }
  if (!res.ok) throw new Error(`TTLock ${path} HTTP ${res.status}: ${JSON.stringify(j).slice(0, 200)}`)
  if (typeof j.errcode === 'number' && j.errcode !== 0) {
    throw new Error(`TTLock ${path} errcode ${j.errcode}: ${j.errmsg ?? '—'}`)
  }
  return j
}

/** Alle TTLock-Schlösser des Kontos (für die Zuordnung in der Admin-Karte). */
export async function listTTLocks(): Promise<{ id: string; name: string; battery?: number | null; critical?: boolean; online?: boolean | null }[]> {
  const j = await ttlockCall<{ list?: { lockId: number; lockAlias?: string; lockName?: string; electricQuantity?: number }[] }>(
    '/v3/lock/list', { pageNo: 1, pageSize: 100 })
  return (j.list ?? []).map((l) => {
    // §265: electricQuantity = Batterie-% laut TTLock-Doku; Online-Status
    // liefert die Liste nicht (Gateway-Zustand wäre ein Extra-Call) → null
    const battery = typeof l.electricQuantity === 'number' ? l.electricQuantity : null
    return {
      id: String(l.lockId), name: l.lockAlias ?? l.lockName ?? `TTLock ${l.lockId}`,
      battery, critical: battery !== null && battery <= 20, online: null,
    }
  })
}

async function listTTLockPins(lockId: number): Promise<{ id: number; name?: string; pwd?: string; endMs?: number }[]> {
  const j = await ttlockCall<{ list?: { keyboardPwdId: number; keyboardPwdName?: string; keyboardPwd?: string; endDate?: number }[] }>(
    '/v3/lock/listKeyboardPwd', { lockId, pageNo: 1, pageSize: 100 })
  return (j.list ?? []).map((p) => ({ id: p.keyboardPwdId, name: p.keyboardPwdName, pwd: p.keyboardPwd, endMs: p.endDate }))
}

/** Wunsch-PIN remote via Gateway anlegen (addType 2). Dauercode = end weit in der Zukunft. */
async function setTTLockCode(lockId: number, name: string, pin: string, startMs: number, endMs: number): Promise<void> {
  await ttlockCall('/v3/keyboardPwd/add', {
    lockId, keyboardPwd: pin, keyboardPwdName: name,
    startDate: startMs, endDate: endMs, addType: 2,
  })
}

async function removeTTLockCodesByName(lockId: number, name: string): Promise<void> {
  for (const p of await listTTLockPins(lockId)) {
    if (p.name === name) {
      await ttlockCall('/v3/keyboardPwd/delete', { lockId, keyboardPwdId: p.id, deleteType: 2 })
    }
  }
}

/** Diagnose (§250, Schreibtisch-Test): PIN-Liste des Schlosses; optional
 *  Test-PIN „TRIMOSA-Test" anlegen (24h gültig, addType 2 = via Gateway —
 *  beweist zugleich die V4-Firmware-Frage) bzw. wieder entfernen. */
export async function ttlockTestProbe(lockId: number, testPin?: string, removeTestPin?: boolean): Promise<{
  pins: { id: number; name?: string; endMs?: number }[]
  testPinAngelegt?: boolean
  testPinEntfernt?: boolean
}> {
  const out: { pins: { id: number; name?: string; endMs?: number }[]; testPinAngelegt?: boolean; testPinEntfernt?: boolean } = { pins: [] }
  if (removeTestPin) {
    await removeTTLockCodesByName(lockId, 'TRIMOSA-Test')
    out.testPinEntfernt = true
  }
  if (testPin) {
    await setTTLockCode(lockId, 'TRIMOSA-Test', testPin, Date.now() - 3600_000, Date.now() + 24 * 3600_000)
    out.testPinAngelegt = true
  }
  out.pins = (await listTTLockPins(lockId)).map((p) => ({ id: p.id, name: p.name, endMs: p.endMs }))
  return out
}

/* ── 🔓 Fern-Öffnen (§253): entriegelt den Zylinder wie ein Keypad-Code ── */

/** Nuki „unlock" (action 1 = aufschließen, NICHT unlatch — passt zu den
 *  Zylinder-Schlössern; ein Türöffner-Motor ist nicht vorhanden). */
async function openNukiLock(smartlockId: number): Promise<void> {
  const res = await nukiFetch(`/smartlock/${smartlockId}/action`, {
    method: 'POST',
    body: JSON.stringify({ action: 1, option: 0 }),
  })
  if (!res.ok && res.status !== 202 && res.status !== 204) {
    throw new Error(`Nuki action HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
}

/** tedee „unlock" (River Retreat). Endpoint aus der v37-Doku; die Operation
 *  läuft asynchron, der POST reicht fürs Auslösen. */
async function openTedeeLock(lockId: number): Promise<void> {
  const res = await tedeeFetch(`/api/v37/my/lock/${lockId}/operation/unlock`, { method: 'POST' })
  if (!res.ok && res.status !== 202 && res.status !== 204) {
    throw new Error(`tedee unlock HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
}

/** TTLock „unlock" via Gateway (Minden UG). Braucht Bridge-Verbindung. */
async function openTTLock(lockId: number): Promise<void> {
  await ttlockCall('/v3/lock/unlock', { lockId, date: Date.now() })
}

/** Ein einzelnes Schloss fernöffnen (Provider-Dispatch). */
export async function openLock(ref: LockRef): Promise<void> {
  const id = Number(ref.id)
  if (ref.provider === 'nuki') return openNukiLock(id)
  if (ref.provider === 'tedee') return openTedeeLock(id)
  if (ref.provider === 'ttlock') return openTTLock(id)
  throw new Error(`Unbekannter Provider: ${ref.provider}`)
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
async function lockIdsFor(listingIds: string[]): Promise<{ nuki: number[]; tedee: number[]; ttlock: number[] }> {
  if (!listingIds.length) return { nuki: [], tedee: [], ttlock: [] }
  const { data } = await supabaseAdmin.from('listings').select('id, locks').in('id', listingIds)
  const nuki = new Set<number>()
  const tedee = new Set<number>()
  const ttlock = new Set<number>()
  for (const l of data ?? []) {
    for (const lock of ((l.locks as LockRef[] | null) ?? [])) {
      if (lock.provider === 'nuki') nuki.add(Number(lock.id))
      if (lock.provider === 'tedee') tedee.add(Number(lock.id))
      if (lock.provider === 'ttlock') ttlock.add(Number(lock.id))
    }
  }
  return { nuki: [...nuki], tedee: [...tedee], ttlock: [...ttlock] }
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
  const ttlockToClean = codeChanged ? [...new Set([...oldIds.ttlock, ...newIds.ttlock])] : oldIds.ttlock.filter((t) => !newIds.ttlock.includes(t))
  await removeNukiAuthsByName(nukiToClean, label)
  for (const id of tedeeToClean) await removeTedeePinsByAlias(id, label)
  for (const id of ttlockToClean) await removeTTLockCodesByName(id, label)

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
  for (const id of newIds.ttlock) {
    try {
      // TTLock verlangt IMMER ein Zeitfenster — Dauercode = +10 Jahre
      if (!codeChanged && (await listTTLockPins(id)).some((p) => p.name === label)) continue
      await setTTLockCode(id, label, code, Date.now() - 3600_000, Date.now() + 10 * 365 * 86400_000)
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err)
      problems.push(`ttlock ${id}: ${m.slice(0, 160)}`)
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
  locks: { id: string; name: string; totalAuths: number; keypadAuths: number; trimosaTeam: string[]; trimosaGuest: number; guestUnbounded: string[]; pending: string[]; sample?: Record<string, unknown> }[]
}> {
  const all = await listNukiLocks()
  const locks = []
  for (const l of all) {
    const res = await nukiFetch(`/smartlock/${l.id}/auth`)
    if (!res.ok) {
      locks.push({ id: l.id, name: l.name, totalAuths: -1, keypadAuths: -1, trimosaTeam: [`GET HTTP ${res.status}`], trimosaGuest: 0, guestUnbounded: [], pending: [] })
      continue
    }
    const auths = await res.json() as { type?: number; name?: string; enabled?: boolean; creationState?: number; allowedFromDate?: string; allowedUntilDate?: string; allowedWeekDays?: number; allowedFromTime?: number; allowedUntilTime?: number }[]
    const keypad = (auths ?? []).filter((a) => a.type === 13)
    const guest = keypad.filter((a) => a.name?.startsWith('TRIMOSA ') && !a.name?.startsWith('TRIMOSA-Team'))
    // Vollständige Zeitfelder EINES Gäste-Codes zur Anzeige-Diagnose (§142)
    const s = guest[0]
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
      sample: s ? { name: s.name, from: s.allowedFromDate, until: s.allowedUntilDate, weekDays: s.allowedWeekDays, fromTime: s.allowedFromTime, untilTime: s.allowedUntilTime } : undefined,
    })
  }
  return { locks }
}

/**
 * 🧹 §231 Reinigungs-Abschluss: Wurde HEUTE (Berlin) an einem der Schlösser
 * der Wohnung ein TEAM-Code benutzt? Dient als „Zeuge" für die vor-Ort-
 * Fertigmeldung — Gäste haben keinen Team-Code, können die Meldung also
 * nicht glaubhaft auslösen. Rückgabe: true/false = geprüft, null = nicht
 * prüfbar (kein Nuki-Schloss, Token fehlt oder API-Fehler).
 * Nuki kürzt Auth-Namen auf 20 Zeichen (§142) — Match auf den stabilen
 * Präfix „TRIMOSA-Team".
 */
export async function staffCodeUsedToday(locks: LockRef[]): Promise<boolean | null> {
  const nukiIds = (locks ?? []).filter((l) => l.provider === 'nuki').map((l) => Number(l.id)).filter(Number.isFinite)
  const tedeeIds = (locks ?? []).filter((l) => l.provider === 'tedee').map((l) => Number(l.id)).filter(Number.isFinite)
  // „Heute" großzügig als Berlin-Datum; die Logs liefern UTC-Zeitstempel —
  // Reinigungen laufen tagsüber, der Datums-Slice reicht als Fenster.
  const todayBerlin = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date())
  let checkedAny = false

  if (nukiIds.length && nukiConfigured()) {
    try {
      for (const id of nukiIds) {
        const res = await nukiFetch(`/smartlock/${id}/log?limit=50`)
        if (!res.ok) continue
        checkedAny = true
        const entries = await res.json() as { name?: string; date?: string; authId?: string; trigger?: number }[]
        const heutige = (entries ?? []).filter((e) => String(e.date ?? '').slice(0, 10) === todayBerlin)
        if (!heutige.length) continue
        // §248c-ROOT-CAUSE: Bei KEYPAD-Öffnungen schreibt Nuki als name nur
        // generisch „Zutrittscode" — der Auth-Name steckt NIE im Log-Eintrag,
        // sondern hinter der authId. Darum: Auth-Liste laden und die heutigen
        // Einträge über authId → Auth-Name auflösen. Der alte name-Match
        // bleibt als Zusatz (deckt App-Öffnungen durch Team-Nutzer ab).
        if (heutige.some((e) => String(e.name ?? '').startsWith('TRIMOSA-Team'))) return true
        const teamAuthIds = new Set<string>()
        const authRes = await nukiFetch(`/smartlock/${id}/auth`)
        if (authRes.ok) {
          const auths = await authRes.json() as { id?: string; name?: string }[]
          for (const a of auths ?? []) {
            if (String(a.name ?? '').startsWith('TRIMOSA-Team') && a.id) teamAuthIds.add(String(a.id))
          }
        }
        if (heutige.some((e) => e.authId && teamAuthIds.has(String(e.authId)))) return true
      }
    } catch (e) {
      console.error('[cleaning-done] Nuki-Log-Prüfung fehlgeschlagen:', e)
    }
  }

  // tedee (River, §231-Nachtrag): Activity-Log defensiv prüfen
  if (tedeeIds.length && tedeeConfigured()) {
    for (const id of tedeeIds) {
      const r = await tedeeStaffEventToday(id, todayBerlin)
      if (r === true) return true
      if (r === false) checkedAny = true
    }
  }

  return checkedAny ? false : null
}

/**
 * ⏱ §255: Beginn der Reinigung = erste TÜRÖFFNUNG am heutigen Berlin-Tag
 * ab `afterHm`, die NICHT von einem GAST-Code stammt (Gast-Auths heißen
 * „TRIMOSA <hex8>" — Team-Codes, Alt-Dauercodes („Zutrittscode") und
 * App-Öffnungen zählen). Liefert den frühesten Zeitstempel (ISO) oder null.
 *
 * Nuki-Log-Semantik (§248c-kalibriert): Einträge tragen name/date/authId/
 * action/state — Keypad-Öffnungen heißen im `name` nur wie ihre Auth
 * („Zutrittscode"), der echte Nutzer steckt hinter der authId. action
 * 1 = unlock / 3 = unlatch; state 0 = Erfolg.
 */
const GUEST_AUTH_RE = /^TRIMOSA [0-9a-f]{6,10}$/i

/** Beginn der Reinigung. `onDay` = Berlin-Datum der Reinigung (Default heute).
 *  Nur für Tage im Log-Fenster (Nuki ~letzte 50 Einträge). */
export async function firstCleaningOpenAt(locks: LockRef[], afterHm: string, onDay?: string): Promise<string | null> {
  const targetDay = onDay ?? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date())
  const hmBerlin = (iso: string): string => new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))
  const dayBerlin = (iso: string): string => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date(iso))

  let earliest: string | null = null
  const consider = (iso: string | undefined) => {
    if (!iso || Number.isNaN(Date.parse(iso))) return
    if (dayBerlin(iso) !== targetDay) return
    if (hmBerlin(iso) < afterHm) return
    if (!earliest || Date.parse(iso) < Date.parse(earliest)) earliest = iso
  }

  const nukiIds = (locks ?? []).filter((l) => l.provider === 'nuki').map((l) => Number(l.id)).filter(Number.isFinite)
  if (nukiIds.length && nukiConfigured()) {
    for (const id of nukiIds) {
      try {
        const res = await nukiFetch(`/smartlock/${id}/log?limit=50`)
        if (!res.ok) continue
        const entries = await res.json() as { name?: string; date?: string; authId?: string; action?: number; state?: number }[]
        // authId → Auth-Name auflösen (Gast-Code-Erkennung, §248c)
        const authName = new Map<string, string>()
        try {
          const ar = await nukiFetch(`/smartlock/${id}/auth`)
          if (ar.ok) {
            for (const a of (await ar.json()) as { id?: string; name?: string }[]) {
              if (a.id) authName.set(String(a.id), String(a.name ?? ''))
            }
          }
        } catch { /* ohne Auflösung entscheidet der Log-name */ }
        for (const e of entries ?? []) {
          if (e.action !== 1 && e.action !== 3) continue          // nur Öffnungen
          if (e.state !== undefined && e.state !== 0) continue     // nur erfolgreiche
          const who = (e.authId && authName.get(String(e.authId))) || String(e.name ?? '')
          if (GUEST_AUTH_RE.test(who.trim())) continue             // Gast-Codes zählen nicht
          consider(e.date)
        }
      } catch (e) {
        console.error('[cleaning-duration] Nuki-Log fehlgeschlagen:', e)
      }
    }
  }

  // tedee (River): Events des Tages, Gast-PINs (Alias „TRIMOSA <hex>") raus.
  // Öffnungs-Eventtyp ist nicht sicher dokumentiert → jedes Ereignis mit
  // Zeitstempel zählt (best effort; Kalibrierung am lebenden Schloss).
  const tedeeIds = (locks ?? []).filter((l) => l.provider === 'tedee').map((l) => Number(l.id)).filter(Number.isFinite)
  if (tedeeIds.length && tedeeConfigured()) {
    for (const id of tedeeIds) {
      for (const path of TEDEE_ACTIVITY_PATHS(id)) {
        try {
          const res = await tedeeFetch(path)
          if (!res.ok) continue
          const events = tedeeEventsOf(tedeeResult<unknown>(await res.json()))
          for (const ev of events) {
            const o = ev as { date?: string; pinAlias?: string }
            if (o.pinAlias && GUEST_AUTH_RE.test(String(o.pinAlias).trim())) continue
            consider(o.date)
          }
          break
        } catch { /* nächster Pfad-Kandidat */ }
      }
    }
  }

  return earliest
}

/**
 * tedee-Activity-Prüfung (§231-Nachtrag): Die exakte Endpoint-/Feld-Form ist
 * nicht sicher dokumentiert — deshalb werden beide Pfad-Kandidaten probiert
 * und die Ereignisse als GANZES auf heutiges Datum + Team-Alias geprüft
 * (feldnamen-unabhängig). Ein LEERES Ereignis-Array zählt bewusst als
 * „nicht prüfbar" — es kann auch heißen, dass die Antwortform nicht erkannt
 * wurde (ein echtes Schloss-Log ist nie leer). Kalibrierung am lebenden
 * River-Schloss via Admin-Action 'tedee-activity-test'.
 */
const TEDEE_ACTIVITY_PATHS = (lockId: number) => [
  `/api/v37/my/lock/${lockId}/activity?elements=50`,
  `/api/v37/my/deviceactivity?deviceId=${lockId}&elements=50`,
]

function tedeeEventsOf(r: unknown): unknown[] {
  if (Array.isArray(r)) return r
  const o = r as { activities?: unknown[]; items?: unknown[]; events?: unknown[] } | null
  return o?.activities ?? o?.items ?? o?.events ?? []
}

async function tedeeStaffEventToday(lockId: number, todayBerlin: string): Promise<boolean | null> {
  for (const path of TEDEE_ACTIVITY_PATHS(lockId)) {
    try {
      const res = await tedeeFetch(path)
      if (!res.ok) continue
      const events = tedeeEventsOf(tedeeResult<unknown>(await res.json()))
      if (!events.length) continue
      return events.some((e) => {
        const s = JSON.stringify(e)
        return s.includes(todayBerlin) && s.includes('TRIMOSA-Team')
      })
    } catch (e) {
      console.error('[cleaning-done] tedee-Activity-Prüfung fehlgeschlagen:', e)
    }
  }
  return null
}

/** Diagnose (§231): rohe tedee-Activity-Antworten beider Pfad-Kandidaten. */
export async function tedeeActivityProbe(lockId: number): Promise<{ path: string; status: number; sample: string }[]> {
  const out: { path: string; status: number; sample: string }[] = []
  for (const path of TEDEE_ACTIVITY_PATHS(lockId)) {
    try {
      const res = await tedeeFetch(path)
      const text = await res.text()
      let sample = text.slice(0, 2000)
      try { sample = JSON.stringify(JSON.parse(text)).slice(0, 2000) } catch { /* Rohtext behalten */ }
      out.push({ path, status: res.status, sample })
    } catch (e) {
      out.push({ path, status: -1, sample: String(e).slice(0, 300) })
    }
  }
  return out
}

/** Diagnose (§248c): rohes Nuki-Schloss-Protokoll — kalibriert den
 *  Reinigungs-Zeugen (staffCodeUsedToday). Liefert die jüngsten Einträge
 *  kompakt (name/date/trigger/action/state) + eine Roh-Probe des ersten
 *  Eintrags, damit unbekannte Feldnamen sichtbar werden. */
export async function nukiLogProbe(smartlockId: number): Promise<{
  status: number
  count: number
  todayBerlin: string
  zeugeWuerdeMatchen: boolean
  entries: { name: string; authName?: string; date: string; trigger?: number; action?: number; state?: number; source?: number }[]
  rawFirst: string
}> {
  const todayBerlin = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date())
  const res = await nukiFetch(`/smartlock/${smartlockId}/log?limit=50`)
  const text = await res.text()
  let entries: Record<string, unknown>[] = []
  try { const j = JSON.parse(text); if (Array.isArray(j)) entries = j } catch { /* Rohtext unten */ }

  // §248c: authId → Auth-Name auflösen (Keypad-Öffnungen heißen im Log nur
  // „Zutrittscode" — der wahre Nutzer steht hinter der authId)
  const authName = new Map<string, string>()
  try {
    const ar = await nukiFetch(`/smartlock/${smartlockId}/auth`)
    if (ar.ok) {
      for (const a of (await ar.json()) as { id?: string; name?: string }[]) {
        if (a.id) authName.set(String(a.id), String(a.name ?? ''))
      }
    }
  } catch { /* Auflösung optional */ }
  const resolved = entries.slice(0, 25).map((e) => ({
    name: String(e.name ?? ''),
    authName: e.authId ? authName.get(String(e.authId)) ?? '(Auth unbekannt/gelöscht)' : undefined,
    date: String(e.date ?? ''),
    trigger: typeof e.trigger === 'number' ? e.trigger : undefined,
    action: typeof e.action === 'number' ? e.action : undefined,
    state: typeof e.state === 'number' ? e.state : undefined,
    source: typeof e.source === 'number' ? e.source : undefined,
  }))
  return {
    status: res.status,
    count: entries.length,
    todayBerlin,
    // NEUE Zeugen-Logik (name-Match ODER authId→Team-Auth) — wie staffCodeUsedToday
    zeugeWuerdeMatchen: entries.some((e) => String(e.date ?? '').slice(0, 10) === todayBerlin && (
      String(e.name ?? '').startsWith('TRIMOSA-Team') ||
      (e.authId ? (authName.get(String(e.authId)) ?? '').startsWith('TRIMOSA-Team') : false)
    )),
    entries: resolved,
    rawFirst: JSON.stringify(entries[0] ?? text.slice(0, 500)).slice(0, 800),
  }
}

/* ── 🔋 §265: Geräte-Gesundheit + Batterie-Wächter ─────────────────────
 * Pascal (Chefsache 11.8.): Akkustand anzeigen, Push-Warnung an die
 * Verantwortliche ab 20 % (alle 3 Tage bis wieder voll), Schlösser bei
 * niedrigem Akku markieren, Online-Status. */

const BATTERIE_WARN_PROZENT = 20
const BATTERIE_ERHOLT_PROZENT = 35   // Hysterese: erst darüber gilt „wieder voll"
const WARN_WIEDERHOLUNG_MS = 3 * 86_400_000

/** Gesundheit aller Schlösser aller Provider — je Provider fail-soft. */
export async function listLockHealth(): Promise<LockHealthMap> {
  const map: LockHealthMap = {}
  const sammel = async (provider: 'nuki' | 'tedee' | 'ttlock', fn: () => Promise<{ id: string; battery?: number | null; critical?: boolean; keypadCritical?: boolean; online?: boolean | null }[]>) => {
    try {
      for (const l of await fn()) {
        map[`${provider}:${l.id}`] = {
          battery: l.battery ?? null,
          critical: l.critical === true,
          keypadCritical: l.keypadCritical === true,
          online: l.online ?? null,
        }
      }
    } catch { /* Provider nicht konfiguriert/erreichbar → Felder bleiben leer */ }
  }
  await Promise.all([
    nukiConfigured() ? sammel('nuki', listNukiLocks) : Promise.resolve(),
    tedeeConfigured() ? sammel('tedee', listTedeeLocks) : Promise.resolve(),
    ttlockConfigured() ? sammel('ttlock', listTTLocks) : Promise.resolve(),
  ])
  return map
}

/**
 * §265-Kalibrierung: ROHE Provider-Antworten für die Gesundheits-Felder —
 * zeigt je Nuki-Schloss das ungefilterte state-Objekt (beweist, ob die
 * batteryCharge-Werte echt sind) und für tedee BEIDE Endpoint-Kandidaten
 * (/my/lock Voll-DTO vs. /my/lock/sync Leichtform mit lockProperties),
 * damit das Batterie-Feld am echten Gerät kalibriert werden kann.
 */
export async function lockHealthRawProbe(): Promise<{
  nuki: unknown
  tedeeLock: unknown
  tedeeSync: unknown
  ttlock: unknown
}> {
  const out: { nuki: unknown; tedeeLock: unknown; tedeeSync: unknown; ttlock: unknown } = {
    nuki: null, tedeeLock: null, tedeeSync: null, ttlock: null,
  }
  if (nukiConfigured()) {
    try {
      const res = await nukiFetch('/smartlock')
      const list = (await res.json()) as { name?: string; smartlockId?: number; serverState?: unknown; state?: unknown }[]
      out.nuki = (list ?? []).map((l) => ({ name: l.name, smartlockId: l.smartlockId, serverState: l.serverState, state: l.state }))
    } catch (e) { out.nuki = `Fehler: ${String(e).slice(0, 200)}` }
  }
  if (tedeeConfigured()) {
    try {
      const res = await tedeeFetch('/api/v37/my/lock')
      out.tedeeLock = await res.json()
    } catch (e) { out.tedeeLock = `Fehler: ${String(e).slice(0, 200)}` }
    try {
      const res = await tedeeFetch('/api/v37/my/lock/sync')
      out.tedeeSync = await res.json()
    } catch (e) { out.tedeeSync = `Fehler: ${String(e).slice(0, 200)}` }
  }
  if (ttlockConfigured()) {
    try {
      out.ttlock = await ttlockCall('/v3/lock/list', { pageNo: 1, pageSize: 100 })
    } catch (e) { out.ttlock = `Fehler: ${String(e).slice(0, 200)}` }
  }
  return out
}

/**
 * Täglicher Batterie-Wächter (läuft im 3:40-Locks-Cron): schwache Schlösser
 * (≤20 % oder Hersteller-Kritisch-Flag) lösen einen Push an die
 * REINIGUNGS-VERANTWORTLICHE der Wohnung aus (sie ist ohnehin vor Ort und
 * tauscht die Batterien) — ohne Zuordnung an die Chefs. Wiederholung alle
 * 3 Tage, bis der Akku wieder klar erholt ist (Hysterese 35 %).
 * Zustand in app_settings 'lock_battery_state'.
 */
export async function checkLockBatteries(): Promise<{ geprueft: number; schwach: string[]; gewarnt: string[]; offline: string[] }> {
  const health = await listLockHealth()
  // BEWUSST ohne is_active-Filter: auch das einbaufertige Minden-UG-Schloss
  // (inaktives Listing „Minden UG (Aufbau)", §250) soll überwacht sein.
  const { data: listings } = await supabaseAdmin
    .from('listings').select('id, title, locks, cleaning_responsible')
  const rows = (listings ?? []).filter((l) => Array.isArray(l.locks) && (l.locks as unknown[]).length > 0)

  // Zustand laden (Dedupe/Wiederholungs-Takt). §258-Regel: supabase-js WIRFT
  // bei DB-Fehlern nicht ({ error }-Feld!) — ein Lesefehler darf NIE als
  // „leerer Zustand" gelten, sonst resettet der 3-Tage-Takt und alle
  // schwachen Schlösser werden erneut gewarnt (§243o-Fehlerpfad-Klasse).
  let state: Record<string, { warnedAt: string; level: number | null }> = {}
  let stateReadOk = true
  try {
    const { data, error } = await supabaseAdmin.from('app_settings').select('value').eq('key', 'lock_battery_state').maybeSingle()
    if (error) stateReadOk = false
    else if (data?.value && typeof data.value === 'object') state = data.value as typeof state
  } catch { stateReadOk = false }

  const schwach: string[] = []
  const gewarnt: string[] = []
  const offline: string[] = []
  let geprueft = 0
  const jetzt = Date.now()

  for (const l of rows) {
    for (const ref of (l.locks as LockRef[])) {
      const key = `${ref.provider}:${ref.id}`
      const h = health[key]
      if (!h) continue
      geprueft++
      if (h.online === false) offline.push(`${l.title as string} · ${ref.label}`)
      const istSchwach = (h.battery !== null && h.battery <= BATTERIE_WARN_PROZENT) || h.critical || h.keypadCritical
      const istErholt = h.battery !== null && h.battery > BATTERIE_ERHOLT_PROZENT && !h.critical && !h.keypadCritical
      if (istErholt && state[key]) delete state[key]   // Batterie getauscht → Zyklus beendet
      if (!istSchwach) continue
      const label = `${l.title as string} · ${ref.label}${h.battery !== null ? ` (${h.battery} %)` : ''}`
      schwach.push(label)
      if (!stateReadOk) continue  // ohne verlässlichen State keine Warn-Pushes (kein Duplikat-Spam)
      const letzte = state[key]?.warnedAt ? Date.parse(state[key].warnedAt) : 0
      if (jetzt - letzte < WARN_WIEDERHOLUNG_MS) continue  // erst in 3 Tagen wieder
      const grund = h.keypadCritical && !(h.battery !== null && h.battery <= BATTERIE_WARN_PROZENT)
        ? 'Keypad-Batterie kritisch' : h.battery !== null ? `nur noch ${h.battery} %` : 'Batterie kritisch'
      const text = `${ref.label} in ${l.title as string}: ${grund} — bitte beim nächsten Besuch die Batterien tauschen.`
      const respId = (l.cleaning_responsible as string | null) ?? null
      try {
        // dynamischer Import wie beim Türcode-Fehler-Push (kein Zirkel push↔locks)
        const { sendPushToUser, sendPushToTeam } = await import('@/lib/push')
        // §265-Review: erreicht die Verantwortliche kein Gerät (keine
        // Subscription / Kategorie stumm), MUSS die Warnung ans Team —
        // sonst warnt der Wächter jahrelang ins Leere.
        const geraete = respId
          ? await sendPushToUser(respId, '🪫 Batterie schwach', text, '/team?tab=einstellungen', `batt-${key}`, 'system')
          : 0
        if (!geraete) {
          await sendPushToTeam('🪫 Batterie schwach', text, '/team?tab=einstellungen', { category: 'system' })
        }
      } catch { /* Push-Fehler bricht den Wächter nie */ }
      state[key] = { warnedAt: new Date().toISOString(), level: h.battery }
      gewarnt.push(label)
    }
  }

  if (stateReadOk) {
    try {
      const { error } = await supabaseAdmin.from('app_settings').upsert({ key: 'lock_battery_state', value: state }, { onConflict: 'key' })
      if (error) console.error('[lock-battery] state-upsert:', error.message)
    } catch (e) { console.error('[lock-battery] state-upsert:', e) }
  }
  return { geprueft, schwach, gewarnt, offline }
}

/* ── 📋 Übersicht + Öffnungs-Protokoll für die Team-App (§253) ── */

export interface LockDoorInfo {
  listingId: string
  title: string
  /** Schlösser dieser Wohnung — provider bestimmt, ob Fernöffnen geht.
   *  §265: + Batterie/Online für die Anzeige im Türschlösser-Bereich. */
  locks: (LockRef & { health?: LockHealth | null })[]
  /** Türcode der laufenden bzw. nächsten Buchung (wenn schon erzeugt) */
  guestCode: string | null
  guestName: string | null
  guestFrom: string | null
  guestTo: string | null
  /** current | upcoming | null */
  guestStatus: 'current' | 'upcoming' | null
}

/** Alle aktiven Wohnungen mit Schlössern + aktuellem Gäste-Türcode.
 *  §265: withHealth lädt zusätzlich Akku-/Online-Status (3 Provider-APIs) —
 *  NUR für die Anzeige (GET); der Öffnen-POST validiert ohne, damit das
 *  zeitkritische Aufschließen nie auf einem hängenden Provider blockiert.
 *  Der Health-Abruf ist zudem auf 8 s gedeckelt (fail-soft → keine Badges). */
export async function getLocksOverview(opts: { withHealth?: boolean } = {}): Promise<LockDoorInfo[]> {
  const healthP: Promise<LockHealthMap> = opts.withHealth
    ? Promise.race([
        listLockHealth(),
        new Promise<LockHealthMap>((resolve) => setTimeout(() => resolve({}), 8000)),
      ]).catch(() => ({} as LockHealthMap))
    : Promise.resolve({} as LockHealthMap)
  const { data: listings } = await supabaseAdmin
    .from('listings').select('id, title, locks').eq('is_active', true).order('title')
  const withLocks = (listings ?? []).filter((l) => Array.isArray(l.locks) && (l.locks as unknown[]).length > 0)
  if (!withLocks.length) return []
  const ids = withLocks.map((l) => l.id as string)
  const today = new Date().toISOString().slice(0, 10)
  // Laufende + kommende bestätigte Buchungen mit Türcode (nächste zuerst)
  const { data: bookings } = await supabaseAdmin
    .from('bookings')
    .select('listing_id, guest_name, check_in, check_out, door_code, status')
    .in('listing_id', ids)
    .eq('status', 'confirmed')
    .gte('check_out', today)
    .order('check_in', { ascending: true })
  const byListing = new Map<string, { guest_name: string | null; check_in: string; check_out: string; door_code: string | null }>()
  for (const b of bookings ?? []) {
    const lid = b.listing_id as string
    if (!byListing.has(lid)) byListing.set(lid, b as { guest_name: string | null; check_in: string; check_out: string; door_code: string | null })
  }
  const health = await healthP
  return withLocks.map((l) => {
    const lid = l.id as string
    const bk = byListing.get(lid) ?? null
    const status: 'current' | 'upcoming' | null = bk
      ? (bk.check_in <= today && bk.check_out >= today ? 'current' : 'upcoming')
      : null
    return {
      listingId: lid,
      title: (l.title as string) ?? 'Wohnung',
      locks: ((l.locks as LockRef[]) ?? []).map((ref) => ({ ...ref, health: health[`${ref.provider}:${ref.id}`] ?? null })),
      guestCode: bk?.door_code ?? null,
      guestName: bk?.guest_name ?? null,
      guestFrom: bk?.check_in ?? null,
      guestTo: bk?.check_out ?? null,
      guestStatus: status,
    }
  })
}

export interface LockOpenLogEntry {
  at: string
  byId: string
  byName: string
  listingId: string
  title: string
  lockLabel: string
  ok: boolean
}

/** Öffnungs-Protokoll (app_settings 'lock_open_log', letzte 200). */
export async function getLockOpenLog(): Promise<LockOpenLogEntry[]> {
  try {
    const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', 'lock_open_log').maybeSingle()
    const arr = (data?.value as { entries?: LockOpenLogEntry[] } | null)?.entries
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

export async function logLockOpen(e: LockOpenLogEntry): Promise<void> {
  const cur = await getLockOpenLog()
  const next = [e, ...cur].slice(0, 200)
  await supabaseAdmin.from('app_settings').upsert({ key: 'lock_open_log', value: { entries: next } }, { onConflict: 'key' })
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
  const ttlockIds = allLocks.filter((l) => l.provider === 'ttlock').map((l) => Number(l.id)).filter(Number.isFinite)
  if (!nukiIds.length && !tedeeIds.length && !ttlockIds.length) return skip('keine schlösser zugeordnet')
  if (nukiIds.length && !nukiConfigured()) return skip('kein NUKI_API_TOKEN')
  if (tedeeIds.length && !tedeeConfigured()) return skip('kein TEDEE_API_KEY')
  if (ttlockIds.length && !ttlockConfigured()) return skip('TTLOCK-Envs fehlen')

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
  // TTLock: Zeitfenster als ms-Timestamps (gleiche ISO-Basis wie oben)
  for (const id of ttlockIds) await setTTLockCode(id, alias, code, Date.parse(from), Date.parse(until))
  await supabaseAdmin.from('bookings').update({ door_code: code }).eq('id', b.id)
  console.log('[locks] Code gesetzt:', { booking: b.id, nuki: nukiIds.length, tedee: tedeeIds.length, ttlock: ttlockIds.length })
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
        for (const l of locks.filter((x) => x.provider === 'ttlock')) {
          await removeTTLockCodesByName(Number(l.id), alias)
          await setTTLockCode(Number(l.id), alias, newCode, Date.parse(from), Date.parse(until))
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
      // TTLock (§250): fehlende Buchungs-Codes mit Original-Fenster nachlegen
      const ttlockLocks = locks.filter((l) => l.provider === 'ttlock').map((l) => Number(l.id)).filter(Number.isFinite)
      for (const lockId of ttlockLocks) {
        try {
          if ((await listTTLockPins(lockId)).some((p) => p.name === alias)) continue
          missing++
          await setTTLockCode(lockId, alias, r.door_code as string, Date.parse(from), Date.parse(until))
          fixed++
        } catch (err) {
          console.error('[locks] verify: ttlock', listing?.title, lockId, (err instanceof Error ? err.message : String(err)).slice(0, 120))
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
      await sendPushToTeam('⚠️ Türcode konnte nicht angelegt werden', errors[0] + (errors.length > 1 ? ` (+${errors.length - 1} weitere)` : ''), '/team?tab=aufgaben', { category: 'system' })
    } catch { /* best effort */ }
    console.error('[locks] Fehler:', errors)
  }
  return { created, skipped, cleaned, errors }
}
