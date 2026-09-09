import { NextRequest, NextResponse } from 'next/server'
import { getTaskAuth } from '@/lib/tasks'
import { buildHeute, berlinToday } from '@/lib/heute'

/**
 * GET /api/heute?tag=YYYY-MM-DD[&fresh=1] — Daten des Heute-Bildschirms
 * (§277). Alle Team-Rollen inkl. Dienstleister (die bekommen keine
 * Gastnamen). Server-Cache 2 Min je Nutzer+Tag, fresh=1 umgeht ihn.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const auth = await getTaskAuth()
  if (!auth) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const p = req.nextUrl.searchParams
  const tagParam = p.get('tag') ?? ''
  const tag = /^\d{4}-\d{2}-\d{2}$/.test(tagParam) ? tagParam : berlinToday()
  try {
    const data = await buildHeute(auth, tag, p.get('fresh') === '1')
    return NextResponse.json({ ...data, role: auth.role }, { headers: { 'Cache-Control': 'no-store, must-revalidate' } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[heute]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
