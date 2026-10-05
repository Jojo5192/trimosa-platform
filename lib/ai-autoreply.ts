/**
 * 🤖 KI-Auto-Antworten (Phase 2, Pascal 26.9.2026) — server-only.
 *
 * Eigenes Subsystem neben dem ✨-Vorschlag (der weiterhin NIE sendet). Läuft alle 10 Minuten per
 * Cron (/api/ai/autoreply) und kennt drei Modi (app_settings 'ai_autoreply', Standard 'aus'):
 *   aus      → nichts
 *   schatten → protokolliert nur, was die KI gesendet HÄTTE (ai_autoreply_log) — sendet nie
 *   aktiv    → sendet wirklich, aber NUR solange das Tor unten erfüllt ist; sonst wie 'schatten'
 *
 * EISERNE REGEL des Inhabers: „Gast-Nachrichten nie ohne Freigabe" (Scheijen-Lektion 31.7.). Deshalb
 * stehen alle Sicherungen FEST IM CODE und sind weder über die Datenbank noch über das Prompt-Studio
 * veränderbar: Kategorien-Liste, Stichwort-Sperre, Prompts, Schwellwert-Klemme, Tor, Zeitfenster.
 *
 * Gesendet werden KANN nur, wenn ALLES zutrifft:
 *   Modus 'aktiv' (nur ein Admin kann ihn setzen) · Tabelle vorhanden · Tor erfüllt (≥ 30 von
 *   Menschen bewertete Sende-Entscheidungen, davon ≤ 3 % 'falsch'; weniger als 10 unbewertete
 *   gesendete Antworten) · 08:00–21:00 Uhr Berlin ·
 *   Portal-/E-Mail-Buchung, bestätigt, nicht stumm, Aufenthalt nicht länger als 1 Tag vorbei ·
 *   Gast-Nachricht 10 Minuten bis 6 Stunden alt UND dem Team seit mindestens 10 Minuten sichtbar
 *   (messages.inserted_at — nicht nur der Portal-Zeitstempel), letzte Nachricht im Thread, vom Team
 *   noch nicht geöffnet (read_at leer), nicht als erledigt/telefonisch geklärt markiert, kein
 *   Telefonkontakt im Thread, keine Host-Nachricht in den 75 Minuten davor, höchstens 4 Gast-
 *   Nachrichten in Folge — geöffnet/markiert/6 Stunden/75 Minuten gelten für JEDE Nachricht des
 *   beantworteten Blocks (bis zu 4 Gast-Nachrichten in Folge), nicht nur für die jüngste ·
 *   heute noch keine Auto-Antwort in diesem Thread · Sprache de/en/nl/fr · deutsche Fassung jeder
 *   Gast-Nachricht vorhanden · keine Stichwort-Sperre (Geld, Rechnung, Storno, Änderung, Personen,
 *   Beschwerde, Mangel, Notfall, Zugang/Tür/Türcode/Schlüssel, Sonderwunsch, jede Zahl/Tageszeit/
 *   Wochentag; auch in Umschrift ae/oe/ue/ss) · kein ernstes Thema im jüngsten Verlauf · Klassifikator:
 *   genau EIN einfaches Anliegen aus wlan/parken/checkin_zeit/checkout_zeit/anfahrt/muell ·
 *   zwei unabhängige Entwürfe + Richter: jede Aussage durch Buchungs-/Unterkunftsdaten oder die
 *   Gästemappe gedeckt · Code-Wächter (jede Zahl in den ZITIERTEN Fakten, Uhrzeiten nur als hh:mm
 *   aus den Fakten, Check-in-/Check-out-Zeit gegen die Stammdaten, keine Zusage, kein Betrag, kein
 *   Zugang) · Konfidenz ≥ Schwelle (85–100, Standard 92) · nach dem Übersetzen Ziffern-/Uhrzeiten-
 *   Abgleich in Reihenfolge + Treue-Prüfung · unmittelbar vor dem Versand Thread erneut geprüft
 *   (inkl. frischem, strengem Smoobu-Abgleich) · Claim im Protokoll (Unique-Index auf
 *   guest_message_id) VOR dem Senden.
 *
 * Fällt das Tor im Modus 'aktiv' inhaltlich zu (zu wenige Urteile / zu viele 'falsch'), stellt der
 * Lauf den Modus dauerhaft auf 'schatten' zurück — wieder einschalten kann nur ein Admin. Senkt
 * jemand die Schwelle, zählt das Tor nur noch Entscheidungen ab diesem Zeitpunkt.
 *
 * Versand über den vorhandenen sitzungsfreien Weg deliverToGuest (lib/voice.ts, strenger Auto-Modus).
 * Bewusst NUR die Buchungs-Welt (messages.booking_id): Website-Gäste mit Direkt-Chat bleiben außen
 * vor (deliverToGuest erreicht sie nicht zuverlässig, §151).
 */
import { supabaseAdmin } from '@/lib/supabase-admin'
import { askClaude, FAST_MODEL, SMART_MODEL } from '@/lib/ai'
import { parseGuide, blockForListing, blockVisibleInPhase, type GuideBlock, type GuidePhase } from '@/lib/guide'
import { translateIncoming } from '@/lib/translate'
import { sendPushToTeam } from '@/lib/push'

/* ───────────── Feste Grenzen — nur hier im Code änderbar ───────────── */

/** Erlaubte Kategorien. Alles andere wird NIE automatisch beantwortet. */
export const AUTOREPLY_KATEGORIEN = ['wlan', 'parken', 'checkin_zeit', 'checkout_zeit', 'anfahrt', 'muell'] as const
export const AUTOREPLY_GRENZEN = {
  schwelleMin: 85, schwelleMax: 100, schwelleDefault: 92,
  /** Tor für 'aktiv': so viele von Menschen bewertete Sende-Entscheidungen … */
  torMin: 30,
  /** … und davon höchstens dieser Anteil 'falsch' */
  torMaxFalsch: 0.03,
  /** ab so vielen UNBEWERTETEN wirklich gesendeten Antworten pausiert der Versand, bis bewertet ist */
  torMaxUnbewertet: 10,
  minAlterMin: 10, maxAlterStd: 6, stundeVon: 8, stundeBis: 21,
  maxProThreadTag: 1, maxProTag: 20, maxProLauf: 4,
} as const

const G = AUTOREPLY_GRENZEN
/** das Tor betrachtet die jüngsten so vielen bewerteten Sende-Entscheidungen */
const TOR_FENSTER = 100
const MIN_ALTER_MS = G.minAlterMin * 60_000
const MAX_ALTER_MS = G.maxAlterStd * 3600_000
/** Schatten-Stichprobe: auch ältere/bereits beantwortete Nachrichten werden bewertet (nie gesendet) */
const PROBE_FENSTER_MS = 24 * 3600_000
/** Host-Nachricht so kurz VOR der Gast-Nachricht = Mensch ist (vermutlich) im Gespräch. Gilt für
 *  JEDE Host-Zeile — per Smoobu synchronisierte Antworten aus der Airbnb-/Booking-App tragen keine
 *  sender_id. Fängt zugleich Zeitstempel-Versatz bis 75 Minuten ab. Kostet nur Trefferquote. */
const GESPRAECH_MS = 75 * 60_000
const TIME_BUDGET_MS = 200_000
const STALE_MS = 15 * 60_000
const SPRACHEN = ['de', 'en', 'nl', 'fr']
const SETTINGS_KEY = 'ai_autoreply'
const LOG = 'ai_autoreply_log'
/** Entscheidungen mit inhaltlich freigegebenem Entwurf — nur sie zählen für das Tor */
const SENDE_ENTSCHEIDUNGEN = ['haette_gesendet', 'vorrang', 'gesendet']

export type AutoReplyMode = 'aus' | 'schatten' | 'aktiv'
export interface AutoReplySettings {
  mode: AutoReplyMode
  schwelle: number
  geaendertVon?: string | null
  geaendertAm?: string | null
  /** gesetzt, sobald die Schwelle GESENKT wurde: das Tor zählt nur Entscheidungen ab hier
   *  (der neu geöffnete Konfidenz-Bereich wurde vorher nie von einem Menschen bewertet) */
  gateSeit?: string | null
  /** gesetzt, wenn der Lauf 'aktiv' wegen eines zugefallenen Tors auf 'schatten' zurückgestellt hat */
  zurueckgestellt?: { am: string; grund: string } | null
}
export interface AutoReplyGate {
  ok: boolean
  bewertet: number
  falsch: number
  /** Fehlerquote 0..1 — null, solange nichts bewertet ist (nie NaN) */
  quote: number | null
  min: number
  maxQuote: number
  grund: string
  /** warum zu: 'qualitaet' (zu wenige Urteile/zu viele 'falsch' → Modus wird zurückgestellt) ·
   *  'pause' (gesendete Antworten warten auf Bewertung) · 'technik' (nicht lesbar) */
  art?: 'qualitaet' | 'pause' | 'technik'
}

/* ───────────── Schalter ───────────── */

function clampSchwelle(v: unknown): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return G.schwelleDefault
  return Math.min(G.schwelleMax, Math.max(G.schwelleMin, n))
}

const isoOrNull = (v: unknown): string | null =>
  typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null

/** Liest die Schalter-Zeile. ok = false bei einem Lesefehler (dann gilt 'aus'). */
async function readSettings(): Promise<{ ok: boolean; s: AutoReplySettings }> {
  const aus: AutoReplySettings = { mode: 'aus', schwelle: G.schwelleDefault }
  try {
    const { data, error } = await supabaseAdmin
      .from('app_settings').select('value').eq('key', SETTINGS_KEY).maybeSingle()
    if (error) return { ok: false, s: aus }
    const v = (data?.value ?? null) as {
      mode?: unknown; schwelle?: unknown; geaendertVon?: unknown; geaendertAm?: unknown
      gateSeit?: unknown; zurueckgestellt?: { am?: unknown; grund?: unknown } | null
    } | null
    const mode: AutoReplyMode = v?.mode === 'schatten' || v?.mode === 'aktiv' ? v.mode : 'aus'
    const zAm = isoOrNull(v?.zurueckgestellt?.am)
    return {
      ok: true,
      s: {
        mode,
        schwelle: v?.schwelle == null ? G.schwelleDefault : clampSchwelle(v.schwelle),
        geaendertVon: typeof v?.geaendertVon === 'string' ? v.geaendertVon : null,
        geaendertAm: typeof v?.geaendertAm === 'string' ? v.geaendertAm : null,
        gateSeit: isoOrNull(v?.gateSeit),
        zurueckgestellt: zAm ? { am: zAm, grund: String(v?.zurueckgestellt?.grund ?? '').slice(0, 200) } : null,
      },
    }
  } catch { return { ok: false, s: aus } }
}

/** Fail-closed: jeder Fehler und jeder unbekannte Wert bedeutet 'aus'. */
export async function getAutoReplySettings(): Promise<AutoReplySettings> {
  return (await readSettings()).s
}

/**
 * Speichert Modus/Schwelle. Die Berechtigungs- und Tor-Prüfung macht die Route (nur is_admin).
 * Wird die Schwelle GESENKT, beginnt das Tor neu zu zählen (gateSeit = jetzt).
 */
export async function saveAutoReplySettings(patch: { mode?: AutoReplyMode; schwelle?: number }, wer: string): Promise<AutoReplySettings> {
  const { ok, s: cur } = await readSettings()
  // nie blind überschreiben — sonst ginge gateSeit verloren
  if (!ok) throw new Error('Einstellungen nicht lesbar')
  const schwelle = patch.schwelle == null ? cur.schwelle : clampSchwelle(patch.schwelle)
  const now = new Date().toISOString()
  const next: AutoReplySettings = {
    mode: patch.mode === 'aus' || patch.mode === 'schatten' || patch.mode === 'aktiv' ? patch.mode : cur.mode,
    schwelle,
    geaendertVon: wer.slice(0, 40),
    geaendertAm: now,
    gateSeit: schwelle < cur.schwelle ? now : cur.gateSeit ?? null,
    // ein Mensch hat den Modus neu gewählt → der Hinweis „automatisch zurückgestellt" ist erledigt
    zurueckgestellt: patch.mode !== undefined ? null : cur.zurueckgestellt ?? null,
  }
  const { error } = await supabaseAdmin.from('app_settings').upsert({ key: SETTINGS_KEY, value: next }, { onConflict: 'key' })
  if (error) throw new Error(error.message)
  return next
}

