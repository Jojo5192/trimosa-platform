/**
 * 📖 Gästemappe: Block-Modell für den Builder (/dashboard/mappe) und die
 * öffentliche Mappe (/mappe/[token]). listings.guide = { blocks: GuideBlock[] }.
 * Inhalts-Blöcke tragen eigenen Text; Smart-Blöcke (map/times/rules/region)
 * befüllen sich aus dem Inserat und brauchen nur eingefügt zu werden.
 */

/** Sichtbarkeits-Phase eines Bausteins (§136): Standard 'immer';
 *  'vor' = nur vor Anreise, 'waehrend' = nur während des Aufenthalts,
 *  'nach' = erst nach Abreise (z. B. Danke/Bewertungs-Block). Optional
 *  zusätzlich minNights = erst ab X Nächten Aufenthaltsdauer. */
export type GuidePhase = 'immer' | 'vor' | 'waehrend' | 'nach'
export interface GuideBlockBase { id: string; type: string; phase?: GuidePhase; minNights?: number }

export const PHASE_META: { id: GuidePhase; label: string; short: string }[] = [
  { id: 'immer', label: 'Immer sichtbar', short: 'Immer' },
  { id: 'vor', label: 'Nur vor Anreise', short: 'Vorher' },
  { id: 'waehrend', label: 'Nur während des Aufenthalts', short: 'Während' },
  { id: 'nach', label: 'Erst nach Abreise', short: 'Danach' },
]

/** Ist der Block in der aktuellen Aufenthalts-Phase sichtbar? */
export function blockVisibleInPhase(b: GuideBlockBase, phase: GuidePhase, nights: number): boolean {
  if (typeof b.minNights === 'number' && b.minNights > 0 && nights < b.minNights) return false
  if (!b.phase || b.phase === 'immer') return true
  return b.phase === phase
}
export interface HeadingBlock extends GuideBlockBase { type: 'heading'; text: string }
export interface TextBlock extends GuideBlockBase { type: 'text'; text: string }
export interface InfoBlock extends GuideBlockBase { type: 'info'; emoji: string; title: string; text: string }
export interface WarningBlock extends GuideBlockBase { type: 'warning'; text: string }
export interface StepsBlock extends GuideBlockBase { type: 'steps'; title: string; steps: string[] }
export interface WifiBlock extends GuideBlockBase { type: 'wifi'; ssid: string; password: string }
export interface DoorBlock extends GuideBlockBase { type: 'door'; title: string; text: string }
export interface ContactBlock extends GuideBlockBase { type: 'contact'; phone: string; note: string }
export interface MapBlock extends GuideBlockBase { type: 'map' }
export interface TimesBlock extends GuideBlockBase { type: 'times' }
export interface RulesBlock extends GuideBlockBase { type: 'rules' }
export interface RegionBlock extends GuideBlockBase { type: 'region' }

export type GuideBlock =
  | HeadingBlock | TextBlock | InfoBlock | WarningBlock | StepsBlock
  | WifiBlock | DoorBlock | ContactBlock
  | MapBlock | TimesBlock | RulesBlock | RegionBlock

/** Kontext aus Inserat/Region für die Smart-Blöcke. */
export interface GuideCtx {
  listingTitle: string
  address: string | null
  lat: number | null
  lon: number | null
  checkIn: string | null
  checkOut: string | null
  rules: string[]
  regionName: string | null
  regionSlug: string | null
  regionClaim: string | null
  /** Türcode-Automatik (§132): gesetzter Code, sobald das Anzeige-Fenster
   *  erreicht ist — sonst doorNote („erscheint X Tage vor Anreise"). */
  doorCode?: string | null
  doorNote?: string | null
}

/** Anzeige-Labels der Mappe — HIER (server-safe) statt in der Client-Datei:
 *  Konstanten aus 'use client'-Modulen sind in Server-Komponenten nur
 *  Client-Referenzen (Object.entries → leer → Crash beim Übersetzen). */
