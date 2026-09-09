import { NextRequest, NextResponse } from 'next/server'
import { getTaskAuth } from '@/lib/tasks'
import { stammgaesteStatistik } from '@/lib/stammgaeste'

/**
 * ⭐ Stammgäste-Statistik (Dominik, Chefsache 9.9. — §290): Verteilung 1×/2×/3×/4+ und die Liste
 * der Wiederkehrer. NUR Admins/Gastgeber (wie Kennzahlen), sonst 403. ?probe=1 = Rechte-Check.
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

export async function GET(req: NextRequest) {
  const auth = await getTaskAuth()
  if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Nur für Admins/Gastgeber.' }, { status: 403, ...NO_STORE })
  if (req.nextUrl.searchParams.get('probe') === '1') return NextResponse.json({ ok: true }, NO_STORE)
  try {
    return NextResponse.json(await stammgaesteStatistik(), NO_STORE)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Fehler' }, { status: 500, ...NO_STORE })
  }
}