/**
 * Das Tor ist im Modus 'aktiv' inhaltlich zugefallen → Modus dauerhaft auf 'schatten' zurückstellen.
 * So kann der echte Versand nie „von selbst" wieder anlaufen (z. B. weil ein Nicht-Admin Urteile
 * ändert) — wieder einschalten kann nur ein Admin. Wirft nie.
 */
async function aufSchattenZurueck(grund: string): Promise<boolean> {
  try {
    const { ok, s } = await readSettings()
    if (!ok || s.mode !== 'aktiv') return false
    const next: AutoReplySettings = { ...s, mode: 'schatten', zurueckgestellt: { am: new Date().toISOString(), grund: grund.slice(0, 200) } }
    const { error } = await supabaseAdmin.from('app_settings').upsert({ key: SETTINGS_KEY, value: next }, { onConflict: 'key' })
    if (error) { console.error('[ai-autoreply] Zurückstellen fehlgeschlagen:', error.message); return false }
    console.log('[ai-autoreply] Modus auf „schatten“ zurückgestellt:', grund)
    await sendPushToTeam('🤖 KI-Auto-Antworten pausiert',
      `Das Tor ist nicht mehr erfüllt (${grund.slice(0, 120)}). Der Modus wurde auf „Schatten“ zurückgestellt – wieder einschalten kann nur ein Admin.`,
      '/team', { guestChat: true }).catch(() => {})
    return true
  } catch (e) {
    console.error('[ai-autoreply] Zurückstellen fehlgeschlagen:', e)
    return false
  }
}

/** Probe-Select: Ohne die Tabelle ist das System still aus — auch wenn der Modus schon gespeichert ist. */
export async function autoReplyTableReady(): Promise<{ ok: boolean; fehler?: string }> {
  try {
    const { error } = await supabaseAdmin.from(LOG).select('id').limit(1)
    return error ? { ok: false, fehler: error.message.slice(0, 160) } : { ok: true }
  } catch (e) {
    return { ok: false, fehler: String(e).slice(0, 160) }
  }
}

/**
 * 🚪 Das Tor für 'aktiv' — fest im Code, bei JEDEM Lauf und bei jedem Umschalten neu geprüft.
 * Zählt nur Urteile von Menschen (bewertet_von gesetzt) über Entscheidungen mit freigegebenem
 * Entwurf (hätte gesendet / Mensch hatte Vorrang / gesendet): die jüngsten 100 ENTSCHEIDUNGEN
 * (nach Entstehung, nicht nach Bewertungs-Klick — erneutes Bewerten alter Einträge verschiebt das
 * Fenster nicht), nach einer Senkung der Schwelle nur Entscheidungen ab diesem Zeitpunkt.
 * 0 Bewertungen = gesperrt. Zusätzlich: Warten zu viele wirklich gesendete Antworten auf ihre
 * Bewertung, pausiert der Versand (ohne laufende Kontrolle bleibt das Tor nicht offen).
 */
export async function aktivGate(): Promise<AutoReplyGate> {
  const zu = (grund: string, art: AutoReplyGate['art'], bewertet = 0, falsch = 0, quote: number | null = null): AutoReplyGate =>
    ({ ok: false, bewertet, falsch, quote, min: G.torMin, maxQuote: G.torMaxFalsch, grund, art })
  try {
    const { ok: sOk, s } = await readSettings()
    if (!sOk) return zu('Einstellungen nicht lesbar.', 'technik')
    let q = supabaseAdmin
      .from(LOG).select('bewertung')
      .in('entscheidung', SENDE_ENTSCHEIDUNGEN)
      .not('bewertung', 'is', null).not('bewertet_von', 'is', null)
    if (s.gateSeit) q = q.gte('created_at', s.gateSeit)
    const { data, error } = await q.order('created_at', { ascending: false }).limit(TOR_FENSTER)
    if (error) return zu('Protokoll nicht lesbar – Migration ausgeführt?', 'technik')
    const rows = (data ?? []) as { bewertung: string | null }[]
    const bewertet = rows.length
    const falsch = rows.filter((r) => r.bewertung === 'falsch').length
    const seit = s.gateSeit ? ` (gezählt seit der Senkung der Schwelle am ${fmtDate(berlinDateOf(s.gateSeit))})` : ''
    if (bewertet === 0) return zu(`Noch keine Entscheidung bewertet – nötig sind mindestens ${G.torMin}${seit}.`, 'qualitaet')
    const quote = falsch / bewertet
    const pct = (quote * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })
    if (bewertet < G.torMin) return zu(`Erst ${bewertet} von ${G.torMin} Entscheidungen bewertet${seit}.`, 'qualitaet', bewertet, falsch, quote)
    // bewusst „nicht (quote <= max)": ein unerwartetes NaN bleibt gesperrt
    if (!(quote <= G.torMaxFalsch)) return zu(`Fehlerquote ${pct} % – erlaubt sind höchstens ${G.torMaxFalsch * 100} %.`, 'qualitaet', bewertet, falsch, quote)

    // Laufende Kontrolle: wirklich gesendete Antworten müssen bewertet werden
    const { count, error: uErr } = await supabaseAdmin
      .from(LOG).select('id', { count: 'exact', head: true })
      .eq('entscheidung', 'gesendet').is('bewertung', null)
    if (uErr || typeof count !== 'number') return zu('Protokoll nicht lesbar.', 'technik', bewertet, falsch, quote)
    if (count >= G.torMaxUnbewertet) {
      return zu(`${count} gesendete Antworten sind noch nicht bewertet – bis sie bewertet sind, sendet die KI nichts.`, 'pause', bewertet, falsch, quote)
    }
    return { ok: true, bewertet, falsch, quote, min: G.torMin, maxQuote: G.torMaxFalsch, grund: `Tor erfüllt: ${bewertet} bewertet, Fehlerquote ${pct} %.` }
  } catch {
    return zu('Protokoll nicht lesbar.', 'technik')
  }
}

/* ───────────── Zeit-Helfer (Berlin) ───────────── */

function berlinNow(): { date: string; hour: number } {
  const s = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' })
  return { date: s.slice(0, 10), hour: Number(s.slice(11, 13)) }
}
function berlinDateOf(iso: string): string {
  return new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 10)
}
/** b − a in ganzen Tagen (Datums-Strings) */
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b.slice(0, 10) + 'T00:00:00Z') - Date.parse(a.slice(0, 10) + 'T00:00:00Z')) / 86_400_000)
}
function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}

/* ───────────── Stufe 0: Stichwort-Sperre (modellunabhängig) ─────────────
 * Läuft auf dem Original UND der deutschen Fassung, jeweils auch in Umschrift (ae/oe/ue/ss).
 * Bewusst grob: lieber zehn einfache Fragen dem Team überlassen als eine heikle automatisch
 * beantworten. ernst = sperrt auch dann, wenn das Thema nur im jüngsten VERLAUF des Gastes steht. */
