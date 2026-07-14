'use client'

/**
 * Shared data + tiny UI helpers for the listing editor (split from the former
 * 1,400-line ListingEditor.tsx): amenity catalogue, cancellation templates,
 * the Listing shape, Section/Field wrappers and the common input style.
 */
import type { Room } from './RoomEditor'

export const AMENITY_CATEGORIES = [
  {
    category: 'Internet & Technik',
    items: [
      { id: 'wifi',           icon: '📶', label: 'WLAN' },
      { id: 'wifi_fast',      icon: '🚀', label: 'Schnelles WLAN (>100 Mbit/s)' },
      { id: 'tv',             icon: '📺', label: 'TV' },
      { id: 'smart_tv',       icon: '📡', label: 'Smart-TV' },
      { id: 'netflix',        icon: '🎬', label: 'Netflix' },
      { id: 'workspace',      icon: '💻', label: 'Arbeitsplatz / Schreibtisch' },
      { id: 'printer',        icon: '🖨️', label: 'Drucker' },
    ],
  },
  {
    category: 'Küche',
    items: [
      { id: 'kitchen',        icon: '🍳', label: 'Küche' },
      { id: 'kitchenette',    icon: '🍽️', label: 'Küchenzeile' },
      { id: 'dishwasher',     icon: '🫧', label: 'Geschirrspüler' },
      { id: 'fridge',         icon: '🧊', label: 'Kühlschrank' },
      { id: 'freezer',        icon: '❄️', label: 'Gefrierfach' },
      { id: 'microwave',      icon: '📦', label: 'Mikrowelle' },
      { id: 'oven',           icon: '🥧', label: 'Backofen' },
      { id: 'coffee',         icon: '☕', label: 'Kaffeemaschine' },
      { id: 'espresso',       icon: '🫘', label: 'Espressomaschine' },
      { id: 'kettle',         icon: '🫖', label: 'Wasserkocher' },
      { id: 'toaster',        icon: '🍞', label: 'Toaster' },
      { id: 'wine_glasses',   icon: '🍷', label: 'Weingläser' },
      { id: 'bbq',            icon: '🍖', label: 'Grill' },
      { id: 'dining_area',    icon: '🪑', label: 'Essbereich' },
    ],
  },
  {
    category: 'Badezimmer',
    items: [
      { id: 'shower',         icon: '🚿', label: 'Dusche' },
      { id: 'bathtub',        icon: '🛁', label: 'Badewanne' },
      { id: 'hot_tub',        icon: '♨️', label: 'Whirlpool / Hot Tub' },
      { id: 'hair_dryer',     icon: '💨', label: 'Haartrockner' },
      { id: 'toiletries',     icon: '🧴', label: 'Pflegeprodukte' },
      { id: 'towels',         icon: '🛁', label: 'Handtücher gestellt' },
    ],
  },
  {
    category: 'Schlafzimmer & Wäsche',
    items: [
      { id: 'linens',         icon: '🛏️', label: 'Bettwäsche gestellt' },
      { id: 'washer',         icon: '🧺', label: 'Waschmaschine' },
      { id: 'dryer',          icon: '👕', label: 'Trockner' },
      { id: 'iron',           icon: '👔', label: 'Bügeleisen' },
      { id: 'wardrobe',       icon: '🚪', label: 'Kleiderschrank' },
      { id: 'hangers',        icon: '🪝', label: 'Kleiderbügel' },
      { id: 'extra_pillows',  icon: '🛏️', label: 'Extra Kissen & Decken' },
      { id: 'blackout',       icon: '🌑', label: 'Verdunkelung' },
    ],
  },
  {
    category: 'Heizung & Klima',
    items: [
      { id: 'heating',        icon: '🔥', label: 'Heizung' },
      { id: 'ac',             icon: '🌬️', label: 'Klimaanlage' },
      { id: 'fireplace',      icon: '🪵', label: 'Kamin' },
      { id: 'floor_heating',  icon: '🌡️', label: 'Fußbodenheizung' },
      { id: 'fan',            icon: '💨', label: 'Ventilator' },
    ],
  },
  {
    category: 'Außenbereich',
    items: [
      { id: 'balcony',        icon: '🏡', label: 'Balkon' },
      { id: 'terrace',        icon: '🌞', label: 'Terrasse' },
      { id: 'garden',         icon: '🌿', label: 'Garten' },
      { id: 'pool',           icon: '🏊', label: 'Pool' },
      { id: 'outdoor_shower', icon: '🚿', label: 'Außendusche' },
      { id: 'sun_loungers',   icon: '🌴', label: 'Liegestühle' },
      { id: 'garden_furniture',icon: '🪑', label: 'Gartenmöbel' },
      { id: 'fire_pit',       icon: '🔥', label: 'Feuerstelle' },
      { id: 'bike_storage',   icon: '🚲', label: 'Fahrradstellplatz' },
    ],
  },
  {
    category: 'Wellness & Sport',
    items: [
      { id: 'sauna',          icon: '🧖', label: 'Sauna' },
      { id: 'steam_room',     icon: '💆', label: 'Dampfbad' },
      { id: 'gym',            icon: '🏋️', label: 'Fitnessraum' },
      { id: 'yoga_mat',       icon: '🧘', label: 'Yogamatte' },
      { id: 'bikes',          icon: '🚵', label: 'Fahrräder verfügbar' },
      { id: 'ski_storage',    icon: '🎿', label: 'Skiaufbewahrung' },
      { id: 'board_games',    icon: '🎲', label: 'Gesellschaftsspiele' },
    ],
  },
  {
    category: 'Parken & Anreise',
    items: [
      { id: 'parking',        icon: '🅿️', label: 'Parkplatz (kostenlos)' },
      { id: 'parking_paid',   icon: '🚗', label: 'Parkplatz (kostenpflichtig)' },
      { id: 'garage',         icon: '🏠', label: 'Garage' },
      { id: 'ev',             icon: '⚡', label: 'E-Auto Ladepunkt' },
      { id: 'self_checkin',   icon: '🔑', label: 'Self-Check-in / Schlüsselbox' },
      { id: 'elevator',       icon: '🛗', label: 'Aufzug' },
    ],
  },
  {
    category: 'Lage & Umgebung',
    items: [
      { id: 'mountain',       icon: '🏔️', label: 'Bergpanorama' },
      { id: 'lake',           icon: '🏞️', label: 'Seenähe' },
      { id: 'beach',          icon: '🏖️', label: 'Strandnähe' },
      { id: 'ski',            icon: '⛷️', label: 'Skigebiet in der Nähe' },
      { id: 'city_center',    icon: '🏙️', label: 'Stadtzentrumsnähe' },
      { id: 'forest',         icon: '🌲', label: 'Waldnähe' },
      { id: 'quiet',          icon: '🤫', label: 'Ruhige Lage' },
    ],
  },
  {
    category: 'Familie & Kinder',
    items: [
      { id: 'baby',           icon: '👶', label: 'Babyausstattung' },
      { id: 'crib',           icon: '🛏️', label: 'Kinderbett / Reisebett' },
      { id: 'high_chair',     icon: '🪑', label: 'Hochstuhl' },
      { id: 'toys',           icon: '🧸', label: 'Spielzeug' },
      { id: 'child_safety',   icon: '🛡️', label: 'Kindersicherungen' },
      { id: 'fenced_garden',  icon: '🏡', label: 'Eingezäunter Garten' },
    ],
  },
  {
    category: 'Sicherheit',
    items: [
      { id: 'smoke_detector', icon: '🚨', label: 'Rauchmelder' },
      { id: 'co_detector',    icon: '⚠️', label: 'CO-Melder' },
      { id: 'first_aid',      icon: '🩹', label: 'Erste-Hilfe-Set' },
      { id: 'fire_ext',       icon: '🧯', label: 'Feuerlöscher' },
      { id: 'safe',           icon: '🔒', label: 'Safe / Tresor' },
      { id: 'security_cam',   icon: '📷', label: 'Überwachungskamera (außen)' },
    ],
  },
  {
    category: 'Haustiere & Sonstiges',
    items: [
      { id: 'pets',           icon: '🐾', label: 'Haustiere erlaubt' },
      { id: 'smoking',        icon: '🚬', label: 'Rauchen erlaubt' },
      { id: 'luggage_storage',icon: '🧳', label: 'Gepäckaufbewahrung' },
      { id: 'long_stay',      icon: '📅', label: 'Langzeitaufenthalt möglich' },
      { id: 'accessible',     icon: '♿', label: 'Barrierefrei' },
      { id: 'breakfast',      icon: '🥐', label: 'Frühstück inklusive' },
    ],
  },
]

