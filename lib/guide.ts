/**
 * 📖 Gästemappe: Block-Modell für den Builder (/dashboard/mappe) und die
 * öffentliche Mappe (/mappe/[token]). listings.guide = { blocks: GuideBlock[] }.
 * Inhalts-Blöcke tragen eigenen Text; Smart-Blöcke (map/times/rules/region)
 * befüllen sich aus dem Inserat und brauchen nur eingefügt zu werden.
 */

/** Sichtbarkeits-Phase eines Bausteins (§136/§150): Standard 'immer'.
 *  NEU: `phases` erlaubt MEHRERE Phasen gleichzeitig (z. B. vor+während,
 *  aber nicht danach); das alte Einzel-Feld `phase` bleibt als Alt-Format
 *  lesbar. Optional minNights = erst ab X Nächten Aufenthaltsdauer.
 *  `disabled` = Baustein pausiert (nirgends sichtbar); `listingIds` =
 *  gilt nur für diese Wohnungen (leer/fehlend = alle) — §150 Pool-Modell. */
export type GuidePhase = 'immer' | 'vor' | 'waehrend' | 'nach'
export interface GuideBlockBase {
  id: string; type: string
  phase?: GuidePhase
  phases?: Exclude<GuidePhase, 'immer'>[]
  minNights?: number
  disabled?: boolean
  listingIds?: string[]
}

export const PHASE_META: { id: GuidePhase; label: string; short: string }[] = [
  { id: 'immer', label: 'Immer sichtbar', short: 'Immer' },
  { id: 'vor', label: 'Vor Anreise', short: 'Vorher' },
  { id: 'waehrend', label: 'Während des Aufenthalts', short: 'Während' },
  { id: 'nach', label: 'Nach Abreise', short: 'Danach' },
]

/** Effektive Phasen-Auswahl (neues Mehrfach-Format vor Alt-Einzelfeld);
 *  leeres Array = immer sichtbar. */
export function blockPhases(b: GuideBlockBase): Exclude<GuidePhase, 'immer'>[] {
  if (b.phases?.length) return b.phases
  if (b.phase && b.phase !== 'immer') return [b.phase]
  return []
}

/** Ist der Block in der aktuellen Aufenthalts-Phase sichtbar? */
export function blockVisibleInPhase(b: GuideBlockBase, phase: GuidePhase, nights: number): boolean {
  if (b.disabled) return false
  if (typeof b.minNights === 'number' && b.minNights > 0 && nights < b.minNights) return false
  const ph = blockPhases(b)
  if (ph.length === 0) return true
  return ph.includes(phase as Exclude<GuidePhase, 'immer'>)
}

/** Gilt der Block für diese Wohnung? (keine Zuordnung = alle Wohnungen) */
export function blockForListing(b: GuideBlockBase, listingId: string): boolean {
  return !b.listingIds || b.listingIds.length === 0 || b.listingIds.includes(listingId)
}
export interface HeadingBlock extends GuideBlockBase { type: 'heading'; text: string }
export interface TextBlock extends GuideBlockBase { type: 'text'; text: string }
export interface InfoBlock extends GuideBlockBase { type: 'info'; emoji: string; title: string; text: string }
export interface WarningBlock extends GuideBlockBase { type: 'warning'; text: string }
// stepImages ist index-parallel zu steps ('' = kein Foto am Schritt)
export interface StepsBlock extends GuideBlockBase { type: 'steps'; title: string; steps: string[]; stepImages?: string[] }
export interface WifiBlock extends GuideBlockBase { type: 'wifi'; ssid: string; password: string }
export interface DoorBlock extends GuideBlockBase { type: 'door'; title: string; text: string }
export interface ContactBlock extends GuideBlockBase { type: 'contact'; phone: string; note: string }
// §199: Google-Bewertungs-Baustein — Button verlinkt über die Place-ID des Inserats
export interface ReviewBlock extends GuideBlockBase { type: 'review'; title: string; text: string }
// url2: optionales zweites Foto — beide rendern NEBENEINANDER (§196b)
export interface ImageBlock extends GuideBlockBase { type: 'image'; url: string; caption: string; url2?: string }
/** §216: freier Link-Button (Ladepunkt, Fahrplan, Speisekarte …). Der
 *  Beschriftungs-Text heißt bewusst `title` — so übersetzen ihn
 *  collectGuideTexts/translateBlocks automatisch mit, die `url` nicht. */
