/**
 * 🧭 „Häufig" im Reiter Mehr (Pascal, Chefsache 7.10.2026 „Informationsarchitektur").
 *
 * Oben stehen höchstens vier meistgenutzte Funktionen. Gezählt wird je Gerät (localStorage,
 * components/team/SettingsPanel.tsx); ohne genug Daten greifen Vorgaben je Rolle. Reine
 * Funktionen ohne DOM — ein Node-Skript kann sie direkt testen.
 *
 * Regeln:
 *  - nur Einträge, die die Rolle überhaupt sieht (verfuegbar) — Rechte bleiben unangetastet
 *  - ein Eintrag zählt erst ab 2 Öffnungen als „genutzt" (ein Fehlgriff verdrängt keine Vorgabe)
 *  - Rest mit den Vorgaben der Rolle auffüllen, dann mit den übrigen Einträgen
 *  - Anzeige in der festen Reihenfolge der Liste (Kacheln springen nicht bei jedem Zählerstand)
 *  - bei wenigen Einträgen (z. B. Dienstleister) keine Häufig-Leiste — sie würde nur wiederholen
 *  - Zähler altern: übersteigt einer den Deckel, werden alle halbiert (neue Gewohnheiten setzen sich durch)
 */

export type MehrZaehler = Record<string, number>

export const HAEUFIG_MAX = 4
/** Darunter keine Häufig-Leiste */
export const HAEUFIG_MIN_EINTRAEGE = 6
/** Ab so vielen Öffnungen gilt ein Eintrag als genutzt */
export const HAEUFIG_MIN_OEFFNUNGEN = 2
export const ZAEHLER_DECKEL = 60

/** Rohwert aus localStorage (JSON) in saubere Zähler verwandeln — alles Fremde fliegt raus */
export function bereinigeZaehler(roh: unknown): MehrZaehler {
  const out: MehrZaehler = {}
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return out
  for (const [k, v] of Object.entries(roh as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0 && k.length <= 40) out[k] = Math.floor(v)
  }
  return out
}

/** Eine Öffnung zählen; übersteigt ein Zähler den Deckel, werden alle halbiert */
export function zaehleOeffnung(z: MehrZaehler, key: string): MehrZaehler {
  const neu: MehrZaehler = { ...z, [key]: (z[key] ?? 0) + 1 }
  if (neu[key] > ZAEHLER_DECKEL) {
    for (const k of Object.keys(neu)) {
      const h = Math.floor(neu[k] / 2)
      if (h > 0) neu[k] = h
      else delete neu[k]
    }
  }
  return neu
}

/** Die Häufig-Auswahl: höchstens `max` Schlüssel aus `verfuegbar`, in Listen-Reihenfolge */
export function waehleHaeufig(
  verfuegbar: readonly string[],
  zaehler: MehrZaehler,
  vorgabe: readonly string[],
  max: number = HAEUFIG_MAX,
): string[] {
  if (verfuegbar.length < HAEUFIG_MIN_EINTRAEGE || max <= 0) return []
  const pos = (k: string) => verfuegbar.indexOf(k)
  const rang = (k: string) => { const i = vorgabe.indexOf(k); return i < 0 ? Number.MAX_SAFE_INTEGER : i }
  const genutzt = verfuegbar
    .filter((k) => (zaehler[k] ?? 0) >= HAEUFIG_MIN_OEFFNUNGEN)
    .sort((a, b) => (zaehler[b] ?? 0) - (zaehler[a] ?? 0) || rang(a) - rang(b) || pos(a) - pos(b))
  const out: string[] = genutzt.slice(0, max)
  for (const k of [...vorgabe, ...verfuegbar]) {
    if (out.length >= max) break
    if (pos(k) >= 0 && !out.includes(k)) out.push(k)
  }
  return out.sort((a, b) => pos(a) - pos(b))
}
