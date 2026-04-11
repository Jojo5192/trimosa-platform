'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseBrowser as supabase } from '@/lib/supabase-browser'
import RoomEditor, { type Room } from './RoomEditor'

const AMENITY_OPTIONS = [
  { id: 'wifi',        icon: '📶', label: 'WLAN' },
  { id: 'kitchen',     icon: '🍳', label: 'Küche' },
  { id: 'parking',     icon: '🅿️', label: 'Parkplatz' },
  { id: 'washer',      icon: '🧺', label: 'Waschmaschine' },
  { id: 'dryer',       icon: '👕', label: 'Trockner' },
  { id: 'ac',          icon: '❄️', label: 'Klimaanlage' },
  { id: 'heating',     icon: '🔥', label: 'Heizung' },
  { id: 'fireplace',   icon: '🪵', label: 'Kamin' },
  { id: 'tv',          icon: '📺', label: 'TV' },
  { id: 'balcony',     icon: '🏡', label: 'Balkon / Terrasse' },
  { id: 'garden',      icon: '🌿', label: 'Garten' },
  { id: 'pool',        icon: '🏊', label: 'Pool' },
  { id: 'sauna',       icon: '🧖', label: 'Sauna' },
  { id: 'bbq',         icon: '🍖', label: 'Grill' },
  { id: 'pets',        icon: '🐾', label: 'Haustiere erlaubt' },
  { id: 'ev',          icon: '⚡', label: 'E-Auto Ladepunkt' },
  { id: 'mountain',    icon: '🏔️', label: 'Bergpanorama' },
  { id: 'lake',        icon: '🏞️', label: 'Seenähe' },
  { id: 'ski',         icon: '⛷️', label: 'Skigebiet in der Nähe' },
  { id: 'baby',        icon: '👶', label: 'Babyausstattung' },
]

interface Listing {
  id: string
  title: string
  description: string
  location: string
  address?: string
  price_per_night: number
  max_guests: number
  bedrooms: number
  bathrooms?: number
  amenities?: string[]
  images?: string[]
  rooms?: Room[]
  house_rules?: string
  check_in_time?: string
  check_out_time?: string
  is_active: boolean
  smoobu_id?: string
  cancellation_policy?: string
}

