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
  /**
   * v4 EHRLICHKEIT: was in den Ausgaben oben NICHT drinsteckt —
   * sevdesk-Entwürfe (St. 50, noch nicht gebucht) + unentschiedene
   * Inbox-Belege. Ohne diesen Ausweis wirkte die Auswertung „zu billig".
   */
  offen: { entwuerfe: number; entwuerfeSumme: number; inbox: number; inboxSumme: number; aeltestes: string | null }
  /** v4: Einnahmen-Gegenprobe aus den sevdesk-RECHNUNGEN je Monat */
  rechnungen: { m: string; g: number }[]
  /** v4: Jahre, für die Daten geladen wurden (neuestes zuerst) */
  jahre: string[]
}

const KANZEM = 'Kanzem'

/* Kanal normalisieren. REIHENFOLGE IST KRITISCH (§140-Substring-Falle):
 * Smoobus Kanalnamen enthalten sich gegenseitig — „FeWo-direkt / HomeAway"
 * enthält „direkt", „Direct booking" enthält „booking". Also von speziell
 * nach allgemein: fewo → direkt → booking. */
function normKanal(channel: string | null, source: string | null): string {
  if (source === 'trimosa') return 'direkt'
  const c = (channel ?? '').toLowerCase()
  if (/fewo|homeaway|vrbo|abritel/.test(c)) return 'fewo'
  if (/direct|direkt|website/.test(c)) return 'direkt'
  if (/airbnb/.test(c)) return 'airbnb'
  if (/hometogo/.test(c)) return 'hometogo'
  if (/booking/.test(c)) return 'booking'
  // Ohne Kanalangabe = eigene Website; ein UNBEKANNTER Kanal bekommt einen
  // eigenen Topf, statt still die Direktbuchungen aufzublähen.
  return c.trim() ? 'sonstige' : 'direkt'
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

/** v4: „1.234,56 €" aus einer Beleg-Beschreibung fischen (Entwürfe haben
 *  sumGross 0 — der Betrag steht dort nur im Text). */
function betragAusText(s: string | null): number | null {
  if (!s) return null
  const m = s.match(/(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{2}))?\s*(?:€|EUR)/i)
  if (!m) return null
  const v = Number(m[1].replace(/\./g, '') + '.' + (m[2] ?? '00'))
  return Number.isFinite(v) && v > 0 ? v : null
}

/** Abstand zweier 'JJJJ-MM' in Monaten (für den Leistungsmonats-Plausicheck). */
function monatsAbstand(a: string, b: string): number {
  const p = (s: string) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7))
  return Math.abs(p(a) - p(b))
}

