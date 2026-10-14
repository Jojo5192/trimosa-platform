/**
 * 🤖 KI-Assistent „Claude" der Team-App — reine Logik (Pascal, Chefsache 7.10.2026):
 *  · Bereich 5 Charakter-Design: Saison-Kostüm nach Datum (Europe/Berlin) bzw. Auswahl je Gerät
 *  · Bereich 8 Gesprächsdesign: offene @c-Frage erkennen und den passenden Warte-Satz wählen
 * Ohne React/Browser-Abhängigkeiten, damit sie auch serverseitig und im Node-Test laufen.
 */

/* ═══════════ Kostüme ═══════════ */

export type AssistentKostuem = 'ostern' | 'sommer' | 'halloween' | 'advent' | 'silvester'
export type KostuemWahl = 'auto' | AssistentKostuem | 'aus'

export const KOSTUEME: AssistentKostuem[] = ['ostern', 'sommer', 'halloween', 'advent', 'silvester']

export const KOSTUEM_NAME: Record<AssistentKostuem, string> = {
  ostern: 'Hasenohren',
  sommer: 'Strohhut',
  halloween: 'Hexenhut',
  advent: 'Zipfelmütze',
  silvester: 'Partyhut',
}
export const KOSTUEM_ANLASS: Record<AssistentKostuem, string> = {
  ostern: 'Ostern',
  sommer: 'Sommer',
  halloween: 'Halloween',
  advent: 'Advent',
  silvester: 'Silvester',
}

/** localStorage-Schlüssel der Auswahl (je Gerät) */
export const KOSTUEM_KEY = 'trimosa-assistent-kostuem'

export function istKostuemWahl(v: unknown): v is KostuemWahl {
  return v === 'auto' || v === 'aus' || (typeof v === 'string' && (KOSTUEME as string[]).includes(v))
}

export interface KalenderTag { jahr: number; monat: number; tag: number }

/** Tagesnummer (UTC-basiert, nur zum Vergleichen/Rechnen mit ganzen Tagen) */
function tagNr(jahr: number, monat: number, tag: number): number {
  return Math.round(Date.UTC(jahr, monat - 1, tag) / 86_400_000)
}

/** Ostersonntag (gregorianisch) nach dem anonymen Algorithmus (Meeus/Jones/Butcher, Gauß-Variante). */
export function osterSonntag(jahr: number): KalenderTag {
  const a = jahr % 19
  const b = Math.floor(jahr / 100)
  const c = jahr % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const n = h + l - 7 * m + 114
  return { jahr, monat: Math.floor(n / 31), tag: (n % 31) + 1 }
}

/** 1. Advent = vierter Sonntag vor dem 25.12. (liegt zwischen 27.11. und 3.12.) */
export function ersterAdvent(jahr: number): KalenderTag {
  const weihnacht = new Date(Date.UTC(jahr, 11, 25))
  const wt = weihnacht.getUTCDay() // 0 = Sonntag
  const vierter = 25 - (wt === 0 ? 7 : wt)
  const erster = new Date(Date.UTC(jahr, 11, vierter - 21))
  return { jahr, monat: erster.getUTCMonth() + 1, tag: erster.getUTCDate() }
}

let berlinFormat: Intl.DateTimeFormat | null = null

/** Kalendertag in Europe/Berlin (unabhängig von der Zeitzone des Geräts/Servers). */
export function berlinTag(d: Date): KalenderTag {
  try {
    berlinFormat ??= new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
    })
    const teile = berlinFormat.formatToParts(d)
    const wert = (t: string) => Number(teile.find((p) => p.type === t)?.value)
    const jahr = wert('year'), monat = wert('month'), tag = wert('day')
    if (jahr && monat && tag) return { jahr, monat, tag }
  } catch { /* Intl ohne Zeitzonen → Gerätezeit */ }
  return { jahr: d.getFullYear(), monat: d.getMonth() + 1, tag: d.getDate() }
}

/**
 * Saison-Kostüm für einen Kalendertag:
 *  Ostern    Palmsonntag bis Ostermontag → Hasenohren
 *  Sommer    21.6.–31.8.                 → Strohhut
 *  Halloween 17.–31.10.                  → Hexenhut
 *  Advent    1. Advent bis 26.12.        → Zipfelmütze
 *  Silvester 27.12.–1.1.                 → Partyhut
 *  sonst ohne (null)
 */
export function saisonKostuem(t: KalenderTag): AssistentKostuem | null {
  const { jahr, monat, tag } = t
  if ((monat === 12 && tag >= 27) || (monat === 1 && tag === 1)) return 'silvester'
  const heute = tagNr(jahr, monat, tag)
  const adv = ersterAdvent(jahr)
  if (heute >= tagNr(jahr, adv.monat, adv.tag) && heute <= tagNr(jahr, 12, 26)) return 'advent'
  if (monat === 10 && tag >= 17) return 'halloween'
  if ((monat === 6 && tag >= 21) || monat === 7 || monat === 8) return 'sommer'
  const o = osterSonntag(jahr)
  const ostern = tagNr(jahr, o.monat, o.tag)
  if (heute >= ostern - 7 && heute <= ostern + 1) return 'ostern'
  return null
}

/** Kostüm, das die Figur gerade trägt: Automatisch = nach Saison (Berlin), fest gewählt, oder aus. */
export function wirksamesKostuem(wahl: KostuemWahl, jetzt: Date): AssistentKostuem | null {
  if (wahl === 'aus') return null
  if (wahl === 'auto') return saisonKostuem(berlinTag(jetzt))
  return wahl
}

