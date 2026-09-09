/**
 * 🎬 Start-Vorhang (Pascal, Chefsache 8.9.2026) — gemeinsame Logik für Server
 * (app/team/page.tsx entscheidet per Cookie, ob der Vorhang im HTML steht) und
 * Client (components/team/StartCurtain.tsx: Rückkehr aus dem Hintergrund).
 * Kein React, keine Browser-APIs — läuft auf beiden Seiten.
 *
 * Regeln:
 * - Seitenaufruf (Kaltstart, Anmeldung): immer — außer der Vorhang lief in den
 *   letzten 10 Minuten (Notbremse gegen Reload-Schleifen/iOS-Kills).
 * - Rückkehr aus dem Hintergrund: nur nach ≥ 4 h oder am neuen Tag (Europe/Berlin).
 * - Spruch: 45 % passend zu Wochentag/Tageszeit, sonst allgemein; nie derselbe
 *   wie beim letzten Mal (Cookie tm-spruch).
 */

export const CURTAIN_MIN_GAP_MS = 10 * 60_000
export const RETURN_AFTER_MS = 4 * 3600_000
/** Cookies (Client schreibt, Server liest): zuletzt aktiv · Vorhang zuletzt gezeigt · letzter Spruch */
export const COOKIE_ACTIVE = 'tm-active'
export const COOKIE_CURTAIN = 'tm-curtain'
export const COOKIE_SPRUCH = 'tm-spruch'

export type Spruch = { id: string; text: string }

function berlinParts(d: Date): { hour: number; day: string; weekday: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hour: 'numeric', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(d)
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
    return { hour: Number(get('hour')) % 24, day: `${get('year')}-${get('month')}-${get('day')}`, weekday: wd < 0 ? d.getDay() : wd }
  } catch {
    return { hour: d.getHours(), day: d.toISOString().slice(0, 10), weekday: d.getDay() }
  }
}
export function berlinDay(d: Date): string { return berlinParts(d).day }

/** „Guten Morgen, Johannes." — 5–11 Morgen · 11–18 Hallo · 18–23 Abend · sonst Nacht */
export function greetingFor(d: Date, firstName: string | null): string {
  const h = berlinParts(d).hour
  const base = h >= 5 && h < 11 ? 'Guten Morgen' : h >= 11 && h < 18 ? 'Hallo' : h >= 18 && h < 23 ? 'Guten Abend' : 'Gute Nacht'
  return firstName ? `${base}, ${firstName}.` : `${base}.`
}

