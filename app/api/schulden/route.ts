import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { Kredit, KreditMonat } from '@/lib/schulden-mathe'

/**
 * 🏦 §272 Schuldenstand — NUR CHEFS (is_admin, hartes Gate wie /buchhaltung).
 *  Kredite je Standort mit Restschuld-Verlauf; Zins/Rate rechnet der Client
 *  aus dem Verlauf (lib/schulden-mathe, Annuitäts-Fit).
 *  Daten in app_settings 'schulden' — EIGENER Key (§243o-Wipe-Klasse: andere
 *  Settings-Writer fassen ihn nie an), Read prüft error und WIRFT (§266c —
 *  ein transienter Lesefehler darf nie als „leer" durchgehen und beim
 *  nächsten Save den Bestand überschreiben).
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }
const KEY = 'schulden'

async function requireAdmin() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  return me?.is_admin ? user : null
}

async function readSchulden(): Promise<{ kredite: Kredit[]; rev: number }> {
  const { data, error } = await supabaseAdmin
    .from('app_settings').select('value').eq('key', KEY).maybeSingle()
  if (error) throw new Error('schulden read failed: ' + error.message)
  const v = (data?.value ?? {}) as { kredite?: Kredit[]; rev?: number }
  return {
    kredite: Array.isArray(v.kredite) ? v.kredite : [],
    rev: Number.isFinite(Number(v.rev)) ? Number(v.rev) : 0,
  }
}

/** CAS-Write (Review §272, HOCH): drei Chefs arbeiten parallel auf demselben
 *  Blob — ohne Versions-Guard überschreibt der langsamere Write den
 *  schnelleren kommentarlos (inkl. Wiederauferstehung gelöschter Kredite).
 *  Update greift nur, wenn die gelesene rev noch stimmt; sonst KONFLIKT →
 *  der Client lädt neu. */
async function writeKredite(kredite: Kredit[], erwarteteRev: number): Promise<void> {
  const next = { kredite, rev: erwarteteRev + 1 }
  let q = supabaseAdmin.from('app_settings').update({ value: next }).eq('key', KEY)
  // Bestand ohne rev-Feld (bzw. Erstanlage) zählt als rev 0
  q = erwarteteRev === 0
    ? q.or('value->>rev.eq.0,value->>rev.is.null')
    : q.eq('value->>rev', String(erwarteteRev))
  const { data, error } = await q.select('key')
  if (error) throw new Error('schulden write failed: ' + error.message)
  if (data?.length) return
  if (erwarteteRev === 0) {
    const { error: insErr } = await supabaseAdmin.from('app_settings').insert({ key: KEY, value: next })
    if (!insErr) return
  }
  throw new Error('KONFLIKT: Die Daten wurden gerade von jemand anderem geändert — bitte neu laden und erneut speichern.')
}

// Jahres-Plausibilität 2000–2099 (Review: Zehner-Dreher wie „2924" vergiftet
// Gesamt-Hero und Chart)
const MONAT_RE = /^20\d{2}-(0[1-9]|1[0-2])$/

function cleanVerlauf(input: unknown): KreditMonat[] {
  if (!Array.isArray(input)) return []
  const map = new Map<string, number>()
  for (const z of input.slice(0, 800)) {
    const monat = String((z as { monat?: unknown }).monat ?? '')
    const r = Number((z as { restschuld?: unknown }).restschuld)
    if (!MONAT_RE.test(monat) || !Number.isFinite(r) || r < 0 || r > 100_000_000) continue
    map.set(monat, Math.round(r * 100) / 100)
  }
  return [...map.entries()].map(([monat, restschuld]) => ({ monat, restschuld }))
    .sort((a, b) => a.monat.localeCompare(b.monat)).slice(0, 600)
}

