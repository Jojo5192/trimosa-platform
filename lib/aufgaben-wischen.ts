/**
 * 👆 Wisch-Gesten auf Aufgaben-Karten (Pascal, Chefsache 7.10.2026 „Gesten").
 *
 * Nach links wischen = erledigt, nach rechts = auf morgen verschieben. Hier steht nur die
 * reine Entscheidungs-Logik (Achse, Schwelle, Geschwindigkeit, neues Datum) OHNE DOM und
 * ohne React — components/team/TasksPanel.tsx nutzt sie, ein Node-Skript kann sie direkt testen.
 *
 * Schutz gegen versehentliches Auslösen:
 *  - Start nicht am linken Bildschirmrand (dort liegt die Zurück-Wischgeste, useSwipeBack: 32 px)
 *  - Achse erst nach ~10 px entscheiden; senkrecht hat Vorrang (Scrollen), waagerecht nur bei
 *    klar flachem Winkel — danach ist die Achse für diese Berührung gesperrt
 *  - Auslösen erst ab der Schwelle (35 % der Kartenbreite, mindestens 96 px, höchstens 150 px)
 *    ODER bei einem schnellen Wisch in dieselbe Richtung, der schon ein Stück gezogen wurde
 *  - eine gesperrte Richtung (fehlendes Recht) federt nur kurz und löst nie aus
 */

export type WischRichtung = 'erledigt' | 'morgen'
export type WischErlaubt = Readonly<Record<WischRichtung, boolean>>

/** Startpunkte links davon gehören der Zurück-Geste (wie useSwipeBack) */
export const WISCH_RAND_PX = 32
/** Ab so viel Bewegung wird die Achse entschieden */
export const WISCH_ACHSE_PX = 10
/** Waagerecht nur, wenn |dx| deutlich größer als |dy| ist (≈ flacher als 40°) */
export const WISCH_ACHSE_FAKTOR = 1.2
export const WISCH_MIN_PX = 96
export const WISCH_MAX_PX = 150
export const WISCH_ANTEIL = 0.35
/** Schneller Wisch: ab 0,6 px/ms (≈ 600 px/s) … */
export const WISCH_TEMPO = 0.6
/** … und erst, wenn mindestens so weit gezogen wurde */
export const WISCH_TEMPO_MIN_PX = 48
/** Gesperrte Richtung: Gummiband mit höchstens so viel Versatz */
export const WISCH_GUMMI_MAX_PX = 24

/** Darf an dieser x-Position (clientX) eine Wisch-Geste beginnen? */
export function wischStartErlaubt(startX: number, randPx: number = WISCH_RAND_PX): boolean {
  return Number.isFinite(startX) && startX >= randPx
}

/** Achse festlegen: 'h' = waagerecht (Wischen), 'v' = senkrecht (Scrollen), null = noch zu wenig Bewegung */
export function wischAchse(dx: number, dy: number, schwelle: number = WISCH_ACHSE_PX): 'h' | 'v' | null {
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (Math.max(ax, ay) < schwelle) return null
  return ax > ay * WISCH_ACHSE_FAKTOR ? 'h' : 'v'
}

/** Welche Aktion zeigt ein Versatz an? Links (dx < 0) = erledigt, rechts (dx > 0) = morgen */
export function wischRichtung(dx: number): WischRichtung | null {
  if (dx < 0) return 'erledigt'
  if (dx > 0) return 'morgen'
  return null
}

/** Einrast-Schwelle in px: 35 % der Kartenbreite, mindestens 96 px, höchstens 150 px */
export function wischSchwelle(breite: number): number {
  const b = Number.isFinite(breite) && breite > 0 ? breite : 0
  return Math.round(Math.min(WISCH_MAX_PX, Math.max(WISCH_MIN_PX, b * WISCH_ANTEIL)))
}

/** Sichtbarer Versatz der Karte: erlaubte Richtung folgt dem Finger (höchstens Kartenbreite),
 *  gesperrte Richtung federt nur leicht (Gummiband) — so merkt man, dass dort nichts geht. */
export function wischVersatz(dx: number, erlaubt: WischErlaubt, breite: number): number {
  const r = wischRichtung(dx)
  if (!r) return 0
  const s = Math.sign(dx)
  if (!erlaubt[r]) return s * Math.min(WISCH_GUMMI_MAX_PX, Math.abs(dx) * 0.15)
  const max = Number.isFinite(breite) && breite > 0 ? breite : Math.abs(dx)
  return s * Math.min(Math.abs(dx), max)
}

/** Steht die Karte gerade jenseits der Schwelle (Symbol rastet ein)? */
export function wischEingerastet(dx: number, erlaubt: WischErlaubt, breite: number): boolean {
  const r = wischRichtung(dx)
  return !!r && erlaubt[r] && Math.abs(dx) >= wischSchwelle(breite)
}

/** Geschwindigkeit in px/ms aus den letzten Punkten (nur das Fenster der letzten 100 ms) */
export function wischTempo(punkte: ReadonlyArray<{ x: number; t: number }>, fensterMs = 100): number {
  if (punkte.length < 2) return 0
  const letzter = punkte[punkte.length - 1]
  let erster = punkte[punkte.length - 2]
  for (let i = punkte.length - 2; i >= 0; i--) {
    if (letzter.t - punkte[i].t > fensterMs) break
    erster = punkte[i]
  }
  const dt = letzter.t - erster.t
  return dt > 0 ? (letzter.x - erster.x) / dt : 0
}

/** Loslassen: löst die Geste aus? Weit genug ODER schnell genug in dieselbe Richtung.
 *  Wer hinter der Schwelle schnell zurückzieht, bricht ab. */
export function wischEntscheidung(p: { dx: number; tempo: number; breite: number; erlaubt: WischErlaubt }): WischRichtung | null {
  const r = wischRichtung(p.dx)
  if (!r || !p.erlaubt[r]) return null
  const s = Math.sign(p.dx)
  const tempo = Number.isFinite(p.tempo) ? p.tempo : 0
  const zurueck = Math.sign(tempo) === -s && Math.abs(tempo) >= WISCH_TEMPO
  if (zurueck) return null
  const weit = Math.abs(p.dx) >= wischSchwelle(p.breite)
  const flick = Math.sign(tempo) === s && Math.abs(tempo) >= WISCH_TEMPO && Math.abs(p.dx) >= WISCH_TEMPO_MIN_PX
  return weit || flick ? r : null
}

/* ── „Auf morgen": neues Fällig-Datum ── */

const ISO_TAG = /^\d{4}-\d{2}-\d{2}$/

/** YYYY-MM-DD + n Tage (rein kalendarisch, ohne Zeitzonen-/Sommerzeit-Sprünge) */
export function plusTage(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}

/** Neues Fällig-Datum für „Auf morgen": das spätere von heute und der bisherigen Fälligkeit,
 *  plus 1 Tag. Ohne Datum, überfällig oder heute fällig → morgen; schon in der Zukunft → +1 Tag. */
export function morgenDatum(due: string | null | undefined, heute: string): string {
  const basis = due && ISO_TAG.test(due) && due > heute ? due : heute
  return plusTage(basis, 1)
}

/** Beschriftung für die Aktion: „Morgen", wenn das neue Datum morgen ist, sonst „+1 Tag" */
export function morgenText(due: string | null | undefined, heute: string): 'Morgen' | '+1 Tag' {
  return morgenDatum(due, heute) === plusTage(heute, 1) ? 'Morgen' : '+1 Tag'
}
