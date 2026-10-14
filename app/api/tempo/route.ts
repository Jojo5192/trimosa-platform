import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTaskAuth } from '@/lib/tasks'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  AUSWERTUNG_TAGE, TEMPO_PREFIX, aufraeumGrenze, auswerten, berlinDatum, letzteTageSchluessel,
  pruefeEingabe, tagEinrechnen, tagLesen, type Messung,
} from '@/lib/tempo'

/**
 * ⏱ Gefühlte Geschwindigkeit (Pascal, Chefsache 7.10.2026, Bereich 11) — Logik in lib/tempo.ts.
 *
 * POST (alle Team-Rollen inkl. Dienstleister): gebündelte Messungen der Team-App
 *   { e: [{ m, r, d, s }] } — Methode, Routen-Muster, Dauer (ms), Statusklasse; keine Inhalte.
 *   Kommt per sendBeacon als text/plain. Rate-Limit je Nutzer, strenge Prüfung (ein ungültiger
 *   Eintrag verwirft die Sendung). Gespeichert wird in EINER app_settings-Zeile je Berliner Tag
 *   (tempo:YYYY-MM-DD, keine Migration); gleichzeitige Schreiber über den Versionszähler v wie
 *   lib/push.ts nachtAnhaengen. Zeilen älter als 14 Tage räumt der erste Schreiber des Tages weg.
 *
 * GET (nur Chefs, is_admin): Auswertung der letzten 7 Tage je Muster — Aufrufe, Median, p90
 *   (aus dem Histogramm geschätzt), Fehlerquote; sortiert nach gefühlter Wartelast (Aufrufe × p90).
 *   ?probe=1 = Sichtbarkeits-Check fürs Mehr-Menü.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 15

const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }
/** 200 Einträge à ~60 Zeichen ≈ 12 KB — großzügig darüber ist kein echter Client */
const MAX_BYTES = 32_000

async function istChef(): Promise<boolean> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data: me } = await supabaseAdmin.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  return !!me?.is_admin
}

/** Alte Tage (> 14) löschen — Schlüssel tempo:YYYY-MM-DD sortieren sich wie Daten */
async function altesAufraeumen(jetzt: Date): Promise<void> {
  const { error } = await supabaseAdmin.from('app_settings').delete()
    .like('key', `${TEMPO_PREFIX}%`).lt('key', aufraeumGrenze(jetzt))
  if (error) console.error('[tempo] Aufräumen fehlgeschlagen:', error.message)
}

/** Messungen in die Tageszeile einrechnen — konfliktfrei über den Versionszähler v */
async function tagAnhaengen(messungen: Messung[], jetzt: Date): Promise<boolean> {
  const key = TEMPO_PREFIX + berlinDatum(jetzt)
  for (let versuch = 0; versuch < 6; versuch++) {
    // kurze Zufallspause — gleichzeitige Schreiber laufen sonst im Gleichschritt
    if (versuch) await new Promise((r) => setTimeout(r, 20 + Math.random() * 80 * versuch))
    const { data, error } = await supabaseAdmin.from('app_settings').select('value').eq('key', key).maybeSingle()
    if (error) { console.error('[tempo] Tageszeile nicht lesbar:', error.message); return false }
    const alt = tagLesen(data?.value)
    const neu = tagEinrechnen(alt, messungen)
    if (!data) {
      // erster Schreiber des Tages — parallel angelegt? Dann scheitert insert am Schlüssel → neu lesen
      const { error: insErr } = await supabaseAdmin.from('app_settings').insert({ key, value: neu })
      if (!insErr) { await altesAufraeumen(jetzt); return true }
      continue
    }
    const { data: upd, error: updErr } = await supabaseAdmin.from('app_settings')
      .update({ value: neu, updated_at: new Date().toISOString() })
      .eq('key', key).eq('value->>v', String(alt.v))
      .select('key')
    if (updErr) { console.error('[tempo] Tageszeile nicht gespeichert:', updErr.message); return false }
    if (upd?.length) {
      // Rückfall, falls das Aufräumen beim Anlegen scheiterte: gelegentlich erneut
      if (Math.random() < 0.02) await altesAufraeumen(jetzt)
      return true
    }
    // jemand war schneller → neu lesen
  }
  return false
}

export async function POST(req: NextRequest) {
  const auth = await getTaskAuth()
  if (!auth) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) {
    return NextResponse.json({ error: 'Zu groß.' }, { status: 413 })
  }
  let text: string
  try { text = await req.text() } catch { return NextResponse.json({ error: 'Ungültig.' }, { status: 400 }) }
  if (text.length > MAX_BYTES) return NextResponse.json({ error: 'Zu groß.' }, { status: 413 })
  let body: unknown
  try { body = JSON.parse(text) } catch { return NextResponse.json({ error: 'Ungültig.' }, { status: 400 }) }
  const pruefung = pruefeEingabe(body)
  if (!pruefung.ok) return NextResponse.json({ error: 'Ungültig.', grund: pruefung.grund }, { status: 400 })
  if (!pruefung.messungen.length) return NextResponse.json({ ok: true, gespeichert: 0 }, NO_STORE)

  // Takt 60 s + Senden beim Verstecken der App — 12 je Minute lassen viel Luft
  if (!(await checkRateLimit(`tempo:${auth.userId}`, 12, 60))) {
    return NextResponse.json({ error: 'Zu viele Sendungen.' }, { status: 429 })
  }
  const ok = await tagAnhaengen(pruefung.messungen, new Date())
  if (!ok) return NextResponse.json({ error: 'Nicht gespeichert.' }, { status: 503 })
  return NextResponse.json({ ok: true, gespeichert: pruefung.messungen.length }, NO_STORE)
}

export async function GET(req: NextRequest) {
  if (!(await istChef())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  if (req.nextUrl.searchParams.get('probe') === '1') return NextResponse.json({ ok: true }, NO_STORE)

  const jetzt = new Date()
  const schluessel = letzteTageSchluessel(AUSWERTUNG_TAGE, jetzt)
  const { data, error } = await supabaseAdmin.from('app_settings').select('key, value').in('key', schluessel)
  if (error) {
    console.error('[tempo] Auswertung nicht lesbar:', error.message)
    return NextResponse.json({ error: 'Nicht lesbar.' }, { status: 500 })
  }
  const zeilen = (data ?? []) as { key: string; value: unknown }[]
  const auswertung = auswerten(zeilen.map((z) => tagLesen(z.value)))
  return NextResponse.json({
    ...auswertung,
    tageMitDaten: zeilen.length,
    von: schluessel[schluessel.length - 1].slice(TEMPO_PREFIX.length),
    bis: schluessel[0].slice(TEMPO_PREFIX.length),
  }, NO_STORE)
}
