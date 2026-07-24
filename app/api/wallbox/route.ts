import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  listWallboxCharges, getChargePointNames, getWallboxSettings, saveWallboxSettings, estimateProfitEur,
} from '@/lib/wallbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * ⚡ Wallbox (§185) — NUR Admins (Finanzdaten!):
 *  GET ?probe=1        → leichter Zugriffs-/Settings-Check (kein Monta-Call)
 *  GET ?page=N         → Ladehistorie (normalisiert) + Summen-Basis
 *  GET ?page=0&debug=1 → zusätzlich Roh-Felder des neuesten Ladevorgangs
 *  PATCH { kwhCostCents? | pushStart? | pushEnd? } — Push-Flags gelten für
 *  den EIGENEN Nutzer (Präferenz), der Strompreis global.
 */

async function requireAdmin(): Promise<{ userId: string } | NextResponse> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  if (!me?.is_admin) return NextResponse.json({ error: 'Nicht berechtigt' }, { status: 403 })
  return { userId: user.id }
}

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const url = new URL(request.url)

  const settings = await getWallboxSettings()
  const mySettings = {
    kwhCostCents: settings.kwhCostCents,
    pushStart: settings.pushStart[auth.userId] !== false,
    pushEnd: settings.pushEnd[auth.userId] !== false,
  }

  // Leichter Check für den ⚙️-Tab (Sichtbarkeit + Toggles) ohne Monta-Call
  if (url.searchParams.get('probe') === '1') {
    return NextResponse.json({ ok: true, configured: !!process.env.MONTA_CLIENT_ID, settings: mySettings })
  }

  const page = Math.max(0, Number(url.searchParams.get('page') ?? 0) || 0)
  try {
    const { charges, hasMore, rawSample } = await listWallboxCharges(page, 50)
    const names = await getChargePointNames()
    const out = charges.map((c) => ({
      ...c,
      chargePointName: c.chargePointName ?? (c.chargePointId != null ? names.get(c.chargePointId) ?? null : null),
      profitEur: estimateProfitEur(c, settings.kwhCostCents),
    }))
    return NextResponse.json({
      charges: out,
      hasMore,
      settings: mySettings,
      ...(url.searchParams.get('debug') === '1' ? { rawSample } : {}),
    })
  } catch (e) {
    console.error('[wallbox] GET:', e)
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 502 })
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  let body: { kwhCostCents?: unknown; pushStart?: unknown; pushEnd?: unknown }
  try { body = await request.json() } catch { body = {} }

  const settings = await getWallboxSettings()
  if (body.kwhCostCents !== undefined) {
    const n = Number(body.kwhCostCents)
    if (!Number.isFinite(n) || n < 0 || n > 200) {
      return NextResponse.json({ error: 'Strompreis muss zwischen 0 und 200 Cent/kWh liegen.' }, { status: 400 })
    }
    settings.kwhCostCents = Math.round(n * 10) / 10
  }
  if (typeof body.pushStart === 'boolean') settings.pushStart[auth.userId] = body.pushStart
  if (typeof body.pushEnd === 'boolean') settings.pushEnd[auth.userId] = body.pushEnd
  await saveWallboxSettings(settings)

  return NextResponse.json({
    ok: true,
    settings: {
      kwhCostCents: settings.kwhCostCents,
      pushStart: settings.pushStart[auth.userId] !== false,
      pushEnd: settings.pushEnd[auth.userId] !== false,
    },
  })
}