export interface LinkBlock extends GuideBlockBase { type: 'link'; title: string; url: string; note: string }
export interface MapBlock extends GuideBlockBase { type: 'map' }
/** show: 'checkin'/'checkout' zeigt nur die eine Zeit — so lassen sich beide
 *  Zeiten als getrennte Bausteine mit EIGENER Phasen-Sichtbarkeit pflegen
 *  (Check-in-Zeit ist nach der Anreise nicht mehr relevant). Default 'beide'. */
export interface TimesBlock extends GuideBlockBase { type: 'times'; show?: 'beide' | 'checkin' | 'checkout' }
export interface RulesBlock extends GuideBlockBase { type: 'rules' }
export interface RegionBlock extends GuideBlockBase { type: 'region' }
/** §163: frei platzierbarer Gäste-Chat — die Mappe rendert den echten Chat
 *  an dieser Stelle (ohne chat-Block wie bisher am Ende). phone/note werden
 *  NICHT gespeichert, sondern zur Render-Zeit aus dem Kontakt-Baustein
 *  angereichert (mergeContactIntoChat, §166: „Kontakt & Chat" = EIN Punkt). */
export interface ChatBlock extends GuideBlockBase { type: 'chat'; phone?: string; note?: string }

/** 📦 Inventar-Checkliste (§195): kuratierter Katalog zum Anklicken +
 *  eigene Einträge; optionale Stückzahl je Punkt. Gespeichert werden NUR
 *  die vorhandenen Punkte (Anwesenheit im Array = „ist da"). Die Liste
 *  ist zugleich die automatische Basis der QS-Protokolle (lib/qs) und
 *  fließt über den KB-Sync in die Anrufbot-Wissensbasis. */
export interface InventarItem { id: string; emoji: string; label: string; count?: number; note?: string }
export interface InventarBlock extends GuideBlockBase { type: 'inventar'; title: string; items: InventarItem[] }

export type GuideBlock =
  | HeadingBlock | TextBlock | InfoBlock | WarningBlock | StepsBlock
  | WifiBlock | DoorBlock | ContactBlock | ImageBlock
  | MapBlock | TimesBlock | RulesBlock | RegionBlock | ChatBlock | InventarBlock | ReviewBlock | LinkBlock

export type InventarGroupKey = 'kueche' | 'geschirr' | 'geraete' | 'bad' | 'wohnen' | 'verbrauch' | 'eigene'
export interface InventarCatalogItem { id: string; emoji: string; label: string; countable?: boolean }

/** Kuratierter Inventar-Katalog — im Builder anklickbar. Eigene Einträge
 *  tragen ihre Kategorie im id-Präfix ('x-<gruppe>-…'); Alt-Einträge ohne
 *  Gruppen-Präfix landen in „Weiteres". */
