/**
 * 🌙 Ruhezeiten für Push-Mitteilungen (Pascal, Chefsache 7.10.2026 „Mitteilungs-Design").
 *
 * Reine Funktionen OHNE Server-Abhängigkeiten — lib/push.ts (Senden + Nacht-Warteschlange),
 * /api/push/prefs (Prüfung der Eingabe), /api/push/morgen (Sammel-Mitteilung) und die
 * Einstellungen in der App (Erklärsatz) teilen sie sich; ein Node-Skript kann sie direkt testen.
 *
 * Regel: je Nutzer profiles.push_prefs.ruhe = { an, von, bis } (volle Stunden, Europe/Berlin),
 * Standard AN 22–7 Uhr. In der Ruhezeit gehen NICHT dringende Mitteilungen nicht aufs Gerät,
 * sondern in die Warteschlange (app_settings push_nacht:<userId>); nach der Ruhezeit kommt EINE
 * Sammel-Mitteilung. Dringend und IMMER sofort: Gastnachrichten, Anrufe, Störungen/Zutritt.
 * Pushes ganz ohne Kategorie: sofort (wie vor den Ruhezeiten).
 */
import type { PushCategory } from '@/lib/push'

export interface Ruhezeit { an: boolean; von: number; bis: number }

/** Standard für alle, die nichts eingestellt haben: AN, 22–7 Uhr */
export const RUHE_STANDARD: Readonly<Ruhezeit> = { an: true, von: 22, bis: 7 }

/** Dringend = kommt immer sofort durch, auch in der Ruhezeit (Gastnachrichten, Anrufe/Notfälle, Störungen/Zutritt/Überbuchung) */
export const DRINGENDE_KATEGORIEN: readonly PushCategory[] = ['guestChats', 'calls', 'system']

/** Ohne Kategorie = sofort (wie bisher) */
export function istDringend(kategorie?: PushCategory | null): boolean {
  return !kategorie || DRINGENDE_KATEGORIEN.includes(kategorie)
}

const istStunde = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 23

/** Eingabe prüfen (PATCH /api/push/prefs): nur vollständig und gültig — sonst null */
export function ruheGueltig(x: unknown): Ruhezeit | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null
  const r = x as Record<string, unknown>
  if (typeof r.an !== 'boolean' || !istStunde(r.von) || !istStunde(r.bis)) return null
  return { an: r.an, von: r.von, bis: r.bis }
}

/** Gespeicherte Einstellung aus push_prefs lesen — fehlt sie oder ist sie kaputt: Standard */
export function ruheAusPrefs(prefs: unknown): Ruhezeit {
  const roh = prefs && typeof prefs === 'object' ? (prefs as Record<string, unknown>).ruhe : undefined
  return ruheGueltig(roh) ?? { ...RUHE_STANDARD }
}

/** Gleich dem Standard? Dann muss nichts gespeichert werden (wie bei den Kategorien: nur Abweichungen) */
export function istRuheStandard(r: Ruhezeit): boolean {
  return r.an === RUHE_STANDARD.an && r.von === RUHE_STANDARD.von && r.bis === RUHE_STANDARD.bis
}

/** Aktuelle Stunde 0–23 in Europe/Berlin — Sommer-/Winterzeit übernimmt Intl */
export function berlinStunde(jetzt: Date = new Date()): number {
  const teil = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: 'numeric', hourCycle: 'h23' })
    .formatToParts(jetzt).find((p) => p.type === 'hour')
  return Number(teil?.value ?? 0) % 24
}

/** Liegt die Stunde in der Ruhezeit? von gilt ab voller Stunde, bis endet zur vollen Stunde (22–7 = 22:00 bis 6:59).
 *  Über Mitternacht möglich; von = bis heißt: keine Ruhezeit. */
export function inRuhezeit(r: Ruhezeit, stunde: number): boolean {
  if (!r.an || r.von === r.bis) return false
  return r.von < r.bis ? stunde >= r.von && stunde < r.bis : stunde >= r.von || stunde < r.bis
}

/** Diese Mitteilung jetzt zurückhalten? (nicht dringend UND Ruhezeit des Nutzers) */
export function zurueckhalten(r: Ruhezeit, kategorie: PushCategory | null | undefined, jetzt: Date = new Date()): boolean {
  return !istDringend(kategorie) && inRuhezeit(r, berlinStunde(jetzt))
}