const VETO: { grund: string; re: RegExp; ernst?: true }[] = [
  { grund: 'Telefon-/Systemnachricht', re: /☎️|guest phone number|reservation (code|number|id)|buchungsnummer|do not reply|no-?reply|automat(ed|ische|isierte) (message|nachricht)/i },
  { grund: 'Geld/Preis', re: /€|\beur\b|euro|\bgeld|bezahl|zahlung|zahlen\b|überweis|kosten|kostet|gebühr|preis|rabatt|kaution|kurtaxe|\bpay|payment|\bpaid\b|price|\bcost|\bfees?\b|charge|deposit|discount|tourist tax|betaal|betal|prijs|\bkost|\bborg\b|korting|paiement|payer|\bprix\b|tarif|caution|remise/i },
  { grund: 'Rechnung', re: /rechnung|quittung|beleg\b|invoice|receipt|factu|\bre[cç]u/i },
  { grund: 'Storno/Erstattung', ernst: true, re: /storn|cancel|annul|erstatt|rückzahl|rückerstatt|refund|rembours|terugbet|geld zurück|money back/i },
  { grund: 'Änderung der Buchung', re: /umbuch|verschieb|verläng|verkürz|(?<![a-zäöüß])änder|eine nacht (mehr|länger|früher)|extra nacht|zusätzlich|weitere person|mehr personen|person mehr|personenzahl|extend|shorten|reschedul|extra night|another night|one more night|additional|extra (guest|person|people)|change (the|our|my) (booking|reservation|dates?)|verleng|wijzig|omboek|prolong|modifi|changer/i },
  { grund: 'Personen/Anzahl', re: /\bstatt\b|instead of|in plaats van|au lieu de|\bpersonen\b|\bpersons?\b|\bpeople\b|\bguests\b|\bgäste\b|erwachsene|\bkindern?\b|(unser|unserem|unseren|unsere|ein|einem|kleines|kleinem|mit) kind\b|children|\bkids?\b|\bbaby|\badults?\b|personnes|enfants|volwassenen|kinderen|\bbesuch\b|besucher|visitors?\b|\bbezoek/i },
  { grund: 'Sonderwunsch (früher/später/Ausnahme)', re: /früh(?!stück|estens)|\beher\b|spät(?!estens)|vorher\b|\bdavor\b|\bzuvor\b|\bschon\b|\bbereits\b|\bjetzt\b|länger|stehen lassen|early|earlier|\bbefore\b|\blater?\b|\balready\b|\bnow\b|\blonger\b|vroeg|eerder|(?<!h(oe|ö) )\blaat\b|\bnu al\b|plus t[oô]t|plus tard|d[eé]j[aà]|ausnahme|exception|uitzondering|wäre es möglich|ist es möglich|möglich,? dass|dürfen wir|would it be possible|is it possible|could we|can we (still|leave|drop|keep|stay)|gepäck|koffer|luggage|baggage|bagage/i },
  { grund: 'Bitte um Erlaubnis/Tageszeit', re: /möglich|possible|mogelijk|geht das|in ordnung|erlaub|\ballowed\b|toegestaan|\bis it ok|\b(ist|wäre) es ok|\bok(ay)?,? (wenn|if)\b|do you mind|stört es|\bnoon\b|midday|\bmittags?\b|vormittag|nachmittag|\babends\b|\bnachts\b|mitternacht|(?<!good )afternoon|(?<!good )\bevening\b|tonight|midnight|\bmidi\b|(?<!g(oe|ö)de )\bmiddag|(?<!g(oe|ö)de )\bavond|\bsoir\b/i },
  { grund: 'Gast nennt eine Zahl (Uhrzeit/Personen/Datum möglich)', re: /\d|(?<![a-zäöüßéèêàâôûç])(zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twee|drie|vijf|zes|zeven|negen|tien|twaalf|deux|trois|quatre|cinq|sept|huit|neuf|dix|douze)(?![a-zäöüßéèêàâôûç])/i },
  { grund: 'Gast nennt einen Tag (Datum möglich)', re: /montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|\blundi|\bmardi|mercredi|\bjeudi|vendredi|samedi|dimanche|übermorgen|tomorrow|overmorgen|\bdemain/i },
  { grund: 'Beschwerde', ernst: true, re: /beschwer|reklam|enttäusch|unzufrieden|unzumutbar|inakzeptabel|frechheit|dreck|schmutz|ungeputzt|nicht sauber|nicht gereinigt|schimmel|ungeziefer|stinkt|gestank|\blärm|\blaut\b|complain|disappoint|unacceptable|dirty|filthy|not clean|\bmold|mould|smell|noisy|\bnoise|klacht|teleurgest|\bvies\b|\bvuil|\bstank|lawaai|plainte|d[eé][cç]u|\bsale\b|moisi|\bbruit/i },
  { grund: 'Mangel/Defekt/Schaden', ernst: true, re: /mangel|mängel|kaputt|defekt|beschädig|schaden|zerbroch|gebrochen|funktioniert (nicht|kein)|geht nicht|gehen nicht|läuft nicht|tut nicht|klappt (es )?nicht|kein(e|en)? (warmwasser|warmes wasser|strom|wasser|internet|wlan|wifi|verbindung|empfang|heizung|licht)|ausgefallen|fällt aus|tropft|undicht|verstopft|fehlt\b|fehlen\b|kein parkplatz|besetzt|belegt|zugeparkt|\bvoll\b|überfüllt|no parking|occupied|blocked|\bfull\b|overflow|broken|damage|not working|doesn'?t work|does not work|isn'?t working|won'?t work|no (hot water|power|electricity|heating|internet|wifi|connection)|\bleak|clogged|missing|kapot|\bstuk\b|werkt niet|doet het niet|\blek\b|ontbreek|cass[eé]|\bpanne|ne (fonctionne|marche) pas|\bfuite|manque/i },
  { grund: 'Mangel (langsam/instabil/kalt/Problem)', re: /langsam|\bslow|traag|\blent|instabil|unstable|bricht (ständig )?ab|disconnect|schwach|\bweak\b|\bkalt\b|\bcold\b|\bkoud\b|\bfroid|problem|probleem|probl[eè]me|\bissue|trouble|schlecht|\bbad\b|\bpoor\b|slecht|mauvais|stimmt nicht|falsch|\bwrong\b|incorrect|ungültig|invalid|nicht (verbinden|einloggen|anmelden|finden)|finde[nt]? .{0,25}nicht|can'?t (connect|find|log)|cannot (connect|find|log)|\bunable\b|couldn'?t/i },
  { grund: 'Notfall/Dringlichkeit', ernst: true, re: /notfall|dringend|sofort|\bhilfe\b|feuer|\bbrand\b|brennt|rauch|\bgas\b|gasgeruch|wasserschaden|überschwemm|einbruch|eingebrochen|polizei|notarzt|krankenwagen|verletz|unfall|\barzt\b|emergency|urgent|\basap\b|\bfire\b|smoke|\bflood|burglar|police|ambulance|injur|accident|doctor|noodgeval|\bspoed|politie|urgence|urgent|incendie|fum[eé]e|m[eé]decin/i },
  { grund: 'Zugang/Türcode/Schlüssel', re: /code|schlüssel|\bschloss\b|schließ|abschließ|ausgesperrt|komme[n]? nicht (rein|hinein|in die)|tür (geht|öffnet|lässt|klemmt)|(?<![a-zäöüß]-)\bzugang\b|zugangscode|zutritt|keybox|key ?safe|lock ?box|\bkeys?\b|\block|locked|can'?t get in|cannot get in|can'?t enter|\baccess\b|\bpin\b|sleutel|\bslot\b|buitengesloten|toegang|\bcl[eé]s?\b|\bclefs?\b|serrure|\bacc[eè]s|digicode/i },
  { grund: 'Zugang (Tür/Eingang/hineinkommen/vor Ort)', re: /(?<!na)tür|door|\bdeur|\bportes?\b|öffne|\bopen|aufmach|aufsperr|\brein\b|reinkomm|hinein|herein|\b(get|come|go) (in|inside)\b|\benter|\bbinnen\b|\bentrer\b|\brentrer\b|eingang|entrance|\bingang|\bentr[eé]e|klingel|sonnette|stehen (vor|draußen)|\bsind (jetzt |gerade )?(da|angekommen|vor ort)\b|we('re| are) (here|outside)|(have|just) arrived|staan (voor|buiten)/i },
  { grund: 'Recht/Bewertung', ernst: true, re: /anwalt|rechtsanw|\bklage|\bgericht|lawyer|attorney|\bsue\b|avocat|advocaat|bewertung|rezension|\breview/i },
  { grund: 'Haustier/Zusatzausstattung', re: /\bhund|haustier|\bkatze|\bpets?\b|\bdogs?\b|huisdier|\bhond\b|\bchien|kinderbett|babybett|reisebett|hochstuhl|\bcot\b|\bcrib\b|high ?chair|kinderbed|kinderstoel|lit bébé/i },
]

/** Schreibvarianten für die Sperre: Umschrift ohne Umlaute („Schluessel", „frueher") und ss statt ß
 *  („ABSCHLIESSEN") werden zusätzlich in der Umlaut-Form geprüft. */
function vetoText(t: string): string {
  const n = t.normalize('NFC')
  const uml = n.replace(/ae/gi, 'ä').replace(/oe/gi, 'ö').replace(/ue/gi, 'ü')
  return [n, uml, uml.replace(/ss/gi, 'ß')].join('\n')
}

function codeVeto(text: string, nurErnst = false): string | null {
  for (const v of VETO) {
    if (nurErnst && !v.ernst) continue
    const m = text.match(v.re)
    if (m) return `${v.grund} („${m[0].trim().slice(0, 30)}“)`
  }
  return null
}

/* ───────────── Prompts — Konstanten im Code, NICHT über das Prompt-Studio änderbar ───────────── */

const SYS_KLASSE = `Du sortierst die Nachricht eines Ferienwohnungs-Gastes an den Gastgeber (TRIMOSA Apartments & Homes) in genau EINE Kategorie. Du beantwortest nichts.

Einfache, rein informative Kategorien:
- wlan: Frage nach den WLAN-/Internet-Zugangsdaten (Netzwerkname, Passwort)
- parken: Frage, wo oder wie man parken kann
- checkin_zeit: reine Frage, ab wann der Check-in ist
- checkout_zeit: reine Frage, bis wann der Check-out ist
- anfahrt: Frage nach der Adresse oder dem Weg zur Unterkunft
- muell: Frage zur Müllentsorgung oder Mülltrennung

Alles andere:
- geld (Preis, Zahlung, Kaution, Kurtaxe, Rabatt) · rechnung · storno (Stornierung, Erstattung)
- aenderung (Datum, Personenzahl, Verlängerung)
- sonderwunsch (früher oder später an- oder abreisen, Gepäck abstellen, Ausnahmen, Haustier, Zusatzausstattung, jede Bitte um Erlaubnis oder Zusage)
- beschwerde · mangel (etwas ist defekt, fehlt, schmutzig, funktioniert nicht) · notfall
- zugang (Türcode, Schlüssel, Schloss, kommt nicht hinein)
- dank (Dank, Gruß, Bestätigung, Smalltalk ohne Frage)
- system (automatische Portal-/Systemtexte, Telefonnotizen)
- sonstiges (alles Übrige, Unklares, mehrere verschiedene Themen)

Regeln:
- Im Zweifel IMMER "sonstiges".
- Enthält die Nachricht mehr als ein Anliegen: "mehrere_anliegen": true.
- Jede Bitte, die eine Entscheidung oder Zusage des Gastgebers braucht: "sonderwunsch": true.
- "ton": "neutral", "veraergert" oder "dringend".
- "eigenstaendig": false, wenn die Nachricht ohne den früheren Verlauf nicht eindeutig zu verstehen ist (z. B. "Und wo genau?", "Ok, und dann?").
- "sicherheit": 0–100 — wie sicher du dir bei Kategorie UND allen Feldern bist.

Antworte AUSSCHLIESSLICH mit JSON in genau dieser Form:
{"kategorie":"sonstiges","mehrere_anliegen":false,"sonderwunsch":false,"ton":"neutral","eigenstaendig":true,"sicherheit":0}`

const ENTWURF_JSON = `Antworte AUSSCHLIESSLICH mit JSON in genau dieser Form:
{"beantwortbar":false,"antwort":"","fakten":[],"sicherheit":0,"fehlend":""}
- "fakten": die Nummern der verwendeten Fakten, z. B. ["F2"].
- "sicherheit": 0–100 — wie sicher die Antwort die Frage vollständig und ausschließlich aus den FAKTEN beantwortet.
- "fehlend": bei "beantwortbar": false kurz, was in den FAKTEN fehlt.`

const SYS_ENTWURF_A = `Du beantwortest als Gastgeber von TRIMOSA Apartments & Homes die Frage eines Gastes — aber NUR, wenn die Antwort vollständig in den FAKTEN steht.

Regeln (ohne Ausnahme):
- Verwende AUSSCHLIESSLICH Informationen aus den nummerierten FAKTEN. Kein Allgemeinwissen, keine Vermutungen, nichts ergänzen.
- Ist auch nur ein Teil der Frage aus den FAKTEN nicht sicher zu beantworten: "beantwortbar": false.
- Keine Zusagen, keine Ankündigungen ("ich prüfe das", "wir melden uns"), keine Ausnahmen, keine Preise oder Geldbeträge, nichts zu Türcode, Schlüssel oder Zugang.
- Nur die Auskunft selbst — ohne "gern", "natürlich", "kein Problem", "jederzeit" oder ähnliche Füllwörter.
- Nenne nur Zahlen und Uhrzeiten aus den Fakten, die du unter "fakten" angibst.
- Uhrzeiten, Zahlen, Netzwerknamen und Passwörter exakt so schreiben, wie sie in den FAKTEN stehen.
- Deutsch, Du-Form, freundlich und kurz (1–3 Sätze), wie eine Chat-Nachricht. Beginne mit "Hallo," ohne Namen. Keine Grußformel am Ende, keine Emojis, keine Rückfrage.

${ENTWURF_JSON}`

const SYS_ENTWURF_B = `Aufgabe: Faktenprüfung für eine Ferienwohnungs-Verwaltung (TRIMOSA). Ein Gast hat eine Frage gestellt. Gehe so vor:
1. Suche in den nummerierten FAKTEN die Stellen, die die Frage direkt beantworten.
2. Findest du nicht für JEDEN Teil der Frage eine eindeutige Stelle, lautet das Ergebnis "beantwortbar": false — rate nicht und fülle keine Lücken mit Erfahrungswissen.
3. Nur wenn alles belegt ist: formuliere eine knappe Antwort an den Gast (Deutsch, Du-Form, 1–3 Sätze, Beginn "Hallo,", keine Grußformel, keine Emojis), die nichts enthält außer dem Belegten.

Verboten in der Antwort: Zusagen, Ankündigungen, Ausnahmen, Geldbeträge, Hinweise zu Türcode, Schlüssel oder Zugang, eigene Schätzungen. Zahlen, Uhrzeiten, Netzwerknamen und Passwörter werden zeichengenau aus den FAKTEN übernommen.

${ENTWURF_JSON}`

const SYS_RICHTER = `Du prüfst streng zwei unabhängig entstandene Antwortentwürfe (A und B) auf die Frage eines Feriengastes gegen die FAKTEN. Du bist misstrauisch: Im Zweifel fällt die Prüfung durch.

Prüfe:
- "gleiche_aussage" (0–100): Sagen A und B inhaltlich dasselbe (gleiche Zeiten, Orte, Zahlen, Anweisungen)? Jede sachliche Abweichung senkt den Wert deutlich.
- "a_gedeckt": Ist JEDE sachliche Aussage in A wörtlich oder sinngleich durch die FAKTEN gedeckt? Schon eine nicht gedeckte Aussage → false.
- "ungedeckt": die nicht gedeckten Aussagen aus A (leere Liste, wenn keine).
- "beantwortet_frage": Beantwortet A genau das, was der Gast gefragt hat — vollständig, ohne eine Teilfrage offen zu lassen und ohne am Anliegen vorbeizugehen?
- "zusage": Enthält A eine Zusage, Ankündigung, Ausnahme, einen Geldbetrag oder Hinweise zu Türcode/Schlüssel/Zugang? (true = durchgefallen)

Antworte AUSSCHLIESSLICH mit JSON in genau dieser Form:
{"gleiche_aussage":0,"a_gedeckt":false,"ungedeckt":[],"beantwortet_frage":false,"zusage":true}`

const SYS_UEBERSETZUNG = `Du prüfst die Übersetzung einer kurzen Nachricht eines Ferienwohnungs-Gastgebers an einen Gast. Vergleiche ORIGINAL (Deutsch) und ÜBERSETZUNG streng. Du bist misstrauisch: Im Zweifel fällt die Prüfung durch.

"gleich": true NUR, wenn die Übersetzung genau dasselbe aussagt wie das Original:
- keine Aussage fehlt, keine ist hinzugefügt (auch keine freundliche Ergänzung, kein Angebot, keine Zusage),
- keine Aussage ist ins Gegenteil verkehrt oder verschoben (z. B. "ab" ↔ "bis", "nicht", "vor" ↔ "hinter"),
- jede Uhrzeit, Zahl und jeder Ort gehört zu derselben Sache wie im Original.
Andere Wortstellung oder Höflichkeitsform ist kein Unterschied.

Antworte AUSSCHLIESSLICH mit JSON in genau dieser Form:
{"gleich":false,"abweichung":""}`

/* ───────────── JSON-/Zahlen-Helfer (fail-closed) ───────────── */

function parseObj(raw: string): Record<string, unknown> | null {
  const a = raw.indexOf('{')
  const b = raw.lastIndexOf('}')
  if (a === -1 || b <= a) return null
  try {
    const o: unknown = JSON.parse(raw.slice(a, b + 1))
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null
  } catch { return null }
}
function pct(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null
}
/** alle Ziffernfolgen samt Uhrzeit-/Datums-Trennern („16:00", „12.10.2026", „7590") */
function zahlen(s: string): string[] {
  return [...new Set(s.match(/\d+(?:[.:,]\d+)*/g) ?? [])]
}
/** Zahlen der Fakten + reine Schreibvarianten (16:00 ↔ 16.00; 12.10.2026 → 12.10). Bewusst KEINE
 *  nackte Stunde („16") und kein nackter Tag — sonst rutschen fremde kleine Zahlen durch. */
function faktenZahlen(text: string): Set<string> {
  const set = new Set<string>()
  for (const t of zahlen(text)) {
    set.add(t)
    const zeit = t.match(/^(\d{1,2})[:.](\d{2})$/)
    if (zeit) { set.add(`${zeit[1]}:${zeit[2]}`); set.add(`${zeit[1]}.${zeit[2]}`) }
    const datum = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
    if (datum) set.add(`${datum[1]}.${datum[2]}`)
  }
  return set
}

/* ───────────── Faktenbasis: NUR Buchung, Unterkunft, Gästemappe ───────────── */

interface BookingRow {
  id: string; listing_id: string | null; status: string | null; source: string | null
  check_in: string; check_out: string; guest_name: string | null; guest_email: string | null
  smoobu_reservation_id: number | string | null
}
interface ListingRow {
  id: string; title: string | null; address: string | null; city: string | null; location: string | null
  check_in_time: string | null; check_out_time: string | null; guide: unknown
}
interface Facts {
  lines: { id: string; text: string }[]
  /** nummerierter Block für die Prompts */
  text: string
  ids: Set<string>
  /** Zeichenketten, die eine Übersetzung nie verändern darf (WLAN-Name/-Passwort) */
  literals: string[]
  /** WLAN-Passwörter — erscheinen nie in Push-Nachrichten */
  geheim: string[]
  zahlen: Set<string>
  /** Check-in-/Check-out-Zeit der Unterkunft (hh:mm) — Maßstab für jede so benannte Uhrzeit */
  checkin: string | null
  checkout: string | null
}

/** Zugangs-/Schlüssel-Inhalte werden NIE zu Fakten (Türcode-Bausteine ohnehin nicht). */
const ZUGANG_RE = /code|schlüssel|\bschloss\b|schließ|keybox|key ?safe|tresor|\bpin\b|türöffn|(?<![a-zäöüß]-)\bzugang\b|zutritt/i
const clean = (s: unknown): string => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const hhmm = (t: string | null): string | null => {
  const m = String(t ?? '').match(/^(\d{1,2}):(\d{2})/)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
}

function buildFacts(b: BookingRow, l: ListingRow, pool: GuideBlock[], today: string): Facts {
  const lines: { id: string; text: string }[] = []
  const literals: string[] = []
  const geheim: string[] = []
  const add = (text: string) => { if (text && lines.length < 40) lines.push({ id: `F${lines.length + 1}`, text: text.slice(0, 700) }) }

  const ort = clean(l.address) || [clean(l.location), clean(l.city)].filter(Boolean).join(', ')
  add(`Unterkunft: ${clean(l.title) || 'Ferienwohnung'}${ort ? ` — Adresse/Lage: ${ort}` : ''}`)
  const ci = hhmm(l.check_in_time)
  const co = hhmm(l.check_out_time)
  if (ci) add(`Check-in ist ab ${ci} Uhr.`)
  if (co) add(`Check-out ist bis ${co} Uhr.`)
  add(`Aufenthalt dieses Gastes: Anreise am ${fmtDate(b.check_in)}, Abreise am ${fmtDate(b.check_out)}.`)

  // Gästemappe — exakt die Bausteine, die die Mappe diesem Gast in der aktuellen Phase zeigt
  // (Pool 'guide_global', sonst die alte Wohnungs-Mappe; wie app/mappe/[token]/page.tsx)
  const phase: GuidePhase = today < b.check_in ? 'vor' : today <= b.check_out ? 'waehrend' : 'nach'
  const nights = Math.max(1, dayDiff(b.check_in, b.check_out))
  // WLAN-Passwort nur während des Aufenthalts bzw. ab dem Tag vor der Anreise
  const wifiPw = phase === 'waehrend' || (phase === 'vor' && dayDiff(today, b.check_in) <= 1)
  let blocks = pool.filter((x) => blockForListing(x, l.id))
  if (!blocks.length) blocks = parseGuide(l.guide)
  blocks = blocks.filter((x) => blockVisibleInPhase(x, phase, nights))

  let abschnitt = ''
  let gesperrt = false
  for (const blk of blocks) {
    if (blk.type === 'heading') {
      abschnitt = clean(blk.text).slice(0, 60)
      gesperrt = ZUGANG_RE.test(abschnitt)
      continue
    }
    if (gesperrt) continue
    let t = ''
    switch (blk.type) {
      case 'text': t = clean(blk.text); break
      case 'info': t = [clean(blk.title), clean(blk.text)].filter(Boolean).join(': '); break
      case 'warning': t = clean(blk.text) ? `Wichtiger Hinweis: ${clean(blk.text)}` : ''; break
      case 'steps': {
        const steps = (blk.steps ?? []).map(clean).filter((s) => s && !ZUGANG_RE.test(s))
        // ohne Nummerierung — deren Ziffern würden den Zahlen-Abgleich aufweichen
        t = steps.length ? [clean(blk.title), ...steps].filter(Boolean).join(' · ') : ''
        break
      }
      case 'wifi': {
        const ssid = clean(blk.ssid)
        const pw = String(blk.password ?? '').trim()
        if (!ssid) break
        literals.push(ssid)
        if (wifiPw && pw) {
          literals.push(pw)
          geheim.push(pw)
          add(`WLAN: Netzwerkname „${ssid}“, Passwort „${pw}“`)
        } else {
          add(`WLAN: Netzwerkname „${ssid}“. Das Passwort steht in der persönlichen Gästemappe des Gastes.`)
        }
        continue
      }
      default: t = '' // door NIE; contact/link/image/map/times/rules/region/chat/review/inventar: nicht für Auto-Antworten
    }
    if (!t || ZUGANG_RE.test(t)) continue
    add(`${abschnitt ? `(Abschnitt „${abschnitt}“) ` : ''}${t}`)
  }

  return {
    lines,
    text: lines.map((x) => `[${x.id}] ${x.text}`).join('\n'),
    ids: new Set(lines.map((x) => x.id)),
    literals,
    geheim,
    zahlen: faktenZahlen(lines.map((x) => x.text).join('\n')),
    checkin: ci,
    checkout: co,
  }
}

/* ───────────── Code-Wächter auf dem Entwurf (modellunabhängig) ───────────── */

/** Jede Zahl des Entwurfs muss in den Fakten stehen — mit belege: in den ZITIERTEN Fakten
 *  (eine Hausnummer aus einem anderen Fakt deckt keine Uhrzeit). */
function zahlenVerstoesse(entwurf: string, facts: Facts, belege?: string[]): string[] {
  const v: string[] = []
  const erlaubt = belege
    ? faktenZahlen(facts.lines.filter((x) => belege.includes(x.id)).map((x) => x.text).join('\n'))
    : facts.zahlen
  for (const t of zahlen(entwurf)) if (!erlaubt.has(t)) v.push(`Zahl/Uhrzeit „${t}“ steht nicht in den ${belege ? 'angegebenen Belegen' : 'Fakten'}`)
  return v
}

const ZEIT_RE = /(?<![\d.:,])(\d{1,2})[:.](\d{2})(?![\d:]|[.,]\d)/g
const CHECKIN_RE = /check-?\s?in|einchecken|eingecheckt|anreise|ankunft/gi
const CHECKOUT_RE = /check-?\s?out|auschecken|ausgecheckt|abreise/gi

/** Uhrzeiten: nur als hh:mm aus den Fakten; eine als Check-in/Check-out benannte Zeit muss die
 *  Stammdaten-Zeit sein (fängt vertauschte Zeiten und „ab 12 Uhr"-Zusagen ab). */
function zeitVerstoesse(entwurf: string, facts: Facts): string[] {
  const v: string[] = []
  const zeiten = new Set([...facts.zahlen].filter((z) => /^\d{1,2}:\d{2}$/.test(z)).map((z) => z.padStart(5, '0')))
  for (const m of entwurf.matchAll(/(?<![\d.:,])(\d{1,2})(?:[:.](\d{2}))?\s*uhr\b/gi)) {
    if (!m[2] || !zeiten.has(`${m[1].padStart(2, '0')}:${m[2]}`)) v.push(`Uhrzeit „${m[0].trim()}“ steht nicht als Uhrzeit in den Fakten`)
  }
  // nackte Stunde ohne Minuten/„Uhr" („ab 12", „gegen 14")
  if (/\b(ab|um|gegen|vor|bis|nach)\s+\d{1,2}(?![\d:]|[.,]\d)(?!\s*(uhr|min|meter|m\b|km|schritt|tag|nächt|nacht|stund|%))/i.test(entwurf)) v.push('Zeitangabe ohne Minuten im Entwurf')
  for (const satz of entwurf.split(/(?<=[.!?])\s+|\n+/)) {
    const marken: { pos: number; soll: string | null; name: string }[] = []
    for (const m of satz.matchAll(CHECKIN_RE)) marken.push({ pos: m.index ?? 0, soll: facts.checkin, name: 'Check-in' })
    for (const m of satz.matchAll(CHECKOUT_RE)) marken.push({ pos: m.index ?? 0, soll: facts.checkout, name: 'Check-out' })
    if (!marken.length) continue
    marken.sort((x, y) => x.pos - y.pos)
    for (const m of satz.matchAll(ZEIT_RE)) {
      const pos = m.index ?? 0
      // maßgeblich ist das letzte Stichwort VOR der Uhrzeit, sonst das erste danach
      const marke = [...marken].reverse().find((x) => x.pos < pos) ?? marken[0]
      const zeit = `${m[1].padStart(2, '0')}:${m[2]}`
      if (marke.soll !== zeit) v.push(`${marke.name}-Zeit „${zeit}“ weicht von den Stammdaten ab`)
    }
  }
  return v
}

function entwurfVerstoesse(entwurf: string, fakten: string[], facts: Facts): string[] {
  const v: string[] = []
  if (entwurf.trim().length < 12) v.push('Entwurf leer')
  if (entwurf.length > 600) v.push('Entwurf zu lang')
  if (/€|\beur\b|\beuro/i.test(entwurf)) v.push('Geldbetrag im Entwurf')
  if (/ich (prüfe|kläre|frage|schaue|melde|kümmere|leite|gebe)|wir (prüfen|klären|melden|kümmern|schauen|fragen)|melden? (mich|uns)|bescheid|rückmeldung|versprech|garantier|ausnahmsweise|geht klar|kein problem/i.test(entwurf)) v.push('Zusage/Ankündigung im Entwurf')
  if (/natürlich|selbstverständlich|in ordnung|\bpasst\b|ja,? das geht|geht (das|in ordnung)|früher|\beher\b|später|länger|\b(schon|bereits) (ab|um|vor|gegen)\b|ausnahme|kulanz|\bgerne?\b|(kannst|könnt|können|darfst|dürft) (du |ihr |sie )?ruhig|jederzeit|machbar|einrichten|entgegenkommen/i.test(entwurf)) v.push('Zusage/Entgegenkommen im Entwurf')
  if (/code|schlüssel|keybox|tresor|\bpin\b/i.test(entwurf)) v.push('Zugang/Code im Entwurf')
  if (/@/.test(entwurf)) v.push('E-Mail-Adresse im Entwurf')
  if (/\?/.test(entwurf)) v.push('Rückfrage im Entwurf')
  if (!fakten.length) v.push('keine Fakten-Belege angegeben')
  for (const id of fakten) if (!facts.ids.has(id)) v.push(`unbekannter Fakten-Beleg ${id}`)
  v.push(...zahlenVerstoesse(entwurf, facts, fakten))
  v.push(...zeitVerstoesse(entwurf, facts))
  for (const u of entwurf.match(/https?:\/\/\S+|www\.\S+/gi) ?? []) {
    if (!facts.lines.some((x) => x.text.includes(u.replace(/[).,!?]+$/, '')))) v.push('Link steht nicht in den Fakten')
  }
  return v
}

/** Uhrzeit-Schreibweisen vereinheitlichen, damit „16:00 Uhr" = „4:00 PM" = „16.00 uur" = „16h00" gilt.
 *  ampm nur für englische Texte (im Deutschen ist „am" eine Präposition). */
function zeitNorm(s: string, ampm: boolean): string {
  const pad = (h: number, m: string) => `${String(h).padStart(2, '0')}:${m}`
  const t = !ampm ? s : s.replace(/\b(\d{1,2})(?:[:.](\d{2}))?\s?(a\.?m\.?|p\.?m\.?)(?![a-z])/gi, (_m, h: string, mm: string | undefined, ap: string) =>
    pad((Number(h) % 12) + (/p/i.test(ap) ? 12 : 0), mm ?? '00'))
  return t
    .replace(/\b(\d{1,2})\s?h\s?(\d{2})\b/gi, (_m, h: string, mm: string) => pad(Number(h), mm))
    .replace(/\b(\d{1,2})[:.](\d{2})\b(?![.:,]?\d)/g, (_m, h: string, mm: string) => pad(Number(h), mm))
}

/** Zusage-/Entgegenkommens-Floskeln, die eine Übersetzung nicht HINZUFÜGEN darf (der deutsche
 *  Entwurf enthält sie nachweislich nicht — siehe entwurfVerstoesse) */
const UEBERSETZUNG_ZUSAGE = /\bearl(y|ier)\b|\bsooner\b|no problem|of course|feel free|welcome to|\banytime\b|\bvroeger\b|\beerder\b|geen probleem|natuurlijk|plus t[oô]t|pas de probl[eè]me|bien s[uû]r|sans souci|n'h[eé]sitez/i

/** Nach dem Übersetzen: Ziffern/Uhrzeiten (in Reihenfolge), WLAN-Daten und Links müssen unverändert sein. */
function uebersetzungsFehler(de: string, sent: string, lang: string, literals: string[]): string | null {
  if (!SPRACHEN.includes(lang)) return `Sprache „${lang}“ ist nicht freigegeben`
  if (!sent.trim()) return 'Übersetzung leer'
  // Zahlen in der Reihenfolge ihres Auftretens — auch vertauschte Uhrzeiten fallen auf
  const folge = (s: string, ampm: boolean): string => (zeitNorm(s, ampm).match(/\d+(?:[.:,]\d+)*/g) ?? []).join('|')
  if (folge(de, false) !== folge(sent, lang === 'en')) return 'Übersetzung verändert Zahlen/Uhrzeiten'
  for (const l of literals) if (de.includes(l) && !sent.includes(l)) return 'Übersetzung verändert WLAN-Daten'
  for (const u of de.match(/https?:\/\/\S+/g) ?? []) if (!sent.includes(u.replace(/[).,!?]+$/, ''))) return 'Übersetzung verändert einen Link'
  if (sent.length > de.length * 1.6 + 40) return 'Übersetzung auffällig lang'
  if (lang !== 'de') {
    const z = sent.match(UEBERSETZUNG_ZUSAGE)
    if (z) return `Übersetzung enthält eine Zusage/Ergänzung („${z[0]}“)`
    if (/\?/.test(sent)) return 'Übersetzung enthält eine Rückfrage'
  }
  return null
}

/** Treue-Prüfung der Übersetzung durch ein Modell (Sinnumkehr, Zusätze) — fail-closed. */
async function uebersetzungUntreu(de: string, sent: string, lang: string): Promise<string | null> {
  const o = parseObj(await askClaude(SYS_UEBERSETZUNG, `ORIGINAL (Deutsch):\n${de}\n\nÜBERSETZUNG (${lang}):\n${sent}`, 300))
  if (o?.gleich === true) return null
  const abw = typeof o?.abweichung === 'string' ? o.abweichung.replace(/\s+/g, ' ').slice(0, 120) : ''
  return `Übersetzung weicht vom deutschen Entwurf ab${abw ? ` (${abw})` : ''}`
}

/* ───────────── Stufen 1–3: Klassifikator, zwei Entwürfe, Richter ───────────── */

interface Urteil {
  sendbar: boolean
  kategorie: string | null
  konfidenz: number | null
  entwurf: string | null
  grund: string
  detail: Record<string, unknown>
}
interface Entwurf { beantwortbar: boolean; antwort: string; fakten: string[]; sicherheit: number; fehlend: string }

function parseEntwurf(raw: string): Entwurf | null {
  const o = parseObj(raw)
  const s = pct(o?.sicherheit)
  if (!o || typeof o.beantwortbar !== 'boolean' || s === null) return null
  return {
    beantwortbar: o.beantwortbar,
    antwort: typeof o.antwort === 'string' ? o.antwort.trim() : '',
    fakten: Array.isArray(o.fakten) ? o.fakten.filter((x): x is string => typeof x === 'string').map((x) => x.replace(/[^A-Za-z0-9]/g, '')) : [],
    sicherheit: s,
    fehlend: typeof o.fehlend === 'string' ? o.fehlend.slice(0, 200) : '',
  }
}

async function bewerte(k: { gastDe: string; gastOriginal: string; verlauf: string; verlaufGast: string; facts: Facts; schwelle: number }): Promise<Urteil> {
  const detail: Record<string, unknown> = {}
  const nein = (grund: string, extra: Partial<Urteil> = {}): Urteil =>
    ({ sendbar: false, kategorie: null, konfidenz: null, entwurf: null, grund: grund.slice(0, 300), detail, ...extra })

  // Stufe 0 — Stichwort-Sperre auf Original UND deutscher Fassung, je auch in Umschrift (kein KI-Aufruf)
  const veto = codeVeto(vetoText(`${k.gastOriginal}\n${k.gastDe}`))
  if (veto) return nein(`Stichwort-Sperre: ${veto}`, { kategorie: 'sperre' })
  // ernste Themen (Beschwerde, Mangel, Notfall, Storno, Recht) sperren auch aus dem jüngsten Verlauf
  const vetoVerlauf = k.verlaufGast ? codeVeto(vetoText(k.verlaufGast), true) : null
  if (vetoVerlauf) return nein(`Stichwort-Sperre (jüngster Verlauf): ${vetoVerlauf}`, { kategorie: 'sperre' })
  if (k.gastDe.length > 700) return nein('Nachricht zu lang für eine einfache Frage', { kategorie: 'sperre' })

  // Stufe 1 — Klassifikator
  const kl = parseObj(await askClaude(SYS_KLASSE,
    `${k.verlauf ? `VERLAUF DAVOR (nur zum Verständnis, älteste zuerst):\n${k.verlauf}\n\n` : ''}NEUE GAST-NACHRICHT:\n${k.gastDe}`,
    400, FAST_MODEL))
  const kategorie = typeof kl?.kategorie === 'string' ? kl.kategorie.toLowerCase().trim() : ''
  const kSicher = pct(kl?.sicherheit)
  detail.klasse = kl
  if (!kl || !kategorie || kSicher === null) return nein('Klassifikator-Antwort nicht lesbar')
  if (!(AUTOREPLY_KATEGORIEN as readonly string[]).includes(kategorie)) return nein(`Kategorie „${kategorie}“ wird nie automatisch beantwortet`, { kategorie })
  // jedes Feld muss ausdrücklich den unkritischen Wert tragen (fehlend = durchgefallen)
  if (kl.mehrere_anliegen !== false) return nein('mehrere Anliegen in einer Nachricht', { kategorie })
  if (kl.sonderwunsch !== false) return nein('Sonderwunsch – braucht eine Entscheidung des Teams', { kategorie })
  if (kl.ton !== 'neutral') return nein(`Ton „${String(kl.ton ?? '?').slice(0, 20)}“ – Mensch soll antworten`, { kategorie })
  if (kl.eigenstaendig !== true) return nein('Frage ohne Verlauf nicht eindeutig', { kategorie })

  // Stufe 2 — zwei UNABHÄNGIGE Entwürfe (anderes Modell, anderer Prompt, Fakten in anderer Reihenfolge)
  const frage = `FRAGE DES GASTES:\n${k.gastDe}`
  const faktenB = [...k.facts.lines].reverse().map((x) => `[${x.id}] ${x.text}`).join('\n')
  const [rawA, rawB] = await Promise.all([
    askClaude(SYS_ENTWURF_A, `FAKTEN:\n${k.facts.text}\n\n${frage}`, 1200),
    askClaude(SYS_ENTWURF_B, `${frage}\n\nFAKTEN:\n${faktenB}`, 3000, SMART_MODEL),
  ])
  const a = parseEntwurf(rawA)
  const b = parseEntwurf(rawB)
  detail.a = a ? { beantwortbar: a.beantwortbar, sicherheit: a.sicherheit, fakten: a.fakten, fehlend: a.fehlend } : null
  detail.b = b ? { beantwortbar: b.beantwortbar, sicherheit: b.sicherheit, antwort: b.antwort.slice(0, 600), fehlend: b.fehlend } : null
  if (!a || !b) return nein('Entwurf nicht lesbar', { kategorie })
  if (!a.beantwortbar || !a.antwort) return nein(`Nicht aus den Fakten beantwortbar${a.fehlend ? `: ${a.fehlend}` : ''}`, { kategorie })
  const entwurf = a.antwort
  if (!b.beantwortbar || !b.antwort) return nein(`Zweiter Durchlauf: nicht aus den Fakten beantwortbar${b.fehlend ? `: ${b.fehlend}` : ''}`, { kategorie, entwurf })

  // Code-Wächter (modellunabhängig)
  const verstoesse = [...entwurfVerstoesse(entwurf, a.fakten, k.facts), ...zahlenVerstoesse(b.antwort, k.facts).map((x) => `Zweiter Durchlauf: ${x}`)]
  detail.verstoesse = verstoesse
  if (verstoesse.length) return nein(`Code-Wächter: ${verstoesse[0]}`, { kategorie, entwurf })

  // Stufe 3 — Richter
  const r = parseObj(await askClaude(SYS_RICHTER,
    `FAKTEN:\n${k.facts.text}\n\n${frage}\n\nENTWURF A:\n${entwurf}\n\nENTWURF B:\n${b.antwort}`, 1200))
  const gleich = pct(r?.gleiche_aussage)
  detail.richter = r
  if (!r || gleich === null) return nein('Richter-Antwort nicht lesbar', { kategorie, entwurf })
  const konfidenz = Math.min(kSicher, a.sicherheit, b.sicherheit, gleich)
  if (r.a_gedeckt !== true) {
    const ung = Array.isArray(r.ungedeckt) ? r.ungedeckt.filter((x): x is string => typeof x === 'string').join('; ').slice(0, 160) : ''
    return nein(`Richter: nicht vollständig durch Fakten gedeckt${ung ? ` (${ung})` : ''}`, { kategorie, entwurf, konfidenz })
  }
  if (r.beantwortet_frage !== true) return nein('Richter: beantwortet die Frage nicht vollständig', { kategorie, entwurf, konfidenz })
  if (r.zusage !== false) return nein('Richter: Zusage, Betrag oder Zugangsdaten im Entwurf', { kategorie, entwurf, konfidenz })
  if (!(konfidenz >= k.schwelle)) return nein(`Konfidenz ${konfidenz} unter der Schwelle ${k.schwelle}`, { kategorie, entwurf, konfidenz })

  return { sendbar: true, kategorie, konfidenz, entwurf, grund: 'alle Prüfungen bestanden', detail }
}

/* ───────────── Kandidaten (nur Buchungs-Welt) ───────────── */

interface MsgRow {
  id: string; booking_id: string; sender_type: string | null; sender_id: string | null
  content: string | null; content_de: string | null; lang: string | null
  created_at: string; read_at: string | null
  no_reply_needed?: boolean | null; phone_resolved?: boolean | null
}
interface Kandidat {
  msg: MsgRow
  /** zusammenhängende Gast-Nachrichten bis zu dieser, älteste zuerst */
  block: MsgRow[]
  verlauf: string
  /** frühere Gast-Nachrichten aus dem Verlauf (Original + deutsche Fassung) — für die Sperre ernster Themen */
  verlaufGast: string
  booking: BookingRow
  listing: ListingRow
  /** gesetzt = Mensch hat Vorrang → wird bewertet und protokolliert, aber NIE gesendet */
  vorrang: string | null
}

const istNotiz = (m: { content: string | null }): boolean => String(m.content ?? '').trimStart().startsWith('☎️')
/** Nur „Spalte gibt es (noch) nicht" gilt als fehlende Migration — jeder andere Fehler ist ein Fehler
 *  (fail-closed: ein vorübergehender DB-Fehler darf keine Sicherung still abschalten). */
const spalteFehlt = (e: { code?: string | null } | null | undefined): boolean => e?.code === '42703' || e?.code === 'PGRST204'

async function loadRecentMessages(sinceIso: string): Promise<MsgRow[]> {
  const COLS = 'id, booking_id, sender_type, sender_id, content, content_de, lang, created_at, read_at, no_reply_needed'
  const run = (cols: string) => supabaseAdmin
    .from('messages').select(cols)
    .not('booking_id', 'is', null).gte('created_at', sinceIso)
    .order('created_at', { ascending: false }).limit(800)
  // phone_resolved mit Retry ohne die Spalte (Muster Inbox)
  let res = await run(COLS + ', phone_resolved')
  if (res.error && spalteFehlt(res.error)) res = await run(COLS)
  if (res.error) throw new Error(res.error.message)
  return (res.data ?? []) as unknown as MsgRow[]
}

interface ThreadKandidat { msg: MsgRow; block: MsgRow[]; verlauf: string; verlaufGast: string; vorrang: string | null }

/**
 * Reine Thread-Analyse (ohne DB): list = Nachrichten EINER Buchung, neueste zuerst.
 * Kandidat ist die neueste Gast-Nachricht (keine ☎️-Notiz), 10 Minuten bis 24 Stunden alt.
 * vorrang = erste zutreffende „Mensch hat Vorrang"-Regel (dann nur Schatten-Stichprobe, nie Versand).
 */
function threadKandidat(list: MsgRow[], now: number): ThreadKandidat | null {
  const idx = list.findIndex((r) => r.sender_type === 'guest' && !istNotiz(r))
  if (idx === -1) return null
  const g = list[idx]
  const alter = now - Date.parse(g.created_at)
  // zu jung (auch: Zeitstempel in der Zukunft) = später erneut ansehen, KEINE Protokollzeile
  if (!(alter >= MIN_ALTER_MS) || alter > PROBE_FENSTER_MS) return null
  if (!String(g.content ?? '').trim()) return null

  const block = [g]
  for (let i = idx + 1; i < list.length && block.length < 4; i++) {
    if (list[i].sender_type !== 'guest' || istNotiz(list[i])) break
    block.push(list[i])
  }
  // mehr als 4 Gast-Nachrichten in Folge: die älteren liefen sonst an der Stichwort-Sperre vorbei
  const naechste = list[idx + block.length]
  const zuViele = !!naechste && naechste.sender_type === 'guest' && !istNotiz(naechste)
  const davor = list.slice(idx + block.length, idx + block.length + 6).reverse()
  block.reverse()
  const verlauf = davor.filter((m) => !istNotiz(m))
    .map((m) => `${m.sender_type === 'guest' ? 'GAST' : 'GASTGEBER'}: ${String(m.content_de || m.content || '').replace(/\s+/g, ' ').slice(0, 300)}`)
    .join('\n')
  // ALLE früheren Gast-Nachrichten des geladenen Fensters (≈ 26 Stunden) für die Sperre ernster Themen
  const verlaufGast = list.slice(idx + block.length)
    .filter((m) => m.sender_type === 'guest' && !istNotiz(m))
    .map((m) => `${String(m.content ?? '').slice(0, 800)}\n${String(m.content_de ?? '').slice(0, 800)}`)
    .join('\n').slice(0, 12_000)

  // Die Vorrang-Regeln gelten für den GANZEN Block (beantwortet werden alle seine Nachrichten, nicht
  // nur die jüngste): Öffnet das Team den Thread nach g1 und der Gast schiebt g2 nach, trägt nur g1
  // read_at; „keine Antwort nötig"/„telefonisch geklärt" markiert die zu dem Zeitpunkt letzte Nachricht.
  const tAeltest = Date.parse(block[0].created_at) // block ist jetzt älteste zuerst
  let vorrang: string | null = null
  const danach = list.slice(0, idx) // alles Neuere stammt von unserer Seite (g ist die neueste Gast-Nachricht)
  if (danach.length) vorrang = danach.some(istNotiz) ? 'Telefonkontakt nach der Nachricht' : 'Team hat bereits geantwortet'
  else if (list.some(istNotiz)) vorrang = 'Telefonkontakt im Thread (letzte 24 Stunden)'
  else if (list.slice(idx + 1).some((m) => m.sender_type !== 'guest' && tAeltest - Date.parse(m.created_at) <= GESPRAECH_MS)) vorrang = 'Host-Nachricht kurz zuvor (Team im Gespräch)'
  else if (block.some((m) => m.read_at)) vorrang = 'Team hat den Thread geöffnet'
  else if (block.some((m) => m.no_reply_needed)) vorrang = 'als „keine Antwort nötig“ markiert'
  else if (block.some((m) => m.phone_resolved)) vorrang = 'als „telefonisch geklärt“ markiert'
  else if (alter > MAX_ALTER_MS) vorrang = `älter als ${G.maxAlterStd} Stunden`
  else if (!(now - tAeltest <= MAX_ALTER_MS)) vorrang = `erste unbeantwortete Gast-Nachricht älter als ${G.maxAlterStd} Stunden`
  else if (zuViele) vorrang = 'mehr als 4 unbeantwortete Gast-Nachrichten in Folge'
  return { msg: g, block, verlauf, verlaufGast, vorrang }
}

async function findCandidates(today: string): Promise<{ kandidaten: Kandidat[]; pool: GuideBlock[] }> {
  const now = Date.now()
  const rows = await loadRecentMessages(new Date(now - PROBE_FENSTER_MS - 2 * 3600_000).toISOString())
  const threads = new Map<string, MsgRow[]>() // je Buchung, neueste zuerst
  for (const r of rows) {
    const list = threads.get(r.booking_id)
    if (list) list.push(r); else threads.set(r.booking_id, [r])
  }

  const roh: ThreadKandidat[] = []
  for (const list of threads.values()) {
    const k = threadKandidat(list, now)
    if (k) roh.push(k)
  }
  if (!roh.length) return { kandidaten: [], pool: [] }

  // schon entschieden? (Unique-Index auf guest_message_id)
  const done = new Set<string>()
  const ids = roh.map((r) => r.msg.id)
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabaseAdmin.from(LOG).select('guest_message_id').in('guest_message_id', ids.slice(i, i + 200))
    if (error) throw new Error(error.message)
    for (const d of data ?? []) done.add(String(d.guest_message_id))
  }
  const offen = roh.filter((r) => !done.has(r.msg.id))
  if (!offen.length) return { kandidaten: [], pool: [] }

  const bIds = [...new Set(offen.map((r) => r.msg.booking_id))]
  const { data: bRows, error: bErr } = await supabaseAdmin
    .from('bookings')
    .select('id, listing_id, status, source, check_in, check_out, guest_name, guest_email, smoobu_reservation_id')
    .in('id', bIds)
  if (bErr) throw new Error(bErr.message)
  const bookings = new Map((bRows ?? []).map((b) => [String(b.id), b as BookingRow]))

  // Website-Gäste mit Direkt-Chat: nicht über diesen Weg (§151)
  const mitKonversation = new Set<string>()
  {
    const { data: convs, error: cErr } = await supabaseAdmin.from('conversations').select('booking_id').in('booking_id', bIds)
    if (cErr) throw new Error(cErr.message)
    for (const c of convs ?? []) if (c.booking_id) mitKonversation.add(String(c.booking_id))
  }
  // Stummschalter — eigene Abfrage, deploy-sicher (Spalte kann fehlen)
  const stumm = new Set<string>()
  {
    const { data: mutes, error } = await supabaseAdmin.from('bookings').select('id, msg_mute').in('id', bIds).not('msg_mute', 'is', null)
    if (error && !spalteFehlt(error)) throw new Error(error.message)
    if (!error) for (const m of mutes ?? []) stumm.add(String(m.id))
  }
  // Vorsprung des Teams an der SICHTBARKEIT festmachen: created_at ist bei Smoobu-Nachrichten die Zeit
  // im Portal — holt erst der 10-Minuten-Abgleich eine Nachricht nach (Webhook ausgefallen), wäre sie
  // beim Import schon „alt genug". messages.inserted_at (DB-Default now()) ist der Moment, ab dem das
  // Team sie sehen konnte. Eigene Abfrage, deploy-sicher: fehlt die Spalte, wird NICHT gesendet.
  const sichtbarSeit = new Map<string, number>()
  let sichtbarFehlt = false
  {
    const mIds = [...new Set(offen.flatMap((r) => r.block.map((m) => m.id)))]
    for (let i = 0; i < mIds.length && !sichtbarFehlt; i += 200) {
      const { data, error } = await supabaseAdmin.from('messages').select('id, inserted_at').in('id', mIds.slice(i, i + 200))
      if (error && !spalteFehlt(error)) throw new Error(error.message)
      if (error) { sichtbarFehlt = true; break }
      for (const d of data ?? []) sichtbarSeit.set(String(d.id), Date.parse(String(d.inserted_at ?? '')))
    }
  }

  // heutige Auto-Antworten (je Thread + gesamt) — zählt auch laufende und unklare Sendungen
  const jeThread = new Map<string, number>()
  let gesamt = 0
  {
    const { data: heute, error: hErr } = await supabaseAdmin
      .from(LOG).select('booking_id, entscheidung, kanal, created_at')
      .in('entscheidung', ['gesendet', 'sendet', 'fehler'])
      .gte('created_at', new Date(now - 26 * 3600_000).toISOString())
    if (hErr) throw new Error(hErr.message)
    for (const h of heute ?? []) {
      if (berlinDateOf(String(h.created_at)) !== today) continue
      if (h.entscheidung === 'fehler' && h.kanal !== 'unklar') continue
      gesamt++
      jeThread.set(String(h.booking_id), (jeThread.get(String(h.booking_id)) ?? 0) + 1)
    }
  }

  const lIds = [...new Set([...bookings.values()].map((b) => b.listing_id).filter((x): x is string => !!x))]
  const listings = new Map<string, ListingRow>()
  if (lIds.length) {
    const { data: lRows, error: lErr } = await supabaseAdmin
      .from('listings').select('id, title, address, city, location, check_in_time, check_out_time, guide').in('id', lIds)
    if (lErr) throw new Error(lErr.message)
    for (const l of lRows ?? []) listings.set(String(l.id), l as ListingRow)
  }
  // Lesefehler = Abbruch: sonst würde still die (ältere) Wohnungs-Mappe zur Faktenbasis
  const { data: poolRow, error: pErr } = await supabaseAdmin.from('app_settings').select('value').eq('key', 'guide_global').maybeSingle()
  if (pErr) throw new Error(pErr.message)
  const pool = parseGuide(poolRow?.value)

  const kandidaten: Kandidat[] = []
  for (const r of offen) {
    const b = bookings.get(r.msg.booking_id)
    // dauerhaft außen vor (ohne Protokollzeile): keine/unbestätigte Buchung, Website-Welt, Aufenthalt vorbei
    if (!b || b.status !== 'confirmed' || !b.listing_id) continue
    if (b.source === 'trimosa' || mitKonversation.has(b.id)) continue
    if (dayDiff(b.check_out, today) > 1) continue
    const l = listings.get(b.listing_id)
    if (!l) continue
    let vorrang = r.vorrang
    if (!vorrang && stumm.has(b.id)) vorrang = 'Nachrichten für diese Buchung sind stummgeschaltet'
    if (!vorrang && (jeThread.get(b.id) ?? 0) >= G.maxProThreadTag) vorrang = 'heute schon eine Auto-Antwort in diesem Thread'
    if (!vorrang && gesamt >= G.maxProTag) vorrang = `Tageslimit von ${G.maxProTag} Auto-Antworten erreicht`
    if (!vorrang) {
      // echter Sende-Kandidat: JEDE Nachricht des Blocks muss dem Team seit ≥ 10 Minuten sichtbar sein
      const seit = r.block.map((m) => sichtbarSeit.get(m.id) ?? NaN)
      if (sichtbarFehlt) vorrang = 'Eingangszeit der Nachricht nicht prüfbar (Migration fehlt)'
      else if (seit.some((t) => !Number.isFinite(t))) vorrang = 'Eingangszeit der Nachricht nicht prüfbar'
      // erst seit weniger als 10 Minuten sichtbar (auch: Zeit in der Zukunft) → später erneut ansehen, KEINE Protokollzeile
      else if (!(now - Math.max(...seit) >= MIN_ALTER_MS)) continue
    }
    kandidaten.push({ msg: r.msg, block: r.block, verlauf: r.verlauf, verlaufGast: r.verlaufGast, booking: b, listing: l, vorrang })
  }
  // echte Sende-Kandidaten zuerst (älteste vorn — sie laufen als Erste aus dem 6-Stunden-Fenster),
  // danach die Schatten-Stichprobe (neueste vorn)
  kandidaten.sort((x, y) => {
    if (!x.vorrang !== !y.vorrang) return x.vorrang ? 1 : -1
    const d = Date.parse(x.msg.created_at) - Date.parse(y.msg.created_at)
    return x.vorrang ? -d : d
  })
  return { kandidaten, pool }
}

