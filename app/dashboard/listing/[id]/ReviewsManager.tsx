'use client'

/**
 * Review management inside the listing editor: load/list/delete imported
 * reviews, trigger the Apify/Places sync, paste-import and single-add forms.
 * Fully self-contained (own state) — split out of ListingEditor.tsx.
 */
import { useState } from 'react'
import { inputStyle } from './editor-data'

export default function ReviewsManager({ listingId }: { listingId: string }) {
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

  return (
    <div style={{ borderTop: '1px solid #F0EEE8', paddingTop: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#111' }}>Importierte Bewertungen</h4>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" onClick={() => {
            setReviewsLoading(true)
            fetch(`/api/reviews?listingId=${listingId}&limit=50`)
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
                body: JSON.stringify({ listingId: listingId }),
              })
              const data = await res.json()
              setFetchResult(data)
              // Reload reviews list after fetching
              const revRes = await fetch(`/api/reviews?listingId=${listingId}&limit=50`)
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
                  body: JSON.stringify({ listingId: listingId, source: pasteSource, text: pasteText }),
                })
                const data = await res.json()
                if (data.error) {
                  setFetchResult({ results: [{ source: pasteSource, status: 'error', fetched: 0, detail: data.error }] })
                } else {
                  setFetchResult({ results: [{ source: pasteSource, status: 'ok', fetched: data.imported ?? 0 }] })
                  setPasteText('')
                  setShowPasteImport(false)
                  // Reload
                  const revRes = await fetch(`/api/reviews?listingId=${listingId}&limit=50`)
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
                listingId: listingId,
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
              fetch(`/api/reviews?listingId=${listingId}&limit=50`)
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
  )
}