export const INVENTAR_KATALOG: { key: Exclude<InventarGroupKey, 'eigene'>; emoji: string; items: InventarCatalogItem[] }[] = [
  { key: 'kueche', emoji: '🍳', items: [
    { id: 'salz-pfeffer', emoji: '🧂', label: 'Salz & Pfeffer' },
    { id: 'gewuerze', emoji: '🌿', label: 'Basis-Gewürze' },
    { id: 'oel', emoji: '🫒', label: 'Speiseöl' },
    { id: 'essig', emoji: '🍶', label: 'Essig' },
    { id: 'kaffee', emoji: '🫘', label: 'Kaffee / Pads / Kapseln' },
    { id: 'tee', emoji: '🍵', label: 'Tee-Auswahl' },
    { id: 'zucker', emoji: '🍬', label: 'Zucker' },
    { id: 'toepfe', emoji: '🍲', label: 'Töpfe', countable: true },
    { id: 'pfannen', emoji: '🍳', label: 'Pfannen', countable: true },
    { id: 'backblech', emoji: '🥧', label: 'Backblech / Auflaufform' },
    { id: 'messerset', emoji: '🔪', label: 'Messerset' },
    { id: 'schneidebretter', emoji: '🪵', label: 'Schneidebretter', countable: true },
    { id: 'kuechenhelfer', emoji: '🥄', label: 'Kochlöffel & Küchenhelfer' },
    { id: 'dosenoeffner', emoji: '🥫', label: 'Dosen- & Flaschenöffner' },
    { id: 'schuesseln', emoji: '🥗', label: 'Schüsseln' },
    { id: 'korkenzieher', emoji: '🍾', label: 'Korkenzieher' },
    { id: 'nudelsieb', emoji: '🍝', label: 'Nudelsieb' },
    { id: 'reibe', emoji: '🧀', label: 'Reibe' },
    { id: 'messbecher', emoji: '⚖️', label: 'Messbecher & Küchenwaage' },
    { id: 'backzubehoer', emoji: '🧁', label: 'Backzubehör (Rührschüssel, Formen)' },
    { id: 'salatschleuder', emoji: '🥬', label: 'Salatschleuder & -besteck' },
    { id: 'frischhaltedosen', emoji: '🥡', label: 'Frischhaltedosen' },
    { id: 'folien', emoji: '🌯', label: 'Alu- & Frischhaltefolie' },
    { id: 'servietten', emoji: '🎀', label: 'Servietten' },
    { id: 'topflappen', emoji: '🧤', label: 'Topflappen & Ofenhandschuhe' },
    { id: 'tablett', emoji: '🛎️', label: 'Serviertablett' },
  ] },
  { key: 'geschirr', emoji: '🍽️', items: [
    { id: 'teller-gross', emoji: '🍽️', label: 'Große Teller', countable: true },
    { id: 'teller-tief', emoji: '🥣', label: 'Tiefe Teller', countable: true },
    { id: 'teller-klein', emoji: '🍰', label: 'Kleine Teller', countable: true },
    { id: 'tassen', emoji: '☕', label: 'Tassen & Becher', countable: true },
    { id: 'glaeser', emoji: '🥛', label: 'Wassergläser', countable: true },
    { id: 'weinglaeser', emoji: '🍷', label: 'Weingläser', countable: true },
    { id: 'sektglaeser', emoji: '🥂', label: 'Sektgläser', countable: true },
    { id: 'besteck', emoji: '🍴', label: 'Besteck-Sets', countable: true },
    { id: 'eierbecher', emoji: '🥚', label: 'Eierbecher', countable: true },
    { id: 'muesli-schalen', emoji: '🍚', label: 'Müslischalen', countable: true },
    { id: 'espressotassen', emoji: '☕', label: 'Espressotassen', countable: true },
    { id: 'bierglaeser', emoji: '🍺', label: 'Biergläser', countable: true },
    { id: 'karaffe', emoji: '🫗', label: 'Wasserkaraffe' },
    { id: 'servierplatten', emoji: '🍱', label: 'Servierplatten' },
    { id: 'kindergeschirr', emoji: '🧒', label: 'Kindergeschirr & -besteck' },
  ] },
  { key: 'geraete', emoji: '🔌', items: [
    { id: 'kaffeemaschine', emoji: '☕', label: 'Kaffeemaschine' },
    { id: 'wasserkocher', emoji: '🫖', label: 'Wasserkocher' },
    { id: 'toaster', emoji: '🍞', label: 'Toaster' },
    { id: 'mikrowelle', emoji: '♨️', label: 'Mikrowelle' },
    { id: 'backofen', emoji: '🔥', label: 'Backofen & Herd' },
    { id: 'spuelmaschine', emoji: '🫧', label: 'Spülmaschine' },
    { id: 'kuehlschrank', emoji: '🧊', label: 'Kühlschrank mit Gefrierfach' },
    { id: 'waschmaschine', emoji: '🧺', label: 'Waschmaschine' },
    { id: 'trockner', emoji: '🌀', label: 'Wäschetrockner' },
    { id: 'foen', emoji: '💇', label: 'Fön' },
    { id: 'buegeleisen', emoji: '👔', label: 'Bügeleisen & -brett' },
    { id: 'staubsauger', emoji: '🧹', label: 'Staubsauger' },
    { id: 'smarttv', emoji: '📺', label: 'Smart-TV' },
    { id: 'mixer', emoji: '🥤', label: 'Mixer / Pürierstab' },
    { id: 'airfryer', emoji: '🍟', label: 'Heißluftfritteuse (Airfryer)' },
    { id: 'raclette', emoji: '🫕', label: 'Raclette- / Fondue-Gerät' },
    { id: 'waffeleisen', emoji: '🧇', label: 'Waffeleisen' },
    { id: 'sandwichmaker', emoji: '🥪', label: 'Sandwichmaker / Kontaktgrill' },
    { id: 'eierkocher', emoji: '🥚', label: 'Eierkocher' },
    { id: 'spielkonsole', emoji: '🎮', label: 'Spielkonsole' },
    { id: 'soundbox', emoji: '🔊', label: 'Bluetooth-Box / Soundbar' },
    { id: 'radio', emoji: '📻', label: 'Radio' },
    { id: 'ventilator', emoji: '💨', label: 'Ventilator' },
    { id: 'klimaanlage', emoji: '❄️', label: 'Klimaanlage' },
    { id: 'heizluefter', emoji: '🌡️', label: 'Zusatz-Heizlüfter' },
    { id: 'ladekabel', emoji: '🔋', label: 'Ladekabel / USB-Steckdosen' },
  ] },
  { key: 'bad', emoji: '🛁', items: [
    { id: 'handtuecher', emoji: '🛁', label: 'Handtücher (groß & klein)', countable: true },
    { id: 'bettwaesche', emoji: '🛏️', label: 'Bettwäsche (bezogen)' },
    { id: 'zusatzdecken', emoji: '🛌', label: 'Zusatzdecken & -kissen' },
    { id: 'toilettenpapier', emoji: '🧻', label: 'Toilettenpapier (Startvorrat)' },
    { id: 'seife', emoji: '🧼', label: 'Handseife / Duschgel' },
    { id: 'badematten', emoji: '🚿', label: 'Badematten' },
    { id: 'strandtuecher', emoji: '🏖️', label: 'Strand- / Saunatücher', countable: true },
    { id: 'shampoo', emoji: '🧴', label: 'Shampoo & Spülung' },
    { id: 'kosmetiktuecher', emoji: '💄', label: 'Kosmetiktücher' },
    { id: 'zahnputzbecher', emoji: '🪥', label: 'Zahnputzbecher' },
    { id: 'kosmetikspiegel', emoji: '🪞', label: 'Kosmetikspiegel' },
    { id: 'personenwaage', emoji: '⚖️', label: 'Personenwaage' },
    { id: 'wc-buerste', emoji: '🚽', label: 'WC-Bürste' },
    { id: 'waeschekorb', emoji: '🧺', label: 'Wäschekorb' },
  ] },
  { key: 'wohnen', emoji: '🛋️', items: [
    { id: 'waeschestaender', emoji: '🌬️', label: 'Wäscheständer' },
    { id: 'kleiderbuegel', emoji: '🪝', label: 'Kleiderbügel', countable: true },
    { id: 'spiele', emoji: '🎲', label: 'Gesellschaftsspiele' },
    { id: 'buecher', emoji: '📚', label: 'Bücher & Reiseführer' },
    { id: 'kinderhochstuhl', emoji: '🪑', label: 'Kinderhochstuhl' },
    { id: 'reisebett', emoji: '👶', label: 'Reisebett' },
    { id: 'grill', emoji: '🍖', label: 'Grill' },
    { id: 'terrassenmoebel', emoji: '🪴', label: 'Terrassen-/Balkonmöbel' },
    { id: 'erstehilfe', emoji: '⛑️', label: 'Erste-Hilfe-Set' },
    { id: 'feuerloescher', emoji: '🧯', label: 'Feuerlöscher' },
    { id: 'rauchmelder', emoji: '🚨', label: 'Rauchmelder' },
    { id: 'schlafsofa', emoji: '🛋️', label: 'Schlafsofa' },
    { id: 'luftmatratze', emoji: '🛟', label: 'Luftmatratze / Gästebett' },
    { id: 'arbeitsplatz', emoji: '💻', label: 'Arbeitsplatz / Schreibtisch' },
    { id: 'safe', emoji: '🔐', label: 'Safe' },
    { id: 'verdunkelung', emoji: '🌙', label: 'Verdunkelungsvorhänge' },
    { id: 'fliegengitter', emoji: '🪰', label: 'Fliegengitter' },
    { id: 'kaminofen', emoji: '🔥', label: 'Kamin / Ofen (inkl. Holz)' },
    { id: 'sonnenschirm', emoji: '⛱️', label: 'Sonnenschirm' },
    { id: 'grillzubehoer', emoji: '🍢', label: 'Grillbesteck & Kohle' },
    { id: 'picknickdecke', emoji: '🧺', label: 'Picknickdecke' },
    { id: 'kinderspielzeug', emoji: '🧸', label: 'Kinderspielzeug' },
    { id: 'yogamatte', emoji: '🧘', label: 'Yogamatte' },
    { id: 'regenschirm', emoji: '☂️', label: 'Regenschirme' },
    { id: 'taschenlampe', emoji: '🔦', label: 'Taschenlampe' },
    { id: 'werkzeugset', emoji: '🔧', label: 'Kleines Werkzeug-Set' },
    { id: 'naehset', emoji: '🧵', label: 'Nähset' },
    { id: 'fahrradabstell', emoji: '🚲', label: 'Fahrrad-Abstellmöglichkeit' },
    { id: 'wallbox', emoji: '⚡', label: 'E-Auto-Lademöglichkeit' },
    { id: 'co-melder', emoji: '⚠️', label: 'CO-Melder' },
  ] },
  { key: 'verbrauch', emoji: '🧴', items: [
    { id: 'spuelmittel', emoji: '🧴', label: 'Spülmittel & Schwamm' },
    { id: 'tabs', emoji: '💊', label: 'Spülmaschinen-Tabs' },
    { id: 'muellbeutel', emoji: '🗑️', label: 'Müllbeutel' },
    { id: 'kuechenrolle', emoji: '📜', label: 'Küchenrolle' },
    { id: 'waschmittel', emoji: '🫧', label: 'Waschmittel' },
    { id: 'putzmittel', emoji: '🧽', label: 'Putzmittel-Grundausstattung' },
    { id: 'kaffeefilter', emoji: '☕', label: 'Kaffeefilter' },
    { id: 'gefrierbeutel', emoji: '🧊', label: 'Gefrierbeutel' },
    { id: 'taschentuecher', emoji: '🤧', label: 'Taschentücher' },
    { id: 'streichhoelzer', emoji: '🔥', label: 'Streichhölzer / Feuerzeug' },
    { id: 'kerzen', emoji: '🕯️', label: 'Kerzen / Teelichter' },
    { id: 'batterien', emoji: '🔋', label: 'Ersatzbatterien' },
    { id: 'gluehbirnen', emoji: '💡', label: 'Ersatz-Glühbirnen' },
  ] },
]

