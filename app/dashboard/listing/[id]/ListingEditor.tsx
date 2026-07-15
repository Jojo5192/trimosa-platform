'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseBrowser as supabase } from '@/lib/supabase-browser'
import RoomEditor, { type Room } from './RoomEditor'
import LocationPicker from '@/components/LocationPicker'
import ReviewsManager from './ReviewsManager'
import TranslationsCard from './TranslationsCard'
import AiPolishButton from '@/components/AiPolishButton'
import { AMENITY_CATEGORIES, AMENITY_OPTIONS, CANCELLATION_TEMPLATES, Section, Field, inputStyle, type Listing } from './editor-data'


export default function ListingEditor({ listing }: { listing: Listing }) {
  const router = useRouter()

  const [title, setTitle] = useState(listing.title)
  const [description, setDescription] = useState(listing.description ?? '')
  const [location, setLocation] = useState(listing.location ?? '')
  const [locationGroup, setLocationGroup] = useState(listing.location_group ?? '')
  const [address, setAddress] = useState(listing.address ?? '')
  const [city, setCity] = useState(listing.city ?? '')
  const [lat, setLat] = useState<number | null>(listing.latitude ?? null)
  const [lon, setLon] = useState<number | null>(listing.longitude ?? null)
  const [maxGuests, setMaxGuests] = useState(listing.max_guests ?? 2)
  const [bedrooms, setBedrooms] = useState(listing.bedrooms ?? 1)
  const [bathrooms, setBathrooms] = useState(listing.bathrooms ?? 1)
  const [amenities, setAmenities] = useState<string[]>(
    // Legacy: the combined "Smart-TV / Netflix" entry was split — old data
    // migrates to plain Smart-TV (Netflix is no longer offered).
    (listing.amenities ?? []).map(a => a === 'Smart-TV / Netflix' ? 'Smart-TV' : a)
  )
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

  // Reviews management

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
          location_group: locationGroup.trim() || null,
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
          <AiPolishButton field="title" text={title} onAccept={setTitle}
            context={{ Ort: location, Stadt: city, Gäste: maxGuests, Schlafzimmer: bedrooms, Beschreibung: description.slice(0, 400) }} />
        </Field>
        <Field label="Beschreibung" hint="Erzähl von der Atmosphäre, der Lage, was besonders ist.">
          <textarea
            style={{ ...inputStyle, resize: 'vertical', minHeight: '120px' }}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Beschreibe deine Unterkunft…"
            rows={5}
          />
          <AiPolishButton field="description" text={description} onAccept={setDescription}
            context={{ Titel: title, Ort: location, Stadt: city, Gäste: maxGuests, Schlafzimmer: bedrooms, Badezimmer: bathrooms, Ausstattung: amenities.join(', ') }} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <Field label="Ort / Region" hint="z.B. Schliersee, Bayern">
            <input style={inputStyle} value={location} onChange={e => setLocation(e.target.value)} placeholder="Schliersee, Bayern" />
          </Field>
          <Field label="Genaue Adresse" hint="Wird erst nach Buchungsbestätigung angezeigt">
            <input style={inputStyle} value={address} onChange={e => setAddress(e.target.value)} placeholder="Musterstraße 1, 83727 Schliersee" />
          </Field>
          <Field label="Standort-Gruppe" hint="Wohnungen mit gleichem Gruppennamen (z. B. „Sirzenich“) werden großen Gruppen als Kombination vorgeschlagen">
            <input style={inputStyle} value={locationGroup} onChange={e => setLocationGroup(e.target.value)} placeholder="Sirzenich" />
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