/** Erklärsatz für die Einstellungen in der App */
export function ruheErklaerung(r: Ruhezeit): string {
  if (!r.an) return 'Aus — alle Mitteilungen kommen sofort, auch nachts.'
  if (r.von === r.bis) return 'Von und Bis sind gleich — so gibt es keine Ruhezeit.'
  const danach = r.bis >= 4 && r.bis <= 11 ? 'morgens' : 'danach'
  return `Zwischen ${r.von} und ${r.bis} Uhr kommen nur Gastnachrichten, Anrufe und Störungen sofort — alles andere ${danach} gesammelt.`
}

/* ── Nacht-Warteschlange (app_settings push_nacht:<userId>, KEINE Migration) ─────────────────────── */

export const NACHT_PREFIX = 'push_nacht:'
/** Höchstens so viele Einträge je Nutzer — was darüber hinausgeht, zählt nur noch in „N Mitteilungen" mit */
export const NACHT_MAX = 50
/** Ziel der Sammel-Mitteilung: „Mehr" mit geöffnetem Mitteilungs-Verlauf (dort stehen alle Mitteilungen einzeln) */
export const MORGEN_URL = '/team?tab=einstellungen&verlauf=1'

export interface NachtEintrag { titel: string; text: string; url: string; kategorie: PushCategory | null; zeit: string }
/** v = Versionszähler fürs konfliktfreie Anhängen, weitere = über NACHT_MAX hinaus nicht gespeicherte Mitteilungen */
export interface NachtWarteschlange { v: number; eintraege: NachtEintrag[]; weitere: number }

/** Gespeicherten Wert robust lesen (fehlt/kaputt → leere Warteschlange) */
export function nachtLesen(value: unknown): NachtWarteschlange {
  const v = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const eintraege = (Array.isArray(v.eintraege) ? v.eintraege : [])
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && typeof (e as Record<string, unknown>).titel === 'string')
    .map((e) => ({
      titel: String(e.titel), text: String(e.text ?? ''), url: String(e.url ?? MORGEN_URL),
      kategorie: (typeof e.kategorie === 'string' ? e.kategorie : null) as PushCategory | null,
      zeit: String(e.zeit ?? ''),
    }))
  const ver = Number(v.v)
  return { v: Number.isInteger(ver) && ver > 0 ? ver : 0, eintraege, weitere: Math.max(0, Math.floor(Number(v.weitere) || 0)) }
}

/** Eintrag anhängen — die ersten NACHT_MAX bleiben erhalten (Reihenfolge der Nacht), der Rest wird nur gezählt */
export function nachtEinreihen(q: NachtWarteschlange, e: NachtEintrag): NachtWarteschlange {
  if (q.eintraege.length >= NACHT_MAX) return { v: q.v + 1, eintraege: q.eintraege, weitere: q.weitere + 1 }
  return { v: q.v + 1, eintraege: [...q.eintraege, e], weitere: q.weitere }
}

/** Kürzen nach Zeichen (nicht UTF-16-Einheiten — Emojis bleiben heil) */
export function kuerze(s: string, max: number): string {
  const z = Array.from(String(s ?? '').replace(/\s+/g, ' ').trim())
  return z.length <= max ? z.join('') : z.slice(0, Math.max(1, max - 1)).join('').trimEnd() + '…'
}

/**
 * Sammel-Mitteilung nach der Ruhezeit: Titel „🌅 Über Nacht: N Mitteilungen", Text = die ersten (bis zu 3)
 * Titel kurz, gleiche Titel zusammengefasst („(2×)"). Bei genau einer Mitteilung steht sie vollständig da.
 * null = nichts zu melden.
 */
export function sammelMitteilung(q: NachtWarteschlange): { title: string; body: string } | null {
  const n = q.eintraege.length + q.weitere
  if (!n) return null
  const title = `🌅 Über Nacht: ${n} ${n === 1 ? 'Mitteilung' : 'Mitteilungen'}`
  if (n === 1 && q.eintraege.length === 1) {
    const e = q.eintraege[0]
    return { title, body: kuerze(e.text ? `${e.titel}: ${e.text}` : e.titel, 120) }
  }
  const gruppen = new Map<string, number>()
  for (const e of q.eintraege) gruppen.set(e.titel, (gruppen.get(e.titel) ?? 0) + 1)
  const teile: string[] = []
  let gezeigt = 0
  for (const [t, k] of gruppen) {
    if (teile.length >= 3) break
    teile.push(kuerze(t, 32) + (k > 1 ? ` (${k}×)` : ''))
    gezeigt += k
  }
  const rest = n - gezeigt
  return { title, body: teile.join(' · ') + (rest > 0 ? ` · +${rest} weitere` : '') }
}
