import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendPushToUser } from '@/lib/push'

/**
 * ⚡ Wallbox-Anbindung (§185): click2charge ist ein Monta-White-Label
 * (DaheimLaden) — wir sprechen direkt die Monta Public API
 * (docs.public-api.monta.com). Auth via client_credentials
 * (Envs MONTA_CLIENT_ID + MONTA_CLIENT_SECRET), Rate-Limit 10 Req/Min —
 * der 15-Min-Poll-Cron braucht 2–3 Requests.
 *
 * ⚠️ FELD-KALIBRIERUNG: Die exakten Charge-Feldnamen sind nicht öffentlich
 * dokumentiert — normCharge() liest deshalb defensiv mehrere Kandidaten
 * (kWh, Preis, Kosten). GET /api/wallbox?debug=1 zeigt die Roh-Felder des
 * neuesten Ladevorgangs — beim ersten echten Lauf kalibrieren (§127-Weg).
 */

const BASE = 'https://public-api.monta.com/api/v1'
const SETTINGS_KEY = 'wallbox_settings'
const PUSH_STATE_KEY = 'wallbox_push_state'

type G = typeof globalThis & { __montaToken?: { token: string; exp: number } }

async function getToken(): Promise<string> {
  const g = globalThis as G
  if (g.__montaToken && Date.now() < g.__montaToken.exp) return g.__montaToken.token
  const clientId = process.env.MONTA_CLIENT_ID
  const clientSecret = process.env.MONTA_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('MONTA_CLIENT_ID / MONTA_CLIENT_SECRET nicht konfiguriert.')
  const res = await fetch(`${BASE}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  })
  if (!res.ok) throw new Error(`Monta-Auth HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const j = await res.json() as { accessToken?: string; token?: string }
  const token = j.accessToken ?? j.token
  if (!token) throw new Error('Monta-Auth: kein accessToken in der Antwort.')
  g.__montaToken = { token, exp: Date.now() + 4 * 60_000 }
  return token
}

async function montaGet(path: string): Promise<unknown> {
  const token = await getToken()
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Monta GET ${path.split('?')[0]} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

/** Monta-Antworten kommen mal als Array, mal als { data: [...] } */
function unwrapList(j: unknown): Record<string, unknown>[] {
  if (Array.isArray(j)) return j as Record<string, unknown>[]
  const d = (j as { data?: unknown })?.data
  return Array.isArray(d) ? (d as Record<string, unknown>[]) : []
}

function num(...vals: unknown[]): number | null {
  for (const v of vals) {
    if (v == null || v === '') continue
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

export interface WallboxCharge {
  id: string
  chargePointId: number | null
  chargePointName: string | null
  state: string
  startedAt: string | null
  stoppedAt: string | null
  kwh: number | null
  /** Was der Ladende gezahlt hat (unser Umsatz), in € */
  revenueEur: number | null
  /** Von Monta gelieferte Kosten (falls vorhanden), in € */
  costEur: number | null
}

function normCharge(c: Record<string, unknown>): WallboxCharge {
  const cp = (c.chargePoint ?? null) as Record<string, unknown> | null
  const price = (c.price ?? null) as Record<string, unknown> | number | null
  return {
    id: String(c.id ?? ''),
    chargePointId: num(c.chargePointId, cp?.id),
    chargePointName: typeof cp?.name === 'string' ? (cp.name as string) : null,
    state: String(c.state ?? ''),
    startedAt: (c.startedAt ?? c.cablePluggedInAt ?? c.createdAt ?? null) as string | null,
    stoppedAt: (c.stoppedAt ?? c.completedAt ?? c.fullyChargedAt ?? null) as string | null,
    kwh: num(c.consumedKwh, c.kwh, c.chargedKwh, c.energy, c.totalKwh),
    revenueEur: num(
      typeof price === 'object' ? (price as Record<string, unknown>)?.amount : price,
      c.totalPrice, c.cashAmount, c.amount, c.grossAmount,
    ),
    costEur: num(c.cost, c.totalCost, c.purchaseCost),
  }
}

export async function listWallboxCharges(page = 0, perPage = 50, fromDate?: string): Promise<{
  charges: WallboxCharge[]
  hasMore: boolean
  rawSample: Record<string, unknown> | null
}> {
  const params = new URLSearchParams({ page: String(page), perPage: String(perPage) })
  if (fromDate) params.set('fromDate', fromDate)
  const j = await montaGet(`/charges?${params}`)
  const rows = unwrapList(j)
  return {
    charges: rows.map(normCharge),
    hasMore: rows.length >= perPage,
    rawSample: rows[0] ?? null,
  }
}

/** Ladepunkt-Namen nachschlagen (id → name), best effort */
export async function getChargePointNames(): Promise<Map<number, string>> {
  try {
    const j = await montaGet('/charge-points?page=0&perPage=50')
    const rows = unwrapList(j)
    const map = new Map<number, string>()
    for (const r of rows) {
      const id = num(r.id)
      const name = typeof r.name === 'string' && r.name ? r.name : (typeof r.serialNumber === 'string' ? r.serialNumber : null)
      if (id != null && name) map.set(id, name)
    }
    return map
  } catch {
    return new Map()
  }
}

/* ── Einstellungen (app_settings, KEINE Migration) ── */

export interface WallboxSettings {
  /** Unser Einkaufs-Strompreis in Cent/kWh (für die Brutto-Gewinn-Schätzung) */
  kwhCostCents: number
  /** Push-Präferenz je Admin — fehlender Eintrag = AN */
  pushStart: Record<string, boolean>
  pushEnd: Record<string, boolean>
}

const DEFAULTS: WallboxSettings = { kwhCostCents: 35, pushStart: {}, pushEnd: {} }

export async function getWallboxSettings(): Promise<WallboxSettings> {
  const { data } = await supabaseAdmin
    .from('app_settings').select('value').eq('key', SETTINGS_KEY).maybeSingle()
  const v = (data?.value ?? {}) as Partial<WallboxSettings>
  return {
    kwhCostCents: Number.isFinite(Number(v.kwhCostCents)) && Number(v.kwhCostCents) >= 0 ? Number(v.kwhCostCents) : DEFAULTS.kwhCostCents,
    pushStart: v.pushStart ?? {},
    pushEnd: v.pushEnd ?? {},
  }
}

export async function saveWallboxSettings(s: WallboxSettings): Promise<void> {
  await supabaseAdmin.from('app_settings').upsert({ key: SETTINGS_KEY, value: s }, { onConflict: 'key' })
}

/** Brutto-Gewinn-Schätzung: Umsatz − Stromkosten (Monta-Kosten, sonst kWh × Satz) */
export function estimateProfitEur(c: WallboxCharge, kwhCostCents: number): number | null {
  if (c.revenueEur == null) return null
  const cost = c.costEur ?? (c.kwh != null ? (c.kwh * kwhCostCents) / 100 : null)
  if (cost == null) return null
  return Math.round((c.revenueEur - cost) * 100) / 100
}

/* ── Poll-Cron (§185): Start-/Ende-Pushes NUR an Admins ── */

const fmtEur = (n: number) => n.toFixed(2).replace('.', ',') + ' €'
const fmtKwh = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',') + ' kWh'

export async function pollWallboxCharges(): Promise<{ checked: number; startPushed: number; endPushed: number }> {
  const fromDate = new Date(Date.now() - 48 * 3600_000).toISOString().slice(0, 19) + 'Z'
  const { charges } = await listWallboxCharges(0, 100, fromDate)
  if (!charges.length) return { checked: 0, startPushed: 0, endPushed: 0 }

  const { data: st } = await supabaseAdmin
    .from('app_settings').select('value').eq('key', PUSH_STATE_KEY).maybeSingle()
  const state = (st?.value ?? {}) as { start?: string[]; end?: string[] }
  const startDone = new Set(state.start ?? [])
  const endDone = new Set(state.end ?? [])

  const ACTIVE = new Set(['charging', 'starting', 'paused', 'stopping'])
  const ENDED = new Set(['completed', 'stopped'])
  const newStarts = charges.filter((c) => ACTIVE.has(c.state) && !startDone.has(c.id))
  // Ende-Push auch, wenn der Start nie gepusht wurde (kurze Ladung zwischen zwei Polls)
  const newEnds = charges.filter((c) => ENDED.has(c.state) && !endDone.has(c.id))
  if (!newStarts.length && !newEnds.length) return { checked: charges.length, startPushed: 0, endPushed: 0 }

  const settings = await getWallboxSettings()
  const { data: admins } = await supabaseAdmin.from('profiles').select('id').eq('is_admin', true)
  const adminIds = (admins ?? []).map((a) => String(a.id))
  const names = await getChargePointNames()
  const cpName = (c: WallboxCharge) => c.chargePointName ?? (c.chargePointId != null ? names.get(c.chargePointId) ?? 'Wallbox' : 'Wallbox')

  let startPushed = 0
  let endPushed = 0
  for (const c of newStarts) {
    const targets = adminIds.filter((id) => settings.pushStart[id] !== false)
    await Promise.all(targets.map((id) =>
      sendPushToUser(id, '⚡ Ladevorgang gestartet', `${cpName(c)} — ein Gast lädt gerade.`, '/team', `wallbox-${c.id}`).catch(() => {}),
    ))
    startDone.add(c.id)
    startPushed++
  }
  for (const c of newEnds) {
    const profit = estimateProfitEur(c, settings.kwhCostCents)
    const bits = [
      c.kwh != null ? fmtKwh(c.kwh) : null,
      c.revenueEur != null ? `Umsatz ${fmtEur(c.revenueEur)}` : null,
      profit != null ? `Gewinn ~${fmtEur(profit)}` : null,
    ].filter(Boolean)
    const targets = adminIds.filter((id) => settings.pushEnd[id] !== false)
    await Promise.all(targets.map((id) =>
      sendPushToUser(id, `⚡ Ladung beendet · ${cpName(c)}`, bits.join(' · ') || 'Details in der App', '/team', `wallbox-${c.id}`).catch(() => {}),
    ))
    endDone.add(c.id)
    endPushed++
  }

  // State begrenzen (die letzten ~300 IDs reichen — Fenster ist ohnehin 48 h)
  await supabaseAdmin.from('app_settings').upsert({
    key: PUSH_STATE_KEY,
    value: { start: [...startDone].slice(-300), end: [...endDone].slice(-300) },
  }, { onConflict: 'key' })

  return { checked: charges.length, startPushed, endPushed }
}