/* ═══════════ Gesprächsdesign: Warten auf die Antwort ═══════════ */

/** Muss zum Auslöser des @c-Crons passen (app/api/team-chat/bot-poll/route.ts) */
export const BOT_TRIGGER = /^\s*@c(laude)?\b/i
/** Absendername des Bot-Kontos (lib/claude-bot.ts) — nur Rückfall, wenn die Bot-ID fehlt */
export const BOT_NAME = 'Claude'

/** Stufen der Warte-Anzeige (ab Absenden der Frage) */
export const WARTE_THEMA_MS = 1_500
export const WARTE_LANG_MS = 8_000
/** 3 Min.: der Bot-Cron läuft nur minütlich, dazu die Rechenzeit der KI — 90 s waren zu knapp (Hinweis kam vor der Antwort) */
export const WARTE_MAX_MS = 180_000
export const WARTE_LANG_TEXT = 'Dauert einen Moment …'
export const WARTE_AUS_TEXT = 'Keine Antwort bekommen – frag gern noch einmal.'

export interface BotChatMsg {
  id: string
  senderId: string
  senderName: string
  content: string
  attachmentType: string | null
  createdAt: string
}

export interface OffeneFrage {
  id: string
  /** Frage ohne „@c" */
  text: string
  hatBild: boolean
  createdAt: string
}

export function istBotFrage(content: string | null | undefined): boolean {
  return BOT_TRIGGER.test(content ?? '')
}

export function istBotNachricht(m: Pick<BotChatMsg, 'senderId' | 'senderName'>, botId: string | null): boolean {
  return botId ? m.senderId === botId : m.senderName === BOT_NAME
}

/**
 * Jüngste @c-Frage im Verlauf, auf die (noch) keine Bot-Nachricht folgt — sonst null.
 * Bild: direkt angehängt oder ≤ 3 Min. vorher vom selben Absender gesendet (wie der Cron).
 */
export function offeneBotFrage(msgs: BotChatMsg[], botId: string | null): OffeneFrage | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (istBotNachricht(m, botId)) return null
    if (!istBotFrage(m.content)) continue
    let hatBild = m.attachmentType === 'image'
    const t = Date.parse(m.createdAt)
    for (let j = i - 1; !hatBild && j >= 0; j--) {
      const v = msgs[j]
      const dt = t - Date.parse(v.createdAt)
      if (!(dt <= 3 * 60_000)) break
      if (v.senderId === m.senderId && v.attachmentType === 'image') hatBild = true
    }
    return { id: m.id, text: m.content.replace(BOT_TRIGGER, '').trim(), hatBild, createdAt: m.createdAt }
  }
  return null
}

/* Wortgrenzen mit Umlauten (\b kennt ä/ö/ü/ß nicht; Lookbehind meiden — ältere Safari) */
const A = '(?:^|[^a-zäöüß0-9])'
const Z = '(?:[^a-zäöüß0-9]|$)'
const THEMEN: { muster: RegExp; satz: string }[] = [
  { muster: new RegExp(`kalender|belegung|belegt|auslastung|verfügbar|wochenende|${A}(?:frei|freie|freien|freier)${Z}`), satz: 'Ich schaue in den Kalender …' },
  { muster: new RegExp(`buchung|gebucht|reservier|anreise|abreise|${A}(?:gast|gastes|gäste|gästen)${Z}`), satz: 'Ich suche die Buchung …' },
  { muster: new RegExp(`aufgabe|erledig|${A}(?:todo|to-do)`), satz: 'Ich sehe bei den Aufgaben nach …' },
  { muster: new RegExp(`türschlo|türcode|zugangscode|schlüsselbox|${A}(?:tür|türen|haustür|wohnungstür|schloss|schlösser|schlüssel|code|codes|pin|nuki)${Z}`), satz: 'Ich frage die Türschlösser ab …' },
  { muster: /rechnung|zahlung|bezahl|gezahlt|überweis|mahnung|stripe/, satz: 'Ich prüfe die Zahlungen …' },
]
export const THEMA_BILD = 'Ich schaue mir das Bild an …'
export const THEMA_STANDARD = 'Ich denke kurz nach …'

/** Themen-Satz zur Frage — angehängtes Bild zuerst (der Bot schaut es sich dann wirklich an). */
export function themenSatz(frage: string, hatBild: boolean): string {
  if (hatBild) return THEMA_BILD
  const t = (frage || '').toLowerCase()
  for (const th of THEMEN) if (th.muster.test(t)) return th.satz
  return THEMA_STANDARD
}

export type WarteStufe = 'tippt' | 'thema' | 'lang' | 'aus'

export function warteStufe(ms: number): WarteStufe {
  if (ms >= WARTE_MAX_MS) return 'aus'
  if (ms >= WARTE_LANG_MS) return 'lang'
  if (ms >= WARTE_THEMA_MS) return 'thema'
  return 'tippt'
}

/** Sichtbarer Status-Text je Stufe (null = nur die drei Punkte) */
export function warteText(frage: Pick<OffeneFrage, 'text' | 'hatBild'>, ms: number): string | null {
  const s = warteStufe(ms)
  if (s === 'tippt') return null
  if (s === 'thema') return themenSatz(frage.text, frage.hatBild)
  if (s === 'lang') return WARTE_LANG_TEXT
  return WARTE_AUS_TEXT
}
