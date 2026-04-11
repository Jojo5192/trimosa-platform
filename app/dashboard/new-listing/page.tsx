'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createListing } from '../actions'

export default function NewListingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    title: '',
    description: '',
    location: '',
    price_per_night: '',
    max_guests: '',
    bedrooms: '',
  })

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!form.title || !form.location || !form.price_per_night) {
      setError('Bitte Titel, Ort und Preis angeben.')
      return
    }

    setLoading(true)
    try {
      await createListing({
        title: form.title,
        description: form.description,
        location: form.location,
        price_per_night: parseInt(form.price_per_night),
        max_guests: parseInt(form.max_guests) || 2,
        bedrooms: parseInt(form.bedrooms) || 1,
      })
      router.push('/dashboard')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Fehler beim Erstellen.')
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen" style={{ backgroundColor: '#F5F5F7' }}>

      {/* Mini-Nav */}
      <nav className="flex items-center justify-between px-8 py-4 bg-white" style={{ borderBottom: '1px solid #E5E5EA' }}>
        <Link href="/" className="h-8">
          <img src="/logo.png" alt="TRIMOSA" className="h-8 w-auto object-contain" />
        </Link>
        <Link href="/dashboard" className="text-sm font-medium hover:underline" style={{ color: '#B0912B' }}>
          ← Dashboard
        </Link>
      </nav>

      <div className="max-w-2xl mx-auto px-8 py-12">
        <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#B0912B' }}>Gastgeber</p>
        <h1 className="text-3xl font-bold tracking-tight mb-2" style={{ color: '#1D1D1F' }}>Neues Inserat</h1>
        <p className="mb-8" style={{ color: '#6E6E73' }}>Füge deine Unterkunft der TRIMOSA Plattform hinzu.</p>

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Titel */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Titel <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              name="title"
              value={form.title}
              onChange={handleChange}
              placeholder="z.B. Chalet am Schliersee mit Seeblick"
              className="w-full rounded-xl px-4 py-3 text-sm" style={{ border: '1px solid #D2D2D7', color: '#1D1D1F', backgroundColor: '#fff' }}
            />
          </div>

          {/* Beschreibung */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Beschreibung
            </label>
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              rows={4}
              placeholder="Beschreibe deine Unterkunft..."
              className="w-full rounded-xl px-4 py-3 text-sm resize-none" style={{ border: '1px solid #D2D2D7', color: '#1D1D1F', backgroundColor: '#fff' }}
            />
          </div>

          {/* Ort */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Ort <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              name="location"
              value={form.location}
              onChange={handleChange}
              placeholder="z.B. Schliersee, Bayern"
              className="w-full rounded-xl px-4 py-3 text-sm" style={{ border: '1px solid #D2D2D7', color: '#1D1D1F', backgroundColor: '#fff' }}
            />
          </div>

          {/* Preis / Gäste / Schlafzimmer */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Preis/Nacht (€) <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                name="price_per_night"
                value={form.price_per_night}
                onChange={handleChange}
                placeholder="120"
                min="1"
                className="w-full rounded-xl px-4 py-3 text-sm" style={{ border: '1px solid #D2D2D7', color: '#1D1D1F', backgroundColor: '#fff' }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max. Gäste
              </label>
              <input
                type="number"
                name="max_guests"
                value={form.max_guests}
                onChange={handleChange}
                placeholder="4"
                min="1"
                className="w-full rounded-xl px-4 py-3 text-sm" style={{ border: '1px solid #D2D2D7', color: '#1D1D1F', backgroundColor: '#fff' }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Schlafzimmer
              </label>
              <input
                type="number"
                name="bedrooms"
                value={form.bedrooms}
                onChange={handleChange}
                placeholder="2"
                min="1"
                className="w-full rounded-xl px-4 py-3 text-sm" style={{ border: '1px solid #D2D2D7', color: '#1D1D1F', backgroundColor: '#fff' }}
              />
            </div>
          </div>

          {error && (
            <div className="rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA', color: '#DC2626' }}>
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Link
              href="/dashboard"
              className="flex-1 text-center py-3 rounded-xl text-sm font-medium transition-colors"
              style={{ border: '1px solid #D2D2D7', color: '#1D1D1F', backgroundColor: '#fff' }}
            >
              Abbrechen
            </Link>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-3 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50 shadow-sm"
              style={{ background: 'linear-gradient(135deg, #B0912B, #8A7020)' }}
            >
              {loading ? 'Wird erstellt…' : 'Inserat erstellen'}
            </button>
          </div>

        </form>
      </div>
    </main>
  )
}
