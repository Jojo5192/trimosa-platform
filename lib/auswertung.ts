import { supabaseAdmin } from '@/lib/supabase-admin'
import { vollAudit } from '@/lib/sevdesk'

/**
 * 📊 AUSWERTUNG (§243ae) — der Daten-Kern des Statistik-Bereichs:
 * sammelt Ausgaben (sevdesk-Belege + Positionen), löst die INTERNE
 * Wohnungs-Zuordnung in €-Anteile je Einheit auf (Doktrin §243o: KEIN
 * „Allgemein" — Allgemeinkosten werden GLEICHMÄSSIG auf alle Wohnungen
 * verteilt; Kanzem = eigene Aufbau-Einheit ohne Listings) und liefert
 * die Buchungen (Einnahmen + Auslastung) als kompakten Datensatz.
 * Cache in app_settings 'auswertung_cache' (TTL 6 h, ?refresh=1 frisch) —
 * der Client filtert/aggregiert dann instant ohne weitere API-Calls.
 *
 * Konten-Doktrin: sevdesk bleibt SKR/EÜR-treu — die verständlichen
 * GRUPPEN („Reinigung/Energie/Portale/IT …") leben NUR hier.
 */

export interface AuswertungDaten {
  stand: string
  /** Einheiten: alle aktiven Wohnungen + Kanzem als letzte Einheit */
  einheiten: { id: string; titel: string; gruppe: string | null }[]
  /**
   * Ausgaben-Zeilen (je Beleg-Position): m = 'JJJJ-MM', nr = SKR-Konto,
   * g = Brutto SIGNIERT (D-Belege/Gutschriften negativ),
   * e = Einheiten-Anteile { "<einheitenIndex>": 0..1 }, lief = Lieferant
   */
  ausgaben: { m: string; nr: string; name: string; g: number; e: Record<string, number>; lief: string }[]
  /**
   * Buchungs-Zeilen: l = Einheiten-Index, ci/co = Zeitraum, p = Brutto,
   * k = Kanal (booking|airbnb|fewo|hometogo|direkt)
   */
  buchungen: { l: number; ci: string; co: string; p: number; k: string }[]
}

const KANZEM = 'Kanzem'

/** Kanal normalisieren — §140-Falle: direct VOR booking prüfen! */
function normKanal(channel: string | null, source: string | null): string {
  if (source === 'trimosa') return 'direkt'
  const c = (channel ?? '').toLowerCase()
  if (/direct|direkt|website/.test(c)) return 'direkt'
  if (/fewo|homeaway|vrbo|abritel/.test(c)) return 'fewo'
  if (/airbnb/.test(c)) return 'airbnb'
  if (/hometogo/.test(c)) return 'hometogo'
  if (/booking/.test(c)) return 'booking'
  return 'direkt'
}

interface Zuordnung { modus?: string; standort?: string; listingIds?: string[]; anteile?: number[] }

/**
 * Interne Zuordnung → Anteile je Einheiten-INDEX (kompakt fürs JSON).
 * Fallback-Kette: zuordnung > sevdesk-KSt > Gleichverteilung auf alle
 * Wohnungen (Kanzem zählt bei der Gleichverteilung NICHT mit — Aufbau).
 */
function anteileFuer(
  zuo: Zuordnung | null, kst: string | null,
  einheiten: { id: string; titel: string; gruppe: string | null }[],
): Record<string, number> {
  const wohnIdx = einheiten.map((e, i) => ({ ...e, i })).filter((e) => e.id !== 'kanzem')
  const kanzemIdx = einheiten.findIndex((e) => e.id === 'kanzem')
  const gleichAlle = (): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const w of wohnIdx) out[String(w.i)] = 1 / wohnIdx.length
    return out
  }
  const fuerStandort = (standort: string): Record<string, number> => {
    if (standort === KANZEM && kanzemIdx >= 0) return { [String(kanzemIdx)]: 1 }
    const gruppe = wohnIdx.filter((w) => w.gruppe === standort || w.titel === standort)
    if (!gruppe.length) return gleichAlle()
    const out: Record<string, number> = {}
    for (const w of gruppe) out[String(w.i)] = 1 / gruppe.length
    return out
  }

  if (zuo?.modus === 'wohnung' || zuo?.modus === 'split') {
    const ids = (zuo.listingIds ?? []).map((id) => wohnIdx.find((w) => w.id === id)).filter(Boolean) as (typeof wohnIdx[number])[]
    if (ids.length) {
      const ant = zuo.anteile?.length === ids.length ? zuo.anteile : ids.map(() => 1)
      const sum = ant.reduce((a, b) => a + (b > 0 ? b : 0), 0) || ids.length
      const out: Record<string, number> = {}
      ids.forEach((w, i) => { out[String(w.i)] = (ant[i] > 0 ? ant[i] : 1) / sum })
      return out
    }
  }
  if (zuo?.modus === 'standort' && zuo.standort) return fuerStandort(zuo.standort)
  if (zuo?.modus === 'allgemein') return gleichAlle()

  // kein zuordnung-Eintrag → sevdesk-KSt als Hinweis (Standort-Doktrin §240)
  if (kst && kst !== 'Allgemein') return fuerStandort(kst)
  return gleichAlle()
}