// Flat list for backwards-compatible storage (uses label as value, same as before)
export const AMENITY_OPTIONS = AMENITY_CATEGORIES.flatMap(c => c.items)

export interface Listing {
  id: string
  title: string
  description: string
  location: string
  address?: string
  city?: string
  latitude?: number
  longitude?: number
  price_per_night: number
  max_guests: number
  bedrooms: number
  bathrooms?: number
  amenities?: string[]
  images?: string[]
  rooms?: Room[]
  house_rules?: string
  house_rules_details?: string
  checkin_instructions?: string
  important_notes?: string
  floor_plan_url?: string
  floor_plan_urls?: string[]
  floor_plan_labels?: string[]
  rule_pets_allowed?: boolean
  rule_events_allowed?: boolean
  rule_smoking_allowed?: boolean
  rule_quiet_hours?: boolean
  rule_quiet_start?: string
  rule_quiet_end?: string
  rule_commercial_photo?: boolean
  rule_max_guests?: number
  rule_additional_rules?: string
  check_in_time?: string
  check_out_time?: string
  allow_instant_booking?: boolean
  allow_requests?: boolean
  min_request_nights?: number
  is_active: boolean
  smoobu_id?: string
  cancellation_policy?: string
  cancel_free_days?: number | null
  cancel_free_percent?: number | null
  cancel_partial_days?: number | null
  cancel_partial_percent?: number | null
  airbnb_url?: string
  booking_url?: string
  vrbo_url?: string
  google_place_id?: string
}

