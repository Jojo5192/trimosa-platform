/** Amenity catalogue for the public detail page (mirrored from the editor). */

export interface AmenityItem { emoji: string; id: string; label: string }
export interface AmenityCategory { name: string; icon: string; items: AmenityItem[] }

/* ── Amenity categories (mirrored from editor) ─────────────── */
export const AMENITY_CATEGORIES: AmenityCategory[] = [
  { name: 'Internet & Technik', icon: '📶', items: [
    { emoji: '📶', id: 'WLAN', label: 'WLAN' }, { emoji: '🚀', id: 'Schnelles WLAN (>100 Mbit/s)', label: 'Schnelles WLAN' },
    { emoji: '📺', id: 'TV', label: 'TV' }, { emoji: '📡', id: 'Smart-TV', label: 'Smart-TV' },
    { emoji: '🎬', id: 'Netflix', label: 'Netflix' },
    // Legacy-Wert bestehender Inserate (kombinierter Punkt vor der Trennung)
    { emoji: '📡', id: 'Smart-TV / Netflix', label: 'Smart-TV' },
    { emoji: '💻', id: 'Arbeitsplatz / Schreibtisch', label: 'Arbeitsplatz' }, { emoji: '🖨️', id: 'Drucker', label: 'Drucker' },
  ]},
  { name: 'Küche', icon: '🍳', items: [
    { emoji: '🍳', id: 'Küche', label: 'Küche' }, { emoji: '🍽️', id: 'Küchenzeile', label: 'Küchenzeile' },
    { emoji: '🫧', id: 'Geschirrspüler', label: 'Geschirrspüler' }, { emoji: '🧊', id: 'Kühlschrank', label: 'Kühlschrank' },
    { emoji: '❄️', id: 'Gefrierfach', label: 'Gefrierfach' }, { emoji: '📦', id: 'Mikrowelle', label: 'Mikrowelle' },
    { emoji: '🥧', id: 'Backofen', label: 'Backofen' }, { emoji: '☕', id: 'Kaffeemaschine', label: 'Kaffeemaschine' },
    { emoji: '🫘', id: 'Espressomaschine', label: 'Espressomaschine' }, { emoji: '🫖', id: 'Wasserkocher', label: 'Wasserkocher' },
    { emoji: '🍞', id: 'Toaster', label: 'Toaster' }, { emoji: '🍷', id: 'Weingläser', label: 'Weingläser' },
    { emoji: '🍖', id: 'Grill', label: 'Grill' }, { emoji: '🪑', id: 'Essbereich', label: 'Essbereich' },
  ]},
  { name: 'Badezimmer', icon: '🚿', items: [
    { emoji: '🚿', id: 'Dusche', label: 'Dusche' }, { emoji: '🛁', id: 'Badewanne', label: 'Badewanne' },
    { emoji: '♨️', id: 'Whirlpool / Hot Tub', label: 'Whirlpool' }, { emoji: '💨', id: 'Haartrockner', label: 'Haartrockner' },
    { emoji: '🧴', id: 'Pflegeprodukte', label: 'Pflegeprodukte' }, { emoji: '🛁', id: 'Handtücher gestellt', label: 'Handtücher' },
  ]},
  { name: 'Schlafzimmer & Wäsche', icon: '🛏️', items: [
    { emoji: '🛏️', id: 'Bettwäsche gestellt', label: 'Bettwäsche' }, { emoji: '🧺', id: 'Waschmaschine', label: 'Waschmaschine' },
    { emoji: '👕', id: 'Trockner', label: 'Trockner' }, { emoji: '👔', id: 'Bügeleisen', label: 'Bügeleisen' },
    { emoji: '🚪', id: 'Kleiderschrank', label: 'Kleiderschrank' }, { emoji: '🪝', id: 'Kleiderbügel', label: 'Kleiderbügel' },
    { emoji: '🛏️', id: 'Extra Kissen & Decken', label: 'Extra Kissen & Decken' }, { emoji: '🌑', id: 'Verdunkelung', label: 'Verdunkelung' },
  ]},
  { name: 'Heizung & Klima', icon: '🔥', items: [
    { emoji: '🔥', id: 'Heizung', label: 'Heizung' }, { emoji: '🌬️', id: 'Klimaanlage', label: 'Klimaanlage' },
    { emoji: '🪵', id: 'Kamin', label: 'Kamin' }, { emoji: '🌡️', id: 'Fußbodenheizung', label: 'Fußbodenheizung' },
    { emoji: '💨', id: 'Ventilator', label: 'Ventilator' },
  ]},
  { name: 'Außenbereich', icon: '🌞', items: [
    { emoji: '🏡', id: 'Balkon', label: 'Balkon' }, { emoji: '🌞', id: 'Terrasse', label: 'Terrasse' },
    { emoji: '🌿', id: 'Garten', label: 'Garten' }, { emoji: '🏊', id: 'Pool', label: 'Pool' },
    { emoji: '🚿', id: 'Außendusche', label: 'Außendusche' }, { emoji: '🌴', id: 'Liegestühle', label: 'Liegestühle' },
    { emoji: '🪑', id: 'Gartenmöbel', label: 'Gartenmöbel' }, { emoji: '🔥', id: 'Feuerstelle', label: 'Feuerstelle' },
    { emoji: '🚲', id: 'Fahrradstellplatz', label: 'Fahrradstellplatz' },
  ]},
  { name: 'Wellness & Sport', icon: '🧖', items: [
    { emoji: '🧖', id: 'Sauna', label: 'Sauna' }, { emoji: '💆', id: 'Dampfbad', label: 'Dampfbad' },
    { emoji: '🏋️', id: 'Fitnessraum', label: 'Fitnessraum' }, { emoji: '🧘', id: 'Yogamatte', label: 'Yogamatte' },
    { emoji: '🚵', id: 'Fahrräder verfügbar', label: 'Fahrräder' }, { emoji: '🎿', id: 'Skiaufbewahrung', label: 'Skiaufbewahrung' },
    { emoji: '🎲', id: 'Gesellschaftsspiele', label: 'Gesellschaftsspiele' },
  ]},
  { name: 'Parken & Anreise', icon: '🅿️', items: [
    { emoji: '🅿️', id: 'Parkplatz (kostenlos)', label: 'Parkplatz (kostenlos)' },
    { emoji: '🚗', id: 'Parkplatz (kostenpflichtig)', label: 'Parkplatz (kostenpflichtig)' },
    { emoji: '🏠', id: 'Garage', label: 'Garage' }, { emoji: '⚡', id: 'E-Auto Ladepunkt', label: 'E-Auto Ladepunkt' },
    { emoji: '🔑', id: 'Self-Check-in / Schlüsselbox', label: 'Self-Check-in' }, { emoji: '🛗', id: 'Aufzug', label: 'Aufzug' },
  ]},
  { name: 'Lage & Umgebung', icon: '🏔️', items: [
    { emoji: '🏔️', id: 'Bergpanorama', label: 'Bergpanorama' }, { emoji: '🏞️', id: 'Seenähe', label: 'Seenähe' },
    { emoji: '🏖️', id: 'Strandnähe', label: 'Strandnähe' }, { emoji: '⛷️', id: 'Skigebiet in der Nähe', label: 'Skigebiet' },
    { emoji: '🏙️', id: 'Stadtzentrumsnähe', label: 'Stadtzentrum' }, { emoji: '🌲', id: 'Waldnähe', label: 'Waldnähe' },
    { emoji: '🤫', id: 'Ruhige Lage', label: 'Ruhige Lage' },
  ]},
  { name: 'Familie & Kinder', icon: '👶', items: [
    { emoji: '👶', id: 'Babyausstattung', label: 'Babyausstattung' }, { emoji: '🛏️', id: 'Kinderbett / Reisebett', label: 'Kinderbett' },
    { emoji: '🪑', id: 'Hochstuhl', label: 'Hochstuhl' }, { emoji: '🧸', id: 'Spielzeug', label: 'Spielzeug' },
    { emoji: '🛡️', id: 'Kindersicherungen', label: 'Kindersicherungen' }, { emoji: '🏡', id: 'Eingezäunter Garten', label: 'Eingezäunter Garten' },
  ]},
  { name: 'Sicherheit', icon: '🚨', items: [
    { emoji: '🚨', id: 'Rauchmelder', label: 'Rauchmelder' }, { emoji: '⚠️', id: 'CO-Melder', label: 'CO-Melder' },
    { emoji: '🩹', id: 'Erste-Hilfe-Set', label: 'Erste-Hilfe-Set' }, { emoji: '🧯', id: 'Feuerlöscher', label: 'Feuerlöscher' },
    { emoji: '🔒', id: 'Safe / Tresor', label: 'Safe / Tresor' }, { emoji: '📷', id: 'Überwachungskamera (außen)', label: 'Kamera (außen)' },
  ]},
  { name: 'Haustiere & Sonstiges', icon: '🐾', items: [
    { emoji: '🐾', id: 'Haustiere erlaubt', label: 'Haustiere erlaubt' }, { emoji: '🚬', id: 'Rauchen erlaubt', label: 'Rauchen erlaubt' },
    { emoji: '🧳', id: 'Gepäckaufbewahrung', label: 'Gepäckaufbewahrung' }, { emoji: '📅', id: 'Langzeitaufenthalt möglich', label: 'Langzeitaufenthalt' },
    { emoji: '♿', id: 'Barrierefrei', label: 'Barrierefrei' }, { emoji: '🥐', id: 'Frühstück inklusive', label: 'Frühstück inklusive' },
  ]},
]

/* Build lookup map: amenity id → { emoji, category } */
export const AMENITY_MAP = new Map<string, { emoji: string; label: string; category: string }>()
for (const cat of AMENITY_CATEGORIES) {
  for (const item of cat.items) {
    AMENITY_MAP.set(item.id, { emoji: item.emoji, label: item.label, category: cat.name })
  }
}

/* Priority amenities — these appear first in the preview when available */
export const PRIORITY_AMENITY_IDS = [
  'WLAN', 'Küche', 'Parkplatz (kostenlos)', 'Klimaanlage', 'Pool', 'Waschmaschine',
  'Balkon', 'Terrasse', 'Garten', 'Sauna', 'TV', 'Haustiere erlaubt',
  'Bergpanorama', 'Seenähe', 'Kamin', 'Grill', 'E-Auto Ladepunkt', 'Babyausstattung',
]