const INVENTAR_GROUP_OF: Record<string, InventarGroupKey> = {}
for (const g of INVENTAR_KATALOG) for (const it of g.items) INVENTAR_GROUP_OF[it.id] = g.key
export function inventarGroupOf(itemId: string): InventarGroupKey {
  const hit = INVENTAR_GROUP_OF[itemId]
  if (hit) return hit
  // Eigene Einträge tragen ihre Kategorie im id-Präfix: x-<gruppe>-<slug>-<rand>
  const m = /^x-(kueche|geschirr|geraete|bad|wohnen|verbrauch)-/.exec(itemId)
  return m ? (m[1] as InventarGroupKey) : 'eigene'
}
export function inventarGroupLabel(labels: GuideLabels, key: InventarGroupKey): string {
  switch (key) {
    case 'kueche': return labels.invGrpKueche
    case 'geschirr': return labels.invGrpGeschirr
    case 'geraete': return labels.invGrpGeraete
    case 'bad': return labels.invGrpBad
    case 'wohnen': return labels.invGrpWohnen
    case 'verbrauch': return labels.invGrpVerbrauch
    case 'eigene': return labels.invGrpEigene
  }
}

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
  /** §199: Google-Place-ID des Inserats — Ziel des Bewertungs-Buttons. */
  googlePlaceId?: string | null
}