function cleanKredit(input: Record<string, unknown>, bestehend?: Kredit): Kredit | null {
  const name = String(input.name ?? bestehend?.name ?? '').trim().slice(0, 80)
  const standort = String(input.standort ?? bestehend?.standort ?? '').trim().slice(0, 40)
  if (!name || !standort) return null
  const firmaRaw = String(input.firma ?? bestehend?.firma ?? 'gbr')
  const num = (v: unknown, alt: number | null | undefined, max: number): number | null => {
    if (v === null) return null
    if (v === undefined) return alt ?? null
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 && n <= max ? n : alt ?? null
  }
  const monatOderNull = (v: unknown, alt: string | null | undefined): string | null => {
    if (v === null) return null
    if (v === undefined) return alt ?? null
    return MONAT_RE.test(String(v)) ? String(v) : alt ?? null
  }
  return {
    id: bestehend?.id ?? String(input.id ?? '') ?? '',
    name,
    standort,
    firma: (['gbr', 'ug', 'aeh'].includes(firmaRaw) ? firmaRaw : 'gbr') as Kredit['firma'],
    bank: input.bank === undefined ? bestehend?.bank ?? null : String(input.bank ?? '').trim().slice(0, 60) || null,
    zinssatz: num(input.zinssatz, bestehend?.zinssatz, 25),
    rate: num(input.rate, bestehend?.rate, 1_000_000),
    zinsbindungBis: monatOderNull(input.zinsbindungBis, bestehend?.zinsbindungBis),
    notiz: input.notiz === undefined ? bestehend?.notiz ?? null : String(input.notiz ?? '').trim().slice(0, 300) || null,
    verlauf: bestehend?.verlauf ?? [],
  }
}

export async function GET(req: NextRequest) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  if (req.nextUrl.searchParams.get('probe') === '1') return NextResponse.json({ ok: true }, NO_STORE)
  try {
    return NextResponse.json({ kredite: (await readSchulden()).kredite }, NO_STORE)
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const action = String(b.action ?? '')
  try {
    const { kredite, rev } = await readSchulden()

    if (action === 'save-kredit') {
      const idGegeben = String(b.id ?? '')
      const idx = kredite.findIndex((k) => k.id === idGegeben)
      // Review §272: Stale-Edit (Kredit wurde parallel gelöscht) darf KEINE
      // stille Neuanlage mit leerem Verlauf werden
      if (idGegeben && idx < 0) return NextResponse.json({ error: 'Kredit nicht gefunden — bitte neu laden.' }, { status: 404 })
      const clean = cleanKredit((b.kredit ?? {}) as Record<string, unknown>, idx >= 0 ? kredite[idx] : undefined)
      if (!clean) return NextResponse.json({ error: 'Name und Standort sind Pflicht.' }, { status: 400 })
      if (idx >= 0) kredite[idx] = clean
      else {
        if (kredite.length >= 30) return NextResponse.json({ error: 'Maximal 30 Kredite.' }, { status: 400 })
        clean.id = crypto.randomUUID()
        kredite.push(clean)
      }
      await writeKredite(kredite, rev)
      return NextResponse.json({ ok: true, id: idx >= 0 ? kredite[idx].id : clean.id, kredite }, NO_STORE)
    }

    if (action === 'delete-kredit') {
      const next = kredite.filter((k) => k.id !== String(b.id ?? ''))
      if (next.length === kredite.length) return NextResponse.json({ error: 'Kredit nicht gefunden.' }, { status: 404 })
      await writeKredite(next, rev)
      return NextResponse.json({ ok: true, kredite: next }, NO_STORE)
    }

    // Verlaufszeilen MERGEN (Bulk-Paste + Einzelmonat) — je Monat gewinnt der neue Wert
    if (action === 'set-verlauf') {
      const k = kredite.find((x) => x.id === String(b.id ?? ''))
      if (!k) return NextResponse.json({ error: 'Kredit nicht gefunden.' }, { status: 404 })
      const neu = cleanVerlauf(b.zeilen)
      if (!neu.length) return NextResponse.json({ error: 'Keine gültigen Zeilen (Format: Monat + Restschuld).' }, { status: 400 })
      const map = new Map<string, number>(k.verlauf.map((z) => [z.monat, z.restschuld]))
      for (const z of neu) map.set(z.monat, z.restschuld)
      k.verlauf = [...map.entries()].map(([monat, restschuld]) => ({ monat, restschuld }))
        .sort((a, b2) => a.monat.localeCompare(b2.monat)).slice(0, 600)
      await writeKredite(kredite, rev)
      return NextResponse.json({ ok: true, uebernommen: neu.length, kredite }, NO_STORE)
    }

    if (action === 'delete-monat') {
      const k = kredite.find((x) => x.id === String(b.id ?? ''))
      if (!k) return NextResponse.json({ error: 'Kredit nicht gefunden.' }, { status: 404 })
      k.verlauf = k.verlauf.filter((z) => z.monat !== String(b.monat ?? ''))
      await writeKredite(kredite, rev)
      return NextResponse.json({ ok: true, kredite }, NO_STORE)
    }

    return NextResponse.json({ error: `Unbekannte action ${action}` }, { status: 400 })
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e)
    return NextResponse.json({ error: msg }, { status: msg.startsWith('KONFLIKT') ? 409 : 500 })
  }
}
