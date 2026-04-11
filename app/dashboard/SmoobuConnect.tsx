'use client'

import { useState } from 'react'

interface SmoobuConnectProps {
  currentApiKey?: string | null
  currentChannelId?: number | null
  currentMarkup?: number
}

export default function SmoobuConnect({
  currentApiKey,
  currentChannelId,
  currentMarkup = 0,
}: SmoobuConnectProps) {
  const [apiKey, setApiKey] = useState('')
  const [markup, setMarkup] = useState(String(currentMarkup))
  const [loading, setLoading] = useState(false)
  const [savingMarkup, setSavingMarkup] = useState(false)
  const [error, setError] = useState('')
  const [savedMarkup, setSavedMarkup] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  // Step 2: channel selection
  const [pendingApiKey, setPendingApiKey] = useState('')
  const [availableChannels, setAvailableChannels] = useState<{ id: number; name: string }[] | null>(null)
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null)

  const isConnected = !!currentApiKey

  // Step 1: validate key + fetch available channels
  async function handleConnect() {
    if (!apiKey.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/smoobu/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Verbindung fehlgeschlagen')
      } else if (data.channels?.length > 0) {
        // Show channel picker (Step 2)
        setPendingApiKey(apiKey.trim())
        setAvailableChannels(data.channels)
        setSelectedChannelId(data.channels[0].id)
        setApiKey('')
      } else {
        setError('Keine Buchungskanäle in deinem Smoobu-Konto gefunden. Bitte erstelle zunächst eine manuelle Buchung in Smoobu, damit TRIMOSA die Channel-ID erkennen kann.')
      }
    } catch {
      setError('Netzwerkfehler. Bitte versuche es erneut.')
    }
    setLoading(false)
  }

  // Step 2: save key + chosen channel
  async function handleSaveChannel() {
    if (!pendingApiKey || !selectedChannelId) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/smoobu/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: pendingApiKey, channelId: selectedChannelId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Speichern fehlgeschlagen')
      } else {
        setAvailableChannels(null)
        setPendingApiKey('')
        setTimeout(() => window.location.reload(), 500)
      }
    } catch {
      setError('Netzwerkfehler.')
    }
    setLoading(false)
  }

  async function handleDisconnect() {
    if (!confirm('Smoobu-Verbindung wirklich trennen?')) return
    setDisconnecting(true)
    await fetch('/api/smoobu/connect', { method: 'DELETE' })
    window.location.reload()
  }

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

  async function handleSync() {
    setLoading(true)
    setError('')
    setSyncMsg('')
    try {
      const res = await fetch('/api/smoobu/sync', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setSyncMsg(data.message)
        if (data.imported > 0 || data.updated > 0) setTimeout(() => window.location.reload(), 2000)
      } else {
        setError(data.error ?? 'Sync fehlgeschlagen.')
      }
    } catch {
      setError('Netzwerkfehler beim Sync.')
    }
    setLoading(false)
  }

  return (
    <div style={{ border: '1px solid #E5E5EA', borderRadius: '16px', padding: '24px', background: '#fff' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '12px', backgroundColor: '#FAF5E4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>
            🔗
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '14px', color: '#1D1D1F' }}>Smoobu Channel Manager</div>
            <div style={{ fontSize: '12px', color: '#6E6E73' }}>Kalender · Preise · Buchungen</div>
          </div>
        </div>
        <span style={{
          fontSize: '11px', fontWeight: 600, padding: '4px 10px', borderRadius: '20px',
          backgroundColor: isConnected ? '#DCFCE7' : '#F5F5F7',
          color: isConnected ? '#16A34A' : '#6E6E73',
        }}>
          {isConnected ? '● Verbunden' : '○ Nicht verbunden'}
        </span>
      </div>

      {isConnected ? (
        /* ── Already connected ── */
        <div>
          <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '12px', padding: '12px 16px', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', color: '#15803D', fontWeight: 500 }}>✓ Smoobu ist verbunden</div>
            {currentChannelId && (
              <div style={{ fontSize: '11px', color: '#6E6E73', marginTop: '2px' }}>Channel-ID: {currentChannelId}</div>
            )}
          </div>

          {syncMsg && <div style={{ marginBottom: '10px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '10px', padding: '10px 14px', fontSize: '12px', color: '#15803D' }}>✓ {syncMsg}</div>}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <button
              onClick={handleSync}
              disabled={loading}
              style={{ flex: 1, padding: '10px', borderRadius: '12px', border: 'none', backgroundColor: '#FAF5E4', color: '#8A7020', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}
            >
              {loading ? '⟳ Lädt...' : '⟳ Apartments synchronisieren'}
            </button>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              style={{ padding: '10px 16px', borderRadius: '12px', border: '1px solid #FECACA', backgroundColor: '#FEF2F2', color: '#DC2626', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}
            >
              Trennen
            </button>
          </div>
        </div>
      ) : (
        /* ── Connect form ── */
        <div>
          {availableChannels ? (
            /* Step 2: Pick which channel TRIMOSA bookings appear under */
            <div>
              <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '12px', padding: '12px 16px', marginBottom: '14px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#15803D' }}>✓ API Key bestätigt!</div>
                <div style={{ fontSize: '11px', color: '#6E6E73', marginTop: '2px' }}>Wähle nun unter welchem Kanal TRIMOSA-Buchungen in Smoobu erscheinen sollen:</div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
                {availableChannels.map(ch => (
                  <label key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '10px', border: `1px solid ${selectedChannelId === ch.id ? '#B0912B' : '#E5E5EA'}`, background: selectedChannelId === ch.id ? '#FAF5E4' : '#fff', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="channel"
                      value={ch.id}
                      checked={selectedChannelId === ch.id}
                      onChange={() => setSelectedChannelId(ch.id)}
                      style={{ accentColor: '#B0912B' }}
                    />
                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#1D1D1F' }}>{ch.name}</span>
                    <span style={{ fontSize: '11px', color: '#999', marginLeft: 'auto' }}>ID {ch.id}</span>
                  </label>
                ))}
              </div>
              <p style={{ fontSize: '11px', color: '#999', marginBottom: '12px' }}>
                Empfehlung: Wähle den Kanal, der am besten zu direkten Website-Buchungen passt — z.B. FeWo-direkt oder den aktivsten Kanal.
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={handleSaveChannel}
                  disabled={loading || !selectedChannelId}
                  style={{ flex: 1, padding: '10px', borderRadius: '12px', border: 'none', background: 'linear-gradient(135deg, #B0912B, #8A7020)', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}
                >
                  {loading ? 'Speichere...' : 'Verbindung speichern'}
                </button>
                <button
                  onClick={() => { setAvailableChannels(null); setPendingApiKey('') }}
                  style={{ padding: '10px 14px', borderRadius: '12px', border: '1px solid #E5E5EA', background: '#fff', fontSize: '13px', cursor: 'pointer', color: '#666' }}
                >
                  Zurück
                </button>
              </div>
            </div>
          ) : (
            /* Step 1: Enter API key */
            <div>
              <div style={{ background: '#F9F7F3', borderRadius: '12px', padding: '14px 16px', marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#1D1D1F', marginBottom: '8px' }}>So verbindest du Smoobu in 3 Schritten:</div>
                <ol style={{ margin: 0, padding: '0 0 0 16px', fontSize: '12px', color: '#444', lineHeight: '1.8' }}>
                  <li>Melde dich in <strong>Smoobu</strong> an (<a href="https://login.smoobu.com" target="_blank" rel="noreferrer" style={{ color: '#B0912B' }}>login.smoobu.com</a>)</li>
                  <li>Gehe zu <strong>Einstellungen → API</strong> (oben rechts, Zahnrad-Symbol)</li>
                  <li>Kopiere deinen <strong>API Key</strong> und füge ihn hier ein</li>
                </ol>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleConnect()}
                  placeholder="Smoobu API Key einfügen..."
                  style={{ flex: 1, padding: '10px 14px', borderRadius: '12px', border: '1px solid #D2D2D7', fontSize: '13px', outline: 'none' }}
                />
                <button
                  onClick={handleConnect}
                  disabled={loading || !apiKey.trim()}
                  style={{ padding: '10px 18px', borderRadius: '12px', border: 'none', background: 'linear-gradient(135deg, #B0912B, #8A7020)', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: loading || !apiKey.trim() ? 0.6 : 1 }}
                >
                  {loading ? '...' : 'Weiter'}
                </button>
              </div>
              <p style={{ fontSize: '11px', color: '#999', marginTop: '6px' }}>
                TRIMOSA prüft den Key und zeigt dir deine verfügbaren Buchungskanäle zur Auswahl.
              </p>
            </div>
          )}
        </div>
      )}


      {error && (
        <div style={{ marginTop: '12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '12px', padding: '12px 16px' }}>
          <p style={{ fontSize: '13px', color: '#DC2626', margin: 0 }}>⚠ {error}</p>
        </div>
      )}

      {/* ── Markup setting (platform-wide) ── */}
      <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #F0EDE6' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#1D1D1F', marginBottom: '4px' }}>Preisanpassung auf TRIMOSA</div>
        <p style={{ fontSize: '11px', color: '#6E6E73', marginBottom: '10px' }}>
          Prozentualer Aufschlag auf Smoobu-Basispreise. 0 = keine Anpassung.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ position: 'relative' }}>
            <input
              type="number" min="-50" max="100" step="0.5"
              value={markup}
              onChange={e => setMarkup(e.target.value)}
              style={{ width: '90px', padding: '8px 28px 8px 12px', borderRadius: '10px', border: '1px solid #D2D2D7', fontSize: '13px', outline: 'none' }}
            />
            <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '12px', color: '#999' }}>%</span>
          </div>
          <button
            onClick={handleSaveMarkup}
            disabled={savingMarkup}
            style={{ padding: '8px 16px', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg, #B0912B, #8A7020)', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: savingMarkup ? 0.6 : 1 }}
          >
            {savingMarkup ? '...' : savedMarkup ? '✓' : 'Speichern'}
          </button>
          {parseFloat(markup) !== 0 && !isNaN(parseFloat(markup)) && (
            <span style={{ fontSize: '11px', color: '#6E6E73' }}>
              z.B. €100 → €{Math.round(100 * (1 + parseFloat(markup) / 100))}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
