import { NextRequest, NextResponse } from 'next/server'
import { getTaskAuth } from '@/lib/tasks'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  MATERIAL_STANDORTE, MATERIAL_KATEGORIEN, getMaterialConfig, saveMaterialConfig,
  getBedarf, addBedarf, setBedarfStatus, cartUrl, analysiereFreitext,
  type MaterialConfig, type MaterialArtikel,
} from '@/lib/material'

/**
 * 🛒 §266f/§267b Material-Bereich (Team-App, Mehr-Tab). Sichtbar für ALLE
 * Team-Rollen inkl. Dienstleister (Julia putzt!) — Merklisten-/Adress-
 * Pflege nur Admins/Gastgeber. Hauptweg = Panel (Merkliste + Freitext-KI),
 * Chat-Gruppe ist optionaler Bonus.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const STATUS_OK = ['offen', 'bestellt', 'aufgefuellt', 'entfernt'] as const

/** Merklisten-Shape serverseitig erzwingen — ein Eintrag ohne name würde
 *  sonst jeden Cron-Lauf mit TypeError crashen (Review-Fund §266f). */
function sanitizeArtikel(raw: unknown): MaterialArtikel[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && typeof (a as { name?: unknown }).name === 'string' && !!String((a as { name?: unknown }).name).trim())
    .slice(0, 120)
    .map((a) => {
      const menge = Math.min(99, Math.max(1, Math.round(Number(a.menge)) || 1))
      const url = typeof a.url === 'string' ? a.url.trim().slice(0, 300) : ''
      const bild = typeof a.bild === 'string' ? a.bild.trim().slice(0, 400) : ''
      const kategorie = typeof a.kategorie === 'string' && (MATERIAL_KATEGORIEN as readonly string[]).includes(a.kategorie) ? a.kategorie : ''
      return {
        id: typeof a.id === 'string' && a.id ? a.id.slice(0, 20) : Math.random().toString(36).slice(2, 10),
        name: String(a.name).trim().slice(0, 60),
        ...(kategorie ? { kategorie } : {}),
        ...(url && /^https:\/\//.test(url) ? { url } : {}),
        ...(bild && /^https:\/\//.test(bild) ? { bild } : {}),
        ...(typeof a.asin === 'string' && a.asin.trim() ? { asin: a.asin.trim().slice(0, 20) } : {}),
        ...(menge > 1 ? { menge } : {}),
      }
    })
}

function sanitizeAdressen(raw: unknown): Record<string, { label: string; hinweis?: string }> {
  const out: Record<string, { label: string; hinweis?: string }> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const s of MATERIAL_STANDORTE) {
    const a = (raw as Record<string, unknown>)[s]
    if (!a || typeof a !== 'object') continue
    const label = String((a as { label?: unknown }).label ?? '').trim().slice(0, 80)
    if (!label) continue
    const hinweis = String((a as { hinweis?: unknown }).hinweis ?? '').trim().slice(0, 120)
    out[s] = { label, ...(hinweis ? { hinweis } : {}) }
  }
  return out
}

export async function GET(req: NextRequest) {
  const auth = await getTaskAuth()
  if (!auth) return NextResponse.json({ error: 'Nicht berechtigt' }, { status: 403 })
  if (req.nextUrl.searchParams.get('probe')) return NextResponse.json({ ok: true })
  const cfg = await getMaterialConfig()
  const bedarf = await getBedarf()
  // Amazon-Sammelkorb je Standort (nur offene Artikel mit ASIN)
  const links: Record<string, string | null> = {}
  for (const s of MATERIAL_STANDORTE) {
    const items = bedarf
      .filter((e) => e.status === 'offen' && e.standort === s)
      .map((e) => cfg.artikel.find((a) => a.id === e.artikelId || a.name.toLowerCase() === e.name.toLowerCase()))
      .filter((a): a is NonNullable<typeof a> => !!a?.asin)
      .map((a) => ({ asin: a.asin!, menge: a.menge ?? 1 }))
    links[s] = cartUrl(items)
  }
  return NextResponse.json({
    standorte: MATERIAL_STANDORTE,
    artikel: cfg.artikel,
    adressen: cfg.adressen,
    gruppeId: cfg.gruppeId ?? null,
    merklisteUrl: cfg.merklisteUrl ?? null,
    bedarf,
    links,
    admin: auth.role === 'admin',
  }, { headers: { 'Cache-Control': 'no-store' } })
}