/** Anzeige-Labels der Mappe — HIER (server-safe) statt in der Client-Datei:
 *  Konstanten aus 'use client'-Modulen sind in Server-Komponenten nur
 *  Client-Referenzen (Object.entries → leer → Crash beim Übersetzen). */
export interface GuideLabels {
  wifi: string; network: string; password: string; copy: string; copied: string
  checkInFrom: string; checkOutUntil: string; addressTitle: string; route: string
  rulesTitle: string; regionTitle: string; regionCta: string; contactTitle: string
  emptyBlock: string; doorCodeLabel: string
  wifiQrHint: string
  invGrpKueche: string; invGrpGeschirr: string; invGrpGeraete: string; invGrpBad: string
  invGrpWohnen: string; invGrpVerbrauch: string; invGrpEigene: string; invShowAll: string
  reviewTitle: string; reviewText: string; reviewButton: string
}

export const DE_LABELS: GuideLabels = {
  wifi: 'WLAN', network: 'Netzwerk', password: 'Passwort', copy: 'Kopieren', copied: 'Kopiert!',
  checkInFrom: 'Check-in ab', checkOutUntil: 'Check-out bis',
  addressTitle: 'Adresse & Anfahrt', route: 'Route in Google Maps öffnen',
  rulesTitle: 'Hausregeln', regionTitle: 'Region entdecken',
  regionCta: 'Zum Reiseführer', contactTitle: 'Dein Gastgeber-Team',
  emptyBlock: 'Noch nicht ausgefüllt — erscheint erst mit Inhalt.',
  doorCodeLabel: 'Dein Türcode',
  wifiQrHint: 'Zweites Gerät verbinden? Diesen Code einfach mit der Kamera scannen — das WLAN verbindet sich direkt.',
  invGrpKueche: 'Küche & Kochen', invGrpGeschirr: 'Geschirr & Besteck', invGrpGeraete: 'Elektrogeräte',
  invGrpBad: 'Bad & Wäsche', invGrpWohnen: 'Wohnen & Sonstiges', invGrpVerbrauch: 'Verbrauchsmaterial',
  invGrpEigene: 'Weiteres', invShowAll: 'Antippen zum Ausklappen',
  reviewTitle: 'Wie war dein Aufenthalt?',
  reviewText: 'Deine Bewertung hilft uns riesig — und anderen Gästen bei der Entscheidung. Danke dir!',
  reviewButton: 'Auf Google bewerten',
}