export async function buildAuswertung(): Promise<AuswertungDaten> {
  // v4: Jahre dynamisch (laufendes + Vorjahr) statt hartkodiert 2026
  const jetzt = new Date()
  const jahre = [String(jetzt.getFullYear()), String(jetzt.getFullYear() - 1)]

  // 1) Einheiten: aktive Wohnungen + Kanzem (Aufbau-Standort ohne Listings)
  const { data: listings } = await supabaseAdmin
    .from('listings').select('id, title, location_group').eq('is_active', true).order('title')
  const einheiten = [
    ...(listings ?? []).map((l) => ({ id: String(l.id), titel: String(l.title), gruppe: l.location_group ? String(l.location_group) : null })),
    { id: 'kanzem', titel: 'Kanzem (Aufbau)', gruppe: KANZEM },
  ]

  // 2) Protokollzeilen je sevdesk-Beleg (range-paginiert — §129; .order()
  //    v4: sonst ist die Seiten-Aufteilung bei >1000 Zeilen undefiniert).
  //    Liefert Zuordnung, Mail-Betrag (für Entwürfe) und die KI-Analyse
  //    (v4: enthält den LEISTUNGSMONAT, falls die Vision ihn gelesen hat).
  const zuoMap = new Map<string, Zuordnung>()
  const betragMap = new Map<string, number>()
  const leistungMap = new Map<string, string>()
  for (let from = 0; from < 8000; from += 1000) {
    const { data: rows, error } = await supabaseAdmin
      .from('beleg_inbox').select('sevdesk_voucher_id, zuordnung, betrag, ki_analyse')
      .not('sevdesk_voucher_id', 'is', null)
      .order('id') // v4-Review: PK ist eindeutig — voucher_id ist es nicht
      .range(from, from + 999)
    // v4-Review: OHNE diese Prüfung fiel bei einem Query-Fehler JEDE Ausgabe
    // still auf die Gleichverteilung zurück — und das 6 h in den Cache
    if (error) throw new Error(`Zuordnungen konnten nicht geladen werden: ${error.message}`)
    for (const r of rows ?? []) {
      const id = String(r.sevdesk_voucher_id)
      if (r.zuordnung) zuoMap.set(id, r.zuordnung as Zuordnung)
      const b = Number(r.betrag)
      if (Number.isFinite(b) && b > 0) betragMap.set(id, b)
      const lm = (r.ki_analyse as { leistungsmonat?: unknown } | null)?.leistungsmonat
      if (typeof lm === 'string' && /^\d{4}-\d{2}$/.test(lm)) leistungMap.set(id, lm)
    }
    if (!rows || rows.length < 1000) break
  }

  // 3) alle sevdesk-Belege + Positionen (vollAudit §243ac; nach id dedupen —
  //    sevdesks status-Filter liefert Belege teils doppelt)
  const { belege, invoices } = await vollAudit()
  const seen = new Set<string>()
  const ausgaben: AuswertungDaten['ausgaben'] = []
  // v4: Entwürfe (St. 50) fließen NICHT in die Ausgaben — aber sie werden
  // jetzt GEZÄHLT und ausgewiesen, statt still zu verschwinden
  const offen = { entwuerfe: 0, entwuerfeSumme: 0, inbox: 0, inboxSumme: 0, aeltestes: null as string | null }
  for (const b of belege) {
    if (seen.has(b.id)) continue
    seen.add(b.id)
    if (b.st === 50) {
      offen.entwuerfe++
      // v4-Review: Entwürfe haben KEINE Positionen (sumGross 0) — der Betrag
      // steht nur im Beschreibungstext; Mail-Betrag > Beschreibung > sumGross
      offen.entwuerfeSumme += betragMap.get(b.id) ?? betragAusText(b.desc) ?? (b.gross ? Math.abs(b.gross) : 0)
      if (b.datum && (!offen.aeltestes || b.datum < offen.aeltestes)) offen.aeltestes = b.datum
      continue
    }
    if (!b.datum || !b.pos.length) continue
    // v4: LEISTUNGSMONAT schlägt das Belegdatum (Reinigungsrechnungen kommen
    // im Folgemonat — die Kosten gehören in den Monat der Leistung).
    // v4-Review: NUR bei plausibler Nähe (±3 Monate) übernehmen — sonst
    // könnte eine KI-Fehllesung den Beleg aus dem geladenen Jahresfenster
    // kippen und er verschwände KOMPLETT aus der Auswertung.
    const belegM = b.datum.slice(0, 7)
    const lm = leistungMap.get(b.id)
    const m = lm && monatsAbstand(lm, belegM) <= 3 ? lm : belegM
    if (!jahre.some((j) => m.startsWith(j))) continue
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

  // 3b) v4: unentschiedene Inbox-Belege (Drei-Firmen-Entscheidung offen) —
  //     auch die fehlen in den Ausgaben, solange sie niemand zuordnet
  try {
    const { data: inboxOffen } = await supabaseAdmin
      .from('beleg_inbox').select('betrag, beleg_datum').eq('status', 'offen').limit(500)
    for (const r of inboxOffen ?? []) {
      offen.inbox++
      const b = Number(r.betrag)
      if (Number.isFinite(b) && b > 0) offen.inboxSumme += b
      const d = r.beleg_datum ? String(r.beleg_datum).slice(0, 10) : null
      if (d && (!offen.aeltestes || d < offen.aeltestes)) offen.aeltestes = d
    }
  } catch { /* fail-soft */ }
  offen.entwuerfeSumme = Math.round(offen.entwuerfeSumme * 100) / 100
  offen.inboxSumme = Math.round(offen.inboxSumme * 100) / 100

  // 3c) v4: Einnahmen-GEGENPROBE aus den sevdesk-Rechnungen (Belegdatum =
  //     Anreisetag, §160) — Entwürfe zählen nicht
  const rechnMap = new Map<string, number>()
  const invSeen = new Set<string>()
  for (const inv of invoices) {
    if (invSeen.has(inv.id)) continue
    invSeen.add(inv.id)
    // v4-Review: bei INVOICES ist 100 der ENTWURF (erst sendBy hebt auf 200) —
    // die Voucher-Schwelle 50 gilt hier nicht. Entwürfe dürfen nicht als
    // „ausgestellte Rechnung" zählen, sonst verdecken sie genau die Lücke.
    if (!inv.datum || inv.st < 200 || inv.gross == null) continue
    const m = inv.datum.slice(0, 7)
    if (!jahre.some((j) => m.startsWith(j))) continue
    rechnMap.set(m, Math.round(((rechnMap.get(m) ?? 0) + Number(inv.gross)) * 100) / 100)
  }
  const rechnungen = [...rechnMap.entries()].map(([m, g]) => ({ m, g })).sort((a, b) => a.m.localeCompare(b.m))

  // 4) Buchungen (Einnahmen + Auslastung): confirmed, Website nur bezahlt
  //    (§234-Filter); Periodisierung = Anreisetag (wie die Rechnungen)
  const buchungen: AuswertungDaten['buchungen'] = []
  const vonJahr = jahre[jahre.length - 1]
  const bisJahr = jahre[0]
  for (let from = 0; from < 8000; from += 1000) {
    const { data: rows } = await supabaseAdmin
      .from('bookings')
      .select('id, listing_id, total_price, check_in, check_out, channel, source, payment_status, status')
      .eq('status', 'confirmed')
      .gte('check_in', `${vonJahr}-01-01`).lte('check_in', `${bisJahr}-12-31`)
      .order('id')
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

  return { stand: new Date().toISOString(), einheiten, ausgaben, buchungen, offen, rechnungen, jahre }
}

const CACHE_KEY = 'auswertung_cache'
const TTL_MS = 6 * 3600_000

/**
 * v4: Ereignis-Invalidierung — nach jeder Buchung/Umbuchung/Löschung ist der
 * 6-h-Cache veraltet (die FeWo-Brutto-Korrektur §243aj war einen halben Tag
 * unsichtbar). DELETE statt Rebuild: der nächste Aufruf baut frisch.
 */
export async function invalidateAuswertungCache(): Promise<void> {
  try { await supabaseAdmin.from('app_settings').delete().eq('key', CACHE_KEY) } catch { /* best effort */ }
}

export async function getAuswertung(refresh = false): Promise<AuswertungDaten> {
  if (!refresh) {
    try {
      const { data: row } = await supabaseAdmin
        .from('app_settings').select('value').eq('key', CACHE_KEY).maybeSingle()
      const c = row?.value as AuswertungDaten | null
      // v4: Alt-Cache ohne die neuen Felder (offen/rechnungen/jahre) wird
      // verworfen — sonst zeigte die Oberfläche bis zu 6 h leere Karten
      if (c?.stand && Date.now() - Date.parse(c.stand) < TTL_MS && c.ausgaben && c.buchungen && c.offen && c.jahre) return c
    } catch { /* Cache-Miss → frisch bauen */ }
  }
  const daten = await buildAuswertung()
  try {
    await supabaseAdmin.from('app_settings')
      .upsert({ key: CACHE_KEY, value: daten }, { onConflict: 'key' })
  } catch { /* Cache-Schreiben ist best effort */ }
  return daten
}
