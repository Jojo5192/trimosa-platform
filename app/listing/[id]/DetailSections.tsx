'use client'

import { useState, useEffect, useMemo } from 'react'

/* ── Types ─────────────────────────────────────────────────── */
interface HostProfile {
  id: string
  display_name?: string
  avatar_url?: string
  bio?: string
  location?: string
  member_since?: string
  languages?: string[]
}

interface HostListing {
  id: string
  title: string
  images?: string[]
  city?: string
  location?: string
  price_per_night?: number
}

interface AmenityItem { emoji: string; id: string; label: string }
interface AmenityCategory { name: string; icon: string; items: AmenityItem[] }

/* ── Amenity categories (mirrored from editor) ─────────────── */
const AMENITY_CATEGORIES: AmenityCategory[] = [
  { name: 'Internet & Technik', icon: '📶', items: [
    { emoji: '📶', id: 'WLAN', label: 'WLAN' }, { emoji: '🚀', id: 'Schnelles WLAN (>100 Mbit/s)', label: 'Schnelles WLAN' },
    { emoji: '📺', id: 'TV', label: 'TV' }, { emoji: '📡', id: 'Smart-TV / Netflix', label: 'Smart-TV / Netflix' },
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
const AMENITY_MAP = new Map<string, { emoji: string; label: string; category: string }>()
for (const cat of AMENITY_CATEGORIES) {
  for (const item of cat.items) {
    AMENITY_MAP.set(item.id, { emoji: item.emoji, label: item.label, category: cat.name })
  }
}

/* ── Overlay backdrop ──────────────────────────────────────── */
function Overlay({ onClose, children, title }: { onClose: () => void; children: React.ReactNode; title: string }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '20px', width: '100%', maxWidth: '600px', maxHeight: '85vh', overflow: 'auto', position: 'relative' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 1, background: '#fff', borderRadius: '20px 20px 0 0', padding: '20px 24px 16px', borderBottom: '1px solid #F0EEE8', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#1D1D1F' }}>{title}</h3>
          <button type="button" onClick={onClose} style={{ width: '32px', height: '32px', borderRadius: '50%', border: 'none', background: '#F5F5F7', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', flexShrink: 0 }}>✕</button>
        </div>
        <div style={{ padding: '20px 24px 24px' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

/* ── 1. Host Badge + Overlay ───────────────────────────────── */
export function HostBadge({ host }: { host: HostProfile }) {
  const [open, setOpen] = useState(false)
  const [listings, setListings] = useState<HostListing[]>([])

  useEffect(() => {
    if (open && listings.length === 0) {
      fetch(`/api/host-listings?hostId=${host.id}`)
        .then(r => r.json())
        .then(d => setListings(d.listings ?? []))
        .catch(() => {})
    }
  }, [open, host.id, listings.length])

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderRadius: '14px', backgroundColor: '#fff', border: '1px solid #E5E5EA', cursor: 'pointer', flex: '1 1 130px', minWidth: '120px', textAlign: 'left' }}>
        <div style={{ width: '36px', height: '36px', borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'linear-gradient(135deg, #C4A235, #8A6818)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {host.avatar_url ? (
            <img src={host.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ color: '#fff', fontSize: '14px', fontWeight: 700 }}>{host.display_name?.[0]?.toUpperCase() ?? '?'}</span>
          )}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: '14px', color: '#1D1D1F' }}>{host.display_name || 'Gastgeber'}</div>
          <div style={{ fontSize: '11px', color: '#6E6E73' }}>Gastgeber</div>
        </div>
      </button>

      {open && (
        <Overlay onClose={() => setOpen(false)} title="Dein Gastgeber">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'linear-gradient(135deg, #C4A235, #8A6818)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {host.avatar_url ? (
                <img src={host.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ color: '#fff', fontSize: '24px', fontWeight: 700 }}>{host.display_name?.[0]?.toUpperCase() ?? '?'}</span>
              )}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '18px', color: '#1D1D1F' }}>{host.display_name || 'Gastgeber'}</div>
              {host.location && <div style={{ fontSize: '13px', color: '#6E6E73', marginTop: '2px' }}>📍 {host.location}</div>}
              {host.member_since && <div style={{ fontSize: '12px', color: '#6E6E73' }}>Mitglied seit {new Date(host.member_since).getFullYear()}</div>}
            </div>
          </div>

          {host.bio && <p style={{ fontSize: '14px', lineHeight: 1.7, color: '#6E6E73', margin: '0 0 16px' }}>{host.bio}</p>}
          {host.languages && host.languages.length > 0 && (
            <p style={{ fontSize: '13px', color: '#6E6E73', margin: '0 0 20px' }}>🌍 Spricht {host.languages.join(', ')}</p>
          )}

          {listings.length > 0 && (
            <>
              <h4 style={{ fontSize: '15px', fontWeight: 700, color: '#1D1D1F', margin: '0 0 12px' }}>Weitere Unterkünfte von {host.display_name}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                {listings.map(l => (
                  <a key={l.id} href={`/listing/${l.id}`} target="_blank" rel="noopener" style={{ textDecoration: 'none', borderRadius: '14px', overflow: 'hidden', border: '1px solid #E5E5EA', background: '#fff' }}>
                    <div style={{ aspectRatio: '3/2', background: '#F5F5F7', overflow: 'hidden' }}>
                      {l.images?.[0] && <img src={l.images[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                    </div>
                    <div style={{ padding: '10px 12px' }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#1D1D1F', marginBottom: '2px' }}>{l.title}</div>
                      <div style={{ fontSize: '11px', color: '#6E6E73' }}>{l.city || l.location}</div>
                      {l.price_per_night != null && l.price_per_night > 0 && (
                        <div style={{ fontSize: '12px', fontWeight: 700, color: '#B0912B', marginTop: '4px' }}>ab € {l.price_per_night} / Nacht</div>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            </>
          )}
        </Overlay>
      )}
    </>
  )
}

/* ── 2. Amenities Section + Overlay ────────────────────────── */
export function AmenitiesSection({ amenities }: { amenities: string[] }) {
  const [showAll, setShowAll] = useState(false)
  const MAX_SHOW = 8

  const enriched = useMemo(() =>
    amenities.map(a => {
      const info = AMENITY_MAP.get(a)
      return { id: a, emoji: info?.emoji ?? '✓', label: info?.label ?? a, category: info?.category ?? 'Sonstiges' }
    }), [amenities])

  const visible = enriched.slice(0, MAX_SHOW)
  const remaining = enriched.length - MAX_SHOW

  // Group by category for overlay
  const grouped = useMemo(() => {
    const map = new Map<string, typeof enriched>()
    for (const a of enriched) {
      const list = map.get(a.category) ?? []
      list.push(a)
      map.set(a.category, list)
    }
    return Array.from(map.entries())
  }, [enriched])

  if (amenities.length === 0) return null

  return (
    <div style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '16px' }}>Ausstattung</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        {visible.map(a => (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', borderRadius: '12px', backgroundColor: '#fff', border: '1px solid #E5E5EA' }}>
            <span style={{ fontSize: '18px', lineHeight: 1, flexShrink: 0 }}>{a.emoji}</span>
            <span style={{ fontSize: '13px', fontWeight: 500, color: '#1D1D1F' }}>{a.label}</span>
          </div>
        ))}
      </div>
      {remaining > 0 && (
        <button type="button" onClick={() => setShowAll(true)} style={{ marginTop: '12px', padding: '10px 20px', borderRadius: '12px', border: '1px solid #1D1D1F', background: '#fff', fontSize: '13px', fontWeight: 600, color: '#1D1D1F', cursor: 'pointer', width: '100%' }}>
          Alle {enriched.length} Ausstattungsmerkmale anzeigen
        </button>
      )}

      {showAll && (
        <Overlay onClose={() => setShowAll(false)} title="Alle Ausstattungsmerkmale">
          {grouped.map(([cat, items]) => (
            <div key={cat} style={{ marginBottom: '24px' }}>
              <h4 style={{ fontSize: '14px', fontWeight: 700, color: '#1D1D1F', marginBottom: '10px' }}>{cat}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {items.map(a => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '10px', backgroundColor: '#F9F9FB', border: '1px solid #F0EEE8' }}>
                    <span style={{ fontSize: '16px', flexShrink: 0 }}>{a.emoji}</span>
                    <span style={{ fontSize: '13px', color: '#1D1D1F' }}>{a.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </Overlay>
      )}
    </div>
  )
}

/* ── 3. Floor Plan Section + Overlay ───────────────────────── */
export function FloorPlanSection({ url }: { url: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '12px' }}>Grundriss</h2>
      <div
        onClick={() => setOpen(true)}
        style={{ borderRadius: '14px', overflow: 'hidden', border: '1px solid #E5E5EA', cursor: 'pointer', position: 'relative', maxHeight: '300px', background: '#fff' }}
      >
        <img src={url} alt="Grundriss" style={{ width: '100%', height: '100%', objectFit: 'contain', maxHeight: '300px' }} />
        <div style={{ position: 'absolute', bottom: '12px', right: '12px', background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: '12px', fontWeight: 600, padding: '6px 14px', borderRadius: '99px', backdropFilter: 'blur(4px)' }}>
          🔍 Vergrößern
        </div>
      </div>

      {open && (
        <Overlay onClose={() => setOpen(false)} title="Grundriss">
          <img src={url} alt="Grundriss" style={{ width: '100%', objectFit: 'contain', borderRadius: '8px' }} />
        </Overlay>
      )}
    </div>
  )
}

/* ── 4. Occupancy Calendar ─────────────────────────────────── */
const DE_MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
const DE_DAYS_SHORT = ['Mo','Di','Mi','Do','Fr','Sa','So']

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

export function OccupancyCalendar({ listingId }: { listingId: string }) {
  const [viewDate, setViewDate] = useState(new Date())
  const [rates, setRates] = useState<Record<string, { available: number }>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const from = isoDate(new Date())
    const to = isoDate(new Date(Date.now() + 365 * 86400000))
    fetch(`/api/smoobu/availability?listingId=${listingId}&from=${from}&to=${to}`)
      .then(r => r.json())
      .then(d => { if (d.rates) setRates(d.rates) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [listingId])

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const firstDow = new Date(year, month, 1).getDay()
  const leadBlanks = firstDow === 0 ? 6 : firstDow - 1
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const todayStr = isoDate(new Date())

  function prev() { setViewDate(new Date(year, month - 1, 1)) }
  function next() { setViewDate(new Date(year, month + 1, 1)) }

  return (
    <div style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '16px' }}>Belegungskalender</h2>
      <div style={{ borderRadius: '16px', padding: '20px', backgroundColor: '#fff', border: '1px solid #E5E5EA' }}>
        {/* Month navigation */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <button type="button" onClick={prev} style={{ width: '36px', height: '36px', borderRadius: '10px', border: '1px solid #E5E5EA', background: '#fff', cursor: 'pointer', fontSize: '16px' }}>‹</button>
          <span style={{ fontSize: '15px', fontWeight: 700, color: '#1D1D1F' }}>{DE_MONTHS[month]} {year}</span>
          <button type="button" onClick={next} style={{ width: '36px', height: '36px', borderRadius: '10px', border: '1px solid #E5E5EA', background: '#fff', cursor: 'pointer', fontSize: '16px' }}>›</button>
        </div>

        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '4px' }}>
          {DE_DAYS_SHORT.map(d => (
            <div key={d} style={{ textAlign: 'center', fontSize: '11px', fontWeight: 600, color: '#999', padding: '4px 0' }}>{d}</div>
          ))}
        </div>

        {/* Days grid */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#999', fontSize: '13px' }}>Laden…</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
            {Array.from({ length: leadBlanks }).map((_, i) => <div key={`b${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
              const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
              const isPast = iso < todayStr
              const rate = rates[iso]
              const isAvailable = !isPast && (!rate || rate.available !== 0)
              const isBooked = !isPast && rate?.available === 0

              let bg = '#F0FDF4'
              let color = '#16A34A'
              let border = '1px solid #BBF7D0'
              if (isPast) { bg = '#F9FAFB'; color = '#D1D5DB'; border = '1px solid #F3F4F6' }
              else if (isBooked) { bg = '#FEF2F2'; color = '#DC2626'; border = '1px solid #FECACA' }

              return (
                <div key={day} style={{ aspectRatio: '1', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: isPast ? 400 : 600, backgroundColor: bg, color, border }}>
                  {day}
                </div>
              )
            })}
          </div>
        )}

        {/* Legend */}
        <div style={{ display: 'flex', gap: '16px', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #F0EEE8' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#6E6E73' }}>
            <span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '4px', background: '#F0FDF4', border: '1px solid #BBF7D0' }} />Frei
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#6E6E73' }}>
            <span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '4px', background: '#FEF2F2', border: '1px solid #FECACA' }} />Belegt
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#6E6E73' }}>
            <span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '4px', background: '#F9FAFB', border: '1px solid #F3F4F6' }} />Vergangen
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── 5. Reviews Placeholder ────────────────────────────────── */
export function ReviewsPlaceholder() {
  return (
    <div id="reviews-section" style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '12px' }}>Bewertungen</h2>
      <div style={{ borderRadius: '14px', padding: '32px', backgroundColor: '#fff', border: '1px solid #E5E5EA', textAlign: 'center' }}>
        <div style={{ fontSize: '40px', marginBottom: '8px' }}>⭐</div>
        <p style={{ fontSize: '15px', fontWeight: 600, color: '#1D1D1F', margin: '0 0 4px' }}>Noch keine Bewertungen</p>
        <p style={{ fontSize: '13px', color: '#6E6E73', margin: 0 }}>Bewertungen werden nach dem ersten Aufenthalt angezeigt.</p>
      </div>
    </div>
  )
}