/**
 * Letzter Blick unmittelbar vor dem Versand (Race): Schalter, Tor, frischer STRENGER Smoobu-Abgleich
 * (Antworten aus der Airbnb-/Booking-App kommen nur per Sync; ein Smoobu-Fehler = kein Versand),
 * Buchung, Stummschalter, Tageszähler, Uhrzeit, Markierungen, 6-Stunden-Grenze — und GANZ ZUM
 * SCHLUSS der Thread selbst, damit zwischen Thread-Prüfung und Versand keine weitere Abfrage liegt.
 * Markierungen (geöffnet / keine Antwort nötig / telefonisch geklärt) werden für ALLE Nachrichten
 * des Blocks geprüft, nicht nur für die jüngste.
 * Liefert einen Grund → es wird NICHT gesendet. Jeder Lesefehler ist ein Grund (fail-closed).
 */
async function letzterBlick(c: Kandidat, logId: string, today: string): Promise<string | null> {
  const s = await getAutoReplySettings()
  if (s.mode !== 'aktiv') return 'Modus wurde inzwischen umgeschaltet'
  if (!(await aktivGate()).ok) return 'Tor ist nicht mehr erfüllt'

  if (c.booking.smoobu_reservation_id) {
    try {
      const { syncBookingMessages } = await import('@/lib/message-sync')
      await syncBookingMessages({
        id: c.booking.id, guest_name: c.booking.guest_name,
        smoobu_reservation_id: c.booking.smoobu_reservation_id, listingTitle: c.listing.title,
      }, { strict: true })
    } catch {
      return 'Smoobu-Abgleich vor dem Versand fehlgeschlagen'
    }
  }

  const { data: b, error: bErr } = await supabaseAdmin.from('bookings').select('status').eq('id', c.booking.id).maybeSingle()
  if (bErr || b?.status !== 'confirmed') return 'Buchung ist nicht mehr bestätigt'
  {
    const { data: m, error: mErr } = await supabaseAdmin.from('bookings').select('msg_mute').eq('id', c.booking.id).maybeSingle()
    if (mErr && !spalteFehlt(mErr)) return 'Stummschaltung nicht prüfbar'
    if (!mErr && m?.msg_mute) return 'Nachrichten für diese Buchung sind stummgeschaltet'
  }

  // Parallel-Lauf: hat inzwischen ein anderer Lauf in diesem Thread gesendet?
  const { data: andere, error: aErr } = await supabaseAdmin
    .from(LOG).select('id, entscheidung, kanal, created_at')
    .eq('booking_id', c.booking.id).neq('id', logId).in('entscheidung', ['gesendet', 'sendet', 'fehler'])
    .gte('created_at', new Date(Date.now() - 26 * 3600_000).toISOString())
  if (aErr) return 'Protokoll vor dem Versand nicht lesbar'
  const heute = (andere ?? []).filter((h) => berlinDateOf(String(h.created_at)) === today && !(h.entscheidung === 'fehler' && h.kanal !== 'unklar'))
  if (heute.length >= G.maxProThreadTag) return 'heute schon eine Auto-Antwort in diesem Thread'

  const { hour } = berlinNow()
  if (hour < G.stundeVon || hour >= G.stundeBis) return `außerhalb ${G.stundeVon}–${G.stundeBis} Uhr`

  // Markierungen und Zeitfenster gelten für den GANZEN Block (alle Nachrichten, die beantwortet würden)
  const blockIds = c.block.map((m) => m.id)
  {
    const { data: p, error: pErr } = await supabaseAdmin.from('messages').select('id, phone_resolved').in('id', blockIds)
    if (pErr && !spalteFehlt(pErr)) return 'Markierung „telefonisch geklärt“ nicht prüfbar'
    if (!pErr && (p ?? []).some((m) => m.phone_resolved)) return 'inzwischen als „telefonisch geklärt“ markiert'
  }

  // Obergrenze erneut (zwischen Kandidatensuche und Versand können Minuten liegen) — ohne Abfrage
  if (!(Date.now() - Date.parse(c.msg.created_at) <= MAX_ALTER_MS)) return `älter als ${G.maxAlterStd} Stunden`
  if (!(Date.now() - Date.parse(c.block[0].created_at) <= MAX_ALTER_MS)) return `erste unbeantwortete Gast-Nachricht älter als ${G.maxAlterStd} Stunden`

  // ZULETZT der Thread: der Block muss unverändert das Ende des Threads sein (jüngste Gast-Nachricht
  // weiterhin die letzte, nichts dazwischen nachsynchronisiert), KEINE seiner Nachrichten geöffnet
  // oder markiert; keine Host-Nachricht (auch frisch synchronisiert, auch mit Zeitstempel-Versatz)
  // kurz vor dem Block. limit(8) reicht: der Block hat höchstens 4 Nachrichten.
  const { data: last, error } = await supabaseAdmin
    .from('messages').select('id, sender_type, created_at, read_at, no_reply_needed')
    .eq('booking_id', c.booking.id).order('created_at', { ascending: false }).limit(8)
  if (error || !last?.length) return 'Thread vor dem Versand nicht lesbar'
  if (String(last[0].id) !== c.msg.id) return last[0].sender_type === 'guest' ? 'Gast hat inzwischen weitergeschrieben' : 'Team hat inzwischen geantwortet'
  const ids = new Set(blockIds)
  const blk = last.slice(0, blockIds.length)
  if (blk.length !== blockIds.length || !blk.every((m) => ids.has(String(m.id)) && m.sender_type === 'guest')) return 'Thread hat sich inzwischen geändert'
  if (blk.some((m) => m.read_at)) return 'Team hat den Thread inzwischen geöffnet'
  if (blk.some((m) => m.no_reply_needed)) return 'inzwischen als „keine Antwort nötig“ markiert'
  const t0 = Math.min(...blk.map((m) => Date.parse(String(m.created_at))))
  if (!Number.isFinite(t0)) return 'Thread vor dem Versand nicht lesbar'
  if (last.slice(blk.length).some((m) => m.sender_type !== 'guest' && t0 - Date.parse(String(m.created_at)) <= GESPRAECH_MS)) return 'Host-Nachricht kurz vor der Gast-Nachricht (Team im Gespräch)'
  return null
}

