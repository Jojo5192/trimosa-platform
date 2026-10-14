import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { runReinigungsRouting } from '@/lib/reinigung-routing'

/**
 * 🧹 Reinigungs-Weiterleitung (Pascal 6.10.2026, lib/reinigung-routing.ts): Late-Check-out-/Late-Check-in-/
 * Early-Check-in-Fragen und Reinigungsmängel aus Gast-Chats und Bewertungen → Aufgabe + Push an die zuständige
 * Reinigungskraft. Es geht NIE etwas an Gäste raus.
 *  GET  → Vercel-Cron alle 15 Min (Bearer CRON_SECRET, fail-closed) — echter Lauf; Totalausfall → Störungs-Push
 *         (lib/ausfall.ts, höchstens alle 6 Stunden).
 *  POST → NUR is_admin: { dryRun: true, stunden?: 1..72 } zeigt, was angelegt WÜRDE — ohne Aufgabe, ohne Push,
 *         ohne Cursor-Änderung. stunden = festes Rückblick-Fenster (auch schon geprüfte Nachrichten).
 */
export const maxDuration = 120
export const dynamic = 'force-dynamic'

const AUSFALL_KEY = 'reinigung-routing'
const AUSFALL_TITEL = 'Reinigungs-Weiterleitung'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 401 })
  }
  const { meldeAusfall, ausfallBehoben } = await import('@/lib/ausfall')
  try {
    const r = await runReinigungsRouting()
    if (r.ausfall) await meldeAusfall(AUSFALL_KEY, AUSFALL_TITEL, r.ausfall)
    else if (!r.fehler && r.abgebrochen !== 'lauf-aktiv') await ausfallBehoben(AUSFALL_KEY, AUSFALL_TITEL)
    console.log('[reinigung-routing]', JSON.stringify({ ...r, vorschau: r.vorschau.map((v) => `${v.ergebnis}: ${v.titel ?? v.grund ?? v.ref}`) }))
    return NextResponse.json(r)
  } catch (err) {
    console.error('[reinigung-routing] cron:', err)
    await meldeAusfall(AUSFALL_KEY, AUSFALL_TITEL,
      `Der Lauf ist abgebrochen: ${String(err instanceof Error ? err.message : err).slice(0, 140)} — Late-Check-out-Fragen und Reinigungsmängel gehen gerade nicht an die Reinigung.`)
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err).slice(0, 300) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { data: me } = await supabaseAdmin.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  if (!me?.is_admin) return NextResponse.json({ error: 'Nur Admins.' }, { status: 403 })

  const body = await request.json().catch(() => ({})) as { dryRun?: unknown; stunden?: unknown }
  if (body.dryRun !== true) {
    return NextResponse.json({ error: 'Nur Probelauf möglich: { "dryRun": true } — echte Läufe macht der Cron alle 15 Minuten.' }, { status: 400 })
  }
  const stunden = Number(body.stunden)
  try {
    return NextResponse.json(await runReinigungsRouting({
      dryRun: true,
      stunden: Number.isFinite(stunden) && stunden >= 1 && stunden <= 72 ? stunden : undefined,
    }))
  } catch (err) {
    console.error('[reinigung-routing] Probelauf:', err)
    // Admin-gated: konkrete Fehlermeldung zurückgeben (Diagnose ohne Vercel-Logs)
    return NextResponse.json({ error: `Probelauf fehlgeschlagen: ${String(err instanceof Error ? err.message : err).slice(0, 300)}` }, { status: 500 })
  }
}
