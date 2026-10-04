import { NextResponse } from 'next/server'
import { getTaskAuth } from '@/lib/tasks'
import { getApifyBudget } from '@/lib/reviews-sync'
import { buildSyncStatus, readCronState, STALE_TAGE } from '@/lib/reviews-sync-log'

/**
 * ⭐ Bewertungs-Abruf — Status (§314). Nur Admins/Gastgeber (Karte im Kalender-Reiter unter den
 * Kennzahlen; 403 ⇒ Karte bleibt aus). Je Wohnung × Portal: letzter erfolgreicher Abruf, letzter
 * Versuch + Fehler, neueste Bewertung, Anzahl. Dazu das Cron-Lebenszeichen und das Apify-Guthaben.
 */
export const dynamic = 'force-dynamic'

const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

export async function GET() {
  const auth = await getTaskAuth()
  if (!auth || auth.role !== 'admin') {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  }
  try {
    const [zeilen, budget, cron] = await Promise.all([buildSyncStatus(), getApifyBudget(), readCronState()])
    const zellen = zeilen.flatMap((z) => z.zellen).filter((c) => c.konfiguriert)
    return NextResponse.json({
      zeilen,
      konfiguriert: zellen.length,
      aktuell: zellen.filter((c) => c.ampel === 'gruen').length,
      probleme: zellen.filter((c) => c.ampel === 'rot').length,
      budget,
      cronAktivAm: cron.state.at ?? null,
      letzterLauf: cron.state.gescraptAm
        ? { am: cron.state.gescraptAm, wohnungen: cron.state.gescrapt?.length ?? 0, ausgelassen: cron.state.ausgelassen ?? 0 }
        : null,
      nachholOffen: cron.lesbar && !cron.state.nachholAm,
      staleTage: STALE_TAGE,
    }, NO_STORE)
  } catch (e) {
    console.error('[reviews/status]', e)
    return NextResponse.json({ error: 'Status konnte nicht geladen werden.' }, { status: 500, ...NO_STORE })
  }
}
