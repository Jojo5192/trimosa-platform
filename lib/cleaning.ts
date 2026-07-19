/**
 * 🧹 Reinigungs-Einstellungen + Feiertage Rheinland-Pfalz.
 * Settings in app_settings 'cleaning_settings' (kein Schema-Change):
 * avoidSundays/avoidHolidays steuern die EMPFEHLUNG im Reinigungsplaner
 * (verschieben ist nur möglich, wenn kein Wechseltag ist).
 */
import { supabaseAdmin } from '@/lib/supabase-admin'

/** Voller Regel-/Satz-Block — Standard UND je-Person-Override (§117/§119). */
export interface CleaningRuleSet {
  avoidSundays: boolean
  avoidHolidays: boolean
  /** €/Stunde Reinigung (Pauschale = Ø-Minuten der Wohnung × Satz) */
  hourlyRate: number
  /** € je Anfahrt */
  travelFee: number
  /** Anfahrt je EINZELNER Reinigung abrechnen (Vertragsmodell VP Glanzteam)
      statt je Einsatztag × Standort gebündelt */
  travelPerCleaning: boolean
  /** Zuschlag in % für Sonntags-Reinigungen (auf die Pauschale) */
  sundaySurchargePct: number
  /** Zuschlag in % für gesetzliche Feiertage */
  holidaySurchargePct: number
  /** Zuschlag in % für BESONDERE Feiertage (24.12., 25./26.12., 31.12., 1.5.) */
  specialSurchargePct: number
  /** Umsatzsteuer in % (0 = Kleinunternehmer/brutto vereinbart) */
  vatPct: number
}
export interface CleaningSettings extends CleaningRuleSet {
  /** Abweichende Regeln/Sätze je Reinigungskraft (profiles-id) —
      z. B. Vanessa mit Sonntags-Zulage, Tip-Top ohne. Fehlt der Eintrag,
      gilt der Standard. */
  perPerson?: Record<string, CleaningRuleSet>
}
export const CLEANING_DEFAULTS: CleaningSettings = {
  avoidSundays: true, avoidHolidays: true,
  hourlyRate: 30, travelFee: 15, travelPerCleaning: false,
  sundaySurchargePct: 50, holidaySurchargePct: 100, specialSurchargePct: 100, vatPct: 0,
}

/** Besondere Feiertage mit eigenem Zuschlag (VP-Glanzteam-Vertrag §4.3):
    Heiligabend, 1./2. Weihnachtstag, Silvester, Tag der Arbeit. */
export function isSpecialDay(iso: string): boolean {
  const md = iso.slice(5) // 'MM-DD'
  return md === '12-24' || md === '12-25' || md === '12-26' || md === '12-31' || md === '05-01'
}

export async function getCleaningSettings(): Promise<CleaningSettings> {
  try {
    const { data } = await supabaseAdmin
      .from('app_settings').select('value').eq('key', 'cleaning_settings').maybeSingle()
    return { ...CLEANING_DEFAULTS, ...((data?.value ?? {}) as Partial<CleaningSettings>) }
  } catch {
    return CLEANING_DEFAULTS
  }
}

/** Effektive Regeln/Sätze für eine Person (null/unbekannt → Standard).
    Overrides werden über die Defaults gemerged — ältere Overrides ohne die
    neuen Felder (§119) bekommen so automatisch sinnvolle Werte. */
export function resolveCleaningFor(all: CleaningSettings, personId: string | null | undefined): CleaningRuleSet {
  const base: CleaningRuleSet = {
    avoidSundays: all.avoidSundays, avoidHolidays: all.avoidHolidays,
    hourlyRate: all.hourlyRate, travelFee: all.travelFee,
    travelPerCleaning: all.travelPerCleaning ?? false,
    sundaySurchargePct: all.sundaySurchargePct, holidaySurchargePct: all.holidaySurchargePct,
    specialSurchargePct: all.specialSurchargePct ?? all.holidaySurchargePct,
    vatPct: all.vatPct ?? 0,
  }
  const o = personId ? all.perPerson?.[personId] : undefined
  return o ? { ...base, ...o } : base
}

/** Ostersonntag (Gauß / anonymer gregorianischer Algorithmus). */
function easter(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const offset = (d: Date, days: number) => new Date(d.getTime() + days * 86400_000)

/** Gesetzliche Feiertage in Rheinland-Pfalz für ein Jahr (ISO-Daten). */
export function holidaysRLP(year: number): string[] {
  const e = easter(year)
  return [
    `${year}-01-01`,                 // Neujahr
    iso(offset(e, -2)),              // Karfreitag
    iso(offset(e, 1)),               // Ostermontag
    `${year}-05-01`,                 // Tag der Arbeit
    iso(offset(e, 39)),              // Christi Himmelfahrt
    iso(offset(e, 50)),              // Pfingstmontag
    iso(offset(e, 60)),              // Fronleichnam
    `${year}-10-03`,                 // Tag der Deutschen Einheit
    `${year}-11-01`,                 // Allerheiligen
    `${year}-12-25`,                 // 1. Weihnachtstag
    `${year}-12-26`,                 // 2. Weihnachtstag
  ]
}

/** Alle RLP-Feiertage im Fenster [fromIso, fromIso + days]. */
export function holidaysInRange(fromIso: string, days: number): string[] {
  const from = new Date(fromIso + 'T00:00:00Z')
  const to = offset(from, days)
  const years = new Set([from.getUTCFullYear(), to.getUTCFullYear()])
  const all = [...years].flatMap((y) => holidaysRLP(y))
  const toIso = iso(to)
  return all.filter((h) => h >= fromIso && h <= toIso).sort()
}