export interface GuideLabels {
  wifi: string; network: string; password: string; copy: string; copied: string
  checkInFrom: string; checkOutUntil: string; addressTitle: string; route: string
  rulesTitle: string; regionTitle: string; regionCta: string; contactTitle: string
  emptyBlock: string; doorCodeLabel: string
}

export const DE_LABELS: GuideLabels = {
  wifi: 'WLAN', network: 'Netzwerk', password: 'Passwort', copy: 'Kopieren', copied: 'Kopiert!',
  checkInFrom: 'Check-in ab', checkOutUntil: 'Check-out bis',
  addressTitle: 'Adresse & Anfahrt', route: 'Route in Google Maps öffnen',
  rulesTitle: 'Hausregeln', regionTitle: 'Region entdecken',
  regionCta: 'Zum Reiseführer', contactTitle: 'Dein Gastgeber-Team',
  emptyBlock: 'Noch nicht ausgefüllt — erscheint erst mit Inhalt.',
  doorCodeLabel: 'Dein Türcode',
}

export const BLOCK_META: Record<GuideBlock['type'], { icon: string; label: string; hint: string; smart?: boolean }> = {
  heading: { icon: '🔠', label: 'Überschrift', hint: 'Große Abschnitts-Überschrift' },
  text: { icon: '¶', label: 'Absatz', hint: 'Freier Fließtext' },
  info: { icon: 'ℹ️', label: 'Info-Karte', hint: 'Karte mit Emoji, Titel und Text (z. B. Parken, Mülltrennung)' },
  warning: { icon: '⚠️', label: 'Hinweis-Box', hint: 'Hervorgehobener wichtiger Hinweis' },
  steps: { icon: '1.', label: 'Schritt-für-Schritt', hint: 'Nummerierte Anleitung (z. B. Check-in)' },
  wifi: { icon: '📶', label: 'WLAN', hint: 'Netzwerkname + Passwort mit Kopier-Knopf' },
  door: { icon: '🔑', label: 'Schlüssel & Zugang', hint: 'Zugangs-Infos — zeigt automatisch den Türcode der Buchung, sobald der Wohnung Schlösser zugeordnet sind (Admin → 🔑 Türcodes)' },
  contact: { icon: '📞', label: 'Kontakt', hint: 'Telefonnummer + Hinweis, wann erreichbar' },
  map: { icon: '📍', label: 'Adresse & Anfahrt', hint: 'Aus dem Inserat: Adresse + Google-Maps-Route', smart: true },
  times: { icon: '🕓', label: 'Check-in/-out-Zeiten', hint: 'Aus dem Inserat: An- und Abreisezeit', smart: true },
  rules: { icon: '🏠', label: 'Hausregeln', hint: 'Aus dem Inserat: Ruhezeiten, Rauchen, Haustiere …', smart: true },
  region: { icon: '🗺️', label: 'Region entdecken', hint: 'Link auf den Reiseführer der Region', smart: true },
}

let seq = 0
export function newBlockId(): string {
  seq += 1
  return `b${Date.now().toString(36)}${seq}${Math.random().toString(36).slice(2, 6)}`
}

export function emptyBlock(type: GuideBlock['type']): GuideBlock {
  const id = newBlockId()
  switch (type) {
    case 'heading': return { id, type, text: '' }
    case 'text': return { id, type, text: '' }
    case 'info': return { id, type, emoji: 'ℹ️', title: '', text: '' }
    case 'warning': return { id, type, text: '' }
    case 'steps': return { id, type, title: '', steps: [''] }
    case 'wifi': return { id, type, ssid: '', password: '' }
    case 'door': return { id, type, title: 'Schlüssel & Zugang', text: '' }
    case 'contact': return { id, type, phone: '', note: '' }
    case 'map': return { id, type }
    case 'times': return { id, type }
    case 'rules': return { id, type }
    case 'region': return { id, type }
  }
}