export const BLOCK_META: Record<GuideBlock['type'], { icon: string; label: string; hint: string; smart?: boolean }> = {
  heading: { icon: '🔠', label: 'Überschrift', hint: 'Große Abschnitts-Überschrift' },
  text: { icon: '¶', label: 'Absatz', hint: 'Freier Fließtext' },
  info: { icon: 'ℹ️', label: 'Info-Karte', hint: 'Karte mit Emoji, Titel und Text (z. B. Parken, Mülltrennung)' },
  warning: { icon: '⚠️', label: 'Hinweis-Box', hint: 'Hervorgehobener wichtiger Hinweis' },
  steps: { icon: '1.', label: 'Schritt-für-Schritt', hint: 'Nummerierte Anleitung (z. B. Check-in)' },
  wifi: { icon: '📶', label: 'WLAN', hint: 'Netzwerkname + Passwort mit Kopier-Knopf' },
  door: { icon: '🔑', label: 'Türcode', hint: 'Zeigt automatisch den Türcode der Buchung, sobald der Wohnung Schlösser zugeordnet sind (Admin → 🔑 Türcodes); Freitext optional' },
  contact: { icon: '📞', label: 'Kontakt', hint: 'Telefonnummer + Hinweis — erscheint in der Mappe ZUSAMMEN mit dem Gäste-Chat als ein Punkt „Kontakt & Chat" (an dieser Position, falls kein eigener Chat-Baustein platziert ist)' },
  image: { icon: '📷', label: 'Foto', hint: 'Bild mit optionaler Bildunterschrift (z. B. Parkplatz, Mülltonnen-Standort)' },
  map: { icon: '📍', label: 'Adresse & Anfahrt', hint: 'Aus dem Inserat: Adresse + Google-Maps-Route', smart: true },
  times: { icon: '🕓', label: 'Check-in/-out-Zeiten', hint: 'Aus dem Inserat: An- und Abreisezeit', smart: true },
  rules: { icon: '🏠', label: 'Hausregeln', hint: 'Aus dem Inserat: Ruhezeiten, Rauchen, Haustiere …', smart: true },
  region: { icon: '🗺️', label: 'Region entdecken', hint: 'Link auf den Reiseführer der Region', smart: true },
  inventar: { icon: '📦', label: 'Inventar-Checkliste', hint: 'Anklickbare Ausstattungs-Liste mit Stückzahlen — in der Mappe ausklappbar; ist automatisch die Basis der QS-Protokolle und des Anrufbot-Wissens' },
  link: { icon: '🔗', label: 'Link-Button', hint: 'Gold-Button zu einer Webseite — z. B. Ladepunkt, Busfahrplan, Speisekarte' },
  review: { icon: '⭐', label: 'Google-Bewertung', hint: 'Bittet den Gast um eine Google-Rezension — der Button verlinkt automatisch über die Google-Place-ID des Inserats. Tipp: Sichtbarkeit „Danach"', smart: true },
  chat: { icon: '💬', label: 'Gäste-Chat', hint: 'Direkter Draht zum Team — bestimmt, WO „Kontakt & Chat" in der Mappe sitzt (Telefon/Hinweis kommen aus dem Kontakt-Baustein; ohne Chat-Baustein: an der Kontakt-Position bzw. am Ende)', smart: true },
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
    case 'door': return { id, type, title: 'Türcode', text: '' }
    case 'contact': return { id, type, phone: '', note: '' }
    case 'image': return { id, type, url: '', caption: '' }
    case 'review': return { id, type, title: '', text: '', phases: ['nach'] }
    case 'link': return { id, type, title: '', url: '', note: '' }
    case 'map': return { id, type }
    case 'times': return { id, type }
    case 'rules': return { id, type }
    case 'region': return { id, type }
    case 'chat': return { id, type }
    case 'inventar': return { id, type, title: 'Inventar & Ausstattung', items: [] }
  }
}