/* ───────────── Der Lauf ───────────── */

export interface AutoReplyReport {
  mode: AutoReplyMode
  /** wie der Lauf tatsächlich arbeitete ('aktiv' nur mit erfülltem Tor) */
  wirksam: AutoReplyMode
  hinweis?: string
  geprueft: number
  haetteGesendet: number
  vorrang: number
  abgelehnt: number
  gesendet: number
  fehler: number
}

export async function runAutoReply(): Promise<AutoReplyReport> {
  const startedAt = Date.now()
  const settings = await getAutoReplySettings()
  const report: AutoReplyReport = { mode: settings.mode, wirksam: 'aus', geprueft: 0, haetteGesendet: 0, vorrang: 0, abgelehnt: 0, gesendet: 0, fehler: 0 }
  if (settings.mode === 'aus') return report

  // Ohne Tabelle still aus — auch wenn der Modus schon gespeichert ist
  const table = await autoReplyTableReady()
  if (!table.ok) return { ...report, hinweis: 'Tabelle ai_autoreply_log fehlt (Migration) – System inaktiv' }

  // Hänger aufräumen (auch in der Ruhezeit): 'laeuft' = Prüfung abgebrochen (nichts gesendet);
  // 'sendet' = Zustellung UNKLAR → nie erneut senden (Unique-Index), Team benachrichtigen
  const alt = new Date(Date.now() - STALE_MS).toISOString()
  await supabaseAdmin.from(LOG)
    .update({ entscheidung: 'fehler', grund: 'Abbruch während der Prüfung (Zeitlimit) – nichts gesendet' })
    .eq('entscheidung', 'laeuft').lt('created_at', alt)
  const { data: haenger } = await supabaseAdmin.from(LOG)
    .update({ entscheidung: 'fehler', kanal: 'unklar', grund: 'Abbruch während des Versands – Zustellung unklar, bitte den Thread prüfen' })
    .eq('entscheidung', 'sendet').lt('created_at', alt).select('booking_id')
  for (const h of haenger ?? []) {
    await sendPushToTeam('⚠️ KI-Auto-Antwort: Versand unklar', 'Ein automatischer Versand wurde unterbrochen – bitte im Thread prüfen, ob die Antwort beim Gast ankam.', '/team?conv=' + h.booking_id, { guestChat: true }).catch(() => {})
  }

  const { date: today, hour } = berlinNow()
  if (hour < G.stundeVon || hour >= G.stundeBis) return { ...report, hinweis: `Ruhezeit (außerhalb ${G.stundeVon}–${G.stundeBis} Uhr)` }

  // Tor bei JEDEM Lauf neu prüfen: nicht (mehr) erfüllt → 'aktiv' verhält sich wie 'schatten'
  const gate = settings.mode === 'aktiv' ? await aktivGate() : null
  const wirksam: 'schatten' | 'aktiv' = settings.mode === 'aktiv' && gate?.ok === true ? 'aktiv' : 'schatten'
  report.wirksam = wirksam
  if (settings.mode === 'aktiv' && wirksam !== 'aktiv') {
    report.hinweis = `Tor nicht erfüllt: ${gate?.grund ?? '—'} – arbeite wie im Schatten-Modus`
    // inhaltlich zugefallen (nicht: Pause/Technik) → Modus dauerhaft zurückstellen; nur ein Admin
    // schaltet wieder ein (ein Nicht-Admin kann den Versand so nie über Urteile zurückholen)
    if (gate?.art === 'qualitaet' && await aufSchattenZurueck(gate.grund)) {
      report.mode = 'schatten'
      report.hinweis += ' · Modus auf „Schatten“ zurückgestellt'
    }
  }

  const { kandidaten, pool } = await findCandidates(today)

  for (const c of kandidaten.slice(0, G.maxProLauf)) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break

    // Sprache + deutsche Fassung ALLER Nachrichten des Blocks (fehlen sie noch: jetzt erkennen;
    // ohne Ergebnis für die jüngste Nachricht → nächster Lauf)
    const ohneSprache = c.block.filter((m) => !m.lang && String(m.content ?? '').trim())
    if (ohneSprache.length) {
      const tr = await translateIncoming(ohneSprache.map((m) => ({ id: m.id, text: String(m.content ?? '') })))
      for (const m of ohneSprache) {
        const t = tr.get(m.id)
        if (t?.lang) { m.lang = t.lang; m.content_de = t.german }
      }
    }
    const lang = c.msg.lang
    if (!lang) continue
    const gastDe = c.block.map((m) => String(m.content_de || m.content || '').trim().slice(0, 800)).filter(Boolean).join('\n')
    const gastOriginal = c.block.map((m) => String(m.content ?? '').trim().slice(0, 800)).join('\n')

    // CLAIM vor jeder KI-Prüfung und vor jedem Versand — Unique-Index auf guest_message_id:
    // scheitert der Insert, hat ein anderer Lauf diese Nachricht (oder die Tabelle ist weg) → nichts tun
    const { data: claim, error: claimErr } = await supabaseAdmin.from(LOG).insert({
      booking_id: c.booking.id, listing_id: c.listing.id, guest_message_id: c.msg.id,
      modus: wirksam, gast_text: gastDe.slice(0, 4000), gast_lang: lang, entscheidung: 'laeuft',
    }).select('id').single()
    if (claimErr || !claim) continue
    const logId = String(claim.id)
    report.geprueft++
    // wirft nie — ein gescheitertes Protokoll-Update darf den Lauf nicht in den falschen Zweig schicken
    const finish = async (entscheidung: string, grund: string, u?: Urteil, extra: Record<string, unknown> = {}) => {
      try {
        const { error } = await supabaseAdmin.from(LOG).update({
          entscheidung, grund: grund.slice(0, 300),
          ...(u ? { kategorie: u.kategorie, konfidenz: u.konfidenz, entwurf: u.entwurf, detail: u.detail } : {}),
          ...extra,
        }).eq('id', logId)
        if (error) console.error('[ai-autoreply] Protokoll-Update fehlgeschlagen:', error.message)
      } catch (e) {
        console.error('[ai-autoreply] Protokoll-Update fehlgeschlagen:', e)
      }
    }

    let versandBegonnen = false
    try {
      if (!SPRACHEN.includes(lang)) {
        await finish('abgelehnt', `Sprache „${lang}“ ist nicht freigegeben`)
        report.abgelehnt++
        continue
      }
      // Die Stichwort-Sperre braucht Original UND deutsche Fassung — fehlt die deutsche Fassung einer
      // fremdsprachigen Nachricht (Übersetzung gescheitert), ist sie nicht prüfbar → kein Versand
      const deFehlt = c.block.some((m) => String(m.content ?? '').trim() && m.lang !== 'de' && !String(m.content_de ?? '').trim())
      if (deFehlt) {
        await finish('abgelehnt', 'deutsche Fassung der Gast-Nachricht fehlt – Stichwort-Sperre nicht prüfbar')
        report.abgelehnt++
        continue
      }
      const facts = buildFacts(c.booking, c.listing, pool, today)
      const u = await bewerte({ gastDe, gastOriginal, verlauf: c.verlauf, verlaufGast: c.verlaufGast, facts, schwelle: settings.schwelle })

      if (!u.sendbar || !u.entwurf) { await finish('abgelehnt', u.grund, u); report.abgelehnt++; continue }
      if (c.vorrang) { await finish('vorrang', `Mensch hat Vorrang: ${c.vorrang}`, u); report.vorrang++; continue }
      if (wirksam !== 'aktiv') {
        await finish('haette_gesendet', settings.mode === 'aktiv' ? `Tor nicht erfüllt (${gate?.grund ?? '—'})` : 'Schatten-Modus – nichts gesendet', u)
        report.haetteGesendet++
        continue
      }

      // ── AKTIV: Sende-Claim (atomar — nur wer 'laeuft' → 'sendet' umschreibt, darf senden) ──
      const { data: sc } = await supabaseAdmin.from(LOG)
        .update({ entscheidung: 'sendet', kategorie: u.kategorie, konfidenz: u.konfidenz, entwurf: u.entwurf, detail: u.detail })
        .eq('id', logId).eq('entscheidung', 'laeuft').select('id')
      if (!sc?.length) continue
      versandBegonnen = true

      const entwurf = u.entwurf
      const sperre: { art: 'vorrang' | 'abgelehnt' | null; grund: string } = { art: null, grund: '' }
      let res: Awaited<ReturnType<typeof import('@/lib/voice').deliverToGuest>>
      try {
        const { deliverToGuest } = await import('@/lib/voice')
        res = await deliverToGuest(c.booking.id, entwurf, {
          testMode: false,
          auto: {
            guard: async (sent, sentLang) => {
              const tf = uebersetzungsFehler(entwurf, sent, sentLang, facts.literals)
                ?? (sentLang !== 'de' ? await uebersetzungUntreu(entwurf, sent, sentLang) : null)
              if (tf) { sperre.art = 'abgelehnt'; sperre.grund = tf; return tf }
              const lb = await letzterBlick(c, logId, today)
              if (lb) { sperre.art = 'vorrang'; sperre.grund = `Kurz vor dem Versand gestoppt: ${lb}`; return lb }
              return null
            },
          },
        })
      } catch (e) {
        // Zustellung UNKLAR (z. B. Timeout nach dem Absenden) → nie erneut senden, Team benachrichtigen
        console.error('[ai-autoreply] Versand abgebrochen:', e)
        await finish('fehler', 'Abbruch während des Versands – Zustellung unklar, bitte den Thread prüfen', undefined, { kanal: 'unklar' })
        await sendPushToTeam('⚠️ KI-Auto-Antwort: Versand unklar', 'Ein automatischer Versand wurde unterbrochen – bitte im Thread prüfen, ob die Antwort beim Gast ankam.', '/team?conv=' + c.booking.id, { guestChat: true }).catch(() => {})
        report.fehler++
        continue
      }

      if (res.delivery === 'smoobu' || res.delivery === 'email') {
        // nie res.detail ins Protokoll — bei E-Mail steht dort die Adresse des Gastes
        await finish('gesendet', 'automatisch beantwortet', undefined, {
          kanal: res.delivery, sent_message_id: res.messageId ?? null,
          gesendet_text: (res.sentText ?? entwurf).slice(0, 4000), gesendet_at: new Date().toISOString(),
        })
        report.gesendet++
        const vorname = (c.booking.guest_name ?? 'Gast').trim().split(/\s+/)[0] || 'Gast'
        // WLAN-Passwörter nie in den Push (Sperrbildschirm, push_log) — im Thread steht der volle Text
        const pushText = facts.geheim.reduce((t, g) => (g ? t.split(g).join('•••') : t), entwurf)
        await sendPushToTeam(
          `🤖 Automatisch beantwortet · ${vorname}${c.listing.title ? ` · ${c.listing.title}` : ''}`,
          `„${gastDe.replace(/\s+/g, ' ').slice(0, 70)}“ → ${pushText.replace(/\s+/g, ' ').slice(0, 160)}${res.lang && res.lang !== 'de' ? ` (gesendet auf ${res.lang.toUpperCase()})` : ''}`,
          '/team?conv=' + c.booking.id, { guestChat: true },
        ).catch(() => {})
        console.log('[ai-autoreply] gesendet:', c.booking.id.slice(0, 8), u.kategorie, u.konfidenz, res.delivery)
      } else if (sperre.art) {
        await finish(sperre.art, sperre.grund)
        if (sperre.art === 'vorrang') report.vorrang++; else report.abgelehnt++
      } else {
        await finish('fehler', `nicht zugestellt: ${res.detail ?? 'kein Kanal'}`)
        report.fehler++
      }
    } catch (e) {
      console.error('[ai-autoreply] Kandidat fehlgeschlagen:', e)
      if (versandBegonnen) {
        // nach dem Sende-Claim: Zustellung im Zweifel UNKLAR — zählt für das Tageslimit, nie Wiederholung
        await finish('fehler', 'Fehler nach Versand-Beginn – Zustellung unklar, bitte den Thread prüfen', undefined, { kanal: 'unklar' })
      } else {
        // Fehler VOR dem Versand (KI/DB): nichts gesendet; keine Wiederholung (Zeile bleibt als 'fehler')
        await finish('fehler', `Prüfung fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`)
      }
      report.fehler++
    }
  }

  if (report.geprueft) console.log('[ai-autoreply] Lauf:', JSON.stringify(report))
  return report
}

