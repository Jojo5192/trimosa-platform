'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import Image from 'next/image'

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

/* Priority amenities — these appear first in the preview when available */
const PRIORITY_AMENITY_IDS = [
  'WLAN', 'Küche', 'Parkplatz (kostenlos)', 'Klimaanlage', 'Pool', 'Waschmaschine',
  'Balkon', 'Terrasse', 'Garten', 'Sauna', 'TV', 'Haustiere erlaubt',
  'Bergpanorama', 'Seenähe', 'Kamin', 'Grill', 'E-Auto Ladepunkt', 'Babyausstattung',
]

/* ── Overlay backdrop ──────────────────────────────────────── */
function Overlay({ onClose, children, title }: { onClose: () => void; children: React.ReactNode; title: string }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])
  return (
    <div onClick={onClose} className="detail-overlay-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div onClick={e => e.stopPropagation()} className="detail-overlay-box" style={{ background: '#fff', borderRadius: '20px', width: '100%', maxWidth: '600px', maxHeight: '85vh', overflow: 'auto', position: 'relative' }}>
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
      <button type="button" onClick={() => setOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px', borderRadius: '99px', backgroundColor: '#fff', border: '1px solid #E5E5EA', cursor: 'pointer', textAlign: 'left', flexShrink: 0 }}>
        <div style={{ position: 'relative', width: '32px', height: '32px', borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'linear-gradient(135deg, #C4A235, #8A6818)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {host.avatar_url ? (
            <Image src={host.avatar_url} alt="" fill sizes="32px" style={{ objectFit: 'cover' }} />
          ) : (
            <span style={{ color: '#fff', fontSize: '13px', fontWeight: 700 }}>{host.display_name?.[0]?.toUpperCase() ?? '?'}</span>
          )}
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: '13px', color: '#1D1D1F', lineHeight: 1.2 }}>{host.display_name || 'Gastgeber'}</div>
          <div style={{ fontSize: '10px', color: '#6E6E73' }}>Gastgeber</div>
        </div>
      </button>

      {open && (
        <Overlay onClose={() => setOpen(false)} title="Dein Gastgeber">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
            <div style={{ position: 'relative', width: '64px', height: '64px', borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'linear-gradient(135deg, #C4A235, #8A6818)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {host.avatar_url ? (
                <Image src={host.avatar_url} alt="" fill sizes="64px" style={{ objectFit: 'cover' }} />
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
                    <div style={{ position: 'relative', aspectRatio: '3/2', background: '#F5F5F7', overflow: 'hidden' }}>
                      {l.images?.[0] && <Image src={l.images[0]} alt="" fill sizes="200px" style={{ objectFit: 'cover' }} />}
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

  const enriched = useMemo(() => {
    const all = amenities.map(a => {
      const info = AMENITY_MAP.get(a)
      return { id: a, emoji: info?.emoji ?? '✓', label: info?.label ?? a, category: info?.category ?? 'Sonstiges' }
    })
    const prioSet = new Set(PRIORITY_AMENITY_IDS)
    const prio = PRIORITY_AMENITY_IDS
      .filter(pid => all.some(a => a.id === pid))
      .map(pid => all.find(a => a.id === pid)!)
    const rest = all.filter(a => !prioSet.has(a.id))
    return [...prio, ...rest]
  }, [amenities])

  const visible = enriched.slice(0, MAX_SHOW)
  const remaining = enriched.length - MAX_SHOW

  const grouped = useMemo(() => {
    const amenitySet = new Set(amenities)
    return AMENITY_CATEGORIES
      .map(cat => ({ name: cat.name, icon: cat.icon, items: cat.items.filter(item => amenitySet.has(item.id)) }))
      .filter(cat => cat.items.length > 0)
  }, [amenities])

  if (amenities.length === 0) return null

  return (
    <div style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '16px' }}>Ausstattung</h2>
      <div className="detail-amenities-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px' }}>
        {visible.map(a => (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid #F0EEE8' }}>
            <span style={{ fontSize: '17px', lineHeight: 1, flexShrink: 0 }}>{a.emoji}</span>
            <span style={{ fontSize: '14px', color: '#1D1D1F' }}>{a.label}</span>
          </div>
        ))}
      </div>
      {remaining > 0 && (
        <button type="button" onClick={() => setShowAll(true)} style={{ marginTop: '16px', padding: '10px 20px', borderRadius: '12px', border: '1px solid #1D1D1F', background: 'transparent', fontSize: '13px', fontWeight: 600, color: '#1D1D1F', cursor: 'pointer', width: '100%' }}>
          Alle {enriched.length} Ausstattungsmerkmale anzeigen
        </button>
      )}

      {showAll && (
        <Overlay onClose={() => setShowAll(false)} title="Alle Ausstattungsmerkmale">
          {grouped.map(cat => (
            <div key={cat.name} style={{ marginBottom: '24px' }}>
              <h4 style={{ fontSize: '14px', fontWeight: 700, color: '#1D1D1F', marginBottom: '10px' }}>{cat.icon} {cat.name}</h4>
              <div className="detail-amenity-overlay-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {cat.items.map(a => (
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

/* ── 3. Floor Plan Section (multiple with labels) + Overlay ── */
export function FloorPlanSection({ urls, labels = [] }: { urls: string[]; labels?: string[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  if (urls.length === 0) return null
  return (
    <div style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '12px' }}>
        {urls.length === 1 ? 'Grundriss' : 'Grundrisse'}
      </h2>
      <div className="detail-floorplan-grid" style={{ display: 'grid', gridTemplateColumns: urls.length === 1 ? '1fr' : '1fr 1fr', gap: '12px' }}>
        {urls.map((url, i) => (
          <div key={i} onClick={() => setOpenIdx(i)} style={{ cursor: 'pointer', position: 'relative' }}>
            <div style={{ borderRadius: '14px', overflow: 'hidden', border: '1px solid #E5E5EA', maxHeight: '300px', background: '#fff' }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- no fixed-height container, low SEO value */}
              <img src={url} alt={labels[i] || `Grundriss ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'contain', maxHeight: '300px' }} />
              <div style={{ position: 'absolute', bottom: '10px', right: '10px', background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: '11px', fontWeight: 600, padding: '5px 12px', borderRadius: '99px' }}>
                🔍 Vergrößern
              </div>
            </div>
            {labels[i] && (
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#6E6E73', marginTop: '6px', textAlign: 'center' }}>{labels[i]}</div>
            )}
          </div>
        ))}
      </div>

      {openIdx !== null && (
        <Overlay onClose={() => setOpenIdx(null)} title={labels[openIdx] || (urls.length === 1 ? 'Grundriss' : `Grundriss ${openIdx + 1}`)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- natural sizing, low SEO value */}
          <img src={urls[openIdx]} alt="Grundriss" style={{ width: '100%', objectFit: 'contain', borderRadius: '8px' }} />
          {urls.length > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '16px' }}>
              {urls.map((_, i) => (
                <button key={i} type="button" onClick={() => setOpenIdx(i)} style={{
                  padding: '6px 14px', borderRadius: '8px', border: i === openIdx ? '2px solid #1D1D1F' : '1px solid #E5E5EA',
                  background: i === openIdx ? '#F5F5F7' : '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: '#1D1D1F',
                }}>{labels[i] || `${i + 1}`}</button>
              ))}
            </div>
          )}
        </Overlay>
      )}
    </div>
  )
}

/* ── 4. Occupancy Calendar — 2 months, clickable → BookingBox ─ */
const DE_MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
const DE_DAYS_SHORT = ['Mo','Di','Mi','Do','Fr','Sa','So']

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function CalendarMonthGrid({ year, month, rates, todayStr, checkIn, checkOut, onClickDay }: {
  year: number; month: number
  rates: Record<string, { available: number }>
  todayStr: string
  checkIn: string; checkOut: string
  onClickDay: (iso: string) => void
}) {
  const firstDow = new Date(year, month, 1).getDay()
  const leadBlanks = firstDow === 0 ? 6 : firstDow - 1
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  return (
    <div>
      <div style={{ textAlign: 'center', fontSize: '14px', fontWeight: 700, color: '#1D1D1F', marginBottom: '10px' }}>
        {DE_MONTHS[month]} {year}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px', marginBottom: '3px' }}>
        {DE_DAYS_SHORT.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: '10px', fontWeight: 600, color: '#999', padding: '3px 0' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px' }}>
        {Array.from({ length: leadBlanks }).map((_, i) => <div key={`b${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
          const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const isPast = iso < todayStr
          const rate = rates[iso]
          const isBooked = !isPast && rate?.available === 0
          const isSelected = iso === checkIn || iso === checkOut
          const inRange = checkIn && checkOut && iso > checkIn && iso < checkOut
          const clickable = !isPast && !isBooked

          let bg = '#F0FDF4'; let color = '#16A34A'; let border = '1px solid #BBF7D0'
          if (isPast) { bg = '#F9FAFB'; color = '#D1D5DB'; border = '1px solid #F3F4F6' }
          else if (isBooked) { bg = '#FEF2F2'; color = '#DC2626'; border = '1px solid #FECACA' }
          if (isSelected) { bg = '#111'; color = '#fff'; border = '1px solid #111' }
          else if (inRange) { bg = 'rgba(17,17,17,0.08)'; color = '#1D1D1F'; border = '1px solid rgba(17,17,17,0.12)' }

          return (
            <button
              key={day}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onClickDay(iso)}
              style={{
                aspectRatio: '1', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '12px', fontWeight: isSelected ? 700 : isPast ? 400 : 600,
                backgroundColor: bg, color, border,
                cursor: clickable ? 'pointer' : 'default',
                transition: 'all 0.1s',
              }}
            >
              {day}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function OccupancyCalendar({ listingId }: { listingId: string }) {
  const [viewDate, setViewDate] = useState(new Date())
  const [rates, setRates] = useState<Record<string, { available: number }>>({})
  const [loading, setLoading] = useState(true)
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [selecting, setSelecting] = useState<'in' | 'out'>('in')

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

  const todayStr = isoDate(new Date())

  const handleClickDay = useCallback((iso: string) => {
    if (selecting === 'in') {
      setCheckIn(iso); setCheckOut(''); setSelecting('out')
    } else {
      if (iso <= checkIn) {
        setCheckIn(iso); setCheckOut(''); setSelecting('out')
      } else {
        setCheckOut(iso); setSelecting('in')
      }
    }
  }, [selecting, checkIn])

  /* When both dates selected, scroll BookingBox into view and update its fields via custom event */
  useEffect(() => {
    if (checkIn && checkOut) {
      window.dispatchEvent(new CustomEvent('calendar-dates', { detail: { checkIn, checkOut } }))
      // Scroll booking box into view on mobile
      const box = document.querySelector('.detail-booking-col')
      if (box && window.innerWidth < 769) {
        box.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
  }, [checkIn, checkOut])

  function prev() { setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1)) }
  function next() { setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1)) }

  const month2 = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1)

  return (
    <div id="occupancy-calendar" style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '16px' }}>Belegungskalender</h2>
      <div>
        {/* Month navigation */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <button type="button" onClick={prev} style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid #E5E5EA', background: 'transparent', cursor: 'pointer', fontSize: '15px', color: '#6E6E73' }}>‹</button>
          <span style={{ fontSize: '12px', color: '#999' }}>
            {selecting === 'in' ? 'Anreise wählen' : 'Abreise wählen'}
          </span>
          <button type="button" onClick={next} style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid #E5E5EA', background: 'transparent', cursor: 'pointer', fontSize: '15px', color: '#6E6E73' }}>›</button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#999', fontSize: '13px' }}>Laden…</div>
        ) : (
          <div className="detail-calendar-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            <CalendarMonthGrid
              year={viewDate.getFullYear()} month={viewDate.getMonth()}
              rates={rates} todayStr={todayStr}
              checkIn={checkIn} checkOut={checkOut}
              onClickDay={handleClickDay}
            />
            <CalendarMonthGrid
              year={month2.getFullYear()} month={month2.getMonth()}
              rates={rates} todayStr={todayStr}
              checkIn={checkIn} checkOut={checkOut}
              onClickDay={handleClickDay}
            />
          </div>
        )}

        {/* Legend + selection info */}
        <div className="detail-calendar-legend" style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', marginTop: '14px', paddingTop: '10px', borderTop: '1px solid #F0EEE8', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#999' }}>
            <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', background: '#F0FDF4', border: '1px solid #BBF7D0' }} />Frei
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#999' }}>
            <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', background: '#FEF2F2', border: '1px solid #FECACA' }} />Belegt
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#999' }}>
            <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', background: '#111', border: '1px solid #111' }} />Ausgewählt
          </div>
          {checkIn && (
            <div style={{ marginLeft: 'auto', fontSize: '12px', color: '#1D1D1F', fontWeight: 600 }}>
              {checkIn}{checkOut ? ` → ${checkOut}` : ' → ?'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── 5. House Rules Display (structured Airbnb-style) ──────── */
interface HouseRules {
  pets_allowed?: boolean
  events_allowed?: boolean
  smoking_allowed?: boolean
  quiet_hours?: boolean
  quiet_start?: string
  quiet_end?: string
  commercial_photo?: boolean
  max_guests?: number
  additional_rules?: string
}

export function HouseRulesDisplay({ rules, checkIn, checkOut, legacyText }: {
  rules: HouseRules; checkIn?: string; checkOut?: string; legacyText?: string
}) {
  const hasStructured = rules.pets_allowed !== undefined || rules.quiet_hours || rules.max_guests || rules.additional_rules
  if (!hasStructured && !legacyText) return null

  const items: { emoji: string; label: string; value: string }[] = []
  if (rules.max_guests) items.push({ emoji: '👥', label: 'Maximale Gästeanzahl', value: `${rules.max_guests} Gäste` })
  if (checkIn) items.push({ emoji: '🕐', label: 'Check-in', value: `ab ${checkIn} Uhr` })
  if (checkOut) items.push({ emoji: '🕐', label: 'Check-out', value: `bis ${checkOut} Uhr` })
  items.push({ emoji: '🐾', label: 'Haustiere', value: rules.pets_allowed ? 'Erlaubt' : 'Nicht erlaubt' })
  items.push({ emoji: '🎉', label: 'Veranstaltungen', value: rules.events_allowed ? 'Erlaubt' : 'Nicht erlaubt' })
  items.push({ emoji: '🚬', label: 'Rauchen', value: rules.smoking_allowed ? 'Erlaubt' : 'Nicht erlaubt' })
  items.push({ emoji: '📸', label: 'Kommerzielles Fotografieren', value: rules.commercial_photo ? 'Erlaubt' : 'Nicht erlaubt' })
  if (rules.quiet_hours) {
    items.push({ emoji: '🤫', label: 'Ruhezeiten', value: `${rules.quiet_start ?? '22:00'} – ${rules.quiet_end ?? '07:00'}` })
  }

  return (
    <div style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#1D1D1F', marginBottom: '10px' }}>Hausregeln</h2>
      {hasStructured ? (
        <div>
          {items.map((item, i) => (
            <div key={item.label} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0',
              borderBottom: i < items.length - 1 ? '1px solid #F0EEE8' : 'none',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px' }}>{item.emoji}</span>
                <span style={{ fontSize: '13px', color: '#6E6E73' }}>{item.label}</span>
              </div>
              <span style={{ fontSize: '12px', fontWeight: 600, color: item.value.includes('Nicht') ? '#DC2626' : '#1D1D1F' }}>
                {item.value}
              </span>
            </div>
          ))}
          {rules.additional_rules && (
            <div style={{ paddingTop: '10px', marginTop: '6px', borderTop: '1px solid #F0EEE8' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', marginBottom: '4px' }}>Zusätzliche Regeln</div>
              <p style={{ fontSize: '13px', lineHeight: 1.6, color: '#6E6E73', whiteSpace: 'pre-line', margin: 0 }}>
                {rules.additional_rules}
              </p>
            </div>
          )}
        </div>
      ) : legacyText ? (
        <p style={{ fontSize: '13px', lineHeight: 1.7, color: '#6E6E73', whiteSpace: 'pre-line', margin: 0 }}>
          {legacyText}
        </p>
      ) : null}
    </div>
  )
}

/* ── 6. Reviews Section (aggregated from all platforms) ──── */

const SOURCE_META: Record<string, { label: string; color: string; icon: string }> = {
  airbnb:  { label: 'Airbnb',  color: '#FF5A5F', icon: '🅰️' },
  booking: { label: 'Booking', color: '#003580', icon: '🅱️' },
  google:  { label: 'Google',  color: '#4285F4', icon: '🔵' },
  vrbo:    { label: 'VRBO',    color: '#6C3BAA', icon: '🟣' },
  trimosa: { label: 'TRIMOSA', color: '#B0912B', icon: '⭐' },
}

interface ReviewData {
  id: string
  source: string
  author_name: string
  author_avatar?: string
  rating: number
  review_text?: string
  review_date: string
  verified?: boolean
}

interface ReviewsAggregate {
  reviews: ReviewData[]
  total: number
  overall: { avg: number; count: number } | null
  sources: Record<string, { avg: number; count: number }>
}

export function ReviewsSection({ listingId, showReviewForm = false, revyoosPropertyId }: { listingId: string; showReviewForm?: boolean; revyoosPropertyId?: string }) {
  const [data, setData] = useState<ReviewsAggregate | null>(null)
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const [allReviews, setAllReviews] = useState<ReviewData[]>([])
  const [filterSource, setFilterSource] = useState<string | null>(null)
  const [guestFormOpen, setGuestFormOpen] = useState(showReviewForm)
  const [guestRating, setGuestRating] = useState(5)
  const [guestText, setGuestText] = useState('')
  const [guestName, setGuestName] = useState('')
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'submitting' | 'success' | 'error' | 'no-booking'>('idle')
  const LIMIT = 6

  // Initial load
  useEffect(() => {
    setLoading(true)
    fetch(`/api/reviews?listingId=${listingId}&limit=${LIMIT}&offset=0`)
      .then(r => r.json())
      .then((d: ReviewsAggregate) => {
        setData(d)
        setAllReviews(d.reviews)
        setOffset(d.reviews.length)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [listingId])

  function loadMore() {
    const params = new URLSearchParams({ listingId, limit: String(LIMIT), offset: String(offset) })
    if (filterSource) params.set('source', filterSource)
    fetch(`/api/reviews?${params}`)
      .then(r => r.json())
      .then((d: ReviewsAggregate) => {
        setAllReviews(prev => [...prev, ...d.reviews])
        setOffset(prev => prev + d.reviews.length)
      })
  }

  function handleFilterSource(source: string | null) {
    setFilterSource(source)
    setOffset(0)
    const params = new URLSearchParams({ listingId, limit: String(LIMIT), offset: '0' })
    if (source) params.set('source', source)
    fetch(`/api/reviews?${params}`)
      .then(r => r.json())
      .then((d: ReviewsAggregate) => {
        setAllReviews(d.reviews)
        setOffset(d.reviews.length)
      })
  }

  function formatReviewDate(iso: string) {
    const d = new Date(iso)
    const months = ['Jan.','Feb.','Mär.','Apr.','Mai','Jun.','Jul.','Aug.','Sep.','Okt.','Nov.','Dez.']
    return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
  }

  function renderStars(rating: number) {
    const full = Math.floor(rating)
    const half = rating - full >= 0.25 && rating - full < 0.75
    const empty = 5 - full - (half ? 1 : 0)
    return (
      <span style={{ color: '#F59E0B', fontSize: '13px', letterSpacing: '1px' }}>
        {'★'.repeat(full)}{half ? '½' : ''}{'☆'.repeat(empty)}
      </span>
    )
  }

  if (loading) {
    return (
      <div id="reviews-section" style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '12px' }}>Bewertungen</h2>
        <div style={{ textAlign: 'center', padding: '40px', color: '#999', fontSize: '13px' }}>Laden…</div>
      </div>
    )
  }

  if (!data?.overall) {
    return (
      <div id="reviews-section" style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '12px' }}>Bewertungen</h2>
        {revyoosPropertyId ? (
          <RevyoosWidget embedCode={revyoosPropertyId} />
        ) : (
          <div style={{ padding: '32px', textAlign: 'center' }}>
            <div style={{ fontSize: '40px', marginBottom: '8px' }}>⭐</div>
            <p style={{ fontSize: '15px', fontWeight: 600, color: '#1D1D1F', margin: '0 0 4px' }}>Noch keine Bewertungen</p>
            <p style={{ fontSize: '13px', color: '#6E6E73', margin: 0 }}>Bewertungen werden nach dem ersten Aufenthalt angezeigt.</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div id="reviews-section" style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '16px' }}>Bewertungen</h2>

      {/* ── Aggregate Score Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid #F0EEE8' }}>
        {/* Overall score */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span style={{ fontSize: '36px', fontWeight: 700, color: '#1D1D1F', lineHeight: 1 }}>{data.overall.avg.toFixed(2)}</span>
          <div>
            {renderStars(data.overall.avg)}
            <div style={{ fontSize: '12px', color: '#6E6E73', marginTop: '2px' }}>
              {data.overall.count} Bewertung{data.overall.count !== 1 ? 'en' : ''}
            </div>
          </div>
        </div>

        {/* Per-source badges */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginLeft: 'auto' }}>
          {Object.entries(data.sources).map(([src, stats]) => {
            const meta = SOURCE_META[src] ?? { label: src, color: '#888', icon: '●' }
            const isActive = filterSource === src
            return (
              <button
                key={src}
                type="button"
                onClick={() => handleFilterSource(isActive ? null : src)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '6px 12px', borderRadius: '99px',
                  border: isActive ? `2px solid ${meta.color}` : '1px solid #E5E5EA',
                  background: isActive ? `${meta.color}10` : '#fff',
                  cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                  color: isActive ? meta.color : '#6E6E73',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                {stats.avg.toFixed(1)}
                <span style={{ fontSize: '10px', color: '#999', fontWeight: 400 }}>({stats.count})</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Guest Review Form ── */}
      {guestFormOpen && submitStatus !== 'success' && (
        <div style={{ padding: '20px', borderRadius: '14px', background: '#FAF5E4', border: '1px solid #E8D9A0', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1D1D1F', margin: '0 0 12px' }}>⭐ Deine Bewertung</h3>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
            {[1, 2, 3, 4, 5].map(star => (
              <button key={star} type="button" onClick={() => setGuestRating(star)}
                style={{ fontSize: '24px', background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: star <= guestRating ? '#F59E0B' : '#DDD', transition: 'color 0.1s' }}>
                ★
              </button>
            ))}
            <span style={{ fontSize: '13px', color: '#888', alignSelf: 'center', marginLeft: '4px' }}>{guestRating}/5</span>
          </div>
          <input
            type="text"
            value={guestName}
            onChange={e => setGuestName(e.target.value)}
            placeholder="Dein Name"
            style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '1.5px solid #E0DDD6', fontSize: '13px', marginBottom: '10px', boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' }}
          />
          <textarea
            value={guestText}
            onChange={e => setGuestText(e.target.value)}
            placeholder="Erzähle von deinem Aufenthalt…"
            rows={4}
            style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '1.5px solid #E0DDD6', fontSize: '13px', resize: 'none', marginBottom: '10px', boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' }}
          />
          {submitStatus === 'error' && <p style={{ fontSize: '12px', color: '#DC2626', margin: '0 0 8px' }}>Etwas ist schiefgelaufen. Bitte erneut versuchen.</p>}
          {submitStatus === 'no-booking' && <p style={{ fontSize: '12px', color: '#92400E', margin: '0 0 8px' }}>Du musst einen abgeschlossenen Aufenthalt haben, um bewerten zu können.</p>}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              disabled={submitStatus === 'submitting' || !guestName}
              onClick={async () => {
                setSubmitStatus('submitting')
                try {
                  const res = await fetch('/api/reviews', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      listingId,
                      source: 'trimosa',
                      authorName: guestName,
                      rating: guestRating,
                      reviewText: guestText,
                      reviewDate: new Date().toISOString().split('T')[0],
                    }),
                  })
                  if (res.status === 403) { setSubmitStatus('no-booking'); return }
                  if (!res.ok) { setSubmitStatus('error'); return }
                  setSubmitStatus('success')
                  // Refresh reviews
                  const d = await fetch(`/api/reviews?listingId=${listingId}&limit=${LIMIT}&offset=0`).then(r => r.json())
                  setData(d)
                  setAllReviews(d.reviews)
                  setOffset(d.reviews.length)
                } catch { setSubmitStatus('error') }
              }}
              style={{
                padding: '10px 24px', borderRadius: '10px', border: 'none',
                background: 'linear-gradient(135deg, #C4A235, #8A6818)', color: '#fff',
                fontSize: '13px', fontWeight: 700, cursor: submitStatus === 'submitting' ? 'not-allowed' : 'pointer',
              }}
            >
              {submitStatus === 'submitting' ? 'Wird gesendet…' : 'Bewertung abgeben'}
            </button>
            <button type="button" onClick={() => setGuestFormOpen(false)}
              style={{ padding: '10px 18px', borderRadius: '10px', border: '1px solid #E0DDD6', background: '#fff', fontSize: '13px', fontWeight: 600, color: '#666', cursor: 'pointer' }}>
              Abbrechen
            </button>
          </div>
        </div>
      )}
      {submitStatus === 'success' && (
        <div style={{ padding: '20px', borderRadius: '14px', background: '#F0FDF4', border: '1px solid #BBF7D0', marginBottom: '20px', textAlign: 'center' }}>
          <p style={{ fontSize: '15px', fontWeight: 600, color: '#16A34A', margin: '0 0 4px' }}>✓ Vielen Dank für deine Bewertung!</p>
          <p style={{ fontSize: '13px', color: '#22C55E', margin: 0 }}>Deine Bewertung wird jetzt angezeigt.</p>
        </div>
      )}

      {/* ── Review Cards ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {allReviews.map(review => {
          const meta = SOURCE_META[review.source] ?? { label: review.source, color: '#888', icon: '●' }
          return (
            <div key={review.id} style={{ padding: '16px 20px', borderRadius: '14px', border: '1px solid #F0EEE8', background: '#fff' }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {/* Avatar */}
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '50%',
                    background: review.author_avatar ? 'transparent' : `linear-gradient(135deg, ${meta.color}, ${meta.color}99)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    overflow: 'hidden', flexShrink: 0,
                  }}>
                    {review.author_avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element -- external (Airbnb/Google/Booking) domains, not whitelisted for next/image
                      <img src={review.author_avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ color: '#fff', fontSize: '14px', fontWeight: 700 }}>
                        {review.author_name[0]?.toUpperCase() ?? '?'}
                      </span>
                    )}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '13px', color: '#1D1D1F', lineHeight: 1.2 }}>{review.author_name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                      {renderStars(review.rating)}
                      <span style={{ fontSize: '11px', color: '#999' }}>{formatReviewDate(review.review_date)}</span>
                    </div>
                  </div>
                </div>

                {/* Source badge */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  fontSize: '11px', fontWeight: 600, color: meta.color,
                }}>
                  {meta.label}
                  <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: meta.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700 }}>
                    {meta.label[0]}
                  </span>
                </div>
              </div>

              {/* Review text */}
              {review.review_text && (
                <ReviewText text={review.review_text} />
              )}

              {/* Verified badge */}
              {review.verified && (
                <div style={{ marginTop: '8px', fontSize: '11px', color: '#16A34A', fontWeight: 600 }}>✓ Verifizierter Aufenthalt</div>
              )}
            </div>
          )
        })}
      </div>

      {/* Load more */}
      {offset < data.total && (
        <button
          type="button"
          onClick={loadMore}
          style={{
            marginTop: '16px', padding: '10px 20px', borderRadius: '10px',
            border: '1px solid #1D1D1F', background: 'transparent',
            fontSize: '13px', fontWeight: 600, color: '#1D1D1F',
            cursor: 'pointer', width: '100%',
          }}
        >
          Mehr laden
        </button>
      )}

      {/* Revyoos Widget */}
      {revyoosPropertyId && <RevyoosWidget embedCode={revyoosPropertyId} />}
    </div>
  )
}

/* Helper: expandable review text */
function ReviewText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const MAX = 200
  const needsTruncation = text.length > MAX

  return (
    <div>
      <p style={{ fontSize: '14px', lineHeight: 1.7, color: '#6E6E73', whiteSpace: 'pre-line', margin: 0 }}>
        {needsTruncation && !expanded ? text.slice(0, MAX) + '…' : text}
      </p>
      {needsTruncation && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: '4px', fontSize: '13px', fontWeight: 600, color: '#B0912B' }}
        >
          {expanded ? 'Weniger' : 'Mehr lesen'}
        </button>
      )}
    </div>
  )
}

/* ── Revyoos Widget ── */
function RevyoosWidget({ embedCode }: { embedCode: string }) {
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return

    // Clear previous content
    node.innerHTML = ''

    // Check if the user pasted a full embed code (contains <script or <div)
    if (embedCode.includes('<script') || embedCode.includes('<div')) {
      // Parse and inject the embed code
      const temp = document.createElement('div')
      temp.innerHTML = embedCode

      // Move all elements into the container
      Array.from(temp.children).forEach(child => {
        if (child.tagName === 'SCRIPT') {
          // Scripts need to be re-created to execute
          const script = document.createElement('script')
          const srcAttr = child.getAttribute('src')
          if (srcAttr) {
            script.src = srcAttr
            script.async = true
          } else {
            script.textContent = child.textContent
          }
          // Copy other attributes
          Array.from(child.attributes).forEach(attr => {
            if (attr.name !== 'src') script.setAttribute(attr.name, attr.value)
          })
          node.appendChild(script)
        } else {
          node.appendChild(child.cloneNode(true))
        }
      })
    } else {
      // Just an ID — create a standard Revyoos widget embed
      // Revyoos uses: <div id="revyoos-widget" data-property="PROPERTY_ID"></div>
      // + <script src="https://app.revyoos.com/widget.js" async></script>
      const widgetDiv = document.createElement('div')
      widgetDiv.id = 'revyoos-widget-' + embedCode
      widgetDiv.setAttribute('data-property', embedCode)
      widgetDiv.className = 'revyoos-widget'
      node.appendChild(widgetDiv)

      const script = document.createElement('script')
      script.src = `https://app.revyoos.com/widget.js?property=${embedCode}`
      script.async = true
      node.appendChild(script)
    }
  }, [embedCode])

  return (
    <div style={{ marginTop: '24px', borderTop: '1px solid #F0EEE8', paddingTop: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <span style={{ fontSize: '14px', fontWeight: 700, color: '#1D1D1F' }}>Bewertungen auf anderen Plattformen</span>
        <span style={{ fontSize: '10px', color: '#999', fontWeight: 500 }}>powered by Revyoos</span>
      </div>
      <div ref={containerRef} />
    </div>
  )
}

/* Keep old export name for backwards compatibility */
export function ReviewsPlaceholder() {
  return null
}