export async function buildAuswertung(): Promise<AuswertungDaten> {
  // 1) Einheiten: aktive Wohnungen + Kanzem (Aufbau-Standort ohne Listings)
  const { data: listings } = await supabaseAdmin
    .from('listings').select('id, title, location_group').eq('is_active', true).order('title')
  const einheiten = [
    ...(listings ?? []).map((l) => ({ id: String(l.id), titel: String(l.title), gruppe: l.location_group ? String(l.location_group) : null })),
    { id: 'kanzem', titel: 'Kanzem (Aufbau)', gruppe: KANZEM },
  ]

  // 2) interne Zuordnungen je sevdesk-Beleg (range-paginiert — §129!)
  const zuoMap = new Map<string, Zuordnung>()
  for (let from = 0; from < 5000; from += 1000) {
    const { data: rows } = await supabaseAdmin
      .from('beleg_inbox').select('sevdesk_voucher_id, zuordnung')
      .not('sevdesk_voucher_id', 'is', null).not('zuordnung', 'is', null)
      .range(from, from + 999)
    for (const r of rows ?? []) zuoMap.set(String(r.sevdesk_voucher_id), r.zuordnung as Zuordnung)
    if (!rows || rows.length < 1000) break
  }

  // 3) alle sevdesk-Belege + Positionen (vollAudit §243ac; nach id dedupen —
  //    sevdesks status-Filter liefert Belege teils doppelt)
  const { belege } = await vollAudit()
  const seen = new Set<string>()
  const ausgaben: AuswertungDaten['ausgaben'] = []
  for (const b of belege) {
    if (seen.has(b.id)) continue
    seen.add(b.id)
    if (!b.datum || !b.pos.length) continue
    if (b.st === 50) continue // Entwürfe sind noch nicht gebucht
    const m = b.datum.slice(0, 7)
    if (!m.startsWith('2026') && !m.startsWith('2025')) continue
    const vz = b.cd === 'D' ? -1 : 1
    // §243ae: Positions-Leichen-Schutz — die Reset-Zyklen können alte
    // VoucherPos hinterlassen haben; der Beleg-sumGross ist autoritativ →
    // weicht Σpos ab, werden die Positionen proportional darauf normiert
    const posSum = b.pos.reduce((s, p) => s + p.g, 0)
    const soll = b.gross != null ? Math.abs(b.gross) : null
    const faktor = soll != null && soll > 0 && posSum > 0 && Math.abs(posSum - soll) > 0.05
      ? soll / posSum : 1
    const e = anteileFuer(zuoMap.get(b.id) ?? null, b.kst, einheiten)
    for (const p of b.pos) {
      if (!p.g) continue
      ausgaben.push({ m, nr: p.nr, name: p.name, g: Math.round(p.g * faktor * vz * 100) / 100, e, lief: (b.lief ?? '?').slice(0, 40) })
    }
  }

  // 4) Buchungen 2026 (Einnahmen + Auslastung): confirmed, Website nur
  //    bezahlt (§234-Filter); Periodisierung = Anreisetag (wie die Rechnungen)
  const buchungen: AuswertungDaten['buchungen'] = []
  for (let from = 0; from < 5000; from += 1000) {
    const { data: rows } = await supabaseAdmin
      .from('bookings')
      .select('listing_id, total_price, check_in, check_out, channel, source, payment_status, status')
      .eq('status', 'confirmed')
      .gte('check_in', '2026-01-01').lte('check_in', '2026-12-31')
      .range(from, from + 999)
    for (const r of rows ?? []) {
      if (r.source === 'trimosa' && r.payment_status !== 'paid') continue
      const idx = einheiten.findIndex((e) => e.id === String(r.listing_id))
      if (idx < 0) continue
      const p = Number(r.total_price ?? 0)
      buchungen.push({
        l: idx, ci: String(r.check_in), co: String(r.check_out),
        p: Math.round(p * 100) / 100,
        k: normKanal(r.channel ? String(r.channel) : null, r.source ? String(r.source) : null),
      })
    }
    if (!rows || rows.length < 1000) break
  }

  return { stand: new Date().toISOString(), einheiten, ausgaben, buchungen }
}

const CACHE_KEY = 'auswertung_cache'
const TTL_MS = 6 * 3600_000

export async function getAuswertung(refresh = false): Promise<AuswertungDaten> {
  if (!refresh) {
    try {
      const { data: row } = await supabaseAdmin
        .from('app_settings').select('value').eq('key', CACHE_KEY).maybeSingle()
      const c = row?.value as AuswertungDaten | null
      if (c?.stand && Date.now() - Date.parse(c.stand) < TTL_MS && c.ausgaben && c.buchungen) return c
    } catch { /* Cache-Miss → frisch bauen */ }
  }
  const daten = await buildAuswertung()
  try {
    await supabaseAdmin.from('app_settings')
      .upsert({ key: CACHE_KEY, value: daten }, { onConflict: 'key' })
  } catch { /* Cache-Schreiben ist best effort */ }
  return daten
}