/** Vorbefüllte Startvorlage — der Host passt Texte an, statt bei null zu beginnen. */
export function defaultTemplate(): GuideBlock[] {
  return [
    { id: newBlockId(), type: 'text', text: 'Schön, dass du da bist! Hier findest du alles Wichtige für deinen Aufenthalt — von der Anreise bis zum WLAN.' },
    { id: newBlockId(), type: 'times' },
    { id: newBlockId(), type: 'map' },
    { id: newBlockId(), type: 'steps', title: 'So kommst du rein', steps: ['Beispiel: Parke direkt vor dem Haus.', 'Beispiel: Die Wohnung findest du im 1. OG links.', 'Beispiel: Den Schlüssel bekommst du …'] },
    { id: newBlockId(), type: 'door', title: 'Türcode', text: '' },
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
    case 'steps': return b.steps.some((s) => s.trim().length > 0) || (b.stepImages ?? []).some(Boolean)
    case 'wifi': return b.ssid.trim().length > 0
    case 'door': return b.text.trim().length > 0 || !!ctx.doorCode || !!ctx.doorNote
    case 'contact': return b.phone.trim().length > 0 || b.note.trim().length > 0
    case 'image': return b.url.trim().length > 0 || !!(b.url2 && b.url2.trim())
    case 'map': return !!ctx.address
    case 'times':
      if (b.show === 'checkin') return !!ctx.checkIn
      if (b.show === 'checkout') return !!ctx.checkOut
      return !!(ctx.checkIn || ctx.checkOut)
    case 'rules': return ctx.rules.length > 0
    case 'region': return !!ctx.regionSlug
    case 'chat': return true
    case 'inventar': return Array.isArray(b.items) && b.items.length > 0
    case 'review': return !!ctx.googlePlaceId
    case 'link': return b.url.trim().length > 0 && b.title.trim().length > 0
  }
}

