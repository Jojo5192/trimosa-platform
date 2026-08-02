import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getDiscountCodes, saveDiscountCodes, normCode, type DiscountCode } from '@/lib/discounts'

/**
 * 🏷 Gutscheincode-Verwaltung (§243af) — Admin-Karte im Dashboard:
 *  GET   → alle Codes
 *  PATCH → { codes: [{ code, pct, aktiv }] } ersetzt die Liste komplett
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

async function requireAdmin() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  return me?.is_admin ? user : null
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  return NextResponse.json({ codes: await getDiscountCodes() }, NO_STORE)
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!Array.isArray(b.codes)) return NextResponse.json({ error: 'codes[] nötig.' }, { status: 400 })
  if (b.codes.length > 40) return NextResponse.json({ error: 'Max. 40 Codes.' }, { status: 400 })

  const clean: DiscountCode[] = []
  const seen = new Set<string>()
  for (const c of b.codes as Record<string, unknown>[]) {
    const code = normCode(String(c?.code ?? ''))
    const pct = Math.round(Number(c?.pct ?? 0) * 100) / 100
    if (code.length < 3) return NextResponse.json({ error: `Code „${code || '?'}" ist zu kurz (min. 3 Zeichen).` }, { status: 400 })
    if (!/^[A-Z0-9-]+$/.test(code)) return NextResponse.json({ error: `Code „${code}": nur Buchstaben, Zahlen und Bindestrich.` }, { status: 400 })
    if (!Number.isFinite(pct) || pct <= 0 || pct > 50) return NextResponse.json({ error: `Rabatt für „${code}" muss zwischen 1 und 50 % liegen.` }, { status: 400 })
    if (seen.has(code)) return NextResponse.json({ error: `Code „${code}" ist doppelt.` }, { status: 400 })
    seen.add(code)
    clean.push({ code, pct, aktiv: c?.aktiv !== false })
  }
  await saveDiscountCodes(clean)
  return NextResponse.json({ ok: true, codes: clean }, NO_STORE)
}
