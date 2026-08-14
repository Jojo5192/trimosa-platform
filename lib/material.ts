// server-only (Kommentar-Konvention §243)
import { supabaseAdmin } from '@/lib/supabase-admin'
import { askClaude, FAST_MODEL } from '@/lib/ai'
import { getClaudeBotId, postAsClaude } from '@/lib/claude-bot'
import { parseJsonLoose } from '@/lib/beleg-ki'

/**
 * 🛒 §266f MATERIAL-SYSTEM — „Sprachnachricht rein, Warenkorb raus":
 * Putzkräfte melden Verbrauchs-Bedarf formlos in der Intern-Gruppe
 * „🛒 Material" (Text oder Sprachnachricht — das Transkript reicht).
 * Ein Cron-Parser (Haiku) strukturiert die Meldungen gegen den Katalog
 * je STANDORT, der Bot bestätigt in der Gruppe, und sobald etwas LEER
 * ist (oder ≥3 Artikel offen sind) postet er je Standort einen fertig
 * befüllten Amazon-Warenkorb-Link + die zu wählende LIEFERADRESSE
 * (jeder Standort hat eine eigene Paketbox — eine Bestellung = eine
 * Adresse, deshalb strikt getrennte Warenkörbe!).
 * Speicherung in app_settings — Katalog/Config und BEDARF bewusst in
 * ZWEI Keys (§243o-Wipe-Klasse: Config-Saves fassen den Bedarf nie an).
 */

/** Feste Kategorien fürs Merkliste-Grid (Filter-Chips) */
export const MATERIAL_KATEGORIEN = ['🧽 Putzen', '🧺 Wäsche', '🍽 Küche', '🧻 Papier & Müll', '🧤 Handschuhe', '🧴 Pflege'] as const

export interface MaterialArtikel {
  id: string
  name: string
  /** Kategorie (aus MATERIAL_KATEGORIEN) — ohne = unter „Alle" sichtbar */
  kategorie?: string
  /** Produkt-Link (dm.de-Merkliste, Amazon, egal) — Bestell-Liste verlinkt ihn */
  url?: string
  /** Produktfoto-URL (dm-CDN products.dm-static.com — Hotlink, Fallback
   *  ohne Bild wenn der Link je bricht; CSP img-src https: deckt es) */
  bild?: string
  /** Amazon-ASIN — Artikel wandert zusätzlich in den Sammel-Warenkorb-Link */
  asin?: string
  /** Bestellmenge je Nachbestellung (Default 1) */
  menge?: number
}

export interface MaterialConfig {
  /** OPTIONAL: Intern-Gruppen-ID — Chat-Meldeweg ist nur ein Bonus,
   *  der Hauptweg ist das Panel (Merkliste-first, Inhaber-Entscheid) */
  gruppeId?: string
  /** EINE globale Merkliste (~38 Produkte) — gepflegt 1×, nicht je Standort */
  artikel: MaterialArtikel[]
  /** Geteilter dm-Merklisten-Link (dm.de „Deine Merkliste" ist offiziell
   *  teilbar) — der schnellste dm-Bestellweg: Liste öffnen, Gemeldetes
   *  in den Warenkorb, Packstation-Adresse wählen */
  merklisteUrl?: string
  /** Amazon-/Paketbox-Adress-Label + Hinweis je Standort (nur ANZEIGE — die
   *  Adresse selbst wählt der Besteller im Shop-Checkout) */
  adressen: Record<string, { label: string; hinweis?: string }>
}

export interface MaterialBedarf {
  id: string
  standort: string
  artikelId?: string
  name: string
  status: 'offen' | 'bestellt' | 'aufgefuellt'
  von: string
  at: string
  bestelltAt?: string
}

const CONFIG_KEY = 'material'
const BEDARF_KEY = 'material_bedarf'
const STATE_KEY = 'material_state' // Cursor + Post-Cooldowns (getrennt vom Config-Key)

export const MATERIAL_STANDORTE = ['Sirzenich', 'Minden', 'Bitburg', 'Edingen'] as const

async function readKey<T>(key: string): Promise<T | null> {
  const { data, error } = await supabaseAdmin
    .from('app_settings').select('value').eq('key', key).maybeSingle()
  if (error) {
    // §243o/§266c: supabase-js wirft nicht — Lesefehler darf nie wie
    // „leer" aussehen, sonst überschreibt der nächste Save den Bestand
    console.error('[material] read failed:', key, error.message)
    throw new Error('material read failed: ' + error.message)
  }
  return (data?.value as T) ?? null
}