/** §166: Kontakt + Chat = EIN Punkt „Kontakt & Chat". Entfernt alle
 *  contact-Bausteine; Telefon/Hinweis des ERSTEN wandern in den chat-Block
 *  (bzw. der erste contact wird selbst zum Chat-Standort, wenn kein
 *  chat-Baustein existiert). Geteilt zwischen öffentlicher Mappe und
 *  Builder-Vorschau — beide zeigen exakt dasselbe. */
export function mergeContactIntoChat(blocks: GuideBlock[]): GuideBlock[] {
  const contact = blocks.find((b): b is ContactBlock => b.type === 'contact')
  const hasChat = blocks.some((b) => b.type === 'chat')
  let first = true
  return blocks.flatMap((b): GuideBlock[] => {
    if (b.type === 'chat') {
      return [contact ? { ...b, phone: contact.phone, note: contact.note } : b]
    }
    if (b.type !== 'contact') return [b]
    const wasFirst = first
    first = false
    if (wasFirst && !hasChat) {
      return [{ id: 'auto-chat', type: 'chat', phase: b.phase, phases: b.phases, minNights: b.minNights, phone: b.phone, note: b.note }]
    }
    return []
  })
}

/** Alle übersetzbaren Textfelder eines Block-Sets (für makeTr auf der Mappe). */
export function collectGuideTexts(blocks: GuideBlock[]): string[] {
  const out: string[] = []
  for (const b of blocks) {
    if ('text' in b && b.text) out.push(b.text)
    if ('title' in b && b.title) out.push(b.title)
    if ('note' in b && b.note) out.push(b.note)
    if ('caption' in b && b.caption) out.push(b.caption)
    if (b.type === 'steps') out.push(...b.steps.filter(Boolean))
    if (b.type === 'inventar') out.push(...(b.items ?? []).flatMap((i) => [i.label, i.note ?? '']).filter(Boolean))
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
    if ('caption' in c && c.caption) c.caption = tr(c.caption)
    if (c.type === 'steps') c.steps = c.steps.map((s) => (s ? tr(s) : s))
    if (c.type === 'inventar') c.items = (c.items ?? []).map((i) => ({ ...i, label: i.label ? tr(i.label) : i.label, note: i.note ? tr(i.note) : i.note }))
    return c
  })
}
