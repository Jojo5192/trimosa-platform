'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseBrowser as supabase } from '@/lib/supabase-browser'
import RoomEditor, { type Room } from './RoomEditor'
import LocationPicker from '@/components/LocationPicker'

const AMENITY_CATEGORIES = [
  {
    category: 'Internet & Technik',
    items: [
      { id: 'wifi',           icon: '📶', label: 'WLAN' },
      { id: 'wifi_fast',      icon: '🚀', label: 'Schnelles WLAN (>100 Mbit/s)' },
      { id: 'tv',             icon: '📺', label: 'TV' },
      { id: 'smart_tv',       icon: '📡', label: 'Smart-TV / Netflix' },
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
const AMENITY_OPTIONS = AMENITY_CATEGORIES.flatMap(c => c.items)

interface Listing {
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
  revyoos_property_id?: string
}

const CANCELLATION_TEMPLATES = [
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
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: '20px', padding: '24px', border: '1px solid #E8E6E0', marginBottom: '16px' }}>
      <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#111', margin: '0 0 18px', letterSpacing: '-0.2px' }}>{title}</h2>
      {children}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
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

export default function ListingEditor({ listing }: { listing: Listing }) {
  const router = useRouter()

  const [title, setTitle] = useState(listing.title)
  const [description, setDescription] = useState(listing.description ?? '')
  const [location, setLocation] = useState(listing.location ?? '')
  const [address, setAddress] = useState(listing.address ?? '')
  const [city, setCity] = useState(listing.city ?? '')
  const [lat, setLat] = useState<number | null>(listing.latitude ?? null)
  const [lon, setLon] = useState<number | null>(listing.longitude ?? null)
  const [maxGuests, setMaxGuests] = useState(listing.max_guests ?? 2)
  const [bedrooms, setBedrooms] = useState(listing.bedrooms ?? 1)
  const [bathrooms, setBathrooms] = useState(listing.bathrooms ?? 1)
  const [amenities, setAmenities] = useState<string[]>(listing.amenities ?? [])
  const [coverImage, setCoverImage] = useState<string>(listing.images?.[0] ?? '')
  const [coverUploading, setCoverUploading] = useState(false)
  const [floorPlanUrls, setFloorPlanUrls] = useState<string[]>(
    listing.floor_plan_urls?.length ? listing.floor_plan_urls : (listing.floor_plan_url ? [listing.floor_plan_url] : [])
  )
  const [floorPlanLabels, setFloorPlanLabels] = useState<string[]>(listing.floor_plan_labels ?? [])
  const [floorPlanUploading, setFloorPlanUploading] = useState(false)
  const [rooms, setRooms] = useState<Room[]>(listing.rooms ?? [])
  const [houseRules, setHouseRules] = useState(listing.house_rules ?? '')
  const [houseRulesDetails, setHouseRulesDetails] = useState(listing.house_rules_details ?? '')
  const [checkinInstructions, setCheckinInstructions] = useState(listing.checkin_instructions ?? '')
  const [importantNotes, setImportantNotes] = useState(listing.important_notes ?? '')
  const [rulePetsAllowed, setRulePetsAllowed] = useState(listing.rule_pets_allowed ?? false)
  const [ruleEventsAllowed, setRuleEventsAllowed] = useState(listing.rule_events_allowed ?? false)
  const [ruleSmokingAllowed, setRuleSmokingAllowed] = useState(listing.rule_smoking_allowed ?? false)
  const [ruleQuietHours, setRuleQuietHours] = useState(listing.rule_quiet_hours ?? false)
  const [ruleQuietStart, setRuleQuietStart] = useState(listing.rule_quiet_start ?? '22:00')
  const [ruleQuietEnd, setRuleQuietEnd] = useState(listing.rule_quiet_end ?? '07:00')
  const [ruleCommercialPhoto, setRuleCommercialPhoto] = useState(listing.rule_commercial_photo ?? false)
  const [ruleAdditionalRules, setRuleAdditionalRules] = useState(listing.rule_additional_rules ?? '')
  const [checkInTime, setCheckInTime] = useState(listing.check_in_time ?? '15:00')
  const [checkOutTime, setCheckOutTime] = useState(listing.check_out_time ?? '11:00')
  const [allowInstant, setAllowInstant] = useState(listing.allow_instant_booking ?? true)
  const [allowRequests, setAllowRequests] = useState(listing.allow_requests ?? true)
  const [minRequestNights, setMinRequestNights] = useState(listing.min_request_nights ?? 1)
  const [isActive, setIsActive] = useState(listing.is_active)
  const [cancelPolicy, setCancelPolicy] = useState(listing.cancellation_policy ?? 'moderat')
  const [cancelFreeDays, setCancelFreeDays] = useState<number>(listing.cancel_free_days ?? (CANCELLATION_TEMPLATES.find(t => t.id === (listing.cancellation_policy ?? 'moderat'))?.freeDays ?? 5))
  const [cancelFreePercent, setCancelFreePercent] = useState<number>(listing.cancel_free_percent ?? (CANCELLATION_TEMPLATES.find(t => t.id === (listing.cancellation_policy ?? 'moderat'))?.freePercent ?? 100))
  const [cancelPartialDays, setCancelPartialDays] = useState<number | null>(listing.cancel_partial_days ?? null)
  const [cancelPartialPercent, setCancelPartialPercent] = useState<number | null>(listing.cancel_partial_percent ?? null)
  const [airbnbUrl, setAirbnbUrl] = useState(listing.airbnb_url ?? '')
  const [bookingUrl, setBookingUrl] = useState(listing.booking_url ?? '')
  const [vrboUrl, setVrboUrl] = useState(listing.vrbo_url ?? '')
  const [googlePlaceId, setGooglePlaceId] = useState(listing.google_place_id ?? '')
  const [revyoosId, setRevyoosId] = useState(listing.revyoos_property_id ?? '')

  // Reviews management
  const [reviews, setReviews] = useState<{ id: string; source: string; author_name: string; rating: number; review_text: string; review_date: string }[]>([])
  const [reviewsLoading, setReviewsLoading] = useState(false)
  const [fetchingReviews, setFetchingReviews] = useState(false)
  const [fetchResult, setFetchResult] = useState<{ results: { source: string; status?: string; fetched: number; upserted?: number; score?: number; count?: number; detail?: string }[] } | null>(null)
  const [showAddReview, setShowAddReview] = useState(false)
  const [showPasteImport, setShowPasteImport] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteSource, setPasteSource] = useState('airbnb')
  const [pasteImporting, setPasteImporting] = useState(false)
  const [newReview, setNewReview] = useState({ source: 'airbnb', authorName: '', rating: '5', reviewText: '', reviewDate: new Date().toISOString().split('T')[0] })

  const [onboardingError, setOnboardingError] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const coverInputRef = useRef<HTMLInputElement>(null)
  const floorPlanInputRef = useRef<HTMLInputElement>(null)

  function toggleAmenity(label: string) {
    setAmenities(prev =>
      prev.includes(label) ? prev.filter(a => a !== label) : [...prev, label]
    )
  }

  async function handleCoverUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCoverUploading(true)
    setError('')

    // 1. Upload to storage
    const form = new FormData()
    form.append('file', file)
    const upRes = await fetch(`/api/listings/${listing.id}/upload`, { method: 'POST', body: form })
    const upData = await upRes.json()

    if (!upRes.ok) {
      setError(`Upload fehlgeschlagen: ${upData.error ?? upRes.statusText}`)
      setCoverUploading(false)
      if (coverInputRef.current) coverInputRef.current.value = ''
      return
    }

    const url: string = upData.url
    setCoverImage(url)

    // 2. Immediately save to DB so it shows on the homepage card
    const saveRes = await fetch(`/api/listings/${listing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cover_image: url }),
    })
    if (!saveRes.ok) {
      const saveData = await saveRes.json()
      setError(`Bild gespeichert, aber Titelbild konnte nicht gesetzt werden: ${saveData.error ?? saveRes.statusText}`)
    }

    setCoverUploading(false)
    if (coverInputRef.current) coverInputRef.current.value = ''
  }

  async function handleFloorPlanUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFloorPlanUploading(true)
    setError('')

    // 1. Upload to storage
    const form = new FormData()
    form.append('file', file)
    const upRes = await fetch(`/api/listings/${listing.id}/upload`, { method: 'POST', body: form })
    const upData = await upRes.json()

    if (!upRes.ok) {
      setError(`Upload fehlgeschlagen: ${upData.error ?? upRes.statusText}`)
      setFloorPlanUploading(false)
      if (floorPlanInputRef.current) floorPlanInputRef.current.value = ''
      return
    }

    const url: string = upData.url
    const newUrls = [...floorPlanUrls, url]
    setFloorPlanUrls(newUrls)

    // 2. Immediately save to DB
    const saveRes = await fetch(`/api/listings/${listing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ floor_plan_urls: newUrls, floor_plan_url: newUrls[0] }),
    })
    if (!saveRes.ok) {
      const saveData = await saveRes.json()
      setError(`Bild gespeichert, aber Grundriss konnte nicht gesetzt werden: ${saveData.error ?? saveRes.statusText}`)
    }

    setFloorPlanUploading(false)
    if (floorPlanInputRef.current) floorPlanInputRef.current.value = ''
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setSaved(false)

    try {
      const res = await fetch(`/api/listings/${listing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          location,
          address,
          city,
          latitude: lat,
          longitude: lon,
          max_guests: maxGuests,
          bedrooms,
          bathrooms,
          amenities,
          cover_image: coverImage,
          floor_plan_url: floorPlanUrls[0] ?? '',
          floor_plan_urls: floorPlanUrls,
          floor_plan_labels: floorPlanLabels,
          rooms,
          cancellation_policy: cancelPolicy === 'custom' ? 'custom' : cancelPolicy,
          cancel_free_days: cancelFreeDays,
          cancel_free_percent: cancelFreePercent,
          cancel_partial_days: cancelPartialDays,
          cancel_partial_percent: cancelPartialPercent,
          house_rules: houseRules,
          house_rules_details: houseRulesDetails,
          checkin_instructions: checkinInstructions,
          important_notes: importantNotes,
          rule_pets_allowed: rulePetsAllowed,
          rule_events_allowed: ruleEventsAllowed,
          rule_smoking_allowed: ruleSmokingAllowed,
          rule_quiet_hours: ruleQuietHours,
          rule_quiet_start: ruleQuietStart,
          rule_quiet_end: ruleQuietEnd,
          rule_commercial_photo: ruleCommercialPhoto,
          rule_additional_rules: ruleAdditionalRules,
          check_in_time: checkInTime,
          check_out_time: checkOutTime,
          allow_instant_booking: allowInstant,
          allow_requests: allowRequests,
          min_request_nights: minRequestNights,
          airbnb_url: airbnbUrl,
          booking_url: bookingUrl,
          vrbo_url: vrboUrl,
          google_place_id: googlePlaceId,
          revyoos_property_id: revyoosId,
          is_active: isActive,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.error === 'onboarding_incomplete') {
          setOnboardingError(true)
          setIsActive(false)
        } else {
          setError('Speichern fehlgeschlagen: ' + (data.error ?? res.statusText))
        }
      } else {
        setOnboardingError(false)
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
        router.refresh()
      }
    } catch (e) {
      setError('Netzwerkfehler: ' + String(e))
    }
    setSaving(false)
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true)
    const res = await fetch(`/api/listings/${listing.id}`, { method: 'DELETE' })
    if (res.ok) {
      router.push('/dashboard')
      router.refresh()
    } else {
      const d = await res.json()
      setError('Löschen fehlgeschlagen: ' + (d.error ?? res.statusText))
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', borderRadius: '12px', border: '1.5px solid #E0DDD6',
    padding: '10px 14px', fontSize: '13px', color: '#111',
    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
    backgroundColor: '#fff',
  }

  return (
    <div>

      {/* ── Status banner ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', borderRadius: '16px', padding: '14px 20px', border: '1px solid #E8E6E0', marginBottom: '16px' }}>
        <div>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#111', margin: 0 }}>Sichtbarkeit</p>
          <p style={{ fontSize: '12px', color: '#999', margin: '2px 0 0' }}>
            {isActive ? 'Inserat ist auf der Plattform sichtbar' : 'Inserat ist noch nicht veröffentlicht'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsActive(v => !v)}
          style={{
            padding: '8px 20px', borderRadius: '999px', border: 'none', cursor: 'pointer',
            fontSize: '12px', fontWeight: 700,
            background: isActive ? 'linear-gradient(135deg, var(--gold), var(--gold-dark))' : '#E5E5E5',
            color: isActive ? '#fff' : '#666',
            transition: 'all 0.15s',
          }}
        >
          {isActive ? '● Aktiv' : '○ Inaktiv'}
        </button>
      </div>

      {/* ── Grunddaten ── */}
      {/* ── Titelbild ── */}
      <Section title="Titelbild">
        <p style={{ fontSize: '12px', color: '#888', margin: '0 0 14px' }}>
          Dieses Bild wird in der Suche und als Hauptfoto in der Detailansicht angezeigt.
        </p>
        <input
          ref={coverInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={handleCoverUpload}
        />
        {coverImage ? (
          <div style={{ position: 'relative', width: '100%', maxWidth: '360px', aspectRatio: '4/3', borderRadius: '14px', overflow: 'hidden', border: '2px solid #E0DDD6' }}>
            <img src={coverImage} alt="Titelbild" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: '8px', padding: '12px', background: 'linear-gradient(to top, rgba(0,0,0,0.45) 0%, transparent 60%)' }}>
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                disabled={coverUploading}
                style={{ flex: 1, padding: '8px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.92)', cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: '#111' }}
              >
                {coverUploading ? 'Wird hochgeladen…' : '↺ Ersetzen'}
              </button>
              <button
                type="button"
                onClick={() => setCoverImage('')}
                style={{ padding: '8px 12px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.92)', cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: '#c00' }}
              >
                ✕
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => coverInputRef.current?.click()}
            disabled={coverUploading}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px',
              width: '100%', maxWidth: '360px', aspectRatio: '4/3',
              borderRadius: '14px', border: '2px dashed var(--gold)',
              background: '#FFFBF0', cursor: coverUploading ? 'not-allowed' : 'pointer',
            }}
          >
            {coverUploading ? (
              <span style={{ fontSize: '13px', color: 'var(--gold-dark)' }}>Wird hochgeladen…</span>
            ) : (
              <>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth={1.5} strokeLinecap="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gold-dark)' }}>Titelbild hochladen</span>
                <span style={{ fontSize: '11px', color: '#BBB' }}>JPG, PNG oder WebP · max. 10 MB</span>
              </>
            )}
          </button>
        )}
      </Section>

      <Section title="Grunddaten">
        <Field label="Titel">
          <input style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} placeholder="z.B. Alpenchalet mit Panoramablick" />
        </Field>
        <Field label="Beschreibung" hint="Erzähl von der Atmosphäre, der Lage, was besonders ist.">
          <textarea
            style={{ ...inputStyle, resize: 'vertical', minHeight: '120px' }}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Beschreibe deine Unterkunft…"
            rows={5}
          />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <Field label="Ort / Region" hint="z.B. Schliersee, Bayern">
            <input style={inputStyle} value={location} onChange={e => setLocation(e.target.value)} placeholder="Schliersee, Bayern" />
          </Field>
          <Field label="Genaue Adresse" hint="Wird erst nach Buchungsbestätigung angezeigt">
            <input style={inputStyle} value={address} onChange={e => setAddress(e.target.value)} placeholder="Musterstraße 1, 83727 Schliersee" />
          </Field>
        </div>
        <Field label="Ort (wird auf Detailseite angezeigt)">
          <input style={inputStyle} value={city} onChange={e => setCity(e.target.value)} placeholder="z.B. Schliersee" />
        </Field>
      </Section>

      {/* ── Standort auf der Karte ── */}
      <Section title="Standort auf der Karte">
        <LocationPicker
          lat={lat}
          lon={lon}
          address={[address, city, location].filter(Boolean).join(', ')}
          onChange={(la, lo) => { setLat(la); setLon(lo) }}
        />
      </Section>

      {/* ── Kapazität ── */}
      <Section title="Kapazität & Ausstattung">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '4px' }}>
          {[
            { label: 'Max. Gäste', val: maxGuests, set: setMaxGuests, min: 1, max: 20 },
            { label: 'Schlafzimmer', val: bedrooms, set: setBedrooms, min: 0, max: 20 },
            { label: 'Badezimmer', val: bathrooms, set: setBathrooms, min: 1, max: 10 },
          ].map(({ label, val, set, min, max }) => (
            <div key={label} style={{ background: '#FAFAFA', borderRadius: '14px', border: '1.5px solid #E0DDD6', padding: '14px 16px' }}>
              <p style={{ fontSize: '11px', fontWeight: 600, color: '#888', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <button type="button" onClick={() => set(v => Math.max(min, v - 1))}
                  style={{ width: '30px', height: '30px', borderRadius: '50%', border: '1.5px solid #E0DDD6', background: '#fff', cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444' }}>
                  −
                </button>
                <span style={{ fontSize: '18px', fontWeight: 700, color: '#111' }}>{val}</span>
                <button type="button" onClick={() => set(v => Math.min(max, v + 1))}
                  style={{ width: '30px', height: '30px', borderRadius: '50%', border: '1.5px solid #E0DDD6', background: '#fff', cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444' }}>
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Ausstattungsmerkmale ── */}
      <Section title="Ausstattungsmerkmale">
        {amenities.length > 0 && (
          <p style={{ fontSize: '12px', color: 'var(--gold-dark)', fontWeight: 600, margin: '0 0 16px' }}>
            {amenities.length} ausgewählt
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {AMENITY_CATEGORIES.map(({ category, items }) => (
            <div key={category}>
              <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 8px' }}>
                {category}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '7px' }}>
                {items.map(({ id, icon, label }) => {
                  const active = amenities.includes(label)
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleAmenity(label)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '9px 12px', borderRadius: '11px',
                        border: `1.5px solid ${active ? 'var(--gold)' : '#E0DDD6'}`,
                        background: active ? '#FDF6E3' : '#fff',
                        cursor: 'pointer', fontSize: '12px', fontWeight: active ? 600 : 400,
                        color: active ? 'var(--gold-dark)' : '#555',
                        transition: 'all 0.12s',
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ fontSize: '15px', lineHeight: 1, flexShrink: 0 }}>{icon}</span>
                      <span style={{ lineHeight: 1.3 }}>{label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Räume & Fotos ── */}
      <Section title="Räume & Fotos">
        <p style={{ fontSize: '12px', color: '#888', margin: '0 0 16px' }}>
          Lege Räume an (z.B. Wohnzimmer, Schlafzimmer, Badezimmer) und lade jeweils die passenden Fotos hoch. Das erste Foto des ersten Raums wird als Titelbild verwendet.
        </p>
        <RoomEditor
          listingId={listing.id}
          rooms={rooms}
          onChange={setRooms}
        />
      </Section>

      {/* ── Grundrisse (mehrere) ── */}
      <Section title="Grundrisse">
        <Field label="Grundrisse" hint="Mehrere Grundrisse möglich (z.B. pro Etage)">
          {floorPlanUrls.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: floorPlanUrls.length === 1 ? '1fr' : '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              {floorPlanUrls.map((url, i) => (
                <div key={i} style={{ borderRadius: '14px', overflow: 'hidden', background: '#f9f7f3', border: '1px solid #E8E6E0' }}>
                  <img src={url} alt={floorPlanLabels[i] || `Grundriss ${i + 1}`} style={{ width: '100%', height: 'auto', display: 'block', maxHeight: '200px', objectFit: 'cover' }} />
                  <div style={{ padding: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      type="text"
                      value={floorPlanLabels[i] ?? ''}
                      onChange={e => {
                        const next = [...floorPlanLabels]
                        next[i] = e.target.value
                        setFloorPlanLabels(next)
                      }}
                      placeholder="z.B. Erdgeschoss"
                      style={{ ...inputStyle, flex: 1, fontSize: '12px', padding: '6px 10px' }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setFloorPlanUrls(prev => prev.filter((_, idx) => idx !== i))
                        setFloorPlanLabels(prev => prev.filter((_, idx) => idx !== i))
                      }}
                      style={{ padding: '4px 10px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.92)', cursor: 'pointer', fontSize: '11px', fontWeight: 600, color: '#c00', flexShrink: 0 }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => floorPlanInputRef.current?.click()}
            disabled={floorPlanUploading}
            style={{
              width: '100%', padding: floorPlanUrls.length > 0 ? '16px' : '40px', borderRadius: '14px', border: '2px dashed #D4C5B0',
              background: '#fafaf8', cursor: 'pointer', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: '6px',
            }}
          >
            {floorPlanUploading ? (
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gold-dark)' }}>Wird hochgeladen…</span>
            ) : (
              <>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gold-dark)' }}>
                  {floorPlanUrls.length > 0 ? '+ Weiteren Grundriss hochladen' : 'Grundriss hochladen'}
                </span>
                <span style={{ fontSize: '11px', color: '#BBB' }}>JPG, PNG oder WebP · max. 10 MB</span>
              </>
            )}
          </button>
          <input
            ref={floorPlanInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFloorPlanUpload}
            style={{ display: 'none' }}
          />
        </Field>
      </Section>

      {/* ── Hausregeln & Check-in ── */}
      <Section title="Hausregeln">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
          <Field label="Check-in ab">
            <input type="time" style={inputStyle} value={checkInTime} onChange={e => setCheckInTime(e.target.value)} />
          </Field>
          <Field label="Check-out bis">
            <input type="time" style={inputStyle} value={checkOutTime} onChange={e => setCheckOutTime(e.target.value)} />
          </Field>
        </div>

        {/* Toggle rules (Airbnb-style) */}
        <div style={{ borderRadius: '14px', border: '1px solid #E8E6E0', overflow: 'hidden', marginBottom: '16px' }}>
          {([
            { label: 'Haustiere erlaubt', value: rulePetsAllowed, set: setRulePetsAllowed },
            { label: 'Veranstaltungen erlaubt', value: ruleEventsAllowed, set: setRuleEventsAllowed },
            { label: 'Rauchen, Vaporizer und E-Zigaretten erlaubt', value: ruleSmokingAllowed, set: setRuleSmokingAllowed },
            { label: 'Kommerzielles Fotografieren und Filmen erlaubt', value: ruleCommercialPhoto, set: setRuleCommercialPhoto },
          ] as const).map((rule, i) => (
            <div key={rule.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: i < 3 ? '1px solid #F0EEE8' : 'none' }}>
              <span style={{ fontSize: '14px', color: '#1D1D1F' }}>{rule.label}</span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button type="button" onClick={() => rule.set(false)} style={{
                  width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: !rule.value ? '2px solid #1D1D1F' : '1.5px solid #E0DDD6', background: !rule.value ? '#1D1D1F' : '#fff',
                  color: !rule.value ? '#fff' : '#999', cursor: 'pointer', fontSize: '14px',
                }}>✕</button>
                <button type="button" onClick={() => rule.set(true)} style={{
                  width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: rule.value ? '2px solid #1D1D1F' : '1.5px solid #E0DDD6', background: rule.value ? '#1D1D1F' : '#fff',
                  color: rule.value ? '#fff' : '#999', cursor: 'pointer', fontSize: '14px',
                }}>✓</button>
              </div>
            </div>
          ))}

          {/* Quiet hours toggle with time pickers */}
          <div style={{ borderTop: '1px solid #F0EEE8', padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: ruleQuietHours ? '12px' : 0 }}>
              <span style={{ fontSize: '14px', color: '#1D1D1F' }}>Ruhezeiten</span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button type="button" onClick={() => setRuleQuietHours(false)} style={{
                  width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: !ruleQuietHours ? '2px solid #1D1D1F' : '1.5px solid #E0DDD6', background: !ruleQuietHours ? '#1D1D1F' : '#fff',
                  color: !ruleQuietHours ? '#fff' : '#999', cursor: 'pointer', fontSize: '14px',
                }}>✕</button>
                <button type="button" onClick={() => setRuleQuietHours(true)} style={{
                  width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: ruleQuietHours ? '2px solid #1D1D1F' : '1.5px solid #E0DDD6', background: ruleQuietHours ? '#1D1D1F' : '#fff',
                  color: ruleQuietHours ? '#fff' : '#999', cursor: 'pointer', fontSize: '14px',
                }}>✓</button>
              </div>
            </div>
            {ruleQuietHours && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: '#888', marginBottom: '4px', display: 'block' }}>Beginn der Ruhezeit</label>
                  <select style={inputStyle} value={ruleQuietStart} onChange={e => setRuleQuietStart(e.target.value)}>
                    {Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`).map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: '#888', marginBottom: '4px', display: 'block' }}>Ende der Ruhezeit</label>
                  <select style={inputStyle} value={ruleQuietEnd} onChange={e => setRuleQuietEnd(e.target.value)}>
                    {Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`).map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Max guests within rules */}
          <div style={{ borderTop: '1px solid #F0EEE8', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '14px', color: '#1D1D1F' }}>Anzahl der Gäste</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button type="button" onClick={() => setMaxGuests(v => Math.max(1, v - 1))}
                style={{ width: '28px', height: '28px', borderRadius: '50%', border: '1.5px solid #E0DDD6', background: '#fff', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#111' }}>−</button>
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#111', minWidth: '20px', textAlign: 'center' }}>{maxGuests}</span>
              <button type="button" onClick={() => setMaxGuests(v => Math.min(30, v + 1))}
                style={{ width: '28px', height: '28px', borderRadius: '50%', border: '1.5px solid #E0DDD6', background: '#fff', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#111' }}>+</button>
            </div>
          </div>
        </div>

        <Field label="Zusätzliche Regeln" hint="Gib an, was du von Gästen sonst noch erwartest">
          <textarea
            style={{ ...inputStyle, resize: 'vertical' }}
            value={ruleAdditionalRules}
            onChange={e => setRuleAdditionalRules(e.target.value)}
            placeholder="z.B. Schuhe bitte am Eingang ausziehen, Müll bitte trennen…"
            rows={3}
          />
        </Field>

        <Field label="Check-In Anweisungen">
          <textarea
            style={{ ...inputStyle, resize: 'vertical' }}
            value={checkinInstructions}
            onChange={e => setCheckinInstructions(e.target.value)}
            placeholder="z.B. Schlüsselkasten Code, Anfahrtsbeschreibung…"
            rows={4}
          />
        </Field>
        <Field label="Wichtige Hinweise für Gäste">
          <textarea
            style={{ ...inputStyle, resize: 'vertical' }}
            value={importantNotes}
            onChange={e => setImportantNotes(e.target.value)}
            placeholder="z.B. Parkmöglichkeiten, WLAN-Passwort…"
            rows={4}
          />
        </Field>
      </Section>

      {/* ── Plattform-Links & Bewertungen ── */}
      <Section title="Bewertungen & Plattformen">
        <p style={{ fontSize: '12px', color: '#888', margin: '0 0 14px' }}>
          Verlinke deine Inserate auf anderen Plattformen und verwalte Bewertungen.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
          <Field label="Airbnb URL">
            <input value={airbnbUrl} onChange={e => setAirbnbUrl(e.target.value)} placeholder="https://airbnb.com/rooms/..." style={inputStyle} />
          </Field>
          <Field label="Booking.com URL">
            <input value={bookingUrl} onChange={e => setBookingUrl(e.target.value)} placeholder="https://booking.com/hotel/..." style={inputStyle} />
          </Field>
          <Field label="VRBO URL">
            <input value={vrboUrl} onChange={e => setVrboUrl(e.target.value)} placeholder="https://vrbo.com/..." style={inputStyle} />
          </Field>
          <Field label="Google Place ID">
            <input value={googlePlaceId} onChange={e => setGooglePlaceId(e.target.value)} placeholder="ChIJ..." style={inputStyle} />
          </Field>
        </div>
        <div style={{ marginBottom: '20px' }}>
          <Field label="Revyoos Property ID (optional)">
            <input value={revyoosId} onChange={e => setRevyoosId(e.target.value)} placeholder="z.B. abc123 oder Embed-Code einfügen" style={inputStyle} />
            <p style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>
              Falls du Revyoos nutzt: Property-ID oder den kompletten Embed-Code hier einfügen. Das Revyoos-Widget wird dann automatisch auf der Detailseite angezeigt.
            </p>
          </Field>
        </div>
        {/* Reviews list */}
        <div style={{ borderTop: '1px solid #F0EEE8', paddingTop: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#111' }}>Importierte Bewertungen</h4>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" onClick={() => {
                setReviewsLoading(true)
                fetch(`/api/reviews?listingId=${listing.id}&limit=50`)
                  .then(r => r.json())
                  .then(d => setReviews(d.reviews ?? []))
                  .catch(() => {})
                  .finally(() => setReviewsLoading(false))
              }} style={{ padding: '6px 14px', borderRadius: '8px', border: '1px solid #E0DDD6', background: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: '#666' }}>
                {reviewsLoading ? 'Laden…' : '↻ Laden'}
              </button>
              <button type="button" onClick={() => { setShowAddReview(!showAddReview); setShowPasteImport(false) }} style={{ padding: '6px 14px', borderRadius: '8px', border: 'none', background: '#FAF5E4', cursor: 'pointer', fontSize: '12px', fontWeight: 700, color: 'var(--gold-dark)' }}>
                + Einzeln
              </button>
              <button type="button" onClick={() => { setShowPasteImport(!showPasteImport); setShowAddReview(false) }} style={{ padding: '6px 14px', borderRadius: '8px', border: 'none', background: '#E8F0E4', cursor: 'pointer', fontSize: '12px', fontWeight: 700, color: '#2D6A1E' }}>
                📋 Einfügen
              </button>
              <button type="button" disabled={fetchingReviews} onClick={async () => {
                setFetchingReviews(true)
                setFetchResult(null)
                try {
                  const res = await fetch('/api/reviews/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ listingId: listing.id }),
                  })
                  const data = await res.json()
                  setFetchResult(data)
                  // Reload reviews list after fetching
                  const revRes = await fetch(`/api/reviews?listingId=${listing.id}&limit=50`)
                  const revData = await revRes.json()
                  setReviews(revData.reviews ?? [])
                } catch (e) {
                  setFetchResult({ results: [{ source: 'system', status: 'error', fetched: 0, detail: String(e) }] })
                } finally {
                  setFetchingReviews(false)
                }
              }} style={{ padding: '6px 14px', borderRadius: '8px', border: 'none', background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))', cursor: fetchingReviews ? 'wait' : 'pointer', fontSize: '12px', fontWeight: 700, color: '#fff', opacity: fetchingReviews ? 0.6 : 1 }}>
                {fetchingReviews ? '⏳ Wird abgerufen…' : '🔄 Bewertungen abrufen'}
              </button>
            </div>
          </div>

          {/* Fetch result display */}
          {fetchResult && (
            <div style={{ marginBottom: '12px', padding: '12px 16px', borderRadius: '12px', background: '#FAFAF5', border: '1px solid #E8D9A0' }}>
              <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--gold-dark)', margin: '0 0 8px' }}>Ergebnis der Abfrage:</p>
              {fetchResult.results.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: r.status === 'error' ? '#DC2626' : r.status === 'skipped' ? '#999' : '#16A34A' }}>
                    {r.source}: {r.status === 'error' ? 'Fehler'
                      : r.status === 'skipped' ? 'übersprungen'
                      : r.score !== undefined
                        ? `★ ${Number(r.score).toFixed(1)} (${r.count} Bewertungen) · ${r.fetched} abgerufen ✓`
                        : `${r.fetched} abgerufen ✓`}
                  </span>
                  {r.detail && <span style={{ fontSize: '11px', color: '#999' }}>— {r.detail}</span>}
                </div>
              ))}
              <button type="button" onClick={() => setFetchResult(null)} style={{ marginTop: '6px', fontSize: '11px', color: '#999', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>✕ Schließen</button>
            </div>
          )}

          {/* Paste import */}
          {showPasteImport && (
            <div style={{ padding: '16px', borderRadius: '12px', background: '#F0F7ED', border: '1px solid #C8DFC0', marginBottom: '12px' }}>
              <p style={{ fontSize: '13px', fontWeight: 700, color: '#2D6A1E', margin: '0 0 8px' }}>Bewertungen einfügen</p>
              <p style={{ fontSize: '11px', color: '#666', margin: '0 0 12px' }}>
                Gehe auf dein Inserat bei Airbnb/Booking/Google, markiere alle Bewertungen (Text, Namen, Sterne) und füge sie hier ein. Wir erkennen die Bewertungen automatisch.
              </p>
              <div style={{ marginBottom: '10px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: '#888', display: 'block', marginBottom: '4px' }}>Plattform</label>
                <select value={pasteSource} onChange={e => setPasteSource(e.target.value)} style={{ ...inputStyle, padding: '8px 10px', maxWidth: '200px' }}>
                  <option value="airbnb">Airbnb</option>
                  <option value="booking">Booking.com</option>
                  <option value="google">Google</option>
                  <option value="vrbo">VRBO</option>
                </select>
              </div>
              <textarea
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                placeholder={'Hier den kopierten Text einfügen...\n\nBeispiel:\nMax M.\n★★★★★\nMärz 2025\nTolle Wohnung, super Lage! Alles war sauber und der Gastgeber war sehr freundlich.\n\nAnna S.\n★★★★\nFebruar 2025\nSchöne Unterkunft, nur das WLAN war etwas schwach.'}
                style={{ ...inputStyle, minHeight: '180px', fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <button type="button" disabled={pasteImporting || !pasteText.trim()} onClick={async () => {
                  setPasteImporting(true)
                  try {
                    const res = await fetch('/api/reviews/parse-paste', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ listingId: listing.id, source: pasteSource, text: pasteText }),
                    })
                    const data = await res.json()
                    if (data.error) {
                      setFetchResult({ results: [{ source: pasteSource, status: 'error', fetched: 0, detail: data.error }] })
                    } else {
                      setFetchResult({ results: [{ source: pasteSource, status: 'ok', fetched: data.imported ?? 0 }] })
                      setPasteText('')
                      setShowPasteImport(false)
                      // Reload
                      const revRes = await fetch(`/api/reviews?listingId=${listing.id}&limit=50`)
                      const revData = await revRes.json()
                      setReviews(revData.reviews ?? [])
                    }
                  } catch (e) {
                    setFetchResult({ results: [{ source: pasteSource, status: 'error', fetched: 0, detail: String(e) }] })
                  } finally {
                    setPasteImporting(false)
                  }
                }} style={{ padding: '8px 20px', borderRadius: '8px', border: 'none', background: '#2D6A1E', cursor: pasteImporting ? 'wait' : 'pointer', fontSize: '12px', fontWeight: 700, color: '#fff', opacity: (pasteImporting || !pasteText.trim()) ? 0.5 : 1 }}>
                  {pasteImporting ? 'Wird verarbeitet…' : 'Bewertungen importieren'}
                </button>
                <button type="button" onClick={() => { setShowPasteImport(false); setPasteText('') }} style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #ccc', background: '#fff', cursor: 'pointer', fontSize: '12px', color: '#666' }}>
                  Abbrechen
                </button>
              </div>
            </div>
          )}

          {/* Add review form */}
          {showAddReview && (
            <div style={{ padding: '16px', borderRadius: '12px', background: '#FAFAF8', border: '1px solid #F0EEE8', marginBottom: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: '#888', display: 'block', marginBottom: '4px' }}>Plattform</label>
                  <select value={newReview.source} onChange={e => setNewReview(r => ({ ...r, source: e.target.value }))} style={{ ...inputStyle, padding: '8px 10px' }}>
                    <option value="airbnb">Airbnb</option>
                    <option value="booking">Booking.com</option>
                    <option value="google">Google</option>
                    <option value="vrbo">VRBO</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: '#888', display: 'block', marginBottom: '4px' }}>Bewertung</label>
                  <select value={newReview.rating} onChange={e => setNewReview(r => ({ ...r, rating: e.target.value }))} style={{ ...inputStyle, padding: '8px 10px' }}>
                    {['5', '4.5', '4', '3.5', '3', '2.5', '2', '1.5', '1'].map(v => (
                      <option key={v} value={v}>{'★'.repeat(Math.floor(Number(v)))} {v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: '#888', display: 'block', marginBottom: '4px' }}>Name des Gastes</label>
                  <input value={newReview.authorName} onChange={e => setNewReview(r => ({ ...r, authorName: e.target.value }))} placeholder="Vorname" style={{ ...inputStyle, padding: '8px 10px' }} />
                </div>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: '#888', display: 'block', marginBottom: '4px' }}>Datum</label>
                  <input type="date" value={newReview.reviewDate} onChange={e => setNewReview(r => ({ ...r, reviewDate: e.target.value }))} style={{ ...inputStyle, padding: '8px 10px' }} />
                </div>
              </div>
              <div style={{ marginBottom: '10px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: '#888', display: 'block', marginBottom: '4px' }}>Bewertungstext</label>
                <textarea value={newReview.reviewText} onChange={e => setNewReview(r => ({ ...r, reviewText: e.target.value }))} placeholder="Text der Bewertung…" rows={3} style={{ ...inputStyle, resize: 'none' }} />
              </div>
              <button type="button" onClick={async () => {
                if (!newReview.authorName || !newReview.reviewDate) return
                const res = await fetch('/api/reviews', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    listingId: listing.id,
                    source: newReview.source,
                    authorName: newReview.authorName,
                    rating: parseFloat(newReview.rating),
                    reviewText: newReview.reviewText,
                    reviewDate: newReview.reviewDate,
                  }),
                })
                if (res.ok) {
                  setShowAddReview(false)
                  setNewReview({ source: 'airbnb', authorName: '', rating: '5', reviewText: '', reviewDate: new Date().toISOString().split('T')[0] })
                  // Refresh reviews
                  fetch(`/api/reviews?listingId=${listing.id}&limit=50`)
                    .then(r => r.json())
                    .then(d => setReviews(d.reviews ?? []))
                }
              }} style={{ padding: '8px 18px', borderRadius: '8px', border: 'none', background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                Speichern
              </button>
            </div>
          )}

          {/* Reviews list */}
          {reviews.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {reviews.map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px', borderRadius: '10px', background: '#fff', border: '1px solid #F0EEE8' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#111' }}>{r.author_name}</span>
                      <span style={{ fontSize: '10px', color: '#999' }}>{'★'.repeat(Math.round(r.rating))}</span>
                      <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: r.source === 'airbnb' ? '#FF5A5F' : r.source === 'booking' ? '#003580' : r.source === 'google' ? '#4285F4' : '#6C3BAA', color: '#fff', fontWeight: 600, textTransform: 'capitalize' }}>{r.source}</span>
                    </div>
                    <p style={{ fontSize: '11px', color: '#888', margin: 0 }}>{r.review_text ? (r.review_text.length > 100 ? r.review_text.slice(0, 100) + '…' : r.review_text) : '—'}</p>
                  </div>
                  <button type="button" onClick={async () => {
                    await fetch(`/api/reviews?id=${r.id}`, { method: 'DELETE' })
                    setReviews(prev => prev.filter(rv => rv.id !== r.id))
                  }} style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #FECACA', background: '#FEF2F2', cursor: 'pointer', fontSize: '10px', color: '#DC2626', flexShrink: 0 }}>✕</button>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: '12px', color: '#AAA', margin: '8px 0 0' }}>Noch keine Bewertungen importiert. Klicke &quot;Laden&quot; um vorhandene abzurufen.</p>
          )}
        </div>
      </Section>

      {/* ── Buchungsmodus (pro Inserat) ── */}
      <Section title="Buchung">
        <p style={{ fontSize: '12px', color: '#888', margin: '0 0 4px' }}>
          Lege für dieses Inserat fest, wie Gäste buchen können.
        </p>

        {/* Sofortbuchung */}
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid #F0EDE8', cursor: 'pointer' }}>
          <div style={{ paddingRight: '16px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: '#111', margin: '0 0 2px' }}>⚡ Sofortbuchung erlauben</p>
            <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>Gäste können sofort buchen – der Kalender wird direkt gesperrt.</p>
          </div>
          <div onClick={(e) => { e.preventDefault(); setAllowInstant(v => !v) }} style={{
            width: '44px', height: '26px', borderRadius: '13px', flexShrink: 0,
            background: allowInstant ? 'var(--gold)' : '#D1D1D6', position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
          }}>
            <div style={{ position: 'absolute', top: '3px', left: allowInstant ? '21px' : '3px', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s' }} />
          </div>
        </label>

        {/* Anfragen */}
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: allowRequests ? '1px solid #F0EDE8' : 'none', cursor: 'pointer' }}>
          <div style={{ paddingRight: '16px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: '#111', margin: '0 0 2px' }}>✉ Anfragen erlauben</p>
            <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>Gäste können Anfragen stellen – du bestätigst manuell.</p>
          </div>
          <div onClick={(e) => { e.preventDefault(); setAllowRequests(v => !v) }} style={{
            width: '44px', height: '26px', borderRadius: '13px', flexShrink: 0,
            background: allowRequests ? 'var(--gold)' : '#D1D1D6', position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
          }}>
            <div style={{ position: 'absolute', top: '3px', left: allowRequests ? '21px' : '3px', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s' }} />
          </div>
        </label>

        {/* Mindestnächte für Anfragen */}
        {allowRequests && (
          <div style={{ padding: '14px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ paddingRight: '16px' }}>
              <p style={{ fontSize: '13px', fontWeight: 600, color: '#111', margin: '0 0 2px' }}>Mindestaufenthalt für Anfragen</p>
              <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>Anfragen erst ab dieser Anzahl Nächte möglich.</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
              <button type="button" onClick={() => setMinRequestNights(n => Math.max(1, n - 1))}
                style={{ width: '28px', height: '28px', borderRadius: '50%', border: '1.5px solid #E0DDD6', background: '#fff', cursor: 'pointer', fontSize: '16px' }}>−</button>
              <span style={{ fontSize: '14px', fontWeight: 700, minWidth: '30px', textAlign: 'center' }}>{minRequestNights}</span>
              <button type="button" onClick={() => setMinRequestNights(n => Math.min(30, n + 1))}
                style={{ width: '28px', height: '28px', borderRadius: '50%', border: '1.5px solid #E0DDD6', background: '#fff', cursor: 'pointer', fontSize: '16px' }}>+</button>
              <span style={{ fontSize: '12px', color: '#888' }}>Nacht{minRequestNights !== 1 ? 'e' : ''}</span>
            </div>
          </div>
        )}

        {!allowInstant && !allowRequests && (
          <div style={{ marginTop: '12px', padding: '10px 14px', background: '#FEF2F2', borderRadius: '10px', border: '1px solid #FECACA' }}>
            <p style={{ fontSize: '12px', color: '#DC2626', margin: 0 }}>
              ⚠️ Weder Sofortbuchung noch Anfragen sind aktiv. Gäste können dieses Inserat nicht buchen.
            </p>
          </div>
        )}
      </Section>

      {/* ── Stornierungsbedingungen ── */}
      <Section title="Stornierungsbedingungen">
        <p style={{ fontSize: '12px', color: '#888', margin: '0 0 14px' }}>
          Wähle eine Vorlage oder definiere eigene Fristen. Die Bedingungen werden Gästen vor der Buchung angezeigt.
        </p>

        {/* Template selector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
          {CANCELLATION_TEMPLATES.map(t => (
            <label key={t.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: '12px',
              padding: '12px 16px', borderRadius: '12px', cursor: 'pointer',
              border: cancelPolicy === t.id ? '2px solid var(--gold)' : '1.5px solid #E0DDD6',
              background: cancelPolicy === t.id ? '#FBF6EC' : '#fff',
            }}>
              <input
                type="radio"
                name="cancellation"
                value={t.id}
                checked={cancelPolicy === t.id}
                onChange={() => {
                  setCancelPolicy(t.id)
                  setCancelFreeDays(t.freeDays)
                  setCancelFreePercent(t.freePercent)
                  setCancelPartialDays(t.partialDays)
                  setCancelPartialPercent(t.partialPercent)
                }}
                style={{ marginTop: '2px', accentColor: 'var(--gold)' }}
              />
              <div>
                <p style={{ fontSize: '13px', fontWeight: 700, color: '#111', margin: '0 0 2px' }}>{t.label}</p>
                <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>{t.desc}</p>
              </div>
            </label>
          ))}
        </div>

        {/* Custom fields — always visible, editable when any template is selected */}
        <div style={{
          background: '#F9F7F3', borderRadius: '14px', padding: '18px 20px',
          border: '1px solid #E8E6E0',
        }}>
          <p style={{ fontSize: '12px', fontWeight: 700, color: '#555', margin: '0 0 14px' }}>
            {cancelPolicy === 'custom' ? 'Benutzerdefinierte Werte' : 'Aktive Werte (zum Anpassen bearbeiten)'}
          </p>

          {/* Tier 1: free cancellation */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#777', display: 'block', marginBottom: '5px' }}>
                Kostenloser Zeitraum (Tage vor Check-in)
              </label>
              <input type="number" min={0} max={90} value={cancelFreeDays}
                onChange={e => { setCancelFreeDays(parseInt(e.target.value) || 0); setCancelPolicy('custom') }}
                style={{ width: '100%', borderRadius: '10px', border: '1.5px solid #E0DDD6', padding: '9px 12px', fontSize: '13px', boxSizing: 'border-box' as const }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#777', display: 'block', marginBottom: '5px' }}>
                Erstattung in diesem Zeitraum (%)
              </label>
              <input type="number" min={0} max={100} value={cancelFreePercent}
                onChange={e => { setCancelFreePercent(parseInt(e.target.value) || 0); setCancelPolicy('custom') }}
                style={{ width: '100%', borderRadius: '10px', border: '1.5px solid #E0DDD6', padding: '9px 12px', fontSize: '13px', boxSizing: 'border-box' as const }}
              />
            </div>
          </div>

          {/* Tier 2: partial refund (optional) */}
          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: '#555' }}>
              <input type="checkbox"
                checked={cancelPartialDays != null}
                onChange={e => {
                  if (e.target.checked) {
                    setCancelPartialDays(Math.max(Math.floor(cancelFreeDays / 2), 1))
                    setCancelPartialPercent(50)
                  } else {
                    setCancelPartialDays(null)
                    setCancelPartialPercent(null)
                  }
                  setCancelPolicy('custom')
                }}
                style={{ accentColor: 'var(--gold)' }}
              />
              Zusätzliche Teilerstattungs-Stufe aktivieren
            </label>
          </div>

          {cancelPartialDays != null && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: '#777', display: 'block', marginBottom: '5px' }}>
                  Teilerstattung bis (Tage vor Check-in)
                </label>
                <input type="number" min={0} max={cancelFreeDays - 1} value={cancelPartialDays}
                  onChange={e => { setCancelPartialDays(parseInt(e.target.value) || 0); setCancelPolicy('custom') }}
                  style={{ width: '100%', borderRadius: '10px', border: '1.5px solid #E0DDD6', padding: '9px 12px', fontSize: '13px', boxSizing: 'border-box' as const }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: '#777', display: 'block', marginBottom: '5px' }}>
                  Teilerstattung (%)
                </label>
                <input type="number" min={0} max={cancelFreePercent} value={cancelPartialPercent ?? 0}
                  onChange={e => { setCancelPartialPercent(parseInt(e.target.value) || 0); setCancelPolicy('custom') }}
                  style={{ width: '100%', borderRadius: '10px', border: '1.5px solid #E0DDD6', padding: '9px 12px', fontSize: '13px', boxSizing: 'border-box' as const }}
                />
              </div>
            </div>
          )}

          {/* Live preview */}
          <div style={{ marginTop: '16px', padding: '12px 14px', background: '#fff', borderRadius: '10px', border: '1px solid #E8E6E0' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gold)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Vorschau für Gäste</p>
            <p style={{ fontSize: '12px', color: '#555', margin: 0, lineHeight: 1.5 }}>
              {cancelFreePercent === 100
                ? `Kostenlose Stornierung bis ${cancelFreeDays} ${cancelFreeDays === 1 ? 'Tag' : 'Tage'} vor Check-in.`
                : cancelFreePercent > 0
                  ? `${cancelFreePercent} % Erstattung bis ${cancelFreeDays} ${cancelFreeDays === 1 ? 'Tag' : 'Tage'} vor Check-in.`
                  : `Keine Erstattung ab ${cancelFreeDays} ${cancelFreeDays === 1 ? 'Tag' : 'Tage'} vor Check-in.`
              }
              {cancelPartialDays != null && cancelPartialPercent != null && cancelPartialPercent > 0
                ? ` ${cancelPartialPercent} % Erstattung bis ${cancelPartialDays} ${cancelPartialDays === 1 ? 'Tag' : 'Tage'} vor Check-in.`
                : ''
              }
              {' '}Danach keine Erstattung.
            </p>
          </div>
        </div>
      </Section>

      {/* ── Onboarding Gate ── */}
      {onboardingError && (
        <div style={{ borderRadius: '12px', padding: '14px 16px', background: '#FFF7E6', border: '1px solid #F6C840', marginBottom: '12px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#92400E', margin: '0 0 6px' }}>
            ⚠️ Einrichtung nicht abgeschlossen
          </p>
          <p style={{ fontSize: '12px', color: '#92400E', margin: '0 0 10px' }}>
            Um ein Inserat zu aktivieren, musst du den Einrichtungsassistenten abschließen und deine Zahlungsdaten (IBAN) hinterlegen.
          </p>
          <a href="/dashboard/setup" style={{ fontSize: '12px', fontWeight: 700, color: 'var(--gold)' }}>
            Zur Einrichtung →
          </a>
        </div>
      )}

      {/* ── Fehler / Speichern ── */}
      {error && (
        <div style={{ borderRadius: '12px', padding: '12px 16px', background: '#FEF2F2', border: '1px solid #FECACA', marginBottom: '12px' }}>
          <p style={{ fontSize: '13px', color: '#DC2626', margin: 0 }}>{error}</p>
        </div>
      )}

      <div style={{ display: 'flex', gap: '10px', position: 'sticky', bottom: '24px' }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            flex: 1, padding: '14px', borderRadius: '14px', border: 'none',
            background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))',
            color: '#fff', fontSize: '14px', fontWeight: 700,
            cursor: saving ? 'not-allowed' : 'pointer',
            boxShadow: '0 4px 20px rgba(168,136,42,0.35)',
            transition: 'all 0.15s',
          }}
        >
          {saving ? 'Wird gespeichert…' : saved ? '✓ Gespeichert' : 'Änderungen speichern'}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          style={{
            padding: '14px 18px', borderRadius: '14px',
            border: confirmDelete ? '2px solid #DC2626' : '1.5px solid #E0DDD6',
            background: confirmDelete ? '#FEF2F2' : '#fff',
            color: confirmDelete ? '#DC2626' : '#999',
            fontSize: '13px', fontWeight: 700, cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          {deleting ? '…' : confirmDelete ? '⚠ Sicher?' : '🗑'}
        </button>
      </div>

    </div>
  )
}