async function writeKey(key: string, value: unknown): Promise<void> {
  const res = await supabaseAdmin.from('app_settings').upsert({ key, value })
  if (res.error) throw new Error('material write failed: ' + res.error.message)
}

export async function getMaterialConfig(): Promise<MaterialConfig> {
  const v = await readKey<MaterialConfig>(CONFIG_KEY)
  return { gruppeId: v?.gruppeId, artikel: v?.artikel ?? [], adressen: v?.adressen ?? {}, merklisteUrl: v?.merklisteUrl }
}

export async function saveMaterialConfig(patch: Partial<MaterialConfig>): Promise<void> {
  const cur = await getMaterialConfig()
  await writeKey(CONFIG_KEY, { ...cur, ...patch })
}

export async function getBedarf(): Promise<MaterialBedarf[]> {
  const v = await readKey<{ eintraege: MaterialBedarf[] }>(BEDARF_KEY)
  return v?.eintraege ?? []
}

async function saveBedarf(eintraege: MaterialBedarf[]): Promise<void> {
  // aufgefüllte Einträge nach 60 Tagen abräumen (Liste bleibt klein)
  const cutoff = Date.now() - 60 * 86400_000
  await writeKey(BEDARF_KEY, {
    eintraege: eintraege.filter((e) => e.status !== 'aufgefuellt' || Date.parse(e.at) > cutoff).slice(-400),
  })
}