/** Freitext-Analyse („Etwas Besonderes?") — KI schlägt vor, der MELDER
 *  bestätigt danach selbst per normalem melden-PATCH (nie Auto-Add). */
export async function POST(req: NextRequest) {
  const auth = await getTaskAuth()
  if (!auth) return NextResponse.json({ error: 'Nicht berechtigt' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const text = typeof b.analyse === 'string' ? b.analyse.trim() : ''
  if (!text || text.length < 3) return NextResponse.json({ error: 'Bitte kurz beschreiben, was fehlt.' }, { status: 400 })
  if (!(await checkRateLimit(`material-ki:${auth.userId}`, 30, 3600))) {
    return NextResponse.json({ error: 'Zu viele Anfragen — bitte später erneut.' }, { status: 429 })
  }
  try {
    const v = await analysiereFreitext(text)
    return NextResponse.json({ ok: true, vorschlag: v })
  } catch (e) {
    return NextResponse.json({ error: 'Analyse fehlgeschlagen: ' + String(e instanceof Error ? e.message : e) }, { status: 502 })
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await getTaskAuth()
  if (!auth) return NextResponse.json({ error: 'Nicht berechtigt' }, { status: 403 })
  const b = await req.json().catch(() => ({}))

  // Status-Wechsel (alle Rollen — Vanessa hakt „aufgefüllt" selbst ab)
  if (typeof b.bedarfId === 'string' && typeof b.status === 'string') {
    if (!STATUS_OK.includes(b.status as typeof STATUS_OK[number])) {
      return NextResponse.json({ error: 'Ungültiger Status' }, { status: 400 })
    }
    const ok = await setBedarfStatus(b.bedarfId, b.status as typeof STATUS_OK[number])
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 })
  }

  // Bedarf melden (alle Rollen — Merklisten-Tap oder bestätigter KI-Vorschlag)
  if (typeof b.melden === 'object' && b.melden) {
    const m = b.melden as { standort?: string; name?: string }
    if (!MATERIAL_STANDORTE.includes(m.standort as typeof MATERIAL_STANDORTE[number]) || !m.name?.trim()) {
      return NextResponse.json({ error: 'Standort und Artikel erforderlich' }, { status: 400 })
    }
    const cfg = await getMaterialConfig()
    const art = cfg.artikel.find((a) => a.name.toLowerCase() === m.name!.trim().toLowerCase())
    const { data: prof } = await supabaseAdmin
      .from('profiles').select('display_name').eq('id', auth.userId).maybeSingle()
    const vorname = (prof?.display_name ?? 'Team').split(/\s+/)[0]
    const res = await addBedarf([{
      standort: m.standort!, artikelId: art?.id, name: art?.name ?? m.name!.trim().slice(0, 60),
    }], vorname)
    return NextResponse.json({ ok: true, neu: res.neu.length, schonDa: res.schonDa })
  }

  // Merkliste/Adressen/Gruppe pflegen — nur Admins/Gastgeber; EIN
  // gebündelter Save (zwei sequenzielle Saves = Lost-Update-Fenster)
  if (auth.role !== 'admin') return NextResponse.json({ error: 'Nur Admins' }, { status: 403 })
  const patch: Partial<MaterialConfig> = {}
  if (Array.isArray(b.artikel)) patch.artikel = sanitizeArtikel(b.artikel)
  if (b.adressen && typeof b.adressen === 'object') patch.adressen = sanitizeAdressen(b.adressen)
  if (typeof b.gruppeId === 'string' && b.gruppeId) patch.gruppeId = b.gruppeId.slice(0, 60)
  if (typeof b.merklisteUrl === 'string') {
    const u = b.merklisteUrl.trim().slice(0, 300)
    patch.merklisteUrl = /^https:\/\//.test(u) ? u : undefined
  }
  if (Object.keys(patch).length) await saveMaterialConfig(patch)
  return NextResponse.json({ ok: true })
}
