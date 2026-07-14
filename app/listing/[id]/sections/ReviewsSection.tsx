'use client'

import { useState, useEffect } from 'react'
import { t, type UiLang } from '@/lib/i18n'

/* ── 6. Reviews Section (aggregated from all platforms) ──── */

const SOURCE_META: Record<string, { label: string; color: string; icon: string }> = {
  airbnb:  { label: 'Airbnb',      color: '#FF5A5F', icon: '🅰️' },
  booking: { label: 'Booking.com', color: '#2E7CF6', icon: '🅱️' },
  google:  { label: 'Google',      color: '#34A853', icon: '🔵' },
  vrbo:    { label: 'FeWo-direkt', color: '#8B5CF6', icon: '🟣' },
  trimosa: { label: 'TRIMOSA',     color: 'var(--gold)', icon: '⭐' },
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

export function ReviewsSection({ listingId, showReviewForm = false, lang = 'de' }: { listingId: string; showReviewForm?: boolean; lang?: UiLang }) {
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
    fetch(`/api/reviews?listingId=${listingId}&limit=${LIMIT}&offset=0&lang=${lang}`)
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
    fetch(`/api/reviews?${params}&lang=${lang}`)
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
    fetch(`/api/reviews?${params}&lang=${lang}`)
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
        <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '12px' }}>{t(lang, 'Bewertungen')}</h2>
        <div style={{ textAlign: 'center', padding: '40px', color: '#999', fontSize: '13px' }}>{t(lang, 'Laden…')}</div>
      </div>
    )
  }

  if (!data?.overall) {
    return (
      <div id="reviews-section" style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '12px' }}>{t(lang, 'Bewertungen')}</h2>
        <div style={{ padding: '32px', textAlign: 'center' }}>
          <div style={{ fontSize: '40px', marginBottom: '8px' }}>⭐</div>
          <p style={{ fontSize: '15px', fontWeight: 600, color: '#1D1D1F', margin: '0 0 4px' }}>{t(lang, 'Noch keine Bewertungen')}</p>
          <p style={{ fontSize: '13px', color: '#6E6E73', margin: 0 }}>{t(lang, 'Bewertungen werden nach dem ersten Aufenthalt angezeigt.')}</p>
        </div>
      </div>
    )
  }

  return (
    <div id="reviews-section" style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1D1D1F', marginBottom: '16px' }}>{t(lang, 'Bewertungen')}</h2>

      {/* ── Aggregate Score Panel ── */}
      <div style={{
        display: 'flex', gap: 'clamp(20px, 4vw, 40px)', flexWrap: 'wrap', alignItems: 'center',
        marginBottom: '24px', padding: 'clamp(18px, 3vw, 26px) clamp(18px, 3vw, 30px)',
        borderRadius: '20px', background: 'linear-gradient(160deg, #FDFCF8 0%, #F7F4EC 100%)',
        border: '1px solid #EDE7D8',
      }}>
        {/* Overall score */}
        <div style={{ textAlign: 'center', minWidth: '130px' }}>
          <div style={{ fontSize: '46px', fontWeight: 800, color: '#1A1400', lineHeight: 1, letterSpacing: '-0.03em' }}>
            {data.overall.avg.toFixed(2).replace('.', ',')}
          </div>
          <div style={{ marginTop: '6px' }}>{renderStars(data.overall.avg)}</div>
          <div style={{ fontSize: '12px', color: '#8A8065', marginTop: '4px', fontWeight: 500 }}>
            {data.overall.count} Bewertung{data.overall.count !== 1 ? 'en' : ''} · {Object.keys(data.sources).length} Plattform{Object.keys(data.sources).length !== 1 ? 'en' : ''}
          </div>
        </div>

        {/* Per-platform score bars (click = filter) */}
        <div style={{ flex: 1, minWidth: '250px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {Object.entries(data.sources).map(([src, stats]) => {
            const meta = SOURCE_META[src] ?? { label: src, color: '#888', icon: '●' }
            const isActive = filterSource === src
            return (
              <button
                key={src}
                type="button"
                onClick={() => handleFilterSource(isActive ? null : src)}
                title={isActive ? 'Filter entfernen' : `Nur ${meta.label}-Bewertungen anzeigen`}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                  background: isActive ? '#fff' : 'transparent',
                  border: isActive ? `1.5px solid ${meta.color}` : '1.5px solid transparent',
                  borderRadius: '12px', padding: '7px 10px',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                  <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#3A3427' }}>{meta.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '13px', fontWeight: 800, color: '#1A1400' }}>{stats.avg.toFixed(1).replace('.', ',')}</span>
                  <span style={{ fontSize: '11px', color: '#9C9377', fontWeight: 500 }}>({stats.count})</span>
                </span>
                <span style={{ display: 'block', height: '5px', borderRadius: '99px', background: '#E9E3D2', overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', borderRadius: '99px', background: `linear-gradient(90deg, ${meta.color}CC, ${meta.color})`, width: `${Math.min(100, (stats.avg / 5) * 100)}%`, transition: 'width 0.4s ease' }} />
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Guest Review Form ── */}
      {guestFormOpen && submitStatus !== 'success' && (
        <div style={{ padding: '20px', borderRadius: '14px', background: '#FAF5E4', border: '1px solid #E8D9A0', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1D1D1F', margin: '0 0 12px' }}>{t(lang, '⭐ Deine Bewertung')}</h3>
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
          {submitStatus === 'error' && <p style={{ fontSize: '12px', color: '#DC2626', margin: '0 0 8px' }}>{t(lang, 'Etwas ist schiefgelaufen. Bitte erneut versuchen.')}</p>}
          {submitStatus === 'no-booking' && <p style={{ fontSize: '12px', color: '#92400E', margin: '0 0 8px' }}>{t(lang, 'Du musst einen abgeschlossenen Aufenthalt haben, um bewerten zu können.')}</p>}
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
                background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))', color: '#fff',
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
          <p style={{ fontSize: '15px', fontWeight: 600, color: '#16A34A', margin: '0 0 4px' }}>{t(lang, '✓ Vielen Dank für deine Bewertung!')}</p>
          <p style={{ fontSize: '13px', color: '#22C55E', margin: 0 }}>{t(lang, 'Deine Bewertung wird jetzt angezeigt.')}</p>
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
                <div style={{ marginTop: '8px', fontSize: '11px', color: '#16A34A', fontWeight: 600 }}>{t(lang, '✓ Verifizierter Aufenthalt')}</div>
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
          {t(lang, 'Mehr laden')}
        </button>
      )}

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
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: '4px', fontSize: '13px', fontWeight: 600, color: 'var(--gold)' }}
        >
          {expanded ? 'Weniger' : 'Mehr lesen'}
        </button>
      )}
    </div>
  )
}

/* Keep old export name for backwards compatibility */
export function ReviewsPlaceholder() {
  return null
}