const ALLGEMEIN = [
  'Schön, dass du da bist.', 'Alles im Blick – los geht\'s.', 'Kein Chaos. Nur Klarheit.', 'Nichts verpasst. Versprochen.',
  'Deine Wohnungen. Dein Überblick.', 'Erst der Blick, dann der Tag.', 'Ruhe im System.', 'Alles an seinem Platz.',
  'Gute Gastgeber haben\'s im Griff.', 'Ein Blick genügt.', 'Läuft. Wie immer.', 'Heute wird gut.',
  'Klar sehen, klar handeln.', 'Wir haben mitgedacht.', 'Die Gäste sind in guten Händen.', 'Alles vorbereitet.',
  'Ordnung ist Gelassenheit.', 'Kurz durchatmen. Dann los.', 'Was zählt, steht hier.', 'Kein Rauschen. Nur das Wichtige.',
  'Der Tag ist sortiert.', 'Schön ruhig hier.', 'Ein guter Moment für den Überblick.', 'Alles synchron.',
  'Die Übersicht gehört dir.', 'Weniger suchen, mehr wissen.', 'Alles Wichtige zuerst.', 'Das Team ist bereit.',
  'Gäste kommen. Wir sind vorbereitet.', 'Es läuft – dank dir.', 'Schritt für Schritt.', 'Heute zählt, was ankommt.',
  'Willkommen zurück.', 'Da bist du ja.', 'Bereit, wenn du es bist.', 'Klare Sicht voraus.',
  'Die Details sind erledigt.', 'Ein ruhiger Kopf sieht mehr.', 'Nichts liegt herum.', 'Der Überblick wartet schon.',
  'Los geht\'s – ganz entspannt.', 'Erst Überblick, dann Antwort.', 'Wir halten die Dinge zusammen.', 'Das Wesentliche, sofort.',
  'Für dich sortiert.', 'Alles frisch geladen.', 'Guter Zeitpunkt.', 'Heute mit Ruhe.',
  'Die Gäste freuen sich schon.', 'Gastfreundschaft beginnt hier.', 'Nichts drängelt.', 'Du hast alles im Griff.',
  'Ein Tag, ein Plan.', 'Wir kümmern uns mit.', 'Alles klar so weit.',
]
const WOCHENTAG: Record<number, string[]> = {
  1: ['Neue Woche, klarer Kopf.', 'Montag. Erst mal Überblick.'],
  2: ['Dienstag – jetzt läuft\'s.', 'Guter Rhythmus heute.'],
  3: ['Bergfest. Halbzeit im Blick.', 'Mittwoch. Alles im Fluss.'],
  4: ['Donnerstag. Das Wochenende plant sich.', 'Fast geschafft.'],
  5: ['Freitag. Die Gäste kommen.', 'Freitag – Anreise-Tag.'],
  6: ['Samstag. Volles Haus, ruhiger Kopf.', 'Wechseltag. Alles im Blick.'],
  0: ['Sonntags reicht ein kurzer Blick.', 'Sonntag. Kurz reinschauen, dann ausruhen.'],
}
const TAGESZEIT: Record<'morgen' | 'tag' | 'abend' | 'nacht', string[]> = {
  morgen: ['Kaffee? Erst der Überblick.', 'Guter Start in den Tag.', 'Der Morgen gehört dem Überblick.', 'Frisch geladen für heute.'],
  tag: ['Zwischendurch kurz reinschauen.', 'Alles läuft – weiter so.', 'Mitten im Tag, alles im Blick.', 'Kurzer Blick, dann weiter.'],
  abend: ['Feierabend-Check.', 'Der Tag klingt aus.', 'Abends noch einmal alles im Blick.', 'Kurz nachsehen, dann Feierabend.'],
  nacht: ['Noch wach? Alles ruhig.', 'Nachts ist es still hier.', 'Späte Stunde, ruhiges Haus.'],
}

/** Alle Sprüche mit stabilen IDs (a = allgemein, w<Tag> = Wochentag, t<Slot> = Tageszeit). */
export const SPRUECHE: Spruch[] = [
  ...ALLGEMEIN.map((text, i) => ({ id: `a${i + 1}`, text })),
  ...Object.entries(WOCHENTAG).flatMap(([wd, arr]) => arr.map((text, i) => ({ id: `w${wd}-${i + 1}`, text }))),
  ...Object.entries(TAGESZEIT).flatMap(([slot, arr]) => arr.map((text, i) => ({ id: `t${slot}-${i + 1}`, text }))),
]

export function pickSpruch(d: Date, lastId: string | null, rnd: () => number = Math.random): Spruch {
  const { hour, weekday } = berlinParts(d)
  const slot: keyof typeof TAGESZEIT = hour >= 5 && hour < 11 ? 'morgen' : hour >= 11 && hour < 18 ? 'tag' : hour >= 18 && hour < 23 ? 'abend' : 'nacht'
  const themed = SPRUECHE.filter((s) => s.id.startsWith(`w${weekday}-`) || s.id.startsWith(`t${slot}-`))
  const general = SPRUECHE.filter((s) => s.id.startsWith('a'))
  const pool = (rnd() < 0.45 && themed.length ? themed : general).filter((s) => s.id !== lastId)
  const list = pool.length ? pool : general
  return list[Math.floor(rnd() * list.length)] ?? general[0]
}

/** Seitenaufruf: immer, außer der Vorhang lief in den letzten 10 Minuten. */
export function curtainDueOnLoad(lastCurtainMs: number | null, now = Date.now()): boolean {
  return !(lastCurtainMs && now - lastCurtainMs < CURTAIN_MIN_GAP_MS)
}
/** Rückkehr aus dem Hintergrund: nach ≥ 4 h oder am neuen Tag (Europe/Berlin). */
export function curtainDueOnReturn(lastActiveMs: number | null, lastCurtainMs: number | null, now = Date.now()): boolean {
  if (!curtainDueOnLoad(lastCurtainMs, now)) return false
  if (!lastActiveMs) return true
  if (now - lastActiveMs >= RETURN_AFTER_MS) return true
  return berlinDay(new Date(lastActiveMs)) !== berlinDay(new Date(now))
}