/** Vorbefüllte Startvorlage — der Host passt Texte an, statt bei null zu beginnen. */
export function defaultTemplate(): GuideBlock[] {
  return [
    { id: newBlockId(), type: 'text', text: 'Schön, dass du da bist! Hier findest du alles Wichtige für deinen Aufenthalt — von der Anreise bis zum WLAN.' },
    { id: newBlockId(), type: 'times' },
    { id: newBlockId(), type: 'map' },
    { id: newBlockId(), type: 'steps', title: 'So kommst du rein', steps: ['Beispiel: Parke direkt vor dem Haus.', 'Beispiel: Die Wohnung findest du im 1. OG links.', 'Beispiel: Den Schlüssel bekommst du …'] },
    { id: newBlockId(), type: 'door', title: 'Schlüssel & Zugang', text: '' },
    { id: newBlockId(), type: 'wifi', ssid: '', password: '' },
    { id: newBlockId(), type: 'info', emoji: '🅿️', title: 'Parken', text: '' },
    { id: newBlockId(), type: 'rules' },
    { id: newBlockId(), type: 'region' },
    { id: newBlockId(), type: 'contact', phone: '', note: 'Bei Fragen sind wir jederzeit für dich da — am schnellsten per Nachricht über die Buchungsplattform.' },
    { id: newBlockId(), type: 'heading', text: 'Abreise' },
    { id: newBlockId(), type: 'text', text: 'Beispiel: Stelle die Spülmaschine an, wirf den Müll in die Tonne vor dem Haus und zieh die Tür einfach hinter dir zu. Gute Heimreise!' },
  ]
}

/** guide-jsonb defensiv in eine Block-Liste überführen. */
export function parseGuide(guide: unknown): GuideBlock[] {
  const g = guide as { blocks?: unknown } | null
  if (!g || !Array.isArray(g.blocks)) return []
  return (g.blocks as GuideBlock[]).filter((b) => b && typeof b === 'object' && typeof b.type === 'string' && b.type in BLOCK_META)
}

/** Hat ein Inhalts-Block sichtbaren Inhalt? Leere Blöcke werden in der
 *  öffentlichen Mappe übersprungen (halb ausgefüllte Vorlagen blamieren nicht). */
export function blockHasContent(b: GuideBlock, ctx: GuideCtx): boolean {
  switch (b.type) {
    case 'heading': case 'text': case 'warning': return b.text.trim().length > 0
    case 'info': return (b.title.trim() + b.text.trim()).length > 0
    case 'steps': return b.steps.some((s) => s.trim().length > 0)
    case 'wifi': return b.ssid.trim().length > 0
    case 'door': return b.text.trim().length > 0 || !!ctx.doorCode || !!ctx.doorNote
    case 'contact': return b.phone.trim().length > 0 || b.note.trim().length > 0
    case 'map': return !!ctx.address
    case 'times': return !!(ctx.checkIn || ctx.checkOut)
    case 'rules': return ctx.rules.length > 0
    case 'region': return !!ctx.regionSlug
  }
}

/** Alle übersetzbaren Textfelder eines Block-Sets (für makeTr auf der Mappe). */
export function collectGuideTexts(blocks: GuideBlock[]): string[] {
  const out: string[] = []
  for (const b of blocks) {
    if ('text' in b && b.text) out.push(b.text)
    if ('title' in b && b.title) out.push(b.title)
    if ('note' in b && b.note) out.push(b.note)
    if (b.type === 'steps') out.push(...b.steps.filter(Boolean))
  }
  return out
}

/** Blöcke mit einer Übersetzungsfunktion (makeTr-Ergebnis) übersetzen. */
export function translateBlocks(blocks: GuideBlock[], tr: (de: string) => string): GuideBlock[] {
  return blocks.map((b) => {
    const c: GuideBlock = { ...b }
    if ('text' in c && c.text) c.text = tr(c.text)
    if ('title' in c && c.title) c.title = tr(c.title)
    if ('note' in c && c.note) c.note = tr(c.note)
    if (c.type === 'steps') c.steps = c.steps.map((s) => (s ? tr(s) : s))
    return c
  })
}