const CANCELLATION_POLICIES = [
  {
    id: 'flexibel',
    label: 'Flexibel',
    desc: 'Kostenlose Stornierung bis 24 Std. vor Check-in. Danach 1 Nacht Gebühr.',
  },
  {
    id: 'moderat',
    label: 'Moderat',
    desc: 'Kostenlose Stornierung bis 5 Tage vor Check-in. Danach 50 % des Buchungsbetrags.',
  },
  {
    id: 'strikt',
    label: 'Strikt',
    desc: 'Kostenlose Stornierung innerhalb von 48 Std. nach Buchung (mind. 14 Tage vor Check-in). Danach keine Rückerstattung.',
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
  const [maxGuests, setMaxGuests] = useState(listing.max_guests ?? 2)
  const [bedrooms, setBedrooms] = useState(listing.bedrooms ?? 1)
  const [bathrooms, setBathrooms] = useState(listing.bathrooms ?? 1)
  const [amenities, setAmenities] = useState<string[]>(listing.amenities ?? [])
  const [coverImage, setCoverImage] = useState<string>(listing.images?.[0] ?? '')
  const [coverUploading, setCoverUploading] = useState(false)
  const [rooms, setRooms] = useState<Room[]>(listing.rooms ?? [])
  const [houseRules, setHouseRules] = useState(listing.house_rules ?? '')
  const [checkInTime, setCheckInTime] = useState(listing.check_in_time ?? '15:00')
  const [checkOutTime, setCheckOutTime] = useState(listing.check_out_time ?? '11:00')
  const [isActive, setIsActive] = useState(listing.is_active)
  const [cancelPolicy, setCancelPolicy] = useState(listing.cancellation_policy ?? 'moderat')
  const [onboardingError, setOnboardingError] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const coverInputRef = useRef<HTMLInputElement>(null)

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
          max_guests: maxGuests,
          bedrooms,
          bathrooms,
          amenities,
          cover_image: coverImage,
          rooms,
          cancellation_policy: cancelPolicy,
          house_rules: houseRules,
          check_in_time: checkInTime,
          check_out_time: checkOutTime,
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
            background: isActive ? 'linear-gradient(135deg, #C4A235, #8A6818)' : '#E5E5E5',
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
              borderRadius: '14px', border: '2px dashed #C4A235',
              background: '#FFFBF0', cursor: coverUploading ? 'not-allowed' : 'pointer',
            }}
          >
            {coverUploading ? (
              <span style={{ fontSize: '13px', color: '#8A6818' }}>Wird hochgeladen…</span>
            ) : (
              <>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#C4A235" strokeWidth={1.5} strokeLinecap="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#8A6818' }}>Titelbild hochladen</span>
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '8px' }}>
          {AMENITY_OPTIONS.map(({ id, icon, label }) => {
            const active = amenities.includes(label)
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggleAmenity(label)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '10px 12px', borderRadius: '12px',
                  border: `1.5px solid ${active ? '#C4A235' : '#E0DDD6'}`,
                  background: active ? '#FDF6E3' : '#fff',
                  cursor: 'pointer', fontSize: '12px', fontWeight: active ? 600 : 400,
                  color: active ? '#8A6818' : '#555',
                  transition: 'all 0.12s',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontSize: '16px', lineHeight: 1 }}>{icon}</span>
                {label}
              </button>
            )
          })}
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

      {/* ── Hausregeln & Check-in ── */}
      <Section title="Hausregeln & Check-in">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
          <Field label="Check-in ab">
            <input type="time" style={inputStyle} value={checkInTime} onChange={e => setCheckInTime(e.target.value)} />
          </Field>
          <Field label="Check-out bis">
            <input type="time" style={inputStyle} value={checkOutTime} onChange={e => setCheckOutTime(e.target.value)} />
          </Field>
        </div>
        <Field label="Hausregeln" hint="z.B. keine Partys, Hunde erlaubt, Rauchen nur draußen">
          <textarea
            style={{ ...inputStyle, resize: 'vertical' }}
            value={houseRules}
            onChange={e => setHouseRules(e.target.value)}
            placeholder="Bitte seid rücksichtsvoll zu den Nachbarn…"
            rows={3}
          />
        </Field>
      </Section>

      {/* ── Stornierungsbedingungen ── */}
      <Section title="Stornierungsbedingungen">
        <p style={{ fontSize: '12px', color: '#888', margin: '0 0 14px' }}>
          Diese Bedingungen gelten für Buchungen über TRIMOSA und werden Gästen vor der Buchung angezeigt.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {CANCELLATION_POLICIES.map(p => (
            <label key={p.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: '12px',
              padding: '12px 16px', borderRadius: '12px', cursor: 'pointer',
              border: cancelPolicy === p.id ? '2px solid #A8882A' : '1.5px solid #E0DDD6',
              background: cancelPolicy === p.id ? '#FBF6EC' : '#fff',
            }}>
              <input
                type="radio"
                name="cancellation"
                value={p.id}
                checked={cancelPolicy === p.id}
                onChange={() => setCancelPolicy(p.id)}
                style={{ marginTop: '2px', accentColor: '#A8882A' }}
              />
              <div>
                <p style={{ fontSize: '13px', fontWeight: 700, color: '#111', margin: '0 0 2px' }}>{p.label}</p>
                <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>{p.desc}</p>
              </div>
            </label>
          ))}
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
          <a href="/dashboard/setup" style={{ fontSize: '12px', fontWeight: 700, color: '#A8882A' }}>
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
            background: 'linear-gradient(135deg, #C4A235, #8A6818)',
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