function rid(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** Bedarf hinzufügen — dedupliziert je Standort+Name auf den OFFENEN
 *  Bestand (mehrfach gemeldet = ein Eintrag). */
export async function addBedarf(items: { standort: string; artikelId?: string; name: string; von?: string }[], fallbackVon: string): Promise<{ neu: MaterialBedarf[]; schonDa: number }> {
  const all = await getBedarf()
  const neu: MaterialBedarf[] = []
  let schonDa = 0
  for (const it of items) {
    const key = `${it.standort}|${it.name.toLowerCase()}`
    const open = all.find((e) => e.status === 'offen' && `${e.standort}|${e.name.toLowerCase()}` === key)
    if (open) { schonDa++; continue }
    const row: MaterialBedarf = {
      id: rid(), standort: it.standort, artikelId: it.artikelId, name: it.name,
      status: 'offen', von: it.von || fallbackVon, at: new Date().toISOString(),
    }
    all.push(row)
    neu.push(row)
  }
  if (neu.length) await saveBedarf(all)
  return { neu, schonDa }
}

export async function setBedarfStatus(id: string, status: MaterialBedarf['status'] | 'entfernt'): Promise<boolean> {
  const all = await getBedarf()
  const i = all.findIndex((e) => e.id === id)
  if (i < 0) return false
  if (status === 'entfernt') all.splice(i, 1)
  else {
    all[i].status = status
    if (status === 'bestellt') all[i].bestelltAt = new Date().toISOString()
  }
  await saveBedarf(all)
  return true
}

/** Amazon-Warenkorb-Link für die Artikel MIT ASIN eines Standorts.
 *  ⚠️ Kalibrier-Punkt (§127-Muster): das add-to-cart-URL-Format wird beim
 *  ersten echten Klick verifiziert — schlägt es fehl, bleibt die Liste
 *  als normale Einkaufsliste nutzbar. */
export function cartUrl(items: { asin: string; menge: number }[]): string | null {
  const withAsin = items.filter((i) => i.asin)
  if (!withAsin.length) return null
  const p = new URLSearchParams()
  withAsin.forEach((i, idx) => {
    p.set(`ASIN.${idx + 1}`, i.asin)
    p.set(`Quantity.${idx + 1}`, String(Math.max(1, i.menge)))
  })
  return 'https://www.amazon.de/gp/aws/cart/add.html?' + p.toString()
}

interface State {
  cursor?: string
  /** letzter Warenkorb-Post je Standort (Cooldown) */
  lastPost?: Record<string, string>
  /** KI-Parse-Fehlversuche in Folge (Retry-Deckel, max 3) */
  failCount?: number
}

/** ── Cron-Kern 1: neue Gruppen-Nachrichten → Haiku → Bedarf ── */
export async function parseMeldungen(): Promise<{ gelesen: number; bedarf: number; fehler?: string }> {
  const cfg = await getMaterialConfig()
  if (!cfg.gruppeId) return { gelesen: 0, bedarf: 0, fehler: 'Material-Gruppe noch nicht verknüpft' }
  const state = (await readKey<State>(STATE_KEY)) ?? {}
  const botId = await getClaudeBotId(false)
  // Ohne verlässliche Bot-ID ist kein sicherer Scan möglich (der Filter
  // gegen die EIGENEN ✔/🛒-Posts fiele still weg → Echo-Schleife)
  if (!botId) return { gelesen: 0, bedarf: 0, fehler: 'Bot-ID nicht auflösbar — Lauf übersprungen' }
  // Erstlauf-Lookback > Cron-Intervall (15 Min), sonst verschwinden
  // Nachrichten aus dem Fenster vor dem allerersten Lauf spurlos
  const since = state.cursor ?? new Date(Date.now() - 30 * 60_000).toISOString()

  const { data: msgs, error } = await supabaseAdmin
    .from('team_messages')
    .select('id, sender_id, content, created_at')
    .eq('chat_id', cfg.gruppeId)
    .gt('created_at', since)
    .order('created_at', { ascending: true })
    .limit(30)
  if (error) return { gelesen: 0, bedarf: 0, fehler: error.message }
  const fresh = (msgs ?? []).filter((m) => m.sender_id !== botId && (m.content ?? '').trim().length > 2)
  if (!msgs?.length) return { gelesen: 0, bedarf: 0 }

  // Cursor SOFORT setzen (Doppel-Verarbeitungs-Schutz); scheitert die KI,
  // wird er unten ZURÜCKGESCHRIEBEN (Retry beim nächsten Lauf, max 3×)
  const newCursor = msgs[msgs.length - 1].created_at
  await writeKey(STATE_KEY, { ...state, cursor: newCursor })
  if (!fresh.length) return { gelesen: msgs.length, bedarf: 0 }

  // Absender-Vornamen für die Bestätigung
  const senderIds = [...new Set(fresh.map((m) => m.sender_id))]
  const { data: profs } = await supabaseAdmin
    .from('profiles').select('id, display_name').in('id', senderIds)
  const nameOf = (id: string) => (profs?.find((p) => p.id === id)?.display_name ?? 'Team').split(/\s+/)[0]

  const katalogText = cfg.artikel.map((a) => a.name).join(', ') || '(noch leer)'

  const system = `Du strukturierst Material-Meldungen einer Ferienwohnungs-Reinigung.
Standorte: ${MATERIAL_STANDORTE.join(', ')}. Merkliste (gilt für alle Standorte):
${katalogText}
Antworte NUR mit JSON: {"items":[{"standort":"...","name":"...","melder":"Vorname"}],"unklar":"..."}
Regeln: name möglichst als EXAKTER Katalog-Name (sonst frei, kurz, Singular).
melder = der Vorname vor dem Doppelpunkt der jeweiligen Nachricht.
Standort aus dem Text ableiten (auch Wohnungsnamen: City Home=Bitburg, Cozy/Magnolia/Sweet=Sirzenich, Panorama/Sunrise=Minden, River=Edingen).
Ist KEIN Standort erkennbar, items leer lassen und in "unklar" die Rückfrage formulieren.
Nachrichten ohne Material-Bezug (Smalltalk, Fragen an den Bot): items leer, unklar leer.`
  const user = fresh.map((m) => `${nameOf(m.sender_id)}: ${(m.content ?? '').slice(0, 500)}`).join('\n---\n')

  let items: { standort: string; name: string; melder?: string }[] = []
  let unklar = ''
  try {
    const raw = await askClaude(system, user, 1200, FAST_MODEL)
    // parseJsonLoose (§242d-Muster): Haiku hängt gern Erklärtext ans JSON
    const j = parseJsonLoose(raw) as { items?: typeof items; unklar?: string }
    items = (j.items ?? []).filter((i) => MATERIAL_STANDORTE.includes(i.standort as typeof MATERIAL_STANDORTE[number]) && i.name?.trim())
      .map((i) => ({ ...i, name: i.name.trim().slice(0, 60) }))
    unklar = (j.unklar ?? '').slice(0, 200)
    // Erfolg: Fehlversuchs-Zähler zurücksetzen (sonst zählt der nächste
    // transiente Fehler von einem alten Stand weiter)
    if (state.failCount) await writeKey(STATE_KEY, { ...state, cursor: newCursor, failCount: undefined }).catch(() => {})
  } catch (e) {
    console.error('[material] parse failed:', e)
    const fails = (state.failCount ?? 0) + 1
    if (fails < 3) {
      // Cursor zurück auf den alten Stand → nächster Lauf holt dieselben
      // Nachrichten erneut (addBedarf-Dedupe macht Doppelläufe harmlos)
      await writeKey(STATE_KEY, { ...state, cursor: state.cursor, failCount: fails }).catch(() => {})
      return { gelesen: fresh.length, bedarf: 0, fehler: `KI-Parse fehlgeschlagen (Versuch ${fails}/3 — Retry)` }
    }
    // Aufgeben, aber EHRLICH: Team erfährt, dass die Meldung verloren ging
    await writeKey(STATE_KEY, { ...state, cursor: newCursor, failCount: undefined }).catch(() => {})
    await postAsClaude(cfg.gruppeId, '⚠️ Ich konnte die letzten Meldungen nicht automatisch verarbeiten — bitte den Bedarf einmal direkt im Material-Bereich (Mehr-Tab) melden oder die Nachricht neu senden.', {}).catch(() => {})
    return { gelesen: fresh.length, bedarf: 0, fehler: 'KI-Parse endgültig fehlgeschlagen — Team informiert' }
  }

  let added = 0
  const parts: string[] = []
  if (items.length) {
    // Merklisten-Match für artikelId (fürs spätere Warenkorb-Bauen)
    const withIds = items.map((i) => {
      const art = cfg.artikel.find((a) => a.name.toLowerCase() === i.name.toLowerCase())
      return { standort: i.standort, artikelId: art?.id, name: art?.name ?? i.name, von: i.melder?.trim().slice(0, 30) }
    })
    const res = await addBedarf(withIds, nameOf(fresh[0].sender_id))
    added = res.neu.length
    if (res.neu.length) {
      const zeilen = res.neu.map((b) => `🛒 ${b.name} (${b.standort})`).join('\n')
      parts.push(`✔ Notiert:\n${zeilen}`)
    } else if (res.schonDa) {
      parts.push('✔ Steht schon auf der Bestell-Liste.')
    }
  }
  // Rückfrage auch dann posten, wenn im selben Batch ANDERE Meldungen
  // erkannt wurden (sonst geht die unklare Meldung still verloren)
  if (unklar) parts.push(`❓ ${unklar}`)
  if (parts.length) {
    const ok = await postAsClaude(cfg.gruppeId, parts.join('\n\n'), {}).catch(() => null)
    if (!ok) console.error('[material] Bestätigungs-Post fehlgeschlagen')
  }
  return { gelesen: fresh.length, bedarf: added }
}

/** Merklisten-Artikel zu einem Bedarf-Eintrag auflösen */
function artFor(cfg: MaterialConfig, e: MaterialBedarf): MaterialArtikel | undefined {
  return cfg.artikel.find((a) => a.id === e.artikelId || a.name.toLowerCase() === e.name.toLowerCase())
}

/** ── Cron-Kern 2: offener Bedarf → Bestell-Ansage je Standort ──
 *  Bedingung: mind. 1 offener Artikel (Meldung = Kaufabsicht); Cooldown
 *  20h je Standort (kein Spam bei jedem Lauf). Hauptkanal ist der
 *  TEAM-PUSH (Kategorie 🛒 material, Deep-Link Mehr-Tab); ist die
 *  optionale Chat-Gruppe verknüpft, kommt derselbe Text als Post dazu. */
export async function checkWarenkoerbe(): Promise<{ posts: number }> {
  const cfg = await getMaterialConfig()
  const state = (await readKey<State>(STATE_KEY)) ?? {}
  const lastPost = state.lastPost ?? {}
  const all = (await getBedarf()).filter((e) => e.status === 'offen')
  let posts = 0

  for (const standort of MATERIAL_STANDORTE) {
    const offen = all.filter((e) => e.standort === standort)
    if (!offen.length) continue
    const last = lastPost[standort] ? Date.parse(lastPost[standort]) : 0
    if (Date.now() - last < 20 * 3600_000) continue

    const adr = cfg.adressen[standort]

    // Team-Push = Hauptkanal (Zirkel-Vermeidung: dynamischer Import, §265-Muster)
    let pushed = false
    try {
      const { sendPushToTeam } = await import('@/lib/push')
      await sendPushToTeam(
        `🛒 Bestellung fällig · ${standort}`,
        `${offen.length} Artikel zum Nachbestellen${adr ? ` — Adresse „${adr.label}"` : ''}. Liste + Warenkorb im Material-Bereich (Mehr-Tab).`,
        '/team?tab=einstellungen',
        { category: 'material' },
      )
      pushed = true
    } catch (e) {
      console.error('[material] Bestell-Push fehlgeschlagen:', standort, e)
    }

    // Optionaler Gruppen-Post (Bonus-Kanal) mit der vollen Liste
    if (cfg.gruppeId) {
      const mitAsin = offen
        .map((e) => artFor(cfg, e))
        .filter((a): a is MaterialArtikel => !!a?.asin)
        .map((a) => ({ asin: a.asin!, menge: a.menge ?? 1 }))
      const korb = cartUrl(mitAsin)
      const zeilen = offen.map((e) => {
        const a = artFor(cfg, e)
        return `🛒 ${e.name}${a?.url ? `\n${a.url}` : ''}`
      }).join('\n')
      let text = `🛒 BESTELLUNG ${standort.toUpperCase()} — ${offen.length} Artikel zum Nachbestellen:\n${zeilen}`
      if (korb) text += `\n\nAmazon-Warenkorb (fertig befüllt):\n${korb}`
      if (adr) text += `\n\n📦 WICHTIG: Im Checkout die Lieferadresse „${adr.label}" wählen!${adr.hinweis ? ` (${adr.hinweis})` : ''}`
      text += `\n\nNach dem Bestellen im Material-Bereich (Mehr-Tab) auf „Bestellt" tippen.`
      // postAsClaude WIRFT bei Insert-Fehlern nicht, sondern liefert null
      const msgId = await postAsClaude(cfg.gruppeId, text, {}).catch((e) => { console.error('[material] post failed:', e); return null })
      if (!msgId) console.error('[material] Gruppen-Post nicht angekommen:', standort)
    }

    // Cooldown nur verbrennen, wenn wenigstens der Push raus ist
    if (!pushed) continue
    lastPost[standort] = new Date().toISOString()
    posts++
    // State je Standort sofort persistieren — schlägt ein späterer Write
    // fehl, ist der Cooldown der bereits gemeldeten nicht verloren
    await writeKey(STATE_KEY, { ...state, lastPost }).catch((e) => console.error('[material] state write failed:', e))
  }
  return { posts }
}

/** ── Freitext-Analyse fürs Panel („Etwas Besonderes?") ──
 *  Matcht die Beschreibung gegen die Merkliste; kein Treffer → freier
 *  Artikel-Vorschlag. Der MELDER bestätigt immer selbst (nie Auto-Add). */
export async function analysiereFreitext(text: string): Promise<{ name: string; artikelId?: string; hinweis?: string }> {
  const cfg = await getMaterialConfig()
  const liste = cfg.artikel.map((a) => a.name).join(', ') || '(leer)'
  const system = `Du hilfst beim Material-Melden einer Ferienwohnungs-Reinigung.
Merkliste: ${liste}
Der Nutzer beschreibt frei, was fehlt. Antworte NUR mit JSON:
{"name":"...","hinweis":"..."}
Regeln: name = EXAKTER Merklisten-Name, wenn eines der Produkte gemeint ist
(auch bei Umschreibungen wie „Handschuhe" → passendster Eintrag); sonst ein
kurzer, kaufbarer Produktname (Singular). hinweis = 1 kurzer Satz, z. B.
welcher Merklisten-Eintrag gemeint sein könnte oder dass es neu ist.`
  const raw = await askClaude(system, text.slice(0, 400), 400, FAST_MODEL)
  const j = parseJsonLoose(raw) as { name?: string; hinweis?: string }
  const name = (j.name ?? '').trim().slice(0, 60)
  if (!name) throw new Error('Kein Vorschlag erkennbar')
  const art = cfg.artikel.find((a) => a.name.toLowerCase() === name.toLowerCase())
  return {
    name: art?.name ?? name,
    artikelId: art?.id,
    hinweis: (j.hinweis ?? '').slice(0, 160) || undefined,
  }
}
