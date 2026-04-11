'use client'

import { useState } from 'react'
import { supabaseBrowser as supabase } from '@/lib/supabase-browser'

interface SmoobuConnectProps {
  currentApiKey?: string
  currentMarkup?: number
}

export default function SmoobuConnect({ currentApiKey, currentMarkup = 0 }: SmoobuConnectProps) {
  const [apiKey, setApiKey] = useState(currentApiKey ?? '')
  const [markup, setMarkup] = useState(String(currentMarkup))
  const [saving, setSaving] = useState(false)
  const [savingMarkup, setSavingMarkup] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [saved, setSaved] = useState(false)
  const [savedMarkup, setSavedMarkup] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function handleSaveMarkup() {
    setSavingMarkup(true)
    const pct = parseFloat(markup) || 0
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform_markup_pct: pct }),
    })
    if (res.ok) { setSavedMarkup(true); setTimeout(() => setSavedMarkup(false), 3000) }
    setSavingMarkup(false)
  }

  async function handleSaveKey() {
    if (!apiKey.trim()) return
    setSaving(true)
    setError('')
    const { error } = await supabase.auth.updateUser({
      data: { smoobu_api_key: apiKey.trim() }
    })
    if (error) {
      setError('Speichern fehlgeschlagen: ' + error.message)
    } else {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }
    setSaving(false)
  }

  async function handleSync() {
    setSyncing(true)
    setSyncResult(null)
    setError('')
    try {
      const res = await fetch('/api/smoobu/sync', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setSyncResult(data.message)
        if (data.errors && data.errors.length > 0) {
          setError('Einige Fehler: ' + data.errors.join('; '))
        }
        // Reload page to show newly imported listings
        if (data.imported > 0 || data.updated > 0) {
          setTimeout(() => window.location.reload(), 2000)
        }
      } else {
        setError(data.error ?? 'Sync fehlgeschlagen.')
      }
    } catch {
      setError('Netzwerkfehler beim Sync. Bitte versuche es erneut.')
    }
    setSyncing(false)
  }

  const isConnected = !!currentApiKey || saved

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm" style={{ border: '1px solid #E5E5EA' }}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: '#FAF5E4' }}>
            <span className="text-lg">🔗</span>
          </div>
          <div>
            <h3 className="font-semibold text-sm" style={{ color: '#1D1D1F' }}>Smoobu Verbindung</h3>
            <p className="text-xs" style={{ color: '#6E6E73' }}>Channel Manager Integration</p>
          </div>
        </div>
        <span className="text-xs font-medium px-2.5 py-1 rounded-full"
          style={isConnected
            ? { backgroundColor: '#DCFCE7', color: '#16A34A' }
            : { backgroundColor: '#F5F5F7', color: '#6E6E73' }
          }>
          {isConnected ? '● Verbunden' : '○ Nicht verbunden'}
        </span>
      </div>

      <p className="text-sm mb-4" style={{ color: '#6E6E73' }}>
        Verbinde dein Smoobu-Konto, um Verfügbarkeiten & Preise automatisch zu synchronisieren
        und Buchungen zurück zu übertragen.
      </p>

      {/* API Key Input */}
      <div className="flex gap-2 mb-3">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Smoobu API Key eingeben..."
          className="flex-1 rounded-xl px-4 py-2.5 text-sm transition-all"
          style={{ border: '1px solid #D2D2D7', color: '#1D1D1F', outline: 'none' }}
        />
        <button
          onClick={handleSaveKey}
          disabled={saving || !apiKey.trim()}
          className="px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-all disabled:opacity-50 whitespace-nowrap"
          style={{ background: 'linear-gradient(135deg, #B0912B, #8A7020)' }}
        >
          {saving ? '...' : saved ? '✓ Gespeichert' : 'Speichern'}
        </button>
      </div>

      <p className="text-xs mb-4" style={{ color: '#6E6E73' }}>
        Den API Key findest du in Smoobu unter{' '}
        <span className="font-mono px-1 py-0.5 rounded text-xs" style={{ backgroundColor: '#F5F5F7' }}>
          Einstellungen → API
        </span>
      </p>

      {/* Sync Button */}
      <button
        onClick={handleSync}
        disabled={syncing || !isConnected}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ backgroundColor: '#FAF5E4', color: '#8A7020' }}
      >
        <svg className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        {syncing ? 'Synchronisiere...' : 'Apartments aus Smoobu importieren'}
      </button>

      {syncResult && (
        <div className="mt-3 rounded-xl px-4 py-3" style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0' }}>
          <p className="text-sm font-medium" style={{ color: '#16A34A' }}>✓ {syncResult}</p>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-xl px-4 py-3" style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}>
          <p className="text-sm" style={{ color: '#DC2626' }}>{error}</p>
        </div>
      )}

      {/* ── Preisaufschlag ── */}
      <div className="mt-5 pt-5" style={{ borderTop: '1px solid #F0EDE6' }}>
        <h4 className="text-sm font-semibold mb-1" style={{ color: '#1D1D1F' }}>Preisanpassung für TRIMOSA</h4>
        <p className="text-xs mb-3" style={{ color: '#6E6E73' }}>
          Smoobu-Basispreise werden auf der Plattform angepasst. Positiv = Aufschlag, negativ = Abschlag. 0 = keine Anpassung.
        </p>
        <div className="flex items-center gap-2">
          <div className="relative flex items-center">
            <input
              type="number"
              min="-50"
              max="50"
              step="0.5"
              value={markup}
              onChange={e => setMarkup(e.target.value)}
              className="rounded-xl px-4 py-2.5 text-sm pr-8"
              style={{ border: '1px solid #D2D2D7', color: '#1D1D1F', outline: 'none', width: '100px' }}
            />
            <span className="absolute right-3 text-sm" style={{ color: '#999' }}>%</span>
          </div>
          <button
            onClick={handleSaveMarkup}
            disabled={savingMarkup}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-all disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #B0912B, #8A7020)' }}
          >
            {savingMarkup ? '...' : savedMarkup ? '✓ Gespeichert' : 'Speichern'}
          </button>
          {parseFloat(markup) !== 0 && !isNaN(parseFloat(markup)) && (
            <span className="text-xs" style={{ color: parseFloat(markup) > 0 ? '#6E6E73' : '#E07000' }}>
              z.B. €100 → €{Math.round(100 * (1 + parseFloat(markup) / 100))}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