/* ───────────── Protokoll fürs Panel + Bewertung ───────────── */

export interface AutoReplyLogRow {
  id: string
  created_at: string
  booking_id: string
  gast: string
  wohnung: string | null
  modus: string
  kategorie: string | null
  konfidenz: number | null
  gast_text: string | null
  gast_lang: string | null
  entwurf: string | null
  gesendet_text: string | null
  entscheidung: string
  grund: string | null
  kanal: string | null
  bewertung: 'richtig' | 'falsch' | null
  /** wer bewertet hat (Nutzer-id) — das Panel sperrt fremde Urteile für Nicht-Admins */
  bewertet_von: string | null
  bewertet_name: string | null
  bewertet_at: string | null
  /** was das Team tatsächlich geantwortet hat (erste Host-Nachricht danach) — Hilfe beim Bewerten */
  team_antwort: string | null
}

export async function listAutoReplyLog(limit = 50): Promise<AutoReplyLogRow[]> {
  const { data, error } = await supabaseAdmin
    .from(LOG)
    .select('id, created_at, booking_id, listing_id, guest_message_id, modus, kategorie, konfidenz, gast_text, gast_lang, entwurf, gesendet_text, entscheidung, grund, kanal, sent_message_id, bewertung, bewertet_von, bewertet_name, bewertet_at')
    .order('created_at', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  const rows = data ?? []
  if (!rows.length) return []

  const bIds = [...new Set(rows.map((r) => String(r.booking_id)))]
  const lIds = [...new Set(rows.map((r) => r.listing_id).filter((x): x is string => !!x))]
  const gIds = rows.map((r) => String(r.guest_message_id))
  const [{ data: bs }, { data: ls }, { data: gs }] = await Promise.all([
    supabaseAdmin.from('bookings').select('id, guest_name').in('id', bIds),
    lIds.length ? supabaseAdmin.from('listings').select('id, title').in('id', lIds) : Promise.resolve({ data: [] as { id: string; title: string | null }[] }),
    supabaseAdmin.from('messages').select('id, created_at').in('id', gIds),
  ])
  const gast = new Map((bs ?? []).map((b) => [String(b.id), String(b.guest_name ?? 'Gast').trim().split(/\s+/)[0] || 'Gast']))
  const wohnung = new Map((ls ?? []).map((l) => [String(l.id), l.title ? String(l.title) : null]))
  const gastZeit = new Map((gs ?? []).map((g) => [String(g.id), Date.parse(String(g.created_at))]))

  // Team-Antworten: erste Host-Nachricht nach der Gast-Nachricht (keine Notiz, keine Auto-Antwort)
  const eigene = new Set(rows.map((r) => r.sent_message_id).filter((x): x is string => !!x).map(String))
  const fruehest = Math.min(...[...gastZeit.values()].filter((t) => Number.isFinite(t)), Date.now())
  const { data: hosts } = await supabaseAdmin
    .from('messages').select('id, booking_id, content, content_de, created_at')
    .in('booking_id', bIds).eq('sender_type', 'host')
    .gte('created_at', new Date(fruehest).toISOString())
    .order('created_at', { ascending: true }).limit(1000)
  const hostsBy = new Map<string, { t: number; text: string }[]>()
  for (const h of hosts ?? []) {
    if (eigene.has(String(h.id)) || istNotiz(h)) continue
    const k = String(h.booking_id)
    const list = hostsBy.get(k) ?? []
    list.push({ t: Date.parse(String(h.created_at)), text: String(h.content_de || h.content || '') })
    hostsBy.set(k, list)
  }

  return rows.map((r) => {
    const t0 = gastZeit.get(String(r.guest_message_id))
    const antwort = t0 == null ? null : (hostsBy.get(String(r.booking_id)) ?? []).find((h) => h.t > t0)
    return {
      id: String(r.id), created_at: String(r.created_at), booking_id: String(r.booking_id),
      gast: gast.get(String(r.booking_id)) ?? 'Gast',
      wohnung: r.listing_id ? wohnung.get(String(r.listing_id)) ?? null : null,
      modus: String(r.modus), kategorie: r.kategorie ?? null, konfidenz: r.konfidenz ?? null,
      gast_text: r.gast_text ?? null, gast_lang: r.gast_lang ?? null,
      entwurf: r.entwurf ?? null, gesendet_text: r.gesendet_text ?? null,
      entscheidung: String(r.entscheidung), grund: r.grund ?? null, kanal: r.kanal ?? null,
      bewertung: r.bewertung === 'richtig' || r.bewertung === 'falsch' ? r.bewertung : null,
      bewertet_von: r.bewertet_von ? String(r.bewertet_von) : null,
      bewertet_name: r.bewertet_name ?? null, bewertet_at: r.bewertet_at ?? null,
      team_antwort: antwort ? antwort.text.slice(0, 1200) : null,
    }
  })
}

/**
 * Bewertung durch einen Menschen (richtig/falsch; null = zurücknehmen). Speichert, wer und wann.
 * Das Urteil eines ANDEREN ändert oder löscht nur ein Admin — sonst könnte ein Gastgeber die
 * 'falsch'-Urteile eines Admins drehen und so das Tor für den echten Versand wieder öffnen.
 */
export async function rateAutoReply(
  id: string, bewertung: 'richtig' | 'falsch' | null, wer: { id: string; name: string; isAdmin: boolean },
): Promise<'ok' | 'fremd' | 'fehlt'> {
  let q = supabaseAdmin.from(LOG)
    .update(bewertung
      ? { bewertung, bewertet_von: wer.id, bewertet_name: wer.name.slice(0, 40), bewertet_at: new Date().toISOString() }
      : { bewertung: null, bewertet_von: null, bewertet_name: null, bewertet_at: null })
    .eq('id', id).not('entscheidung', 'in', '(laeuft,sendet)')
  if (!wer.isAdmin) q = q.or(`bewertet_von.is.null,bewertet_von.eq.${wer.id}`)
  const { data, error } = await q.select('id')
  if (error) throw new Error(error.message)
  if (data?.length) return 'ok'
  if (!wer.isAdmin) {
    const { data: row } = await supabaseAdmin.from(LOG).select('bewertet_von, entscheidung').eq('id', id).maybeSingle()
    if (row && row.entscheidung !== 'laeuft' && row.entscheidung !== 'sendet' && row.bewertet_von && row.bewertet_von !== wer.id) return 'fremd'
  }
  return 'fehlt'
}