export const CANCELLATION_TEMPLATES = [
  {
    id: 'flexibel',
    label: 'Flexibel',
    desc: 'Kostenlose Stornierung bis 1 Tag vor Check-in.',
    freeDays: 1, freePercent: 100, partialDays: null as number | null, partialPercent: null as number | null,
  },
  {
    id: 'moderat',
    label: 'Moderat',
    desc: 'Kostenlose Stornierung bis 5 Tage vor Check-in.',
    freeDays: 5, freePercent: 100, partialDays: null as number | null, partialPercent: null as number | null,
  },
  {
    id: 'strikt',
    label: 'Strikt',
    desc: '50 % Erstattung bis 14 Tage vor Check-in. Danach keine Erstattung.',
    freeDays: 14, freePercent: 50, partialDays: null as number | null, partialPercent: null as number | null,
  },
  {
    id: 'custom',
    label: 'Benutzerdefiniert',
    desc: 'Eigene Fristen und Erstattungssätze festlegen.',
    freeDays: 7, freePercent: 100, partialDays: 3, partialPercent: 50,
  },
]

/* ── Section wrapper — must be defined outside ListingEditor to avoid focus loss on re-render ── */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: '20px', padding: '24px', border: '1px solid #E8E6E0', marginBottom: '16px' }}>
      <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#111', margin: '0 0 18px', letterSpacing: '-0.2px' }}>{title}</h2>
      {children}
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>
        {label}
      </label>
      {children}
      {hint && <p style={{ fontSize: '11px', color: '#AAA', margin: '4px 0 0' }}>{hint}</p>}
    </div>
  )
}

export const inputStyle: React.CSSProperties = {
  width: '100%', borderRadius: '12px', border: '1.5px solid #E0DDD6',
  padding: '10px 14px', fontSize: '13px', color: '#111',
  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  backgroundColor: '#fff',
}
